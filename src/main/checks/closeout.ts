// 10. Rezultāts — what was submitted, what happened, what to carry into the next tender.
// The one thing that changes a register is [Pievienot objektu reģistram]; it is explicit and happens once per tender.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { emptyCloseout, type Closeout } from "../../shared/checks.js";
import type { RegObject, Registers } from "../../shared/registers.js";
import type { Project } from "../../shared/types.js";
import type { Engine, RunOptions } from "../engines/types.js";
import type { Outcome } from "../fill/run.js";
import { loadState, updateState } from "../project-state.js";
import { docsByKind } from "../tasks/docs.js";
import { locateQuote } from "../tasks/grounding.js";
import { inForceNolikums } from "../tasks/phase2-run.js";
import { runModelTask } from "../tasks/runner.js";

type Base = Omit<RunOptions, "prompt" | "onEvent">;

export const getCloseout = (p: Project): Closeout => ({ ...emptyCloseout(), ...(loadState(p.outputDir).closeout as Closeout | undefined) });

export function saveCloseout(p: Project, patch: Partial<Closeout>): Closeout {
	const next = updateState(p.outputDir, (s) => void (s.closeout = { ...emptyCloseout(), ...(s.closeout as Closeout | undefined), ...patch }));
	return next.closeout as Closeout;
}

/** The object this tender adds to the register: only facts the app really has, the rest left for the person. */
export function objectFromTender(p: Project, id: string = randomUUID()): RegObject {
	const s = loadState(p.outputDir);
	const r = s.requirements.dati;
	const fields: RegObject["fields"] = [];
	const put = (key: string, v: string | null | undefined) => v && fields.push({ key, value: v });
	put("Pasūtītājs", r.purchaser.value);
	put("Iepirkuma ID", r.id.value);
	put("Līguma veids", r.contractType.value);
	put("Iesniegts", s.closeout ? (s.closeout as Closeout).submittedAt : null);
	put("Piezīme", "Pievienots no konkursa mapes; platība, gads, loma un pierādījumu faili jāpapildina pašam.");
	return { id, name: r.subject.value ?? p.name, fields, evidence: [] };
}

/** Adds the object once; a second call is refused so the register never gets a duplicate from one tender. */
export function addObjectToRegister(p: Project, reg: Registers): Outcome<{ registers: Registers; object: RegObject }> {
	const c = getCloseout(p);
	if (c.addedObjectId) return { ok: false, error: "Šī konkursa objekts reģistram jau ir pievienots." };
	const object = objectFromTender(p);
	const registers: Registers = { ...reg, objects: [...reg.objects, object] };
	saveCloseout(p, { addedObjectId: object.id });
	return { ok: true, registers, object };
}

// ---------- deadlines after a win ----------
export const postWinSchema = z.object({ items: z.array(z.object({ what: z.string(), due: z.string(), quote: z.string(), file: z.string().nullable() })) });
export const POSTWIN_HINT = `{"items": [{"what": "ko jāizdara (piem. līguma parakstīšana, apdrošināšana, garantija)", "due": "termiņš kā rakstīts (piem. 5 darba dienu laikā pēc lēmuma)", "quote": "burtisks citāts no nolikuma/līguma", "file": "faila nosaukums"}]}`;
export const POSTWIN_INSTRUCTIONS = [
	"Atrodi darbības un termiņus, kas pretendentam jāizpilda PĒC tam, kad tas atzīts par uzvarētāju: līguma slēgšana, līguma izpildes nodrošinājums, civiltiesiskās atbildības apdrošināšana, dokumentu iesniegšana pirms līguma, saistības pret apakšuzņēmējiem.",
	"Katrai darbībai — termiņš tieši tā, kā rakstīts, un burtisks citāts (10–300 zīmes). Neizdomā un neaprēķini datumus.",
].join("\n");

export async function readPostWin(p: Project, engine: Engine, base: Base): Promise<Outcome<{ added: number; rejected: number }>> {
	const s = loadState(p.outputDir);
	const nol = inForceNolikums(p, s);
	const docs = [...(nol.ok ? nol.docs : []), ...docsByKind(p, s, ["ligums"])];
	if (docs.length === 0) return { ok: false, error: "Nav nolasītu konkursa dokumentu (1. Dokumenti)." };
	const r = await runModelTask({ engine, base, instructions: POSTWIN_INSTRUCTIONS, schemaHint: POSTWIN_HINT, schema: postWinSchema, docs });
	if (!r.ok) return r;
	const found: Closeout["postWin"] = [];
	let rejected = 0;
	for (const it of r.data.items) {
		const cite = locateQuote(it.quote, docs, it.file ?? undefined);
		if (!cite) rejected++;
		else found.push({ what: it.what, due: it.due, cite });
	}
	const keep = getCloseout(p).postWin.filter((x) => !x.cite);
	saveCloseout(p, { postWin: [...keep, ...found] });
	return { ok: true, added: found.length, rejected };
}
