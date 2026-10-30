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

/** One streamed event from an engine run, already normalised across vendors. */
export type RunEvent =
	| { type: "text"; text: string }
	| { type: "tool"; name: string; detail?: string }
	| { type: "tool_result"; name: string; ok: boolean; detail?: string }
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
}
