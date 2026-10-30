// Runs one structured model task on any engine: prompt → JSON → schema check → caller grounds it.
// Malformed output gets exactly one retry; provider errors are returned raw (D11). The caller
// commits results to state in one step, so a failure leaves the project file untouched.
import type { z } from "zod";
import type { Engine, RunOptions } from "../engines/types.js";
import type { DocInput } from "./grounding.js";

export type TaskResult<T> = { ok: true; data: T; engine: string } | { ok: false; error: string; engine: string };

export const MAX_DOC_CHARS = 700_000;

/** Pulls the JSON object out of a reply that may carry a code fence or a sentence around it. */
export function extractJson(text: string): unknown {
	const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
	const body = fence ? fence[1] : text;
	const start = body.indexOf("{");
	const end = body.lastIndexOf("}");
	if (start < 0 || end <= start) throw new Error("Atbildē nav JSON objekta.");
	return JSON.parse(body.slice(start, end + 1));
}

export function buildTaskPrompt(instructions: string, schemaHint: string, docs: DocInput[]): string {
	let budget = MAX_DOC_CHARS;
	const blocks: string[] = [];
	for (const d of docs) {
		const text = d.text.length > budget ? `${d.text.slice(0, budget)}\n[… teksts saīsināts]` : d.text;
		budget -= text.length;
		blocks.push(`=== DOKUMENTS: ${d.file} ===\n${text}\n=== BEIGAS: ${d.file} ===`);
		if (budget <= 0) break;
	}
	return [
		"Tu esi BŪVDIZAINS konkursu asistents. Šis ir datu nolasīšanas uzdevums: NEIZMANTO rīkus, atbildi tikai no zemāk dotajiem dokumentiem.",
		"",
		instructions,
		"",
		"Atbildes formāts — TIKAI viens JSON objekts, bez cita teksta:",
		schemaHint,
		"",
		"Citātu noteikumi:",
		'- "quote" ir BURTISKS fragments no dokumenta (10–300 zīmes), nokopēts precīzi, bez pārfrāzēšanas.',
		'- "file" ir dokumenta nosaukums tieši tā, kā tas rakstīts virsrakstā "=== DOKUMENTS: … ===".',
		'- Ja vērtības dokumentos nav, liec "value": null un "quote": null. Neizdomā.',
		"",
		...blocks,
	].join("\n");
}

export async function runModelTask<S extends z.ZodTypeAny>(p: {
	engine: Engine;
	base: Omit<RunOptions, "prompt" | "onEvent">;
	instructions: string;
	schemaHint: string;
	schema: S;
	docs: DocInput[];
	onText?: (t: string) => void;
}): Promise<TaskResult<z.infer<S>>> {
	let prompt = buildTaskPrompt(p.instructions, p.schemaHint, p.docs);
	let lastProblem = "";
	for (let attempt = 0; attempt < 2; attempt++) {
		let finalText = "";
		let streamed = "";
		let providerError: string | null = null;
		await p.engine.run({
			...p.base,
			prompt,
			onEvent: (e) => {
				if (e.type === "text") {
					streamed += e.text;
					p.onText?.(e.text);
				} else if (e.type === "done") finalText = e.text || streamed;
				else if (e.type === "error") providerError = e.message;
			},
		});
		if (providerError) return { ok: false, error: providerError, engine: p.engine.id };
		const reply = finalText || streamed;
		try {
			const parsed = p.schema.safeParse(extractJson(reply));
			if (parsed.success) return { ok: true, data: parsed.data, engine: p.engine.id };
			lastProblem = parsed.error.issues.map((i: { path: PropertyKey[]; message: string }) => `${i.path.map(String).join(".")}: ${i.message}`).join("; ");
		} catch (e) {
			lastProblem = (e as Error).message;
		}
		prompt = `${prompt}\n\nIEPRIEKŠĒJĀ ATBILDE NEDERĒJA (${lastProblem}). Atbildi vēlreiz — tikai derīgs JSON pēc dotās formas.`;
	}
	return { ok: false, error: `Aģenta atbilde nebija derīga divas reizes pēc kārtas: ${lastProblem}`, engine: p.engine.id };
}
