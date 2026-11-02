// Typed access to the preload bridge. One generic invoke, small typed wrappers on top.
import type { BlockId, Choices, Cited, DocKind, FillSheet, ProjectState, QaItem, Roles, StepId, StepStatus, Variant } from "../shared/state";
import type { Expiry, Registers } from "../shared/registers";
import type { LeakReport } from "../shared/leaks";
import type { DepItem } from "../shared/deps";
import type { Activity } from "../shared/activity";
import type { PreviewBlock } from "../shared/preview";
import type { ExtraSource, SourcePage } from "../shared/sources";
import type { CheckRun, Closeout, Finding, SignatureRow, SignatureVerdict } from "../shared/checks";
import type { EngineId, EngineStatus, FolderSummary, Project, RunEvent, Settings } from "../shared/types";

interface Bridge {
	invoke(channel: string, ...args: unknown[]): Promise<unknown>;
	on(channel: string, cb: (...args: unknown[]) => void): () => void;
}
declare global {
	interface Window {
		konkurss: Bridge;
	}
}

const call = <T>(channel: string, ...args: unknown[]) => window.konkurss.invoke(channel, ...args) as Promise<T>;

export interface ProjectSummary {
	project: Project;
	progress: { done: number; total: number; problems: number };
	tenderId: string | null;
	deadline: string | null;
	changedAt: string;
	sourceExists: boolean;
}
export interface StateBundle {
	state: ProjectState;
	steps: Record<StepId, StepStatus>;
	progress: { done: number; total: number; problems: number };
	checklist: { done: number; total: number };
	warnings: string[];
	editions: { candidates: string[]; guess: { original?: string; amended?: string } };
}
export type SourceOutcome = { ok: true; source: ExtraSource } | { ok: false; error: string };
export type TaskOutcome<T> = ({ ok: true } & T) | { ok: false; error: string };
export type Impact = "kriterijs" | "prasiba" | "redakcionala";

export const onActivity = (cb: (a: Activity) => void) => window.konkurss.on("activity", cb as (...a: unknown[]) => void);

export const api = {
	projects: {
		list: () => call<Project[]>("projects:list"),
		summaries: () => call<ProjectSummary[]>("projects:summaries"),
		add: (input: { name?: string; sourceDir: string; outputDir: string; variant?: Variant | null; builders?: string[] }) => call<Project>("projects:add", input),
		update: (id: string, patch: { name?: string; variant?: Variant | null; builders?: string[] }) => call<Project>("projects:update", id, patch),
		forget: (id: string) => call<void>("projects:forget", id),
	},
	folders: {
		pick: (title: string) => call<string | null>("folders:pick", title),
		summary: (path: string) => call<FolderSummary>("folders:summary", path),
		open: (path: string) => call<string>("folders:open", path),
	},
	sources: {
		pick: (kind: "file" | "folder") => call<string[] | null>("sources:pick", kind),
		add: (projectId: string, page: SourcePage, path: string, note: string) => call<SourceOutcome>("sources:add", projectId, page, path, note),
		refresh: (projectId: string, page: SourcePage, id: string) => call<SourceOutcome>("sources:refresh", projectId, page, id),
		remove: (projectId: string, page: SourcePage, id: string) => call<void>("sources:remove", projectId, page, id),
		note: (projectId: string, page: SourcePage, id: string, note: string) => call<void>("sources:note", projectId, page, id, note),
		open: (projectId: string, page: SourcePage, id: string) => call<string>("sources:open", projectId, page, id),
	},
	settings: {
		get: () => call<Settings>("settings:get"),
		save: (patch: Partial<Settings>) => call<Settings>("settings:save", patch),
		setClaudeKey: (key: string) => call<void>("settings:setClaudeKey", key),
	},
	engines: {
		status: () => call<EngineStatus[]>("engines:status"),
		login: (id: EngineId) => call<void>("engines:login", id),
	},
	agent: {
		run: (req: { runId: string; projectId: string; engine: EngineId; text: string }) => call<void>("agent:run", req),
		stop: (runId: string) => call<void>("agent:stop", runId),
		onEvent: (cb: (runId: string, ev: RunEvent) => void) => window.konkurss.on("agent:event", cb as (...a: unknown[]) => void),
	},
	state: {
		get: (projectId: string) => call<StateBundle>("state:get", projectId),
	},
	files: {
		scan: (projectId: string) => call<number>("files:scan", projectId),
		extract: (projectId: string) => call<{ read: number; readable: number; total: number }>("files:extract", projectId),
		setKind: (projectId: string, root: "source" | "output", rel: string, kind: DocKind) => call<void>("files:setKind", projectId, root, rel, kind),
		text: (projectId: string, root: "source" | "output", rel: string) => call<string | null>("files:text", projectId, root, rel),
		openOne: (projectId: string, root: "source" | "output", rel: string) => call<string>("files:openOne", projectId, root, rel),
		onProgress: (cb: (projectId: string, done: number, total: number, rel: string) => void) => window.konkurss.on("files:progress", cb as (...a: unknown[]) => void),
	},
	tasks: {
		variant: (projectId: string) => call<TaskOutcome<{ variant: Cited<Variant> }>>("tasks:variant", projectId),
		confirmVariant: (projectId: string, value: Variant) => call<Project>("tasks:confirmVariant", projectId, value),
	},
	versions: {
		setEditions: (id: string, original?: string, amended?: string) => call<void>("versions:setEditions", id, original, amended),
		compare: (id: string) => call<TaskOutcome<{ changes: number }>>("versions:compare", id),
		classify: (id: string) => call<TaskOutcome<{ classified: number }>>("versions:classify", id),
		confirmChange: (id: string, index: number, impact: Impact | null) => call<void>("versions:confirmChange", id, index, impact),
		setInForce: (id: string, which: "original" | "amended") => call<void>("versions:setInForce", id, which),
		readQa: (id: string) => call<TaskOutcome<{ items: number; rejected: number }>>("versions:readQa", id),
		setQaImpact: (id: string, index: number, impact: QaItem["impact"]) => call<void>("versions:setQaImpact", id, index, impact),
		confirmQa: (id: string, index: number, value: boolean) => call<void>("versions:confirmQa", id, index, value),
		compareTemplates: (id: string) => call<TaskOutcome<{ forms: number; differing: number }>>("versions:compareTemplates", id),
		readDeadline: (id: string) => call<TaskOutcome<object>>("versions:readDeadline", id),
		setDeadline: (id: string, date: string, time: string, source: "iub" | "eis" | "nolikums" | "manual") => call<void>("versions:setDeadline", id, date, time, source),
	},
	req: {
		read: (id: string, block: BlockId) => call<TaskOutcome<{ rejected: number }>>("req:read", id, block),
		confirm: (id: string, block: BlockId, value: boolean) => call<void>("req:confirm", id, block, value),
		edit: (id: string, block: BlockId, data: unknown) => call<void>("req:edit", id, block, data),
		secondPass: (id: string) => call<TaskOutcome<{ conflicts: number }>>("req:secondPass", id),
	},
	registers: {
		get: () => call<{ registers: Registers; expiring: Expiry[]; hasData: boolean }>("registers:get"),
		save: (r: Registers) => call<{ registers: Registers; expiring: Expiry[] }>("registers:save", r),
		import: (replace: boolean) => call<TaskOutcome<{ specialists: number; objects: number; fields: number }>>("registers:import", replace),
	},
	roles: {
		get: (id: string) => call<Roles>("roles:get", id),
		save: (id: string, roles: Roles) => call<Roles>("roles:save", id, roles),
	},
	fill: {
		templates: (id: string) => call<{ key: string; rel: string; kind: string }[]>("fill:templates", id),
		sheet: (id: string, key: string) => call<FillSheet | null>("fill:valueSheet", id, key),
		preview: (id: string, key: string) => call<TaskOutcome<{ blocks: PreviewBlock[] }>>("fill:preview", id, key),
		inspect: (id: string, key: string) => call<TaskOutcome<{ sheet: FillSheet }>>("fill:inspect", id, key),
		fillBip: (id: string, key: string) => call<TaskOutcome<{ rejected: number; items: number }>>("fill:bip", id, key),
		setItem: (id: string, key: string, slotId: string, value: string | null) => call<void>("fill:setItem", id, key, slotId, value),
		generate: (id: string, key: string, builder?: string) => call<TaskOutcome<{ generated: Generated }>>("fill:generate", id, key, builder),
		builderCopies: (id: string, key: string) => call<TaskOutcome<{ copies: Generated[] }>>("fill:builderCopies", id, key),
		matrica: (id: string, key: string, builder?: string) => call<TaskOutcome<{ result: MatricaResult }>>("fill:matrica", id, key, builder),
	},
	v1: {
		feasibility: (id: string) => call<FeasibilityView>("feasibility:get", id),
		saveDecision: (id: string, decision: Choices["decision"]) => call<void>("feasibility:save", id, decision),
		saveChoices: (id: string, choices: Choices) => call<void>("mapping:save", id, choices),
		finance: (id: string) => call<FinanceView>("finance:get", id),
		saveFinance: (id: string, f: FinanceView["finance"]) => call<FinanceView>("finance:save", id, f),
		forms: (id: string) => call<{ key: string; rel: string; kind: string }[]>("fill:forms", id),
		vocabulary: (id: string) => call<{ id: string; label: string }[]>("fill:vocabulary", id),
		bindForm: (id: string, key: string) => call<TaskOutcome<{ sheet: FillSheet; fromMemory: number; fromModel: number; unbound: number; unplaced: string[] }>>("fill:bindForm", id, key),
		setBinding: (id: string, key: string, slotId: string, binding: string) => call<TaskOutcome<{ sheet: FillSheet }>>("fill:setBinding", id, key, slotId, binding),
		confirmBinding: (id: string, key: string, slotId: string) => call<void>("fill:confirmBinding", id, key, slotId),
		notApplicable: (id: string, key: string, slotId: string) => call<void>("fill:notApplicable", id, key, slotId),
		generateForm: (id: string, key: string) => call<TaskOutcome<{ file: string }>>("fill:generateForm", id, key),
		pickFile: (title: string) => call<string | null>("folders:pickFile", title),
		techProposal: (id: string, boilerplate: string) => call<TaskOutcome<{ changes: number; rejected: number }>>("fill:techProposal", id, boilerplate),
		techDecision: (id: string, i: number, d: "accept" | "reject" | null) => call<void>("fill:techDecision", id, i, d),
		techEdit: (id: string, i: number, text: string) => call<void>("fill:techEdit", id, i, text),
		techGenerate: (id: string) => call<TaskOutcome<{ file: string; applied: number; pending: number }>>("fill:techGenerate", id),
		proofPlan: (id: string) => call<EvidenceItem[]>("proofs:plan", id),
		proofCollect: (id: string) => call<{ copied: string[]; skipped: string[] }>("proofs:collect", id),
	},
	checks: {
		run: (id: string) => call<CheckRun & { summary: { fail: number; warn: number; ok: number; na: number }; unreadable: string[] }>("checks:run", id),
		substance: (id: string) => call<{ ok: boolean; errors: string[]; findings: Finding[] }>("checks:substance", id),
		ack: (id: string, finding: string, on: boolean) => call<void>("checks:ack", id, finding, on),
		setCode: (id: string, code: string | null) => call<void>("checks:code", id, code),
	},
	signatures: {
		get: (id: string) => call<SignaturesView>("signatures:get", id),
		save: (id: string, row: string, change: { file?: string | null; manual?: { name: string; at: string } | null }) => call<SignaturesView>("signatures:save", id, row, change),
		pick: () => call<string | null>("signatures:pick"),
		tick: (id: string, tick: string, on: boolean) => call<void>("eis:tick", id, tick, on),
	},
	closeout: {
		get: (id: string) => call<Closeout>("closeout:get", id),
		save: (id: string, patch: Partial<Closeout>) => call<Closeout>("closeout:save", id, patch),
		addObject: (id: string) => call<TaskOutcome<{ object: { id: string; name: string } }>>("closeout:addObject", id),
		postWin: (id: string) => call<TaskOutcome<{ added: number; rejected: number }>>("closeout:postwin", id),
		clarify: (id: string, request: string, secret: boolean) => call<TaskOutcome<{ result: { file: string; answered: number; unsupported: { question: string; why: string }[] } }>>("clarify:draft", id, request, secret),
	},
	deps: {
		status: () => call<DepItem[]>("deps:status"),
		updateGrok: () => call<{ ok: boolean; out: string }>("grok:update"),
	},
	audit: { tail: (projectId: string, lines?: number) => call<{ at: string; tool: string; path?: string; ok: boolean; reason?: string; engine?: string }[]>("audit:tail", projectId, lines) },
};

/** Electron wraps thrown errors as "Error invoking remote method 'x': Error: <message>". Show only the message. */
export function errorText(e: unknown): string {
	const m = e instanceof Error ? e.message : String(e);
	return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

export interface Generated {
	file: string;
	builder: string;
	open: number;
	leaks: LeakReport;
}
export interface MatricaResult {
	file: string;
	filledAuthors: number;
	missingAuthors: number;
	keptCells: number;
	lodFilled: number;
	phasesAssumed: boolean;
}

export interface FeasibilityView {
	feasibility: {
		specialists: { required: string; covered: boolean; by: { id: string; name: string; type: "A" | "B" | "C"; field: string; certificate: string; validUntil: string }[] }[];
		specialistsCovered: number;
		slots: { slot: SlotView; qualifying: { id: string; name: string }[]; excluded: { object: { id: string; name: string }; reasons: string[] }[]; needed: number; met: boolean }[];
		points: { price: number; reachable: number; lost: { name: string; points: number; why: string }[]; total: number };
		blockers: string[];
	};
	slots: SlotView[];
	options: Record<string, { id: string; name: string; ok: boolean; reasons: string[]; warnings: string[] }[]>;
	choices: Choices;
	requirements: { field: string | null; mandatory: boolean }[];
	bpv: { ok: boolean; message: string }[];
	produced: string[];
}
export interface SlotView {
	id: string;
	kind: "company" | "bpv" | "energy";
	title: string;
	count: number | null;
	years: number | null;
	points: number | null;
	source: string;
}
export interface FinanceView {
	finance: { rows: { name: string; amount: string }[]; vatPercent: number; eisAmount: string | null };
	totals: { rows: { name: string; net: number | null; vat: number | null; gross: number | null }[]; net: number; vat: number; gross: number; eis: number | null; invalid: string[] };
}
export interface EvidenceItem {
	slot: string;
	object: string;
	label: string;
	from: string;
	toRel: string;
	status: "ok" | "missing";
	reason?: string;
}

export interface SignaturesView {
	rows: SignatureRow[];
	verdicts: Record<string, SignatureVerdict>;
	ticks: { id: string; text: string; source: string }[];
	ticked: Record<string, true>;
	deadline: ProjectState["deadline"];
}
