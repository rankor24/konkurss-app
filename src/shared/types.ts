// Types shared by main process, tool server and renderer.

export type EngineId = "claude" | "codex" | "grok";

export const ENGINE_LABELS: Record<EngineId, string> = {
	claude: "Claude (API atslēga)",
	codex: "Codex (ChatGPT abonements)",
	grok: "Grok (SuperGrok abonements)",
};

/** What the settings screen shows per engine. `reason` is plain Latvian for the lietvede. */
export interface EngineStatus {
	id: EngineId;
	ready: boolean;
	reason: string;
	/** True when the app can start the vendor's own sign-in flow. */
	canLogin: boolean;
}

/** What a tool call does, as far as the side panel needs to tell: reading, searching, editing, a shell command, the web, a plan. */
export type ToolKind = "read" | "search" | "edit" | "shell" | "web" | "plan" | "other";

/** One streamed event from an engine run, already normalised across vendors. */
export type RunEvent =
	| { type: "text"; text: string }
	/** The model's reasoning (a summary, or the thinking itself), as the vendor gives it. */
	| { type: "thinking"; text: string }
	/** A new model response begins (the n-th of this run). */
	| { type: "turn"; n: number }
	| { type: "tool"; name: string; detail?: string; /** pairs the call with its result */ id?: string; kind?: ToolKind }
	| { type: "tool_result"; name: string; ok: boolean; detail?: string; id?: string; /** what the tool returned, shortened */ output?: string }
	| { type: "done"; text: string }
	/** Raw provider error, never rewritten (decision D11). */
	| { type: "error"; engine: EngineId; message: string };

/** V1 projektēšana · V2 projektē un būvē · V3 tikai BIM daļa. */
export type Variant = "V1" | "V2" | "V3";

export interface Project {
	id: string;
	name: string;
	/** Izejas dati — read-only for everything in the app. */
	sourceDir: string;
	/** Where new versions are written. */
	outputDir: string;
	variant: Variant | null;
	builders: string[];
	createdAt: string;
}

export interface FolderSummary {
	path: string;
	exists: boolean;
	total: number;
	byExt: Record<string, number>;
}

export interface Settings {
	engineForTasks: EngineId;
	models: Partial<Record<EngineId, string>>;
	hasClaudeKey: boolean;
	/** the "Aģents" switch on every page; anything but false means on */
	agentOn?: boolean;
	/** extra names of other tenders to look for in finished documents */
	foreignTerms?: string[];
}
