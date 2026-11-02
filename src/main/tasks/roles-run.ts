// 5. Kas ko dara: the roles a tender asks for, read from its documents. Suggestions only — the table is filled by a person.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ProjectState, RolePicks, RoleSuggestion, Roles } from "../../shared/state.js";
import type { Project } from "../../shared/types.js";
import type { Engine, RunOptions } from "../engines/types.js";
import { loadState, updateState } from "../project-state.js";
import { readCachedText } from "../extract.js";
import { docLabel, docsByKind } from "./docs.js";
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
			company: z.string().nullish(),
			person: z.string().nullish(),
			side: z.enum(["projektesana", "buvdarbi", "nav_skaidrs"]),
			quote: z.string(),
			file: z.string().nullable(),
		}),
	),
});

export const ROLES_HINT = `{"items": [{"role": "lomas nosaukums kā dokumentā", "part": "AR, BK (vai null)", "company": "uzņēmums, ja citāts to nosauc (vai null)", "person": "Vārds Uzvārds, ja citāts to nosauc (vai null)", "side": "projektesana" | "buvdarbi" | "nav_skaidrs", "quote": "burtisks citāts no dokumenta", "file": "faila nosaukums"}]}`;

export const ROLES_INSTRUCTIONS = [
	"Atrodi lomas un speciālistus, ko konkurss prasa vai nosauc kā iesaistāmos: BIM koordinators, VDV pārvaldnieks, BIM modeļa autori pa būvprojekta daļām, 4D/5D speciālisti, tāmētājs, būvdarbu vadītājs, lāzerskenēšanas speciālists un tamlīdzīgi.",
	"role: loma tā, kā tā nosaukta dokumentā (īss nosaukums, bez uzņēmuma un bez personas vārda).",
	'company, person: uzņēmums un cilvēks, ko dokuments PATS nosauc šai lomai (piem. dalībnieku tabulas rindā "VDV pārvaldnieks | SIA Digitālā Vide | Jānis Bērziņš"). Raksti tos TIKAI, ja tie burtiski stāv tajā pašā citātā; citādi null. Ja dokumentā ir vairāki cilvēki vienai lomai, dod katram savu ierakstu.',
	'part: būvprojekta daļu kodi (piem. "AR, BK, ŪKT") — TIKAI ja pats citāts tos nosauc; citādi null. Kodus neizdomā.',
	"side: projektesana — projektētāja puse (BIM koordinators, VDV pārvaldnieks, modeļu autori); buvdarbi — būvnieka puse (būvdarbu vadītājs, 4D, 5D, tāmētājs, izpilddokumentācija); nav_skaidrs — dokuments nepasaka, kuras puses loma tā ir.",
	'Speciālistu un apakšuzņēmēju sarakstos (dokumenti, kuru nosaukumā ir „saraksts”) katra tabulas rinda ir viens ieraksts: role = specialitāte, person = Vārds, uzvārds, citāts = visa rinda. Uzņēmumu ņem no sava citāta tikai tad, ja tas stāv tajā pašā rindā.',
	"Katrai lomai burtisks citāts (10–300 zīmes) no dokumenta, kurā loma minēta (un kurā ir uzņēmums vai cilvēks, ja tos raksti), un faila nosaukums. Ja dokumentā lomas nav, to neraksti. Neizdomā lomas, personas vai uzņēmumus.",
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

/** A company or a person's name counts only when the cited text itself contains it. */
export function nameIn(raw: string | null | undefined, quote: string): string {
	const v = (raw ?? "").trim();
	return v.length >= 3 && normalizeForMatch(quote).includes(normalizeForMatch(v)) ? v : "";
}

/**
 * Keeps only roles whose quote is really in a document, once per role and person, that are not already in the table
 * and were not dismissed before. A company or a person is kept only when it stands in the quote. A person's earlier decision is kept.
 */
export function groundRoles(data: z.infer<typeof rolesSchema>, docs: DocInput[], roles: Roles, previous: RoleSuggestion[] = []): { items: RoleSuggestion[]; already: number; rejected: number } {
	const rows = [...roles.design, ...Object.values(roles.build).flat()].filter((r) => key(r.role));
	const seen = new Set<string>();
	const items: RoleSuggestion[] = [];
	let already = 0;
	let rejected = 0;
	for (const it of data.items) {
		const k = key(it.role);
		if (!k) continue;
		const cite = locateQuote(it.quote, docs, it.file ?? undefined);
		if (!cite) {
			rejected++;
			continue;
		}
		const person = nameIn(it.person, cite.quote);
		const company = nameIn(it.company, cite.quote);
		// one entry per role and person: two authors of the same role are both offered
		const id = `${k}|${key(person)}`;
		if (seen.has(id)) continue;
		seen.add(id);
		// in the table already: the same role, and — when the document names a person — that same person
		if (rows.some((r) => key(r.role) === k && (!person || key(r.person) === key(person)))) {
			already++;
			continue;
		}
		const old = previous.find((p) => key(p.role) === k && key(p.person ?? "") === key(person));
		items.push({ id: old?.id ?? randomUUID(), role: it.role.trim(), part: partFrom(it.part, cite.quote), company, person, side: it.side, cite, decision: old?.decision === "rejected" ? "rejected" : null });
	}
	return { items, already, rejected };
}

/** File names of lists that already name people or companies: a specialist list, a subcontractor list. */
export const PARTICIPANT_LIST = /speci[aā]list\w*[_ ]?saraksts|apak[sš]uz[nņ][eē]m[eē]j\w*[_ ]?saraksts/i;

/**
 * The project's own lists of named people and companies: files read as a qualification form, plus any
 * file whose name says it is a specialist or subcontractor list (the app files a subcontractor list as "cits").
 */
export function participantDocs(p: Project, s: ProjectState): DocInput[] {
	const byKind = docsByKind(p, s, ["kvalifikacija"]);
	const named = s.files
		.filter((f) => f.kind !== "kvalifikacija" && f.where !== "darba" && f.text === "ok" && PARTICIPANT_LIST.test(f.rel.split(/[\\/]/).pop() ?? ""))
		.flatMap((f) => {
			const text = readCachedText(p, f);
			return text ? [{ file: docLabel(f, s.files), text }] : [];
		});
	return [...byKind, ...named];
}

export async function suggestRoles(p: Project, engine: Engine, base: Base): Promise<RolesOutcome> {
	const s = loadState(p.outputDir);
	const nol = inForceNolikums(p, s);
	const requirements = [...docsByKind(p, s, ["pip", "paraugmodelu_prasibas", "tehniska_specifikacija", "pu"]), ...(nol.ok ? nol.docs : [])];
	if (requirements.length === 0) return { ok: false, error: "Nav nolasītu konkursa dokumentu (1. Dokumenti)." };
	// the people lists are short and go first: the requirement documents are longer than a prompt holds, and the end is cut
	const tender = [...participantDocs(p, s), ...requirements];
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
