import type { EngineId, EngineStatus, FolderSummary, Project, RunEvent, Settings, Variant } from "../shared/types";

/** Typed view of the preload bridge (window.konkurss). */
export interface KonkurssApi {
	projects: {
		list(): Promise<Project[]>;
		add(input: { name?: string; sourceDir: string; outputDir: string; variant?: Variant | null; builders?: string[] }): Promise<Project>;
		update(id: string, patch: { name?: string; variant?: Variant | null; builders?: string[] }): Promise<Project>;
		forget(id: string): Promise<void>;
	};
	folders: {
		pick(title: string): Promise<string | null>;
		summary(path: string): Promise<FolderSummary>;
		open(path: string): Promise<string>;
	};
	settings: {
		get(): Promise<Settings>;
		save(patch: Partial<Settings>): Promise<Settings>;
		setClaudeKey(key: string): Promise<void>;
	};
	engines: {
		status(): Promise<EngineStatus[]>;
		login(id: EngineId): Promise<void>;
	};
	agent: {
		run(req: { runId: string; projectId: string; engine: EngineId; text: string }): Promise<void>;
		stop(runId: string): Promise<void>;
		onEvent(cb: (runId: string, ev: RunEvent) => void): () => void;
	};
}

declare global {
	interface Window {
		konkurss: KonkurssApi;
	}
}

export const api = (): KonkurssApi => window.konkurss;

/** Electron wraps thrown errors as "Error invoking remote method 'x': Error: <message>". Show only the message. */
export function errorText(e: unknown): string {
	const m = e instanceof Error ? e.message : String(e);
	return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}
