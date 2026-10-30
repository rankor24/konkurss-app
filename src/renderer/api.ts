// Typed access to the preload bridge. One generic invoke, small typed wrappers on top.
import type { Cited, DocKind, ProjectState, StepId, StepStatus, Variant } from "../shared/state";
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
}
export type TaskOutcome<T> = ({ ok: true } & T) | { ok: false; error: string };

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
	audit: { tail: (projectId: string, lines?: number) => call<{ at: string; tool: string; path?: string; ok: boolean; reason?: string; engine?: string }[]>("audit:tail", projectId, lines) },
};

/** Electron wraps thrown errors as "Error invoking remote method 'x': Error: <message>". Show only the message. */
export function errorText(e: unknown): string {
	const m = e instanceof Error ? e.message : String(e);
	return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}
