// Step status for the rail, computed from project state only (no UI state).
import { STEPS, type ProjectState, type StepId, type StepStatus } from "./state.js";

export function stepStatus(s: ProjectState, step: StepId): StepStatus {
	switch (step) {
		case "dokumenti": {
			if (!s.scannedAt) return "nav";
			if (!s.extractedAt) return "proc";
			const problems = s.files.some((f) => f.text === "kluda" || f.text === "tukss");
			return problems ? "problema" : "gatavs";
		}
		case "versija": {
			const v = s.versions;
			const pendingQa = v.qa.some((q) => !q.confirmed);
			const pendingChange = v.changes.some((c) => !c.confirmed);
			const templateIssue = v.templates.some((t) => !t.equal);
			const deadlineSet = s.deadline.date.value !== null;
			if (!v.inForce && v.qa.length === 0 && !deadlineSet) return "nav";
			if (templateIssue) return "problema";
			if (pendingQa || pendingChange || !v.inForce || !deadlineSet) return "proc";
			return "gatavs";
		}
		case "prasibas": {
			const blocks = ["dati", "dokumenti", "pieredze", "specialisti", "vertesana", "apaksuznemeji"] as const;
			const read = blocks.filter((b) => s.requirements.readAt[b]).length;
			const confirmed = blocks.filter((b) => s.requirements.confirmed[b]).length;
			if (read === 0) return "nav";
			const conflicts = hasConflicts(s);
			if (conflicts) return "problema";
			return confirmed === blocks.length ? "gatavs" : "proc";
		}
		default: {
			// Later steps report their own status through state[step].status once implemented.
			const own = (s[step] as { status?: StepStatus } | undefined)?.status;
			return own ?? "nav";
		}
	}
}

function hasConflicts(s: ProjectState): boolean {
	const r = s.requirements;
	const cited = [s.deadline.date, s.deadline.time, r.apaksuznemeji.threshold, ...r.vertesana.flatMap((c) => [c.points, c.name])];
	return cited.some((c) => c.conflict);
}

export function allStepStatuses(s: ProjectState): Record<StepId, StepStatus> {
	return Object.fromEntries(STEPS.map((st) => [st.id, stepStatus(s, st.id)])) as Record<StepId, StepStatus>;
}

export interface ChecklistItem {
	step: StepId;
	label: string;
	done: boolean;
}

/**
 * The "Čeklists x/y" counter in the top bar: concrete things to finish, derived from state only.
 * Later phases append their own items here.
 */
export function checklist(s: ProjectState): ChecklistItem[] {
	const r = s.requirements;
	const items: ChecklistItem[] = [
		{ step: "dokumenti", label: "Mapes pārskatītas", done: !!s.scannedAt },
		{ step: "dokumenti", label: "Dokumentu teksts nolasīts", done: !!s.extractedAt },
		{ step: "dokumenti", label: "Visi nolasāmie faili nolasīti", done: !!s.extractedAt && !s.files.some((f) => f.text === "kluda" || f.text === "tukss") },
		{ step: "versija", label: "Spēkā esošā redakcija izvēlēta", done: !!s.versions.inForce },
		{ step: "versija", label: "Komisijas atbildes apstiprinātas", done: s.versions.qa.length > 0 && s.versions.qa.every((q) => q.confirmed) },
		{ step: "versija", label: "Veidlapas salīdzinātas", done: !!s.versions.templatesComparedAt && s.versions.templates.every((t) => t.equal) },
		{ step: "versija", label: "Termiņš ievadīts", done: s.deadline.date.value !== null },
	];
	for (const [id, label] of [
		["dati", "Konkursa dati"],
		["dokumenti", "Kas jāiesniedz"],
		["pieredze", "Uzņēmuma pieredze"],
		["specialisti", "Speciālisti"],
		["vertesana", "Vērtēšana"],
		["apaksuznemeji", "Apakšuzņēmēji"],
	] as const) {
		items.push({ step: "prasibas", label: `${label} pārbaudīts`, done: !!r.confirmed[id] });
	}
	return items;
}

export function progress(s: ProjectState): { done: number; total: number; problems: number } {
	const all = Object.values(allStepStatuses(s));
	return {
		done: all.filter((x) => x === "gatavs" || x === "neattiecas").length,
		total: all.length,
		problems: all.filter((x) => x === "problema").length,
	};
}
