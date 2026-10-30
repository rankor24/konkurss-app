import type { EngineId, EngineStatus, RunEvent } from "../../shared/types.js";

/** How to start the konkurss-tools MCP server. Same spec for every engine. */
export interface McpLaunch {
	command: string;
	args: string[];
	env: Record<string, string>;
}

export interface RunOptions {
	/** Full prompt, already including folder paths and working rules. */
	prompt: string;
	/** App-owned scratch folder for this project (never a tender folder). */
	runDir: string;
	/** resources/plugin — Claude loads skills from here natively. */
	pluginDir: string;
	mcp: McpLaunch;
	model?: string;
	signal: AbortSignal;
	onEvent: (e: RunEvent) => void;
}

export interface Engine {
	id: EngineId;
	status(): Promise<EngineStatus>;
	run(opts: RunOptions): Promise<void>;
	/** Starts the vendor's own sign-in flow (Codex, Grok). Claude uses an API key instead. */
	login?(): Promise<void>;
}

/** Only these tools may run. Everything that touches files goes through konkurss-tools. */
export const KONKURSS_TOOLS = ["list_files", "read_doc", "get_skill", "write_text", "project_overview", "list_open_fields", "set_field", "set_deadline", "set_role"] as const;
export const MCP_SERVER_NAME = "konkurss";
