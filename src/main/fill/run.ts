// Phase 3 orchestration. Every function reads state, does one step, and commits in one atomic write.
// Outputs are always NEW files with the next free version number; templates and earlier versions are never touched.
import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import type { FillSheet, ProjectState, SheetItem, Variant } from "../../shared/state.js";
import type { Project } from "../../shared/types.js";
import type { Engine, RunOptions } from "../engines/types.js";
import { loadState, updateState } from "../project-state.js";
import { fillDocx, fillXlsx, inspectDocx, inspectXlsx, type ToolsConfig } from "../pytools.js";
import type { Registers } from "../registers/registers.js";
import { docsByKind } from "../tasks/docs.js";
import { extraDocs, extraNote, withExtras } from "../tasks/extras.js";
import { runModelTask } from "../tasks/runner.js";
import { inForceNolikums } from "../tasks/phase2-run.js";
import { checkDocument, foreignTerms, otherBuilderTerms, type LeakReport } from "./leaks.js";
import { groundLod, LOD_HINT, LOD_INSTRUCTIONS, lodSchema, matrixLayout, planAuthors, planLods, type LodProposal } from "./matrica.js";
import { codeFill, LEGEND, mergeSheets, newSheet, openItems, toEdits } from "./sheet.js";
import { applyCells, applySections, CELLS_HINT, CELLS_INSTRUCTIONS, cellsPrompt, cellsSchema, chunk, FOCUSED_INSTRUCTIONS, SECTIONS_HINT, SECTIONS_INSTRUCTIONS, sectionsPrompt, sectionsSchema } from "./tasks.js";
import { makeRetriever, type RankedDoc } from "./retrieve.js";
import { buildPreview } from "./preview.js";
import type { PreviewBlock } from "../../shared/preview.js";

type Base = Omit<RunOptions, "prompt" | "onEvent">;
export type Outcome<X = object> = ({ ok: true } & X) | { ok: false; error: string };

export interface RunDeps {
	project: Project;
	tools: ToolsConfig;
	registers: Registers;
	otherProjects: Project[];
	extraForeign: string[];
}

const templatePath = (p: Project, s: ProjectState, key: string): string | null => {
	const f = s.files.find((x) => `${x.root}:${x.rel}` === key);
	return f ? join(f.root === "source" ? p.sourceDir : p.outputDir, f.rel) : null;
};

/** Next free `<stem>_vN<ext>` in a folder — earlier versions are kept as they are. */
export function nextVersionPath(dir: string, stem: string, ext: string): string {
	let n = 1;
	if (existsSync(dir)) {
		const re = new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_v(\\d+)${ext.replace(".", "\\.")}$`, "i");
		for (const f of readdirSync(dir)) {
			const m = f.match(re);
			if (m) n = Math.max(n, Number(m[1]) + 1);
		}
	}
	return join(dir, `${stem}_v${n}${ext}`);
}

export const safeName = (s: string) => s.replace(/[<>:"/\\|?*]+/g, "").replace(/\s+/g, " ").trim();

export function templateCandidates(s: ProjectState) {
	return s.files.filter((f) => f.root === "source" && f.where !== "darba" && ((f.kind === "bip_veidne" && f.rel.toLowerCase().endsWith(".docx")) || (f.kind === "matrica" && f.rel.toLowerCase().endsWith(".xlsx")))).map((f) => ({ key: `${f.root}:${f.rel}`, rel: f.rel, kind: f.kind }));
}

// ---------- BIP ----------
export async function inspectTemplate(d: RunDeps, key: string): Promise<Outcome<{ sheet: FillSheet }>> {
	const s = loadState(d.project.outputDir);
	const path = templatePath(d.project, s, key);
	if (!path) return { ok: false, error: "Veidnes fails nav atrasts." };
	const info = await inspectDocx(d.tools, path);
	const sheet = mergeSheets(newSheet(key, info), s.fills[key]);
	updateState(d.project.outputDir, (st) => void (st.fills[key] = sheet));
	return { ok: true, sheet };
}

/** The template as a document top to bottom, for the preview on screen 6. */
export async function previewTemplate(d: RunDeps, key: string): Promise<Outcome<{ blocks: PreviewBlock[] }>> {
	const s = loadState(d.project.outputDir);
	const path = templatePath(d.project, s, key);
	if (!path) return { ok: false, error: "Veidnes fails nav atrasts." };
	if (!/\.docx$/i.test(path)) return { ok: false, error: "Priekšskatījums ir tikai Word veidnēm." };
	const sheet = s.fills[key];
	if (!sheet) return { ok: false, error: "Vispirms pārskati veidni." };
	return { ok: true, blocks: buildPreview(await inspectDocx(d.tools, path), sheet) };
}

const variantOf = (s: ProjectState): Variant | null => s.variant?.value ?? null;

/** Code-fills roles and bidder cells. Safe to repeat; a person's edits are kept. */
export async function fillFromCode(d: RunDeps, key: string, builder?: string): Promise<Outcome<{ sheet: FillSheet }>> {
	const s = loadState(d.project.outputDir);
	const path = templatePath(d.project, s, key);
	if (!path) return { ok: false, error: "Veidnes fails nav atrasts." };
	const info = await inspectDocx(d.tools, path);
	const base = s.fills[key] ?? newSheet(key, info);
	const sheet = codeFill(mergeSheets(newSheet(key, info), base), info, { variant: variantOf(s), state: s, registers: d.registers, builder });
	updateState(d.project.outputDir, (st) => void (st.fills[key] = sheet));
	return { ok: true, sheet };
}

const FILL_DOCS_CELLS = ["tehniska_specifikacija", "pu", "pip"] as const;
const FILL_DOCS_SECTIONS = ["pip", "paraugmodelu_prasibas", "tehniska_specifikacija", "pu", "grozijumi", "qa"] as const;
/** The client's BIM requirements say what a BIP section must contain; a Q&A letter only adjusts them. */
const SECTION_DOC_WEIGHT: Record<(typeof FILL_DOCS_SECTIONS)[number], number> = { pip: 1.6, paraugmodelu_prasibas: 1.3, tehniska_specifikacija: 1, pu: 1, grozijumi: 1, qa: 1 };
const EXTRA_DOC_WEIGHT = 1;

/** The documents sections are written from, each marked with how much a hit in it counts. */
export const rankedSectionDocs = (p: Project, s: ProjectState): RankedDoc[] => [
	...FILL_DOCS_SECTIONS.flatMap((k) => docsByKind(p, s, [k]).map((doc) => ({ ...doc, weight: SECTION_DOC_WEIGHT[k] }))),
	// what a person added on this page: below the client's own requirements, level with the other tender documents
	...extraDocs(p, s, "aizpildit").map((doc) => ({ ...doc, weight: EXTRA_DOC_WEIGHT })),
];

/** Model step: project-info cells and instruction sections from the tender documents, each with a verified quote. */
export async function fillFromTender(d: RunDeps, engine: Engine, base: Base, key: string, onProgress?: (msg: string) => void): Promise<Outcome<{ sheet: FillSheet; rejected: number }>> {
	const s = loadState(d.project.outputDir);
	const sheet0 = s.fills[key];
	if (!sheet0) return { ok: false, error: "Vispirms pārskati veidni." };
	const nol = inForceNolikums(d.project, s);
	const cellDocs0 = [...(nol.ok ? nol.docs : []), ...docsByKind(d.project, s, [...FILL_DOCS_CELLS])];
	const secDocs0 = docsByKind(d.project, s, [...FILL_DOCS_SECTIONS]);
	if (secDocs0.length === 0 && cellDocs0.length === 0) return { ok: false, error: "Nav nolasītu konkursa dokumentu (1. Dokumenti)." };
	// the page's extra sources go after the tender documents: the tender is read first, and the second pass below reaches them by topic
	const extra = extraDocs(d.project, s, "aizpildit");
	const note = extraNote(s, "aizpildit");
	const cellDocs = [...cellDocs0, ...extra];
	const secDocs = [...secDocs0, ...extra];

	let rejected = 0;
	let committed = 0;

	/**
	 * Each step commits by itself: a provider error half-way keeps what is already done and says what is left.
	 * Items a person edited in the meantime are never overwritten.
	 */
	const commit = (changed: SheetItem[]) => {
		const touched = changed.filter((c) => c.by === "model" || c.note);
		updateState(d.project.outputDir, (st) => {
			const sh = st.fills[key];
			if (!sh) return;
			const byId = new Map(touched.map((i) => [i.slotId, i]));
			sh.items = sh.items.map((i) => (i.by === null && byId.has(i.slotId) ? byId.get(i.slotId)! : i));
			sh.filledAt = new Date().toISOString();
		});
		committed += touched.filter((c) => c.by === "model").length;
	};
	const fail = (error: string, left: string): Outcome<{ sheet: FillSheet; rejected: number }> => ({
		ok: false,
		error: `${error}${committed ? `

Jau saglabāts: ${committed} lauki/sadaļas. ${left}` : ""}`,
	});

	const openCells = sheet0.items.filter((i) => i.kind === "cell" && i.status === "missing" && i.by === null && !/(loma|bu?vprojekta dala|uznemums|vards)/i.test(i.label.toLowerCase()) && /^[^()]+$/.test(i.label));
	if (openCells.length && cellDocs.length) {
		onProgress?.(`Projekta dati (${openCells.length} lauki)…`);
		const r = await runModelTask({ engine, base, instructions: `${CELLS_INSTRUCTIONS}${note}

LAUKI:
${cellsPrompt(openCells)}`, schemaHint: CELLS_HINT, schema: cellsSchema, docs: cellDocs });
		if (!r.ok) return fail(r.error, "");
		const a = applyCells(openCells, r.data, cellDocs);
		rejected += a.rejected;
		commit(a.items);
	}

	const sections = sheet0.items.filter((i) => i.kind === "section" && i.status === "missing" && i.by === null);
	const batches = chunk(sections, 10);
	for (const [n, batch] of batches.entries()) {
		onProgress?.(`Sadaļas ${n + 1}/${batches.length}…`);
		const r = await runModelTask({ engine, base, instructions: `${SECTIONS_INSTRUCTIONS}${note}

SADAĻAS:
${sectionsPrompt(batch)}`, schemaHint: SECTIONS_HINT, schema: sectionsSchema, docs: secDocs });
		if (!r.ok) return fail(r.error, `Atlikušās sadaļas (${batches.length - n} no ${batches.length} grupām) var aizpildīt vēlreiz — jau aizpildītās netiks pārrakstītas.`);
		const a = applySections(batch, r.data, secDocs);
		rejected += a.rejected;
		commit(a.items);
	}

	// Second pass, one section at a time: what is still empty gets only the passages about its own topic (see retrieve.ts).
	// A million characters of documents make a model answer "nothing found"; a few thousand about "Garantijas laiks" make it find the clause.
	const still = loadState(d.project.outputDir).fills[key].items.filter((i) => i.kind === "section" && i.status === "missing" && i.by === null);
	if (still.length) {
		const retrieve = makeRetriever(rankedSectionDocs(d.project, s));
		for (const [n, item] of still.entries()) {
			onProgress?.(`Meklēju „${item.label}” (${n + 1}/${still.length})…`);
			const found = retrieve(item);
			if (found.docs.length === 0) {
				commit([{ ...item, note: item.note ?? "Dokumentos nav neviena fragmenta par šo tēmu." }]);
				continue;
			}
			const r = await runModelTask({ engine, base, instructions: `${FOCUSED_INSTRUCTIONS}${note}\n\nSADAĻAS:\n${sectionsPrompt([item])}`, schemaHint: SECTIONS_HINT, schema: sectionsSchema, docs: found.docs });
			if (!r.ok) return fail(r.error, "Atkārtotā meklēšana nav pabeigta — spied „Aizpildīt” vēlreiz, jau aizpildītais netiks pārrakstīts.");
			const a = applySections([item], r.data, found.docs);
			rejected += a.rejected;
			const [done] = a.items;
			// say why a section stayed empty instead of leaving the bare instruction
			if (done.status === "missing" && !done.note) done.note = `Meklēts ${found.passages} fragmentos no ${found.docs.length} dokumentiem (${found.docs.map((x) => x.file.split(/[\\/]/).pop()).join("; ")}) — aģents tiešu prasību neatrada.`;
			commit([done]);
		}
	}

	const sheet = loadState(d.project.outputDir).fills[key];
	return { ok: true, sheet, rejected };
}

export function setItem(p: Project, key: string, slotId: string, value: string | null): void {
	updateState(p.outputDir, (s) => {
		const it = s.fills[key]?.items.find((i) => i.slotId === slotId);
		if (!it) return;
		if (value === null) Object.assign(it, { value: "", status: "missing", by: null, cites: [], note: undefined });
		else Object.assign(it, { value, status: value.trim() ? "manual" : "missing", by: "manual", cites: [], note: undefined });
	});
}

export interface Generated {
	file: string;
	builder: string;
	open: number;
	leaks: LeakReport;
}

/** Writes one copy. With a builder, the builder side is filled from that builder's roles only, and the check also looks for the other builders' data. */
export async function generate(d: RunDeps, key: string, builder?: string): Promise<Outcome<{ generated: Generated }>> {
	const filled = await fillFromCode(d, key, builder);
	if (!filled.ok) return filled;
	const s = loadState(d.project.outputDir);
	const src = templatePath(d.project, s, key)!;
	// the builder-specific values exist only in this copy; the stored sheet keeps the neutral base
	const sheet = builder ? codeFill(s.fills[key], await inspectDocx(d.tools, src), { variant: variantOf(s), state: s, registers: d.registers, builder }) : filled.sheet;
	const stem = safeName(basename(src, extname(src)));
	const dir = builder ? join(d.project.outputDir, safeName(builder)) : join(d.project.outputDir, "Pirms-liguma BIP");
	const dst = nextVersionPath(dir, builder ? `${stem}_${safeName(builder)}` : stem, extname(src));
	await fillDocx(d.tools, { src, dst, edits: toEdits(sheet), legend: LEGEND });
	const terms = [...foreignTerms({ project: d.project, state: s }, d.otherProjects, d.extraForeign), ...(builder ? otherBuilderTerms(s, d.project.builders, builder) : [])];
	const leaks = await checkDocument(d.tools, dst, terms);
	updateState(d.project.outputDir, (st) => {
		const fs0 = st.fills[key];
		if (fs0) fs0.outputs[builder ?? ""] = dst;
	});
	return { ok: true, generated: { file: dst, builder: builder ?? "", open: openItems(sheet).length, leaks } };
}

/** A copy for every builder of the project (V2/V3). Each is checked for the other builders' data. */
export async function builderCopies(d: RunDeps, key: string): Promise<Outcome<{ copies: Generated[] }>> {
	if (d.project.builders.length === 0) return { ok: false, error: "Konkursam nav norādīts neviens būvnieks (konkursa veids un būvnieki)." };
	const copies: Generated[] = [];
	for (const b of d.project.builders) {
		const r = await generate(d, key, b);
		if (!r.ok) return { ok: false, error: `${b}: ${r.error}` };
		copies.push(r.generated);
	}
	return { ok: true, copies };
}

// ---------- matrica ----------
/** What the checks need to find again: the written matrica per builder and the LODs read from the PIP. */
export interface MatricaState {
	outputs: Record<string, string>;
	lod: LodProposal[];
}

export interface MatricaResult {
	file: string;
	filledAuthors: number;
	missingAuthors: number;
	keptCells: number;
	lodFilled: number;
	phasesAssumed: boolean;
}

export async function fillMatrica(d: RunDeps, engine: Engine | null, base: Base | null, key: string, builder?: string): Promise<Outcome<{ result: MatricaResult }>> {
	const s = loadState(d.project.outputDir);
	const src = templatePath(d.project, s, key);
	if (!src) return { ok: false, error: "Matricas fails nav atrasts." };
	const x = await inspectXlsx(d.tools, src);
	const sheet = x.sheets.find((sh) => matrixLayout(sh));
	const layout = sheet && matrixLayout(sheet);
	if (!sheet || !layout) return { ok: false, error: "Šajā failā neatradu atbildības matricas kolonnas (Autors / LOD)." };
	const authors = planAuthors(sheet, layout, s, builder);
	let lodEdits: ReturnType<typeof planLods> = [];
	let lodProposals: LodProposal[] = [];
	const blank = layout.rows.some((r) => r.kind === "model" && layout.lodCols.some((c, i) => !sheet.cells[`${String.fromCharCode(64 + c)}${r.row}`] && i >= 0));
	if (blank && engine && base) {
		const pip0 = docsByKind(d.project, s, ["pip"]);
		if (pip0.length) {
			const { instructions: lodNote, docs: pip } = withExtras(d.project, s, "aizpildit", "", pip0);
			const contract = s.requirements.dati.contractType.value ?? s.variant?.value ?? "nav zināms";
			const r = await runModelTask({
				engine,
				base,
				instructions: `${LOD_INSTRUCTIONS}${lodNote}\n\nLīguma veids šim konkursam: ${contract}. Modeļu kodi no veidnes: ${layout.rows.filter((q) => q.kind === "model").map((q) => q.code).join(", ")}.`,
				schemaHint: LOD_HINT,
				schema: lodSchema,
				docs: pip,
			});
			if (!r.ok) return r;
			lodProposals = groundLod(r.data, pip).proposals;
			lodEdits = planLods(sheet, layout, lodProposals);
		}
	}
	const stem = safeName(basename(src, extname(src)));
	const dir = builder ? join(d.project.outputDir, safeName(builder)) : join(d.project.outputDir, "Atbildības matrica");
	const dst = nextVersionPath(dir, builder ? `${stem}_${safeName(builder)}` : stem, extname(src));
	await fillXlsx(d.tools, { src, dst, edits: [...authors.edits, ...lodEdits] });
	updateState(d.project.outputDir, (st) => {
		const m = (st.matrica as MatricaState | undefined) ?? { outputs: {}, lod: [] };
		m.outputs[builder ?? ""] = dst;
		if (lodProposals.length) m.lod = lodProposals;
		st.matrica = m;
	});
	return { ok: true, result: { file: dst, filledAuthors: authors.filled, missingAuthors: authors.missing, keptCells: authors.kept, lodFilled: lodEdits.length, phasesAssumed: layout.phasesAssumed } };
}

export { dirname };
export type { SheetItem };
