// 5. Kas ko dara: the roles a tender asks for, read from its documents. Suggestions only — the table is filled by a person.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { RolePicks, RoleSuggestion, Roles } from "../../shared/state.js";
import type { Project } from "../../shared/types.js";
import type { Engine, RunOptions } from "../engines/types.js";
import { loadState, updateState } from "../project-state.js";
import { docsByKind } from "./docs.js";
import { withExtras } from "./extras.js";
import { locateQuote, normalizeForMatch, type DocInput } from "./grounding.js";
import { inForceNolikums } from "./phase2-run.js";
import { runModelTask } from "./runner.js";

type Base = Omit<RunOptions, "prompt" | "onEvent">;
export type RolesOutcome = { ok: true; added: number; already: number; rejected: number } | { ok: false; error: string };

export const rolesSchema = z.object({
	items: z.array(
		z.object({
			role: z.string(),
			part: z.string().nullable(),
			side: z.enum(["projektesana", "buvdarbi", "nav_skaidrs"]),
			quote: z.string(),
			file: z.string().nullable(),
		}),
	),
});

export const ROLES_HINT = `{"items": [{"role": "lomas nosaukums kā dokumentā", "part": "AR, BK (vai null)", "side": "projektesana" | "buvdarbi" | "nav_skaidrs", "quote": "burtisks citāts no dokumenta", "file": "faila nosaukums"}]}`;

export const ROLES_INSTRUCTIONS = [
	"Atrodi lomas un speciālistus, ko konkurss prasa vai nosauc kā iesaistāmos: BIM koordinators, VDV pārvaldnieks, BIM modeļa autori pa būvprojekta daļām, 4D/5D speciālisti, tāmētājs, būvdarbu vadītājs, lāzerskenēšanas speciālists un tamlīdzīgi.",
	"role: loma tā, kā tā nosaukta dokumentā (īss nosaukums, bez uzņēmuma un bez personas vārda).",
	'part: būvprojekta daļu kodi (piem. "AR, BK, ŪKT") — TIKAI ja pats citāts tos nosauc; citādi null. Kodus neizdomā.',
	"side: projektesana — projektētāja puse (BIM koordinators, VDV pārvaldnieks, modeļu autori); buvdarbi — būvnieka puse (būvdarbu vadītājs, 4D, 5D, tāmētājs, izpilddokumentācija); nav_skaidrs — dokuments nepasaka, kuras puses loma tā ir.",
	"Katrai lomai burtisks citāts (10–300 zīmes) no dokumenta, kurā loma minēta, un faila nosaukums. Ja dokumentā lomas nav, to neraksti. Neizdomā lomas, personas vai uzņēmumus.",
].join("\n");

/** Kodi like "AR, BK, ŪKT": capital letters and digits only, and each one must stand in the quote itself. */
export function partFrom(raw: string | null, quote: string): string {
	if (!raw) return "";
	const codes = raw.split(/[,;]+/).map((c) => c.trim()).filter(Boolean);
	if (codes.length === 0 || !codes.every((c) => /^[\p{Lu}\d][\p{Lu}\d./-]{0,11}$/u.test(c))) return "";
	const q = quote.replace(/\s+/g, " ");
	return codes.every((c) => new RegExp(`(^|[^\\p{L}\\d])${c.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&")}($|[^\\p{L}\\d])`, "u").test(q)) ? codes.join(", ") : "";
}

const key = (role: string) => normalizeForMatch(role).replace(/[^\p{L}\d ]/gu, "").trim();

/**
 * Keeps only roles whose quote is really in a document, once each, that are not already in the table
 * and were not dismissed before. A person's earlier decision on the same role is kept.
 */
export function groundRoles(data: z.infer<typeof rolesSchema>, docs: DocInput[], roles: Roles, previous: RoleSuggestion[] = []): { items: RoleSuggestion[]; already: number; rejected: number } {
	const inTable = new Set([...roles.design, ...Object.values(roles.build).flat()].map((r) => key(r.role)).filter(Boolean));
	const seen = new Set<string>();
	const items: RoleSuggestion[] = [];
	let already = 0;
	let rejected = 0;
	for (const it of data.items) {
		const k = key(it.role);
		if (!k || seen.has(k)) continue;
		const cite = locateQuote(it.quote, docs, it.file ?? undefined);
		if (!cite) {
			rejected++;
			continue;
		}
		seen.add(k);
		if (inTable.has(k)) {
			already++;
			continue;
		}
		const old = previous.find((p) => key(p.role) === k);
		items.push({ id: old?.id ?? randomUUID(), role: it.role.trim(), part: partFrom(it.part, cite.quote), side: it.side, cite, decision: old?.decision === "rejected" ? "rejected" : null });
	}
	return { items, already, rejected };
}

export async function suggestRoles(p: Project, engine: Engine, base: Base): Promise<RolesOutcome> {
	const s = loadState(p.outputDir);
	const nol = inForceNolikums(p, s);
	const tender = [...docsByKind(p, s, ["pip", "paraugmodelu_prasibas", "tehniska_specifikacija", "pu"]), ...(nol.ok ? nol.docs : [])];
	if (tender.length === 0) return { ok: false, error: "Nav nolasītu konkursa dokumentu (1. Dokumenti)." };
	const { instructions, docs } = withExtras(p, s, "kas", ROLES_INSTRUCTIONS, tender);
	const r = await runModelTask({ engine, base, instructions, schemaHint: ROLES_HINT, schema: rolesSchema, docs });
	if (!r.ok) return r;
	const g = groundRoles(r.data, docs, s.roles, s.rolePicks?.items);
	const picks: RolePicks = { items: g.items, readAt: new Date().toISOString(), already: g.already, rejected: g.rejected };
	// a role already in the table was left out above, so a role added by hand is never offered again
	updateState(p.outputDir, (st) => void (st.rolePicks = picks));
	return { ok: true, added: g.items.filter((i) => !i.decision).length, already: g.already, rejected: g.rejected };
}

export function decideRole(p: Project, id: string, decision: RoleSuggestion["decision"]): void {
	updateState(p.outputDir, (s) => {
		const it = s.rolePicks?.items.find((x) => x.id === id);
		if (it) it.decision = decision;
	});
}
