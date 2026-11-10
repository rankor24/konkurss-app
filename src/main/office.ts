// Read-only text out of .xlsx and .docx, in Node (no Python needed). Used for registers that live in office
// spreadsheets (tracker, subcontractors) and for reading earlier submitted forms during harvesting.
// Values are returned verbatim (whitespace collapsed), so they can serve as quotes.
import { ZipReader } from "./zip.js";

export function decodeXml(s: string): string {
	return s
		.replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
		.replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&");
}
export const clean = (s: string) => s.replace(/[\s ]+/g, " ").trim();

// ---------------- xlsx ----------------
export interface XlsxRow {
	/** 1-based row number in the sheet */
	n: number;
	/** column letter → cell text (numbers as written in the file, e.g. "1234.5") */
	cells: Record<string, string>;
}
export interface XlsxSheet {
	name: string;
	rows: XlsxRow[];
}

function sharedStrings(z: ZipReader): string[] {
	const x = z.text("xl/sharedStrings.xml");
	if (!x) return [];
	return [...x.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => decodeXml([...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
}

/** Sheet name → part path, through workbook.xml and its relationships. */
function sheetParts(z: ZipReader): { name: string; part: string }[] {
	const wb = z.text("xl/workbook.xml") ?? "";
	const rels = z.text("xl/_rels/workbook.xml.rels") ?? "";
	const target = new Map([...rels.matchAll(/<Relationship\b([^>]*)\/?>/g)].map((m) => [m[1].match(/Id="([^"]+)"/)?.[1] ?? "", m[1].match(/Target="([^"]+)"/)?.[1] ?? ""]));
	return [...wb.matchAll(/<sheet\b([^>]*)\/?>/g)].map((m) => {
		const name = decodeXml(m[1].match(/name="([^"]*)"/)?.[1] ?? "");
		const rid = m[1].match(/r:id="([^"]+)"/)?.[1] ?? "";
		let t = target.get(rid) ?? "";
		t = t.startsWith("/") ? t.slice(1) : `xl/${t}`;
		return { name, part: t };
	});
}

export function readXlsx(path: string): XlsxSheet[] {
	return readXlsxZip(ZipReader.fromFile(path));
}
export function readXlsxZip(z: ZipReader): XlsxSheet[] {
	const ss = sharedStrings(z);
	return sheetParts(z).map(({ name, part }) => {
		const x = z.text(part) ?? "";
		const rows: XlsxRow[] = [];
		for (const r of x.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
			const n = Number(r[1].match(/\br="(\d+)"/)?.[1] ?? rows.length + 1);
			const cells: Record<string, string> = {};
			for (const c of r[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
				const col = c[1].match(/\br="([A-Z]+)\d+"/)?.[1];
				if (!col || !c[2]) continue;
				const type = c[1].match(/\bt="([^"]+)"/)?.[1];
				let v: string | null = null;
				if (type === "inlineStr") v = decodeXml([...c[2].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""));
				else {
					const raw = c[2].match(/<v>([\s\S]*?)<\/v>/)?.[1];
					if (raw === undefined) continue;
					v = type === "s" ? (ss[Number(raw)] ?? "") : decodeXml(raw);
				}
				if (v !== null && v !== "") cells[col] = v;
			}
			if (Object.keys(cells).length) rows.push({ n, cells });
		}
		return { name, rows };
	});
}

/** Excel serial date (1900 system) → YYYY-MM-DD; null when not a plausible serial. */
export function excelDate(v: string): string | null {
	const n = Number(v);
	if (!Number.isFinite(n) || n < 20000 || n > 80000) return null;
	const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86_400_000);
	return d.toISOString().slice(0, 10);
}

// ---------------- docx ----------------
export interface DocxContent {
	paragraphs: string[];
	/** table → row → cell text */
	tables: string[][][];
}

/** Text runs of one paragraph in order; tabs and line breaks become spaces. */
const paraText = (xml: string) =>
	clean([...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g)].map((m) => (m[1] !== undefined ? decodeXml(m[1]) : " ")).join(""));

/** Text of every <w:p> in `xml`, in order. */
function paragraphsOf(xml: string): string[] {
	return [...xml.matchAll(/<w:p\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:p>)/g)].map((m) => paraText(m[1] ?? ""));
}

/** Splits `xml` into top-level elements named `tag`, honouring nesting of the same tag. */
function topLevel(xml: string, tag: string): { start: number; end: number; inner: string }[] {
	const out: { start: number; end: number; inner: string }[] = [];
	const re = new RegExp(`<${tag}\\b[^>]*?(/?)>|</${tag}>`, "g");
	let depth = 0;
	let start = -1;
	let innerStart = -1;
	for (const m of xml.matchAll(re)) {
		const isClose = m[0].startsWith("</");
		if (!isClose && m[1] === "/") {
			if (depth === 0) out.push({ start: m.index!, end: m.index! + m[0].length, inner: "" });
			continue;
		}
		if (!isClose) {
			if (depth === 0) {
				start = m.index!;
				innerStart = m.index! + m[0].length;
			}
			depth++;
		} else {
			depth--;
			if (depth === 0) out.push({ start, end: m.index! + m[0].length, inner: xml.slice(innerStart, m.index!) });
		}
	}
	return out;
}

export function readDocx(path: string): DocxContent {
	return readDocxZip(ZipReader.fromFile(path));
}
export function readDocxZip(z: ZipReader): DocxContent {
	const doc = z.text("word/document.xml");
	if (!doc) throw new Error("Nav Word dokuments (trūkst word/document.xml).");
	const body = doc.match(/<w:body>([\s\S]*)<\/w:body>/)?.[1] ?? doc;
	const tables: string[][][] = [];
	const paragraphs: string[] = [];
	let last = 0;
	for (const t of topLevel(body, "w:tbl")) {
		paragraphs.push(...paragraphsOf(body.slice(last, t.start)));
		tables.push(topLevel(t.inner, "w:tr").map((tr) => topLevel(tr.inner, "w:tc").map((tc) => clean(paragraphsOf(tc.inner).join(" ")))));
		last = t.end;
	}
	paragraphs.push(...paragraphsOf(body.slice(last)));
	return { paragraphs: paragraphs.filter(Boolean), tables };
}

/** All text of a document as one string (paragraphs, then table cells), for searching. */
export function docxPlainText(c: DocxContent): string {
	return [...c.paragraphs, ...c.tables.flatMap((t) => t.map((r) => r.join(" | ")))].join("\n");
}
