// Leak checks (mistake catalogue B5, B6): another tender's names in this document, working notes in
// brackets, and one builder's data in another builder's copy. Exact search in code, no model.
import type { Project } from "../../shared/types.js";
import type { ProjectState } from "../../shared/state.js";
import { loadState } from "../project-state.js";
import type { LeakReport, TermHit } from "../../shared/leaks.js";
import type { ToolsConfig } from "../pytools.js";
import { grepTerms } from "../pytools.js";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/** "260713_Salacgriva_Sila iela 2" → "Salacgriva Sila iela 2" */
export function tenderLabel(name: string): string {
	return name.replace(/^\d{6}[_ -]*/, "").replace(/_/g, " ").trim();
}

/**
 * Names that identify OTHER tenders: their project names, IDs, purchasers and subjects as read in the app,
 * plus a list the user keeps in Iestatījumi. A term that also occurs in this tender's own identity is dropped
 * (two NVA tenders share the purchaser; that is not a leak).
 */
export function foreignTerms(current: { project: Project; state: ProjectState }, others: Project[], extra: string[] = []): string[] {
	const own = norm(
		[current.project.name, current.state.requirements.dati.id.value, current.state.requirements.dati.purchaser.value, current.state.requirements.dati.subject.value].filter(Boolean).join(" "),
	);
	const terms = new Set<string>();
	const add = (t?: string | null) => {
		const v = (t ?? "").trim();
		if (v.length >= 4) terms.add(v);
	};
	for (const o of others) {
		if (o.id === current.project.id) continue;
		add(tenderLabel(o.name));
		let st: ProjectState | null = null;
		try {
			st = loadState(o.outputDir);
		} catch {
			/* a broken other project must not block this one */
		}
		if (st) {
			add(st.requirements.dati.id.value);
			add(st.requirements.dati.subject.value?.slice(0, 60));
			add(st.requirements.dati.purchaser.value);
		}
	}
	for (const e of extra) add(e);
	return [...terms].filter((t) => !own.includes(norm(t)));
}

/** Regexes for working notes left in a document: "[ ... ]" other than our own markers. */
export const NOTE_PATTERNS = ["\\[(?!aizpildīt\\]|BŪVNIEKS)[^\\]\\n]{3,}\\]"];

export async function checkDocument(cfg: ToolsConfig, file: string, terms: string[]): Promise<LeakReport> {
	const r = await grepTerms(cfg, { files: [file], terms, patterns: NOTE_PATTERNS });
	const unreadable = r.hits.filter((h) => h.term === null);
	const notes = r.hits.filter((h) => h.term === NOTE_PATTERNS[0]);
	const foreign = r.hits.filter((h) => h.term !== null && h.term !== NOTE_PATTERNS[0]);
	return { clean: r.hits.length === 0, foreign, notes, unreadable };
}

/** Terms that belong to the OTHER builders: their names and the people/companies in their role rows. */
export function otherBuilderTerms(state: ProjectState, builders: string[], me: string): string[] {
	const terms = new Set<string>();
	for (const b of builders) {
		if (b === me) continue;
		terms.add(b);
		for (const r of state.roles.build[b] ?? []) {
			if (r.person.trim().length >= 4) terms.add(r.person.trim());
			if (r.company.trim().length >= 4 && r.company.trim() !== me) terms.add(r.company.trim());
		}
	}
	// a person who legitimately appears on both sides (our own design team) is not a leak
	for (const r of state.roles.design) terms.delete(r.person.trim());
	for (const r of state.roles.build[me] ?? []) terms.delete(r.person.trim());
	return [...terms];
}

export type { LeakReport };
