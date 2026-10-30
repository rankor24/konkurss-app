// What the agent is doing, in words a person reads. Shared by the main process (which emits) and the side panel (which shows).
import type { EngineId, RunEvent } from "./types.js";

export interface Activity {
	/** one model run; progress lines of the same run replace each other */
	run: string;
	project: string | null;
	engine: EngineId;
	at: string;
	kind: "start" | "tool" | "answer" | "done" | "error";
	text: string;
	/** the full text behind the line: the whole task for "start", everything the agent wrote so far for "answer" */
	detail?: string;
}

const TOOLS: Record<string, string> = {
	list_files: "Skatās failu sarakstu",
	read_doc: "Lasa dokumentu",
	get_skill: "Ielādē instrukcijas",
	write_text: "Raksta failu",
};

const last = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

/** The file or folder a tool call is about, from the raw tool input (`{"path": "…"}`), or "" when there is none. */
export function targetOf(detail: string | undefined): string {
	if (!detail) return "";
	try {
		const o = JSON.parse(detail) as Record<string, unknown>;
		const p = o.path ?? o.file ?? o.dir ?? o.skill;
		return typeof p === "string" ? last(p) : "";
	} catch {
		const m = detail.match(/"(?:path|file|dir|skill)"\s*:\s*"([^"]+)"/);
		return m ? last(m[1].replace(/\\\\/g, "\\")) : "";
	}
}

/** The MCP tool name arrives as `mcp__konkurss-tools__read_doc` or plain `read_doc`; show only the last part. */
export const toolWords = (name: string) => TOOLS[name.split(/__|\./).pop() ?? name] ?? "Izmanto rīku";

export function describe(ev: RunEvent): { kind: Activity["kind"]; text: string } | null {
	if (ev.type === "tool") {
		const t = targetOf(ev.detail);
		return { kind: "tool", text: t ? `${toolWords(ev.name)}: ${t}` : toolWords(ev.name) };
	}
	if (ev.type === "tool_result" && !ev.ok) return { kind: "tool", text: `${toolWords(ev.name)} — neizdevās` };
	if (ev.type === "done") return { kind: "done", text: "Pabeigts" };
	if (ev.type === "error") return { kind: "error", text: ev.message };
	return null;
}

/** Streamed answer text is the model's own formatted output, not something to read; show how much has been written. */
export const progressText = (chars: number) => `Atbilde — ${chars.toLocaleString("lv-LV")} zīmes`;

/** First line of a task's instructions, shortened — what the run is about. */
export function taskTitle(prompt: string): string {
	const lines = prompt.split("\n").filter((l) => l.trim().length > 8);
	// the first lines are the fixed preamble given to every task; the title is the first line that is about this task
	const line = lines.find((l) => !/^Tu esi |NEIZMANTO/i.test(l.trim())) ?? lines[0] ?? "Uzdevums";
	const t = line.trim();
	return t.length > 110 ? `${t.slice(0, 107)}…` : t;
}
