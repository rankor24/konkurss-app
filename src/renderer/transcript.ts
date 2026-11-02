// The Aģents chat as blocks: what the person asked, what the agent thought, each tool call with its input and result, and what it answered.
import { KIND_LABEL, targetOf, toolKind, toolWords } from "../shared/activity";
import type { RunEvent, ToolKind } from "../shared/types";

export type Block =
	| { k: "user"; text: string }
	| { k: "thinking"; text: string }
	| { k: "tool"; id: string; tool: ToolKind; words: string; target: string; input?: string; output?: string; status: "running" | "ok" | "failed"; error?: string }
	| { k: "answer"; text: string }
	| { k: "error"; text: string }
	| { k: "done" };

const oneLine = (s: string, max: number) => {
	const t = s.replace(/\s+/g, " ").trim();
	return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** What a tool call was given, as one line: the file it is about, else the value it writes, else the first words of its input. */
function targetFor(name: string, detail: string | undefined, own: boolean): string {
	if (!detail) return "";
	if (!own) return oneLine(detail, 90);
	const file = targetOf(detail);
	if (file) return file;
	try {
		const o = JSON.parse(detail) as Record<string, unknown>;
		if (typeof o.value === "string") return oneLine(o.value, 90);
		const first = Object.values(o).find((v) => typeof v === "string") as string | undefined;
		return first ? oneLine(first, 90) : "";
	} catch {
		return oneLine(detail, 90);
	}
}

/** Tool input as the person reads it: JSON laid out over lines, anything else as it came. */
export function prettyInput(detail: string | undefined): string {
	if (!detail) return "";
	try {
		return JSON.stringify(JSON.parse(detail), null, 2);
	} catch {
		return detail;
	}
}

/** Add one engine event. Reasoning and answer text that streams in pieces joins into one block; a tool result completes the call with the same id. */
export function addEvent(blocks: Block[], ev: RunEvent): Block[] {
	const last = blocks[blocks.length - 1];
	switch (ev.type) {
		case "text":
			return last?.k === "answer" ? [...blocks.slice(0, -1), { k: "answer", text: last.text + ev.text }] : [...blocks, { k: "answer", text: ev.text }];
		case "thinking":
			return last?.k === "thinking" ? [...blocks.slice(0, -1), { k: "thinking", text: last.text + ev.text }] : [...blocks, { k: "thinking", text: ev.text }];
		case "tool": {
			const own = toolWords(ev.name) !== "Izmanto rīku";
			const tool = toolKind(ev.name, ev.kind);
			const words = own ? toolWords(ev.name) : tool === "other" ? ev.name : KIND_LABEL[tool];
			return [...blocks, { k: "tool", id: ev.id ?? `t${blocks.length}`, tool, words, target: targetFor(ev.name, ev.detail, own), input: ev.detail, status: "running" }];
		}
		case "tool_result": {
			const at = blocks.findIndex((b) => b.k === "tool" && b.status === "running" && (ev.id ? b.id === ev.id : b.words === toolWords(ev.name)));
			const status = ev.ok ? "ok" : "failed";
			if (at < 0) {
				const tool = toolKind(ev.name);
				return [...blocks, { k: "tool", id: ev.id ?? `r${blocks.length}`, tool, words: toolWords(ev.name), target: "", output: ev.output, status, error: ev.ok ? undefined : ev.detail }];
			}
			return blocks.map((b, i) => (i === at && b.k === "tool" ? { ...b, status, output: ev.output, error: ev.ok ? undefined : ev.detail } : b));
		}
		case "done":
			return [...blocks, { k: "done" }];
		case "error":
			return [...blocks, { k: "error", text: `Kļūda (${ev.engine}): ${ev.message}` }];
		case "turn":
			return blocks;
	}
}
