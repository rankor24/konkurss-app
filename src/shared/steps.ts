// Step status for the rail, computed from project state only (no UI state).
import { STEPS, type ProjectState, type StepId, type StepStatus } from "./state.js";
import { stepsNotApplicable } from "./profile.js";

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
		case "varam": {
			if (s.requirements.readAt.specialisti === undefined && s.requirements.readAt.vertesana === undefined) return "nav";
			return s.choices.decision.apply ? "gatavs" : "proc";
		}
		case "aizpildit": {
			const sheets = Object.values(s.fills);
			if (sheets.length === 0) return "nav";
			const forms = sheets.filter((sh) => sh.items.some((i) => i.kind === "cell"));
			const open = forms.some((sh) => sh.items.some((i) => i.kind === "cell" && i.status === "missing"));
			const written = sheets.every((sh) => Object.keys(sh.outputs).length > 0);
			return written && !open ? "gatavs" : "proc";
		}
		case "pieradijumi": {
			const chosen = Object.values(s.choices.objects).flat().length;
			if (chosen === 0) return "nav";
			if (!s.proofs) return "proc";
			return s.proofs.missing > 0 ? "problema" : "gatavs";
		}
		case "kas": {
			// V2/V3: the roles tables. V1 is decided by the specialists screen (phase 4).
			const v = s.variant?.value;
			if (v !== "V2" && v !== "V3") {
				const ch = s.choices;
				const need = s.requirements.specialisti.filter((x) => x.mandatory).length;
				const chosen = Object.keys(ch.specialists).length;
				const slotsWithCount = s.requirements.pieredze.length + s.requirements.vertesana.filter((c) => c.objectsNeeded).length;
				const hasObjects = Object.values(ch.objects).some((o) => o.length > 0);
				if (need === 0 && slotsWithCount === 0) return "nav";
				if (chosen === 0 && !hasObjects) return "nav";
				return chosen >= need && hasObjects ? "gatavs" : "proc";
			}
			if (s.roles.design.length === 0) return "nav";
			const people = (rows: { person: string; company: string }[]) => rows.length > 0 && rows.every((r) => r.person.trim() && r.company.trim());
			const builders = Object.keys(s.roles.build);
			return people(s.roles.design) && builders.length > 0 && builders.every((b) => people(s.roles.build[b])) ? "gatavs" : "proc";
		}
		case "parbaude": {
			const run = s.checks as { findings: { id: string; status: string }[] } | undefined;
			if (!run) return "nav";
			const ack = (s.checkAck as Record<string, true> | undefined) ?? {};
			const open = run.findings.filter((f) => !ack[f.id]);
			if (open.some((f) => f.status === "fail")) return "problema";
			return open.some((f) => f.status === "warn") ? "proc" : "gatavs";
		}
		case "paraksti": {
			const sum = s.signaturesSummary as { total: number; ok: number; wrong: number } | undefined;
			if (!sum || sum.total === 0) return "nav";
			if (sum.wrong > 0) return "problema";
			return sum.ok >= sum.total ? "gatavs" : "proc";
		}
		case "rezultats": {
			const c = s.closeout as { submittedAt: string | null; result: string | null } | undefined;
			if (!c || (!c.submittedAt && !c.result)) return "nav";
			return c.result ? "gatavs" : "proc";
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
	const na = stepsNotApplicable(s.profile);
	return Object.fromEntries(STEPS.map((st) => [st.id, na.includes(st.id) ? "neattiecas" : stepStatus(s, st.id)])) as Record<StepId, StepStatus>;
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
