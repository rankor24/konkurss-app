// Dependency status types, shared by main process and renderer.
export type DepState = "ok" | "missing" | "old" | "warn";
export interface DepItem {
	id: "tools" | "claude" | "codex" | "grok";
	label: string;
	state: DepState;
	detail: string;
	/** what the person does about it; empty when nothing is needed */
	fix: string;
	action?: "update-grok";
}
