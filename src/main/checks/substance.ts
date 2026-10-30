// 8. Pārbaude — substance checks (5.3). The model reads both sides; code verifies every quote.
//  · does the technical proposal answer what the specification asks?
//  · does an atsauksme really prove what we claim about the object?
// A finding is only ever "ok" or "warn" here — a model's reading never fails a bid on its own, and a side whose
// quote cannot be found in the document is reported as "nepārbaudīts", never as a confirmation.
import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import type { Finding } from "../../shared/checks.js";
import type { RegObject } from "../../shared/registers.js";
import type { Project } from "../../shared/types.js";
import { readerFor, runPython, type PyConfig } from "../../mcp/python.js";
import type { Engine, RunOptions } from "../engines/types.js";
import type { Outcome } from "../fill/run.js";
import { loadState } from "../project-state.js";
import { inspectDocx, type ToolsConfig } from "../pytools.js";
import { docsByKind } from "../tasks/docs.js";
import { locateQuote, type DocInput } from "../tasks/grounding.js";
import { inForceNolikums } from "../tasks/phase2-run.js";
import { runModelTask } from "../tasks/runner.js";
import type { EvidenceItem } from "../v1/evidence.js";

type Base = Omit<RunOptions, "prompt" | "onEvent">;

// ---------- technical proposal vs specification ----------
export const specSchema = z.object({
	items: z.array(z.object({ requirement_quote: z.string(), file: z.string().nullable(), status: z.enum(["atbildets", "dalēji", "neatbildets"]), answer_quote: z.string().nullable(), note: z.string().nullable() })),
});
export const SPEC_HINT = `{"items": [{"requirement_quote": "burtisks citāts no tehniskās specifikācijas", "file": "faila nosaukums", "status": "atbildets" | "dalēji" | "neatbildets", "answer_quote": "burtisks citāts no MŪSU piedāvājuma, kas atbild (vai null)", "note": "īss skaidrojums vai null"}]}`;
export const SPEC_INSTRUCTIONS = [
	"Dots konkursa tehniskā specifikācija un MŪSU tehniskā piedāvājuma teksts (dokuments ar nosaukumu „MŪSU PIEDĀVĀJUMS”).",
	"Atrodi specifikācijas konkrētās prasības, uz kurām tehniskajam piedāvājumam jāatbild (ko jādara, kādā apjomā, kādā termiņā, kādā kvalitātē), un pārbaudi, vai piedāvājums uz katru atbild.",
	"Katrai prasībai: burtisks citāts no specifikācijas; statuss atbildets / dalēji / neatbildets; ja atbildets vai dalēji — burtisks citāts no MŪSU piedāvājuma. Ja piedāvājumā atbildes nav, answer_quote ir null.",
	"Neizdomā prasības. Ja specifikācijā nav konkrētu prasību, atgriez tukšu sarakstu. Ne vairāk kā 25 svarīgākās prasības.",
].join("\n");

export interface SpecItem {
	requirement: { file: string; quote: string };
	status: "atbildets" | "dalēji" | "neatbildets" | "nepārbaudīts";
	answer: { file: string; quote: string } | null;
	note: string | null;
}

/** A requirement counts only if its quote is in the tender documents; "answered" only if the answer quote is in our proposal. */
export function groundSpec(res: z.infer<typeof specSchema>, tender: DocInput[], ours: DocInput): { items: SpecItem[]; rejected: number } {
	const items: SpecItem[] = [];
	let rejected = 0;
	for (const it of res.items) {
		const req = locateQuote(it.requirement_quote, tender, it.file ?? undefined);
		if (!req) {
			rejected++;
			continue;
		}
		const ans = it.answer_quote ? locateQuote(it.answer_quote, [ours]) : null;
		let status: SpecItem["status"] = it.status;
		if ((it.status === "atbildets" || it.status === "dalēji") && !ans) status = "nepārbaudīts";
		items.push({ requirement: req, status, answer: ans, note: it.note });
	}
	return { items, rejected };
}

export function specFinding(items: SpecItem[], rejected: number): Finding {
	const base = { id: "substance-tech", kind: "satura" as const, title: "Tehniskais piedāvājums atbild specifikācijai", step: "aizpildit" as const };
	if (items.length === 0) return { ...base, status: "na", detail: "Specifikācijā app neatrada konkrētas prasības, ko salīdzināt.", where: [] };
	const bad = items.filter((x) => x.status !== "atbildets");
	if (bad.length === 0) return { ...base, status: "ok", detail: `${items.length} prasības, uz visām piedāvājumā ir atbilde (ar citātiem).`, where: [], cites: items.flatMap((x) => [x.requirement, ...(x.answer ? [x.answer] : [])]).slice(0, 6) };
	const word = { neatbildets: "piedāvājumā atbildes nav", dalēji: "piedāvājums atbild tikai daļēji", nepārbaudīts: "app atbildi piedāvājumā neatrada" } as const;
	const detail = bad.map((x) => `„${x.requirement.quote.slice(0, 140)}” — ${word[x.status as keyof typeof word]}${x.note ? ` (${x.note})` : ""}`).join("; ");
	return { ...base, status: "warn", detail: `${detail}. Komisija vērtē tehnisko piedāvājumu pret specifikāciju.${rejected ? ` (${rejected} prasības atmestas — citāts nebija atrodams dokumentā.)` : ""}`, where: ["Tehniskais piedāvājums"], cites: bad.flatMap((x) => [x.requirement, ...(x.answer ? [x.answer] : [])]) };
}

export async function checkTechAnswers(d: { project: Project; tools: ToolsConfig }, engine: Engine, base: Base): Promise<Outcome<{ finding: Finding }>> {
	const s = loadState(d.project.outputDir);
	const out = s.tech?.output;
	if (!out || !existsSync(out)) return { ok: false, error: "Tehniskais piedāvājums vēl nav izveidots (6. Aizpildīt)." };
	const info = await inspectDocx(d.tools, out);
	const text = [...info.paragraphs.map((p) => p.text), ...info.tables.flatMap((t) => t.cells.flat())].filter(Boolean).join("\n");
	const nol = inForceNolikums(d.project, s);
	const tender = [...docsByKind(d.project, s, ["tehniska_specifikacija", "pu"]), ...(nol.ok ? nol.docs : [])];
	if (tender.length === 0) return { ok: false, error: "Nav nolasītas tehniskās specifikācijas (1. Dokumenti)." };
	const ours: DocInput = { file: "MŪSU PIEDĀVĀJUMS", text };
	const r = await runModelTask({ engine, base, instructions: SPEC_INSTRUCTIONS, schemaHint: SPEC_HINT, schema: specSchema, docs: [...tender, ours] });
	if (!r.ok) return r;
	const g = groundSpec(r.data, tender, ours);
	return { ok: true, finding: specFinding(g.items, g.rejected) };
}

// ---------- atsauksme proves the claim ----------
export const proofSchema = z.object({
	items: z.array(z.object({ object: z.string(), claim_quote: z.string().nullable(), proof_quote: z.string().nullable(), verdict: z.enum(["apstiprina", "nepietiek", "pretruna"]), note: z.string().nullable() })),
});
export const PROOF_HINT = `{"items": [{"object": "objekta nosaukums", "claim_quote": "burtisks citāts no REĢISTRA ieraksta par šo objektu", "proof_quote": "burtisks citāts no ATSAUKSMES (vai null)", "verdict": "apstiprina" | "nepietiek" | "pretruna", "note": "īss skaidrojums vai null"}]}`;
export const PROOF_INSTRUCTIONS = [
	"Katram objektam ir divi dokumenti: „REĢISTRS: <objekts>” — ko mēs apgalvojam par objektu (platība, veids, gads, loma), un „ATSAUKSME: <objekts>” — pasūtītāja atsauksme.",
	"Pārbaudi, vai atsauksme apstiprina mūsu apgalvojumu: darbu veids, objekta veids, apjoms/platība, laiks, mūsu loma.",
	"verdict: apstiprina — atsauksmē ir tas pats; nepietiek — atsauksme to nepasaka; pretruna — atsauksmē ir citādi (cits veids, mazāka platība, cits laiks).",
	"Katram objektam divi burtiski citāti: claim_quote no reģistra teksta, proof_quote no atsauksmes teksta. Ja atsauksmē nekā nav, proof_quote ir null. Neizdomā.",
].join("\n");

export interface ProofItem {
	object: string;
	claim: { file: string; quote: string } | null;
	proof: { file: string; quote: string } | null;
	verdict: "apstiprina" | "nepietiek" | "pretruna" | "nepārbaudīts";
	note: string | null;
}

export function groundProof(res: z.infer<typeof proofSchema>, claims: DocInput[], proofs: DocInput[]): ProofItem[] {
	return res.items.map((it) => {
		const claim = it.claim_quote ? locateQuote(it.claim_quote, claims) : null;
		const proof = it.proof_quote ? locateQuote(it.proof_quote, proofs) : null;
		// both sides must be found before a verdict is trusted
		const verdict: ProofItem["verdict"] = !claim || (it.verdict === "apstiprina" && !proof) ? "nepārbaudīts" : it.verdict;
		return { object: it.object, claim, proof, verdict, note: it.note };
	});
}

export function proofFinding(items: ProofItem[], withoutFile: string[]): Finding {
	const base = { id: "substance-atsauksme", kind: "satura" as const, title: "Atsauksmes apstiprina pieredzi", step: "pieradijumi" as const };
	if (items.length === 0 && withoutFile.length === 0) return { ...base, status: "na", detail: "Nav izvēlēts neviens objekts ar atsauksmi.", where: [] };
	const bad = items.filter((x) => x.verdict !== "apstiprina");
	const parts = [
		...bad.map((x) => `${x.object}: ${x.verdict === "pretruna" ? "atsauksme runā pretī reģistra ierakstam" : x.verdict === "nepietiek" ? "atsauksme neapstiprina apgalvoto" : "app abus citātus dokumentos neatrada"}${x.note ? ` (${x.note})` : ""}`),
		...withoutFile.map((o) => `${o}: atsauksmes teksts nav nolasāms (skenēts vai fails nav atrasts) — pārbaudi ar aci`),
	];
	if (parts.length === 0) return { ...base, status: "ok", detail: `${items.length} objekti — atsauksmē ir tas, ko apgalvojam.`, where: [], cites: items.flatMap((x) => [x.claim, x.proof]).filter((c): c is NonNullable<typeof c> => !!c).slice(0, 6) };
	return { ...base, status: "warn", detail: `${parts.join("; ")}. Komisija pieredzi vērtē pēc atsauksmes.`, where: ["Pierādījumi"], cites: bad.flatMap((x) => [x.claim, x.proof]).filter((c): c is NonNullable<typeof c> => !!c) };
}

const claimText = (o: RegObject) => [o.name, ...o.fields.map((f) => `${f.key}: ${f.value}`)].join("\n");

export async function checkAtsauksmes(d: { project: Project; py: PyConfig }, engine: Engine, base: Base, plan: EvidenceItem[], objects: RegObject[]): Promise<Outcome<{ finding: Finding }>> {
	const claims: DocInput[] = [];
	const proofs: DocInput[] = [];
	const without: string[] = [];
	const seen = new Set<string>();
	for (const p of plan.filter((x) => /atsauksm/i.test(x.label) && x.status === "ok")) {
		if (seen.has(p.object)) continue;
		seen.add(p.object);
		const obj = objects.find((o) => o.name === p.object);
		let text = "";
		try {
			const ext = extname(p.from).toLowerCase();
			if (ext === ".txt") text = readFileSync(p.from, "utf8");
			else {
				const reader = readerFor(d.py.skillsDir, p.from);
				if (reader) text = await runPython(d.py, reader.script, reader.args);
			}
		} catch {
			text = "";
		}
		text = text.replace(/\r\n?/g, "\n");
		if (!obj || (text.match(/[\p{L}\p{N}]/gu) ?? []).length < 40) {
			without.push(p.object);
			continue;
		}
		claims.push({ file: `REĢISTRS: ${p.object}`, text: claimText(obj) });
		proofs.push({ file: `ATSAUKSME: ${p.object}`, text });
	}
	if (claims.length === 0) return { ok: true, finding: proofFinding([], without) };
	const r = await runModelTask({ engine, base, instructions: PROOF_INSTRUCTIONS, schemaHint: PROOF_HINT, schema: proofSchema, docs: [...claims, ...proofs] });
	if (!r.ok) return r;
	return { ok: true, finding: proofFinding(groundProof(r.data, claims, proofs), without) };
}
