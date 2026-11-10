// Test-only ZIP writer (store + deflate), to build small .docx/.xlsx fixtures in memory.
import { deflateRawSync } from "node:zlib";

const CRC_TABLE = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();
function crc32(b: Buffer): number {
	let c = 0xffffffff;
	for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

export function makeZip(entries: Record<string, string | Buffer>, deflate = true): Buffer {
	const locals: Buffer[] = [];
	const central: Buffer[] = [];
	let offset = 0;
	for (const [name, content] of Object.entries(entries)) {
		const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
		const comp = deflate ? deflateRawSync(data) : data;
		const nameBuf = Buffer.from(name, "utf8");
		const crc = crc32(data);
		const lh = Buffer.alloc(30);
		lh.writeUInt32LE(0x04034b50, 0);
		lh.writeUInt16LE(20, 4);
		lh.writeUInt16LE(0x800, 6);
		lh.writeUInt16LE(deflate ? 8 : 0, 8);
		lh.writeUInt32LE(crc, 14);
		lh.writeUInt32LE(comp.length, 18);
		lh.writeUInt32LE(data.length, 22);
		lh.writeUInt16LE(nameBuf.length, 26);
		locals.push(lh, nameBuf, comp);
		const ch = Buffer.alloc(46);
		ch.writeUInt32LE(0x02014b50, 0);
		ch.writeUInt16LE(20, 4);
		ch.writeUInt16LE(20, 6);
		ch.writeUInt16LE(0x800, 8);
		ch.writeUInt16LE(deflate ? 8 : 0, 10);
		ch.writeUInt32LE(crc, 16);
		ch.writeUInt32LE(comp.length, 20);
		ch.writeUInt32LE(data.length, 24);
		ch.writeUInt16LE(nameBuf.length, 28);
		ch.writeUInt32LE(offset, 42);
		central.push(ch, nameBuf);
		offset += 30 + nameBuf.length + comp.length;
	}
	const cd = Buffer.concat(central);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(Object.keys(entries).length, 8);
	end.writeUInt16LE(Object.keys(entries).length, 10);
	end.writeUInt32LE(cd.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, cd, end]);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const para = (t: string) => `<w:p><w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`;

/** A minimal .docx: paragraphs, then tables (rows of cells). */
export function makeDocx(paragraphs: string[], tables: string[][][] = []): Buffer {
	const tbl = tables.map((t) => `<w:tbl>${t.map((r) => `<w:tr>${r.map((c) => `<w:tc>${c.split("\n").map(para).join("")}</w:tc>`).join("")}</w:tr>`).join("")}</w:tbl>`).join("");
	const doc = `<?xml version="1.0"?><w:document xmlns:w="w"><w:body>${paragraphs.map(para).join("")}${tbl}<w:sectPr/></w:body></w:document>`;
	return makeZip({ "[Content_Types].xml": "<Types/>", "word/document.xml": doc });
}

/** A minimal .xlsx: one or more sheets of rows given as column-letter → text (strings go to sharedStrings). */
export function makeXlsx(sheets: { name: string; rows: Record<string, string>[] }[]): Buffer {
	const ss: string[] = [];
	const idx = (s: string) => (ss.includes(s) ? ss.indexOf(s) : ss.push(s) - 1);
	const parts: Record<string, string> = {};
	sheets.forEach((sh, i) => {
		const rows = sh.rows
			.map((r, n) => `<row r="${n + 1}">${Object.entries(r).map(([c, v]) => (/^-?\d+(\.\d+)?$/.test(v) ? `<c r="${c}${n + 1}"><v>${v}</v></c>` : `<c r="${c}${n + 1}" t="s"><v>${idx(v)}</v></c>`)).join("")}</row>`)
			.join("");
		parts[`xl/worksheets/sheet${i + 1}.xml`] = `<worksheet><sheetData>${rows}</sheetData></worksheet>`;
	});
	parts["xl/workbook.xml"] = `<workbook><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`;
	parts["xl/_rels/workbook.xml.rels"] = `<Relationships>${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`;
	parts["xl/sharedStrings.xml"] = `<sst>${ss.map((s) => `<si><t>${esc(s)}</t></si>`).join("")}</sst>`;
	return makeZip(parts);
}
