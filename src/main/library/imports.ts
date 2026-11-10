// Library v2 imports from the office's own spreadsheets (read-only):
//   02_Iepirkumi_BD_jauns.xlsx                 → tracker rows (2022–2025 layout and the 2026 triage layout)
//   00_Specialistu un apaksuznemeju reg..xlsx  → design subcontractors
// Columns are found by their header text, not by letter: the yearly sheets do not share a layout.
import { randomUUID } from "node:crypto";
import type { Subcontractor, TrackerDecision, TrackerResult, TrackerRow } from "../../shared/library.js";
import { clean, excelDate, type XlsxSheet } from "../office.js";

const norm = (s: string) => clean(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** "65 800,00" · "1437577.07" · "4 509.50" · "78400" → cents; null when it is not an amount. */
export function parseEur(s: string): number | null {
	const t = s.replace(/[\s ]/g, "").replace(/(eur|€)$/i, "");
	if (!/^\d+([.,]\d+)*$/.test(t)) return null;
	const m = t.match(/^(.*?)(?:[.,](\d{1,2}))?$/)!;
	const whole = m[1].replace(/[.,]/g, "");
	if (!whole) return null;
	return Number(whole) * 100 + (m[2] ? Number(m[2].padEnd(2, "0")) : 0);
}

/** dd.mm.yyyy or an Excel serial → YYYY-MM-DD. */
export function parseDay(s: string | undefined): string | null {
	if (!s) return null;
	const d = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
	if (d) return `${d[3]}-${d[2].padStart(2, "0")}-${d[1].padStart(2, "0")}`;
	return excelDate(s.trim());
}

export function parseResult(text: string, submitted: boolean | null): TrackerResult {
	const t = norm(text);
	if (/zaud|zaid/.test(t)) return "zaudejums";
	if (/partraukt|atcelt|neviens piedavajums/.test(t)) return "parstraukts";
	if (/uzvar|ligums noslegts|ligum[as]* slegsanas|^ligums|pirmie|1\. ?vieta|izturet/.test(t)) return "uzvara";
	if (submitted) return "gaida";
	return "nav";
}

const DECISIONS: [RegExp, TrackerDecision][] = [
	[/^liekam/, "liekam"],
	[/^neinterese/, "neinteresē"],
	[/interese.*nav pieredz/, "interesē_nav_pieredzes"],
	[/partraukt/, "pārtraukts"],
];

/** The first company + amount a comment names: „SIA “Livland Group” 65 800,00 EUR” → winner and cents. */
export function parseWinner(text: string): { winner: string; cents: number } | null {
	const m = clean(text).match(/((?:SIA|AS|PS|Personu apvienība|IK|VSIA)\b[^\d]{2,120}?)\s*(\d[\d\s.,]*\d)\s*(?:EUR|eur|€)/);
	if (!m) return null;
	const cents = parseEur(m[2]);
	if (cents === null) return null;
	return { winner: m[1].replace(/[\s,]+$/, "").trim(), cents };
}

type Col = "decision" | "submitted" | "deadline" | "url" | "title" | "work" | "purchaser" | "procedure" | "subject" | "ourAmount" | "comment" | "result";
const HEADERS: [Col, RegExp][] = [
	["decision", /^liekam/],
	// "Iesniegs / Neiesniegts" — the slash matters: "Iesniegšanas termiņš" starts the same way
	["submitted", /^iesniegt?s\s*\//],
	["deadline", /^iesniegsanas (termins|datums)/],
	["url", /^saite/],
	["title", /^iepirkuma nosaukums/],
	["work", /^darbu veids \(/],
	["purchaser", /^pasutitajs/],
	["procedure", /^iepirkuma veids/],
	["subject", /^darbu veids$/],
	["ourAmount", /^bd summa/],
	["comment", /^celonis/],
	["result", /^rezultats/],
];

export function parseTrackerSheet(sheet: XlsxSheet): TrackerRow[] {
	const hi = sheet.rows.findIndex((r) => Object.values(r.cells).some((v) => /^iepirkuma nosaukums/.test(norm(v))));
	if (hi < 0) return [];
	const cols: Partial<Record<Col, string>> = {};
	for (const [letter, text] of Object.entries(sheet.rows[hi].cells)) {
		const h = norm(text);
		const hit = HEADERS.find(([, re]) => re.test(h));
		if (hit && !cols[hit[0]]) cols[hit[0]] = letter;
	}
	const legacy = !cols.decision;
	const out: TrackerRow[] = [];
	for (const r of sheet.rows.slice(hi + 1)) {
		const get = (c: Col) => (cols[c] ? clean(r.cells[cols[c]!] ?? "") : "");
		const title = get("title");
		if (!title) continue;
		const subTxt = norm(get("submitted"));
		const submitted = legacy ? true : subTxt.startsWith("iesniegts") ? true : subTxt.startsWith("neiesniegts") ? false : null;
		const resultText = [get("result"), get("comment")].filter(Boolean).join(" · ");
		const [purchaser, ...rest] = get("purchaser").split("/").map((x) => x.trim());
		const builders = rest.filter((x) => x && x.length <= 30);
		const winner = parseWinner(resultText);
		const amount = get("ourAmount");
		out.push({
			sheet: sheet.name,
			row: r.n,
			title,
			work: get("work"),
			purchaser: builders.length ? purchaser : get("purchaser"),
			builders,
			ourAmount: amount,
			ourCents: parseEur(amount),
			deadline: parseDay(cols.deadline ? r.cells[cols.deadline] : undefined),
			procedure: get("procedure"),
			subject: get("subject"),
			decision: DECISIONS.find(([re]) => re.test(norm(get("decision"))))?.[1] ?? "",
			submitted,
			result: parseResult(resultText, submitted),
			comment: resultText,
			winner: winner?.winner ?? null,
			winnerCents: winner?.cents ?? null,
			eisUrl: /^https?:\/\//.test(get("url")) ? get("url") : null,
		});
	}
	return out;
}

export function parseTracker(sheets: XlsxSheet[]): TrackerRow[] {
	return sheets.flatMap(parseTrackerSheet);
}

export interface TrackerStats {
	sheet: string;
	rows: number;
	submitted: number;
	won: number;
	lost: number;
	decided: Partial<Record<TrackerDecision, number>>;
}
export function trackerStats(rows: TrackerRow[]): TrackerStats[] {
	const by = new Map<string, TrackerStats>();
	for (const r of rows) {
		const s = by.get(r.sheet) ?? { sheet: r.sheet, rows: 0, submitted: 0, won: 0, lost: 0, decided: {} };
		s.rows++;
		if (r.submitted) s.submitted++;
		if (r.result === "uzvara") s.won++;
		if (r.result === "zaudejums") s.lost++;
		if (r.decision) s.decided[r.decision] = (s.decided[r.decision] ?? 0) + 1;
		by.set(r.sheet, s);
	}
	return [...by.values()];
}

/**
 * Subcontractor register: a row that names a company or person starts a contact; following rows that carry only
 * a projekta sadaļa add that part to the same contact (the sheet lists one firm's parts on consecutive rows).
 */
export function parseSubcontractors(sheet: XlsxSheet): Subcontractor[] {
	const hi = sheet.rows.findIndex((r) => Object.values(r.cells).some((v) => /uznemuma nosaukums/.test(norm(v))));
	if (hi < 0) return [];
	const h = sheet.rows[hi].cells;
	const find = (re: RegExp) => Object.entries(h).find(([, v]) => re.test(norm(v)))?.[0];
	const cPart = find(/sadal/) ?? "A";
	const cCompany = find(/uznemuma nosaukums/) ?? "B";
	const cPerson = find(/uzvards/) ?? "C";
	const cPhone = find(/telefon/) ?? "D";
	const cMail = find(/e-pasts/) ?? "E";
	const cNote = find(/piezim/) ?? "I";
	// the ratings sit under "Apraksts" in three columns named on the next row (Cena / Kvalitāte / Termiņi)
	const sub = sheet.rows[hi + 1]?.cells ?? {};
	const subFind = (re: RegExp) => Object.entries(sub).find(([, v]) => re.test(norm(v)))?.[0];
	const cPrice = subFind(/^cena/);
	const cQual = subFind(/^kvalit/);
	const cTerm = subFind(/^termin/);
	const out: Subcontractor[] = [];
	let cur: Subcontractor | null = null;
	for (const r of sheet.rows.slice(hi + 1)) {
		const v = (c?: string) => (c ? clean(r.cells[c] ?? "") : "");
		if (r === sheet.rows[hi + 1] && cPrice) continue;
		const company = v(cCompany);
		const person = v(cPerson);
		const part = v(cPart);
		if (company || person) {
			cur = { id: randomUUID(), company, person, phone: v(cPhone), email: v(cMail), parts: part ? [part] : [], price: v(cPrice), quality: v(cQual), terms: v(cTerm), note: v(cNote), source: `xlsx:${r.n}` };
			out.push(cur);
		} else if (part && cur && !cur.parts.includes(part)) cur.parts.push(part);
	}
	return out;
}
