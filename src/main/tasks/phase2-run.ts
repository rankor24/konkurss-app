// Phase 2 runners: which edition is in force, Q&A, forms, deadline, requirements, second pass.
// Every runner reads state, calls code or a model task, and commits the result in ONE atomic write.
import { extname } from "node:path";
import type { BlockId, Cited, FileEntry, ProjectState, Requirements } from "../../shared/state.js";
import type { Project } from "../../shared/types.js";
import type { Engine, RunOptions } from "../engines/types.js";
import { readCachedText } from "../extract.js";
import { loadState, updateState } from "../project-state.js";
import { diffParagraphs } from "../versions/diff.js";
import { compareTemplates } from "../versions/templates.js";
import { docLabel, docsByKind } from "./docs.js";
import { mergeSecondPass, type DocInput } from "./grounding.js";
import * as T from "./phase2.js";
import { runModelTask } from "./runner.js";

type Base = Omit<RunOptions, "prompt" | "onEvent">;
export type Outcome<X = object> = ({ ok: true } & X) | { ok: false; error: string };

export const fileKey = (f: Pick<FileEntry, "root" | "rel">) => `${f.root}:${f.rel}`;

/** Word files that look like a nolikums edition (the amended one is usually classified as "grozījumi"). */
export function editionCandidates(files: FileEntry[]): FileEntry[] {
	return files.filter((f) => f.where !== "darba" && (f.kind === "nolikums" || f.kind === "grozijumi") && /nolik/i.test(f.rel.split(/[\\/]/).pop() ?? "") && extname(f.rel).toLowerCase() === ".docx");
}

/** Pre-selects original/amended: the one named "groz…" is the amended edition. */
export function guessEditions(files: FileEntry[]): { original?: string; amended?: string } {
	const c = editionCandidates(files);
	const amended = c.find((f) => /groz/i.test(f.rel));
	const original = c.find((f) => f !== amended);
	return { original: original && fileKey(original), amended: amended && fileKey(amended) };
}

function docOf(p: Project, s: ProjectState, key: string | undefined): DocInput | null {
	if (!key) return null;
	const f = s.files.find((x) => fileKey(x) === key);
	if (!f) return null;
	const text = readCachedText(p, f);
	return text ? { file: docLabel(f, s.files), text } : null;
}

export function setEditions(p: Project, original: string | undefined, amended: string | undefined): void {
	updateState(p.outputDir, (s) => {
		s.versions.originalFile = original;
		s.versions.amendedFile = amended;
	});
}

export function diffEditions(p: Project): Outcome<{ changes: number }> {
	const s = loadState(p.outputDir);
	const a = docOf(p, s, s.versions.originalFile);
	const b = docOf(p, s, s.versions.amendedFile);
	if (!a || !b) return { ok: false, error: "Izvēlies abas nolikuma redakcijas (un nolasi to tekstu 1. solī)." };
	const diff = diffParagraphs(a.text, b.text);
	updateState(p.outputDir, (st) => {
		// keep a person's earlier decision for an identical change
		const old = new Map(st.versions.changes.map((c) => [c.before + "→" + c.after, c]));
		st.versions.changes = diff.map((c) => old.get(c.before + "→" + c.after) ?? { before: c.before, after: c.after, impact: null, impactBy: null, confirmed: false });
		st.versions.diffedAt = new Date().toISOString();
	});
	return { ok: true, changes: diff.length };
}

export async function classifyChanges(p: Project, engine: Engine, base: Base): Promise<Outcome<{ classified: number }>> {
	const s = loadState(p.outputDir);
	const todo = s.versions.changes.filter((c) => c.impactBy !== "manual");
	if (todo.length === 0) return { ok: false, error: "Nav izmaiņu, ko klasificēt. Vispirms salīdzini redakcijas." };
	if (todo.length > 80) return { ok: false, error: `Izmaiņu ir ${todo.length} — pārāk daudz automātiskai klasificēšanai. Pārbaudi tās pašas.` };
	const r = await runModelTask({
		engine,
		base,
		instructions: T.CLASSIFY_INSTRUCTIONS,
		schemaHint: T.CLASSIFY_HINT,
		schema: T.classifySchema,
		docs: [{ file: "izmainas.txt", text: T.classifyPrompt(todo) }],
	});
	if (!r.ok) return r;
	// result i refers to the position within `todo`; map back onto the full list in one write
	updateState(p.outputDir, (st) => {
		const res = T.applyClassification(st.versions.changes.filter((c) => c.impactBy !== "manual"), r.data);
		let k = 0;
		st.versions.changes = st.versions.changes.map((c) => (c.impactBy !== "manual" ? res[k++] : c));
	});
	return { ok: true, classified: r.data.items.length };
}

export function setInForce(p: Project, which: "original" | "amended"): void {
	updateState(p.outputDir, (s) => void (s.versions.inForce = which));
}

/** The nolikums text to read requirements from: the edition in force (plus nothing else). */
export function inForceNolikums(p: Project, s: ProjectState): Outcome<{ docs: DocInput[] }> {
	const c = editionCandidates(s.files).filter((f) => f.text === "ok");
	if (c.length === 0) return { ok: false, error: "Nolikuma teksts nav nolasīts (1. Dokumenti)." };
	let chosen: FileEntry[];
	if (c.length === 1) chosen = c;
	else if (s.versions.inForce) {
		const key = s.versions.inForce === "amended" ? s.versions.amendedFile : s.versions.originalFile;
		chosen = c.filter((f) => fileKey(f) === key);
		if (chosen.length === 0) return { ok: false, error: "Izvēlētā spēkā esošā redakcija nav atrasta. Izvēlies redakcijas 2. solī." };
	} else return { ok: false, error: `Atrastas ${c.length} nolikuma redakcijas. Vispirms 2. solī izvēlies, kura ir spēkā.` };
	const docs = chosen.map((f) => ({ file: docLabel(f, s.files), text: readCachedText(p, f) ?? "" })).filter((d) => d.text);
	return { ok: true, docs };
}

export async function readQa(p: Project, engine: Engine, base: Base): Promise<Outcome<{ items: number; rejected: number }>> {
	const s = loadState(p.outputDir);
	const docs = docsByKind(p, s, ["qa"]);
	if (docs.length === 0) return { ok: false, error: "Komisijas atbilžu dokumentu nav (vai tie nav nolasīti)." };
	const r = await runModelTask({ engine, base, instructions: T.QA_INSTRUCTIONS, schemaHint: T.QA_HINT, schema: T.qaSchema, docs });
	if (!r.ok) return r;
	const g = T.groundQa(r.data, docs);
	updateState(p.outputDir, (st) => {
		const old = new Map(st.versions.qa.map((q) => [`${q.file}|${q.question}`, q]));
		st.versions.qa = g.items.map((q) => old.get(`${q.file}|${q.question}`) ?? q);
		st.versions.qaReadAt = new Date().toISOString();
	});
	return { ok: true, items: g.items.length, rejected: g.rejected };
}

/** Exact check: distributed forms vs the forms embedded in the nolikums (edition in force). */
export function compareForms(p: Project): Outcome<{ forms: number; differing: number }> {
	const s = loadState(p.outputDir);
	const nol = inForceNolikums(p, s);
	if (!nol.ok) return nol;
	const forms = docsByKind(p, s, ["pieteikums", "kvalifikacija", "finansu", "apliecinajums", "vertesanas_veidlapa", "tehniskais_piedavajums"]);
	const diffs = compareTemplates(forms, nol.docs[0]);
	updateState(p.outputDir, (st) => {
		st.versions.templates = diffs;
		st.versions.templatesComparedAt = new Date().toISOString();
	});
	return { ok: true, forms: diffs.length, differing: diffs.filter((d) => !d.equal).length };
}

export async function readDeadline(p: Project, engine: Engine, base: Base, pass: 1 | 2 = 1): Promise<Outcome<{ deadline: ReturnType<typeof T.groundDeadline> }>> {
	const s = loadState(p.outputDir);
	const docs = docsByKind(p, s, ["iub", "nolikums", "grozijumi", "qa", "tehniska_specifikacija"]);
	if (docs.length === 0) return { ok: false, error: "Nav nolasītu dokumentu, kur meklēt termiņu." };
	const ordered = pass === 1 ? docs : [...docs].reverse();
	const r = await runModelTask({
		engine,
		base,
		instructions: pass === 1 ? T.DEADLINE_INSTRUCTIONS : T.DEADLINE_INSTRUCTIONS_2,
		schemaHint: T.DEADLINE_HINT,
		schema: T.deadlineSchema,
		docs: ordered,
	});
	if (!r.ok) return r;
	return { ok: true, deadline: T.groundDeadline(r.data, docs) };
}

export function storeDeadline(p: Project, d: ReturnType<typeof T.groundDeadline>): void {
	updateState(p.outputDir, (st) => {
		// a manually entered deadline is never overwritten by a model reading
		if (st.deadline.date.status === "manual") return;
		st.deadline = d;
	});
}

export function setManualDeadline(p: Project, date: string, time: string, source: "iub" | "eis" | "nolikums" | "manual"): void {
	updateState(p.outputDir, (st) => {
		st.deadline = { date: { value: date, status: "manual" }, time: { value: time || null, status: time ? "manual" : "missing" }, source };
	});
}

// ---------- requirement blocks ----------
function docsForBlock(p: Project, s: ProjectState, block: BlockId): Outcome<{ docs: DocInput[] }> {
	const nol = inForceNolikums(p, s);
	if (!nol.ok) return nol;
	const qa = docsByKind(p, s, ["qa"]);
	if (block === "dati") return { ok: true, docs: [...nol.docs, ...docsByKind(p, s, ["tehniska_specifikacija", "iub"])] };
	return { ok: true, docs: [...nol.docs, ...qa] };
}

export type BlockResult = { rejected: number };

export async function readBlock(p: Project, engine: Engine, base: Base, block: BlockId, pass: 1 | 2 = 1): Promise<Outcome<BlockResult & { patch: Partial<Requirements> }>> {
	const s = loadState(p.outputDir);
	const d = docsForBlock(p, s, block);
	if (!d.ok) return d;
	const docs = pass === 1 ? d.docs : [...d.docs].reverse();
	const run = <S extends import("zod").ZodTypeAny>(instructions: string, schemaHint: string, schema: S) => runModelTask({ engine, base, instructions, schemaHint, schema, docs });
	switch (block) {
		case "dati": {
			const r = await run(T.DATI_INSTRUCTIONS, T.DATI_HINT, T.datiSchema);
			return r.ok ? { ok: true, rejected: 0, patch: { dati: T.groundDati(r.data, d.docs) } } : r;
		}
		case "dokumenti": {
			const r = await run(T.DOKUMENTI_INSTRUCTIONS, T.DOKUMENTI_HINT, T.dokumentiSchema);
			if (!r.ok) return r;
			const g = T.groundDokumenti(r.data, d.docs);
			return { ok: true, rejected: g.rejected, patch: { dokumenti: g.items } };
		}
		case "pieredze": {
			const r = await run(T.PIEREDZE_INSTRUCTIONS, T.PIEREDZE_HINT, T.pieredzeSchema);
			if (!r.ok) return r;
			const g = T.groundPieredze(r.data, d.docs);
			return { ok: true, rejected: g.rejected, patch: { pieredze: g.items } };
		}
		case "specialisti": {
			const r = await run(T.SPECIALISTI_INSTRUCTIONS, T.SPECIALISTI_HINT, T.specialistiSchema);
			if (!r.ok) return r;
			const g = T.groundSpecialisti(r.data, d.docs);
			return { ok: true, rejected: g.rejected, patch: { specialisti: g.items } };
		}
		case "vertesana": {
			const r = await run(pass === 1 ? T.VERTESANA_INSTRUCTIONS : T.VERTESANA_INSTRUCTIONS_2, T.VERTESANA_HINT, T.vertesanaSchema);
			if (!r.ok) return r;
			const g = T.groundVertesana(r.data, d.docs);
			return { ok: true, rejected: g.rejected, patch: { vertesana: g.items } };
		}
		case "apaksuznemeji": {
			const r = await run(pass === 1 ? T.APAKS_INSTRUCTIONS : T.APAKS_INSTRUCTIONS_2, T.APAKS_HINT, T.apaksSchema);
			return r.ok ? { ok: true, rejected: 0, patch: { apaksuznemeji: T.groundApaks(r.data, d.docs) } } : r;
		}
	}
}

/** Commits a block reading: replaces the block, stamps readAt, clears the person's confirmation. */
export function storeBlock(p: Project, block: BlockId, patch: Partial<Requirements>): void {
	updateState(p.outputDir, (st) => {
		Object.assign(st.requirements, patch);
		st.requirements.readAt[block] = new Date().toISOString();
		st.requirements.confirmed[block] = false;
	});
}

export function confirmBlock(p: Project, block: BlockId, value: boolean): void {
	updateState(p.outputDir, (st) => void (st.requirements.confirmed[block] = value));
}

/** Person edits a block by hand: the whole block is replaced; edited values must arrive as manual. */
export function editBlock(p: Project, block: BlockId, data: unknown): void {
	updateState(p.outputDir, (st) => {
		(st.requirements as unknown as Record<string, unknown>)[block] = data;
		st.requirements.confirmed[block] = false;
		if (!st.requirements.readAt[block]) st.requirements.readAt[block] = new Date().toISOString();
	});
}

/**
 * D6 second pass over the three values where a wrong reading costs most: deadline, evaluation
 * criteria, subcontractor threshold. Independent re-extraction (different wording, reversed document
 * order); disagreement is stored as a visible conflict, never silently resolved.
 */
export async function secondPass(p: Project, engine: Engine, base: Base): Promise<Outcome<{ conflicts: number }>> {
	const dl = await readDeadline(p, engine, base, 2);
	if (!dl.ok) return dl;
	const vt = await readBlock(p, engine, base, "vertesana", 2);
	if (!vt.ok) return vt;
	const ap = await readBlock(p, engine, base, "apaksuznemeji", 2);
	if (!ap.ok) return ap;
	let conflicts = 0;
	updateState(p.outputDir, (st) => {
		const same = (a: string, b: string) => a === b;
		const date: Cited<string> = mergeSecondPass(st.deadline.date, dl.deadline.date, same);
		const time: Cited<string> = mergeSecondPass(st.deadline.time, dl.deadline.time, same);
		st.deadline = { ...st.deadline, date, time };
		if (date.conflict) conflicts++;
		if (time.conflict) conflicts++;
		const second = vt.patch.vertesana ?? [];
		st.requirements.vertesana = T.mergeCriteria(st.requirements.vertesana, second);
		conflicts += st.requirements.vertesana.filter((c) => c.points.conflict || c.name.conflict).length;
		const thr = mergeSecondPass(st.requirements.apaksuznemeji.threshold, ap.patch.apaksuznemeji!.threshold);
		st.requirements.apaksuznemeji = { ...st.requirements.apaksuznemeji, threshold: thr };
		if (thr.conflict) conflicts++;
	});
	return { ok: true, conflicts };
}
