// Everything the IPC handlers share: store, engines, paths, and the run-options builder.
import { join } from "node:path";
import type { EngineId, Project } from "../shared/types.js";
import type { ProjectState } from "../shared/state.js";
import { Store } from "./store.js";
import { createEngines, mcpLaunch } from "./engines/index.js";
import type { Engine, RunOptions } from "./engines/types.js";
import { pyConfigFromEnv, type PyConfig } from "../mcp/python.js";
import { loadState } from "./project-state.js";
import { withActivity } from "./activity.js";

export interface Paths {
	pluginDir: string;
	skillsDir: string;
	serverJs: string;
}

export class AppContext {
	readonly engines: Record<EngineId, Engine>;
	readonly py: PyConfig;
	/** run folder → project id, so the activity panel knows which tender a run belongs to */
	private readonly runDirs = new Map<string, string>();

	constructor(
		readonly store: Store,
		readonly paths: Paths,
		readonly emit: (channel: string, ...args: unknown[]) => void,
	) {
		this.engines = createEngines(() => store.claudeKey());
		this.py = { ...pyConfigFromEnv(process.env), skillsDir: paths.skillsDir };
	}

	project(id: string): Project {
		const p = this.store.projects().find((x) => x.id === id);
		if (!p) throw new Error("Konkurss nav atrasts.");
		return p;
	}

	state(id: string): ProjectState {
		return loadState(this.project(id).outputDir);
	}

	/** Engine chosen for model tasks in Iestatījumi. */
	taskEngine(): Engine {
		return withActivity(this.engines[this.store.settings().engineForTasks], (a) => this.emit("activity", a), (dir) => this.runDirs.get(dir) ?? null);
	}

	runBase(project: Project, engine: EngineId, signal: AbortSignal): Omit<RunOptions, "prompt" | "onEvent"> {
		const runDir = this.store.runDir(project.id);
		this.runDirs.set(runDir, project.id);
		return {
			runDir,
			pluginDir: this.paths.pluginDir,
			mcp: mcpLaunch({
				serverJs: this.paths.serverJs,
				project,
				skillsDir: this.paths.skillsDir,
				auditFile: join(project.outputDir, ".konkurss", "audit.jsonl"),
				engine,
				python: process.env.KONKURSS_PY,
				toolsExe: process.env.KONKURSS_TOOLS_EXE,
			}),
			model: this.store.settings().models[engine],
			signal,
		};
	}
}
