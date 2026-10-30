// 10. Rezultāts / precizējums (5.7): the commission asks us to clarify something we already submitted.
// The draft is built ONLY from our submitted documents (every claim carries a verified quote from them), says the
// content is not changed („negrozot saturu”), is one document so it can be turned into one PDF, and can carry the
// commercial-secret line. Whatever the documents do not support is listed for the person to write — never invented.
import { z } from "zod";
import { existsSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { Project } from "../../shared/types.js";
import type { Engine, RunOptions } from "../engines/types.js";
import { nextVersionPath, safeName, type Outcome } from "../fill/run.js";
import { loadState } from "../project-state.js";
import { inspectDocx, writeDocx, type DocBlock, type ToolsConfig } from "../pytools.js";
import { locateQuote, type DocInput } from "../tasks/grounding.js";
import { runModelTask } from "../tasks/runner.js";
import { outputFiles } from "./run.js";

type Base = Omit<RunOptions, "prompt" | "onEvent">;

export const NO_CHANGE_LINE = "Šis skaidrojums sniegts, negrozot piedāvājuma saturu; tas balstīts uz pretendenta jau iesniegtajiem piedāvājuma dokumentiem.";
export const SECRET_LINE = "Pretendents norāda, ka šajā dokumentā iekļautā informācija ir komercnoslēpums un nav izpaužama trešajām personām.";

export const clarifySchema = z.object({
	answers: z.array(z.object({ question: z.string(), answer: z.string(), quote: z.string().nullable(), file: z.string().nullable() })),
});
export const CLARIFY_HINT = `{"answers": [{"question": "komisijas jautājuma teksts", "answer": "īsa atbilde latviski, tikai ar faktiem no mūsu iesniegtajiem dokumentiem", "quote": "burtisks citāts no MŪSU iesniegtā dokumenta, kas to apstiprina (vai null)", "file": "faila nosaukums"}]}`;
export const CLARIFY_INSTRUCTIONS = [
	"Komisija lūdz precizēt jau iesniegto piedāvājumu. Dots komisijas pieprasījuma teksts un MŪSU iesniegtie dokumenti.",
	"Sadali pieprasījumu atsevišķos jautājumos. Katram jautājumam uzraksti īsu, mierīgu atbildi latviski, izmantojot TIKAI to, kas jau rakstīts mūsu iesniegtajos dokumentos.",
	"Piedāvājuma saturu nedrīkst grozīt: nepievieno jaunus faktus, skaitļus, personas vai programmatūru. Ja iesniegtie dokumenti uz jautājumu neatbild, atbildi atstāj tukšu (answer = \"\") un quote = null.",
	"Katrai atbildei burtisks citāts (10–300 zīmes) no mūsu iesniegtā dokumenta, kas to apstiprina.",
].join("\n");

export interface Draft {
	answered: { question: string; answer: string; cite: { file: string; quote: string } }[];
	/** questions the submitted documents do not answer — the person writes these */
	unsupported: { question: string; why: string }[];
}

export function groundClarify(res: z.infer<typeof clarifySchema>, submitted: DocInput[]): Draft {
	const draft: Draft = { answered: [], unsupported: [] };
	for (const a of res.answers) {
		if (!a.answer.trim()) {
			draft.unsupported.push({ question: a.question, why: "iesniegtie dokumenti uz šo neatbild" });
			continue;
		}
		const cite = a.quote ? locateQuote(a.quote, submitted, a.file ?? undefined) : null;
		if (!cite) draft.unsupported.push({ question: a.question, why: "atbildi nevarēja pamatot ar citātu iesniegtajos dokumentos" });
		else draft.answered.push({ question: a.question, answer: a.answer.trim(), cite });
	}
	return draft;
}

/** The blocks of the one-document answer. Pure — so the structure is testable without writing a file. */
export function clarifyBlocks(d: { project: string; draft: Draft; secret: boolean; today: string }): DocBlock[] {
	const b: DocBlock[] = [
		{ heading: "Atbilde uz iepirkuma komisijas pieprasījumu", level: 1 },
		{ text: `Iepirkums: ${d.project}` },
		{ text: `Datums: ${d.today}` },
	];
	d.draft.answered.forEach((a, i) => {
		b.push({ heading: `${i + 1}. ${a.question.trim()}`, level: 2 }, { text: a.answer }, { text: `Pamatojums iesniegtajā dokumentā (${a.cite.file}): „${a.cite.quote}”` });
	});
	d.draft.unsupported.forEach((u, i) => {
		const n = d.draft.answered.length + i + 1;
		b.push({ heading: `${n}. ${u.question.trim()}`, level: 2 }, { text: "[aizpildīt] — atbildi raksta pats; iesniegtie dokumenti uz šo neatbild." });
	});
	b.push({ text: NO_CHANGE_LINE, bold: true });
	if (d.secret) b.push({ text: SECRET_LINE });
	return b;
}

export interface ClarifyResult {
	file: string;
	answered: number;
	unsupported: Draft["unsupported"];
}

/** Our submitted documents as the only source: the produced forms, BIP, matrica text and the technical proposal. */
async function submittedDocs(project: Project, tools: ToolsConfig): Promise<DocInput[]> {
	const s = loadState(project.outputDir);
	const docs: DocInput[] = [];
	for (const o of outputFiles(s)) {
		if (!existsSync(o.file) || extname(o.file).toLowerCase() !== ".docx") continue;
		const i = await inspectDocx(tools, o.file).catch(() => null);
		if (i) docs.push({ file: basename(o.file), text: [...i.paragraphs.map((p) => p.text), ...i.tables.flatMap((t) => t.cells.flat())].filter(Boolean).join("\n") });
	}
	return docs;
}

export async function draftClarification(d: { project: Project; tools: ToolsConfig }, engine: Engine, base: Base, request: string, secret: boolean, now: Date = new Date()): Promise<Outcome<{ result: ClarifyResult }>> {
	if (!request.trim()) return { ok: false, error: "Ielīmē komisijas pieprasījuma tekstu." };
	const submitted = await submittedDocs(d.project, d.tools);
	if (submitted.length === 0) return { ok: false, error: "Nav izveidotu iesniedzamo dokumentu, uz kuriem balstīt atbildi (6. Aizpildīt)." };
	const r = await runModelTask({
		engine,
		base,
		instructions: `${CLARIFY_INSTRUCTIONS}\n\nKOMISIJAS PIEPRASĪJUMS:\n${request.trim()}`,
		schemaHint: CLARIFY_HINT,
		schema: clarifySchema,
		docs: submitted,
	});
	if (!r.ok) return r;
	const draft = groundClarify(r.data, submitted);
	const s = loadState(d.project.outputDir);
	const name = s.requirements.dati.subject.value ?? d.project.name;
	const dst = nextVersionPath(join(d.project.outputDir, "Iesniedzamie"), `Precizejums_${safeName(d.project.name)}`, ".docx");
	await writeDocx(d.tools, { dst, blocks: clarifyBlocks({ project: name, draft, secret, today: now.toLocaleDateString("lv-LV") }) });
	return { ok: true, result: { file: dst, answered: draft.answered.length, unsupported: draft.unsupported } };
}
