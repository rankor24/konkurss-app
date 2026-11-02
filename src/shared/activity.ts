// What the agent is doing, in words a person reads. Shared by the main process (which emits) and the side panel (which shows).
import type { EngineId, RunEvent, ToolKind } from "./types.js";

export interface Activity {
	/** one model run; every line of it carries the same id */
	run: string;
	project: string | null;
	engine: EngineId;
	at: string;
	kind: "start" | "turn" | "thinking" | "tool" | "answer" | "done" | "error";
	text: string;
	/** the full text behind the line: the whole task for "start", the reasoning or answer so far, a tool's input and what it returned */
	detail?: string;
	/** lines with the same step are one thing that changes: a tool going from running to finished, a block of thinking or answer that grows */
	step?: string;
	tool?: ToolKind;
	status?: "running" | "ok" | "failed";
}

const TOOLS: Record<string, string> = {
	list_files: "Skatās failu sarakstu",
	read_doc: "Lasa dokumentu",
	get_skill: "Ielādē instrukcijas",
	write_text: "Raksta failu",
	project_overview: "Pārskata konkursa stāvokli",
	list_open_fields: "Meklē tukšos laukus",
	set_field: "Ieraksta lauku",
	set_deadline: "Ieraksta termiņu",
	set_role: "Ieraksta lomu",
};

/** The kind of our own tools; other tools say what they are themselves. */
const TOOL_KINDS: Record<string, ToolKind> = {
	list_files: "read",
	read_doc: "read",
	get_skill: "read",
	project_overview: "read",
	list_open_fields: "read",
	write_text: "edit",
	set_field: "edit",
	set_deadline: "edit",
	set_role: "edit",
};

export const KIND_LABEL: Record<ToolKind | "thinking", string> = {
	read: "Lasa",
	search: "Meklē",
	edit: "Raksta",
	shell: "Komanda",
	web: "Tīmeklis",
	plan: "Plāns",
	other: "Rīks",
	thinking: "Domā",
};

const last = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
const baseName = (name: string) => name.split(/__|\./).pop() ?? name;

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
export const toolWords = (name: string) => TOOLS[baseName(name)] ?? "Izmanto rīku";

export const toolKind = (name: string, hint?: ToolKind): ToolKind => TOOL_KINDS[baseName(name)] ?? hint ?? "other";

const oneLine = (s: string, max: number) => {
	const t = s.replace(/\s+/g, " ").trim();
	return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

export function describe(ev: RunEvent): { kind: Activity["kind"]; text: string } | null {
	if (ev.type === "tool") {
		if (!TOOLS[baseName(ev.name)] && ev.kind && ev.kind !== "other") {
			// a vendor's own tool (a shell command, a search): its kind and what it was given
			return { kind: "tool", text: ev.detail ? `${KIND_LABEL[ev.kind]}: ${oneLine(ev.detail, 90)}` : KIND_LABEL[ev.kind] };
		}
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

/** The first line of the model's reasoning, without markdown emphasis — what it is thinking about. */
export const thinkingLine = (text: string) => oneLine(text.replace(/[*_`#]+/g, "").split("\n").find((l) => l.trim()) ?? "", 100) || "…";

/** First line of a task's instructions, shortened — what the run is about. */
export function taskTitle(prompt: string): string {
	const lines = prompt.split("\n").filter((l) => l.trim().length > 8);
	// the first lines are the fixed preamble given to every task; the title is the first line that is about this task
	const line = lines.find((l) => !/^Tu esi |NEIZMANTO/i.test(l.trim())) ?? lines[0] ?? "Uzdevums";
	const t = line.trim();
	return t.length > 110 ? `${t.slice(0, 107)}…` : t;
}

/** What a shell command does, from its text: reading a file, searching in files, or something else. */
export function shellKind(command: string): ToolKind {
	if (/\b(rg|grep|findstr|Select-String|ripgrep)\b/i.test(command)) return "search";
	if (/\b(cat|type|Get-Content|head|tail|sed|less|more)\b/i.test(command)) return "read";
	return "shell";
}
