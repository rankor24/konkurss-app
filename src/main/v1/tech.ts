// Tehniskais piedāvājums (decision D9): never generated from nothing. The boilerplate is an earlier submitted text;
// the model proposes changes only to paragraphs that state tender-specific facts, each with a verified quote.
// A person accepts or rejects each paragraph; untouched paragraphs stay exactly as they were.
import { z } from "zod";
import { basename, extname, join } from "node:path";
import type { TechChange, TechState } from "../../shared/state.js";
import type { Project } from "../../shared/types.js";
import type { Engine, RunOptions } from "../engines/types.js";
import { nextVersionPath, safeName, type Outcome } from "../fill/run.js";
import { loadState, updateState } from "../project-state.js";
import { fillDocx, inspectDocx, type DocxEdit, type ToolsConfig } from "../pytools.js";
import { docsByKind } from "../tasks/docs.js";
import { withExtras } from "../tasks/extras.js";
import { locateQuote, type DocInput } from "../tasks/grounding.js";
import { inForceNolikums } from "../tasks/phase2-run.js";
import { runModelTask } from "../tasks/runner.js";

type Base = Omit<RunOptions, "prompt" | "onEvent">;

export const techSchema = z.object({ changes: z.array(z.object({ i: z.number(), text: z.string(), why: z.string(), quote: z.string().nullable(), file: z.string().nullable() })) });
export const TECH_HINT = `{"changes": [{"i": 12, "text": "jaunais teksts šim rindkopas numuram", "why": "kāpēc mainīts", "quote": "burtisks citāts no konkursa dokumenta", "file": "faila nosaukums"}]}`;
export const TECH_INSTRUCTIONS = [
	"Dots iepriekš veiksmīgi iesniegta tehniskā piedāvājuma teksts (numurētas rindkopas) un jaunā konkursa dokumenti.",
	"Atrodi TIKAI tās rindkopas, kurās ir iepriekšējam konkursam specifiski fakti: objekta nosaukums vai adrese, pasūtītājs, iepirkuma ID, apjoms/darbu saraksts, termiņi, konkrēti prasību punkti. Katrai piedāvā aizstājēju tekstu ar jaunā konkursa faktiem.",
	"Rindkopas ar vispārīgu uzņēmuma, metodoloģijas vai kvalitātes tekstu NEMAINI — tās neiekļauj atbildē.",
	"Jaunajam tekstam jābūt tikai ar faktiem no jaunā konkursa dokumentiem. Katrai izmaiņai burtisks citāts (10–300 zīmes) no jaunā konkursa dokumenta, kas apstiprina jauno faktu. Neizdomā.",
].join("\n");

export function techPrompt(paragraphs: { i: number; text: string }[]): string {
	return paragraphs.map((p) => `[${p.i}] ${p.text}`).join("\n");
}

/** Keeps only changes whose quote is really in the new tender's documents and whose paragraph exists. */
export function groundTech(res: z.infer<typeof techSchema>, paragraphs: { i: number; text: string }[], docs: DocInput[]): { changes: TechChange[]; rejected: number } {
	const changes: TechChange[] = [];
	let rejected = 0;
	for (const c of res.changes) {
		const para = paragraphs.find((p) => p.i === c.i);
		const cite = c.quote ? locateQuote(c.quote, docs, c.file ?? undefined) : null;
		if (!para || !cite || !c.text.trim() || c.text.trim() === para.text.trim()) {
			rejected++;
			continue;
		}
		changes.push({ i: c.i, before: para.text, after: c.text.trim(), why: c.why, cites: [cite], decision: null });
	}
	return { changes, rejected };
}

export interface TechDeps {
	project: Project;
	tools: ToolsConfig;
}

export async function proposeTech(d: TechDeps, engine: Engine, base: Base, boilerplate: string): Promise<Outcome<{ changes: number; rejected: number }>> {
	const s = loadState(d.project.outputDir);
	const info = await inspectDocx(d.tools, boilerplate);
	const paragraphs = info.paragraphs.filter((p) => p.text.trim().length >= 30 && !p.heading).map((p) => ({ i: p.i, text: p.text.trim() }));
	if (paragraphs.length === 0) return { ok: false, error: "Iepriekšējā tehniskā piedāvājumā nav teksta, ko pielāgot." };
	const nol = inForceNolikums(d.project, s);
	const tender = [...(nol.ok ? nol.docs : []), ...docsByKind(d.project, s, ["tehniska_specifikacija", "qa", "grozijumi"])];
	if (tender.length === 0) return { ok: false, error: "Nav nolasītu konkursa dokumentu (1. Dokumenti)." };
	const { instructions: note, docs } = withExtras(d.project, s, "aizpildit", "", tender);
	const r = await runModelTask({
		engine,
		base,
		instructions: `${TECH_INSTRUCTIONS}${note}\n\nIEPRIEKŠĒJĀ PIEDĀVĀJUMA RINDKOPAS:\n${techPrompt(paragraphs)}`,
		schemaHint: TECH_HINT,
		schema: techSchema,
		docs,
	});
	if (!r.ok) return r;
	const g = groundTech(r.data, paragraphs, docs);
	updateState(d.project.outputDir, (st) => {
		const old = new Map((st.tech?.changes ?? []).map((c) => [`${c.i}|${c.after}`, c.decision]));
		st.tech = { boilerplate, changes: g.changes.map((c) => ({ ...c, decision: old.get(`${c.i}|${c.after}`) ?? null })), readAt: new Date().toISOString() };
	});
	return { ok: true, changes: g.changes.length, rejected: g.rejected };
}

export function techDecision(p: Project, i: number, decision: "accept" | "reject" | null): void {
	updateState(p.outputDir, (s) => {
		const c = s.tech?.changes.find((x) => x.i === i);
		if (c) c.decision = decision;
	});
}

export function editTechText(p: Project, i: number, text: string): void {
	updateState(p.outputDir, (s) => {
		const c = s.tech?.changes.find((x) => x.i === i);
		if (c) Object.assign(c, { after: text, decision: "accept" });
	});
}

/** Edits for the accepted paragraphs only — everything else in the file is left exactly as it was. */
export function techEdits(tech: TechState): DocxEdit[] {
	return tech.changes.filter((c) => c.decision === "accept").map((c): DocxEdit => ({ kind: "paragraph", i: c.i, text: c.after, status: "added" }));
}

export async function generateTech(d: TechDeps): Promise<Outcome<{ file: string; applied: number; pending: number }>> {
	const s = loadState(d.project.outputDir);
	if (!s.tech) return { ok: false, error: "Vispirms izvēlies iepriekšējo tehnisko piedāvājumu un nolasi izmaiņas." };
	const pending = s.tech.changes.filter((c) => c.decision === null).length;
	const edits = techEdits(s.tech);
	const dst = nextVersionPath(join(d.project.outputDir, "Iesniedzamie"), `${safeName(basename(s.tech.boilerplate, extname(s.tech.boilerplate)))}_jaunais`, extname(s.tech.boilerplate));
	await fillDocx(d.tools, { src: s.tech.boilerplate, dst, edits, legend: [["sarkans = mainīts attiecībā pret iepriekšējo iesniegumu (pārbaudīts)", "added"]] });
	updateState(d.project.outputDir, (st) => void (st.tech && (st.tech.output = dst)));
	return { ok: true, file: dst, applied: edits.length, pending };
}
