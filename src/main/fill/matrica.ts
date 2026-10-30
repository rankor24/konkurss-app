// Atbildības matrica (xlsx): which model each author makes in which project phase, and at which LOD.
// Layout is found from the sheet's own header cells ("Autors" / "LOD" pairs), never from fixed cell numbers.
import { z } from "zod";
import type { Citation, ProjectState } from "../../shared/state.js";
import type { InspectedSheet, XlsxEdit } from "../pytools.js";
import { numberInQuote } from "../tasks/grounding-extra.js";
import { locateQuote, type DocInput } from "../tasks/grounding.js";

export const DEFAULT_PHASES = ["KC", "ST", "DT", "AP", "BV", "IM", "AIM"];
export const DESIGN_PHASES = new Set(["KC", "ST", "DT", "AP"]);

const colNum = (letters: string) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const colName = (n: number) => {
	let s = "";
	for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
	return s;
};
const split = (ref: string) => {
	const m = ref.match(/^([A-Z]+)(\d+)$/)!;
	return { col: colNum(m[1]), row: Number(m[2]) };
};
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

export interface MatrixRow {
	row: number;
	/** model code, e.g. "AR", "AVK-A", "UK" */
	code: string;
	title: string;
	section: string;
	kind: "model" | "combined" | "other";
}
export interface MatrixLayout {
	sheet: string;
	phases: string[];
	authorCols: number[];
	lodCols: number[];
	rows: MatrixRow[];
	/** true when the template's own phase header row was unusable and defaults were used */
	phasesAssumed: boolean;
}

/** Finds the author/LOD column pairs and the model rows. Returns null if the sheet is not such a matrix. */
export function matrixLayout(sheet: InspectedSheet): MatrixLayout | null {
	const cells = sheet.cells;
	const entries = Object.entries(cells).map(([ref, v]) => ({ ...split(ref), v: v as string }));
	const byRow = new Map<number, typeof entries>();
	for (const e of entries) byRow.set(e.row, [...(byRow.get(e.row) ?? []), e]);

	// header row: at least 3 cells starting with Autors/Atbildīgais whose right neighbour is "LOD"
	let header = 0;
	let authorCols: number[] = [];
	for (const [row, list] of byRow) {
		const cols = list.filter((e) => /^(autors|atbildig)/.test(norm(e.v)) && norm(cells[`${colName(e.col + 1)}${row}`] ?? "") === "lod").map((e) => e.col);
		if (cols.length >= 3 && (header === 0 || row < header)) {
			header = row;
			authorCols = cols.sort((a, b) => a - b);
		}
	}
	if (!header) return null;

	const above = authorCols.map((c) => (cells[`${colName(c)}${header - 1}`] ?? "").trim());
	const distinct = new Set(above.filter(Boolean));
	const usable = above.every(Boolean) && distinct.size === above.length;
	const phases = usable ? above : authorCols.map((_, i) => DEFAULT_PHASES[i] ?? `F${i + 1}`);

	// the code/title column is the one with the most "XX Title" texts below the header
	const labelCol = [...new Set(entries.filter((e) => e.row > header).map((e) => e.col))]
		.map((col) => ({ col, n: entries.filter((e) => e.col === col && e.row > header && /^[A-Z]{1,4}(?:[-\s][A-Z]{1,3})?(?:\s*\([^)]*\))?\s+\S/.test(e.v)).length }))
		.sort((a, b) => b.n - a.n)[0]?.col;
	if (!labelCol) return null;

	const rows: MatrixRow[] = [];
	let section = "";
	let inOther = false;
	for (const e of entries.filter((x) => x.row > header).sort((a, b) => a.row - b.row)) {
		if (e.col < labelCol && /^[A-ZĀČĒĢĪĶĻŅŠŪŽ\s\-ĀĒĪ]{6,}/.test(e.v) && e.col === labelCol - 1) {
			section = e.v.replace(/\s+/g, " ").trim();
			inOther = /citi bim nodevumi/i.test(e.v);
			continue;
		}
		if (e.col !== labelCol) continue;
		const m = e.v.match(/^([A-Z]{1,4}(?:[-\s][A-Z]{1,3})?)(?:\s*\(([^)]*)\))?\s+(.*)$/);
		if (/^savietotais modelis/i.test(e.v)) rows.push({ row: e.row, code: "SAVIETOTAIS", title: e.v, section, kind: "combined" });
		else if (m && !inOther) rows.push({ row: e.row, code: m[1].replace(/\s/g, "-"), title: e.v, section, kind: "model" });
		else if (inOther && e.v.length > 3 && e.v !== "…") rows.push({ row: e.row, code: "", title: e.v, section, kind: "other" });
	}
	return { sheet: sheet.name, phases, authorCols, lodCols: authorCols.map((c) => c + 1), rows, phasesAssumed: !usable };
}

const splitParts = (part: string) =>
	part
		.split(/[,;/\n]+/)
		.map((p) => p.trim().toUpperCase().replace(/\s+/g, "-"))
		.filter(Boolean);

/** Person responsible for a model in a phase: from the design roles (KC–AP) or the builder's roles (BV–AIM). */
export function authorFor(row: MatrixRow, phase: string, state: ProjectState, builder?: string): string {
	const side = DESIGN_PHASES.has(phase) ? state.roles.design : builder ? (state.roles.build[builder] ?? []) : [];
	if (row.kind === "combined") return side.find((r) => /koordinator|savietot/i.test(r.role))?.person.trim() ?? "";
	const hit = side.find((r) => splitParts(r.part).includes(row.code) && !/koordinator/i.test(r.role) && r.person.trim());
	return hit?.person.trim() ?? "";
}

export interface MatrixPlan {
	edits: XlsxEdit[];
	filled: number;
	missing: number;
	/** cells that already had a value in the template and were left alone */
	kept: number;
}

/** Author cells from the roles screen. A cell that already holds a value is kept; missing authors are marked. */
export function planAuthors(sheet: InspectedSheet, layout: MatrixLayout, state: ProjectState, builder?: string): MatrixPlan {
	const edits: XlsxEdit[] = [];
	let filled = 0;
	let missing = 0;
	let kept = 0;
	const lods = lodSpecified(sheet, layout);
	for (const row of layout.rows) {
		if (row.kind === "other") continue;
		layout.phases.forEach((phase, i) => {
			const ref = `${colName(layout.authorCols[i])}${row.row}`;
			if (sheet.cells[ref]) return void kept++;
			// only models that take part in this phase (a LOD is given, or the combined model) need an author
			if (row.kind === "model" && lods && !lods.has(`${row.row}:${i}`)) return;
			const who = authorFor(row, phase, state, builder);
			if (who) {
				edits.push({ sheet: sheet.name, ref, value: who, status: "source", note: "Avots: lomu tabula (5. Kas ko dara)." });
				filled++;
			} else {
				edits.push({ sheet: sheet.name, ref, value: DESIGN_PHASES.has(phase) ? null : "BŪVNIEKS", status: "missing", note: "Ievadīt autoru (vārds uzvārds)." });
				missing++;
			}
		});
	}
	return { edits, filled, missing, kept };
}

/** Rows × phases that carry a LOD in the template. Null when the template has no LODs at all (blank form). */
function lodSpecified(sheet: InspectedSheet, layout: MatrixLayout): Set<string> | null {
	const set = new Set<string>();
	for (const row of layout.rows) {
		layout.lodCols.forEach((c, i) => {
			if (sheet.cells[`${colName(c)}${row.row}`]) set.add(`${row.row}:${i}`);
		});
	}
	return set.size ? set : null;
}

// ---------- LOD from PIP ----------
export const lodSchema = z.object({
	rows: z.array(z.object({ code: z.string(), phases: z.record(z.string(), z.number().nullable()), quote: z.string().nullable(), file: z.string().nullable() })),
});
export const LOD_HINT = `{"rows": [{"code": "AR", "phases": {"KC": 200, "ST": 200, "DT": 300, "AP": 300, "BV": 400, "IM": 400, "AIM": 400}, "quote": "visa tabulas rinda no PIP", "file": "faila nosaukums"}]}`;
export const LOD_INSTRUCTIONS = [
	"PIP 1. pielikumā „Projekta speciālās prasības” ir tabulas ar minimālo LOD katram BIM modelim katrā projekta posmā (KC, ST, DT, AP, BV, IM, AIM), atsevišķi katram līguma veidam.",
	"Izmanto TIKAI to tabulu, kas atbilst šī konkursa līguma veidam (tas norādīts tālāk). Katram modelim (kods kā AR, IN, BK, AVK-A, EL, UK …) izraksti LOD pa posmiem.",
	"Posmu, kuram LOD nav norādīts, liec null. Citātam jābūt visai tabulas rindai, kur redzami skaitļi.",
].join("\n");

export interface LodProposal {
	code: string;
	phase: string;
	lod: number;
	cite: Citation;
}

/** Keeps only LOD numbers that really appear in their quote; a row with an unfindable quote is dropped. */
export function groundLod(res: z.infer<typeof lodSchema>, docs: DocInput[]): { proposals: LodProposal[]; rejected: number } {
	const proposals: LodProposal[] = [];
	let rejected = 0;
	for (const r of res.rows) {
		const cite = r.quote ? locateQuote(r.quote, docs, r.file ?? undefined) : null;
		if (!cite) {
			rejected++;
			continue;
		}
		for (const [phase, lod] of Object.entries(r.phases)) {
			if (lod === null || !numberInQuote(lod, cite.quote)) continue;
			proposals.push({ code: r.code.toUpperCase().replace(/\s+/g, "-"), phase: phase.toUpperCase(), lod, cite });
		}
	}
	return { proposals, rejected };
}

/** LOD cells for rows × phases the template left blank, from grounded PIP proposals. */
export function planLods(sheet: InspectedSheet, layout: MatrixLayout, proposals: LodProposal[]): XlsxEdit[] {
	const edits: XlsxEdit[] = [];
	for (const row of layout.rows) {
		if (row.kind !== "model") continue;
		layout.phases.forEach((phase, i) => {
			const ref = `${colName(layout.lodCols[i])}${row.row}`;
			if (sheet.cells[ref]) return;
			const p = proposals.find((x) => x.code === row.code && x.phase === phase);
			if (p) edits.push({ sheet: sheet.name, ref, value: p.lod, status: "source", note: `Avots: ${p.cite.file}: “${p.cite.quote.slice(0, 120)}”` });
		});
	}
	return edits;
}

/** Existing numeric LOD in the template for a row/phase, as number. */
export function templateLod(sheet: InspectedSheet, layout: MatrixLayout, row: MatrixRow, phaseIndex: number): number | null {
	const v = sheet.cells[`${colName(layout.lodCols[phaseIndex])}${row.row}`];
	const n = v === undefined ? NaN : Number(v);
	return Number.isFinite(n) ? n : null;
}
