// Claude engine — official Claude Agent SDK, authenticated with a Console API key.
// claude.ai login is deliberately not offered (Agent SDK terms; see PLAN.md §3.1).
import { query, type HookCallback, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { mkdirSync } from "node:fs";
import type { RunEvent } from "../../shared/types.js";
import type { Engine, RunOptions } from "./types.js";
import { KONKURSS_TOOLS, MCP_SERVER_NAME } from "./types.js";

/** Built-in Claude Code tools the app never allows: no shell, no direct file access, no web. */
export const CLAUDE_DISALLOWED = [
	"Bash",
	"BashOutput",
	"KillShell",
	"Read",
	"Write",
	"Edit",
	"MultiEdit",
	"NotebookEdit",
	"Glob",
	"Grep",
	"WebFetch",
	"WebSearch",
];

export const CLAUDE_ALLOWED = [...KONKURSS_TOOLS.map((t) => `mcp__${MCP_SERVER_NAME}__${t}`), "Skill", "TodoWrite"];

/** Second lock behind disallowedTools: anything not on the allow list is denied. */
export const denyUnlisted: HookCallback = async (input) => {
	if (input.hook_event_name !== "PreToolUse") return {};
	if (CLAUDE_ALLOWED.includes(input.tool_name)) return {};
	return {
		hookSpecificOutput: {
			hookEventName: "PreToolUse",
			permissionDecision: "deny",
			permissionDecisionReason: `Rīks ${input.tool_name} šajā app nav atļauts. Izmanto konkurss rīkus.`,
		},
	};
};

/** How much of a tool's output the side panel keeps. */
const OUTPUT_MAX = 2000;

export function claudeOptions(o: RunOptions, apiKey: string, abort: AbortController): Options {
	return {
		cwd: o.runDir,
		model: o.model,
		abortController: abort,
		env: { ...(process.env as Record<string, string>), ANTHROPIC_API_KEY: apiKey },
		// Never pick up a colleague's personal ~/.claude settings, CLAUDE.md or skills.
		settingSources: [],
		// the reasoning is shown in the side panel, as a summary
		thinking: { type: "adaptive", display: "summarized" },
		plugins: [{ type: "local", path: o.pluginDir, skipMcpDiscovery: true }],
		mcpServers: { [MCP_SERVER_NAME]: { type: "stdio", ...o.mcp } },
		allowedTools: CLAUDE_ALLOWED,
		disallowedTools: CLAUDE_DISALLOWED,
		permissionMode: "dontAsk",
		hooks: { PreToolUse: [{ hooks: [denyUnlisted] }] },
	};
}

/** State the mapper needs between messages of one run. */
export interface ClaudeState {
	turns: number;
	/** tool call id → tool name, so a result can say which tool it belongs to */
	names: Map<string, string>;
}

/** One message of the Agent SDK stream as the events the side panel and the runner understand. Pure, so it can be tested on messages of the SDK's own shape. */
export function claudeEvents(msg: SDKMessage, st: ClaudeState): RunEvent[] {
	const out: RunEvent[] = [];
	const emit = (e: RunEvent) => void out.push(e);
	if (msg.type === "assistant") {
		if (msg.error) emit({ type: "error", engine: "claude", message: String(msg.error) });
		if (msg.message.content.length > 0) emit({ type: "turn", n: ++st.turns });
		for (const block of msg.message.content) {
			if (block.type === "text") emit({ type: "text", text: block.text });
			else if (block.type === "thinking") {
				if (block.thinking.trim()) emit({ type: "thinking", text: block.thinking });
			} else if (block.type === "tool_use") {
				st.names.set(block.id, block.name);
				emit({ type: "tool", name: block.name, id: block.id, detail: JSON.stringify(block.input).slice(0, 600) });
			}
		}
	} else if (msg.type === "user" && Array.isArray(msg.message.content)) {
		for (const block of msg.message.content) {
			if (block.type !== "tool_result") continue;
			const text = typeof block.content === "string" ? block.content : (block.content ?? []).map((b) => (b.type === "text" ? b.text : "")).join("\n");
			emit({ type: "tool_result", name: st.names.get(block.tool_use_id) ?? "rīks", id: block.tool_use_id, ok: !block.is_error, detail: block.is_error ? text.slice(0, OUTPUT_MAX) : undefined, output: text.slice(0, OUTPUT_MAX) });
		}
	} else if (msg.type === "result") {
		if (msg.subtype === "success" && !msg.is_error) emit({ type: "done", text: msg.result });
		else emit({ type: "error", engine: "claude", message: `${msg.subtype}${"errors" in msg ? `: ${JSON.stringify(msg.errors)}` : ""}` });
	}
	return out;
}

export function createClaudeEngine(getKey: () => string | null): Engine {
	return {
		id: "claude",
		async status() {
			const key = getKey();
			return key
				? { id: "claude", ready: true, reason: "API atslēga saglabāta.", canLogin: false }
				: { id: "claude", ready: false, reason: "Nav ievadīta API atslēga (Iestatījumi → Claude).", canLogin: false };
		},
		async run(o) {
			const key = getKey();
			if (!key) {
				o.onEvent({ type: "error", engine: "claude", message: "Nav ievadīta Claude API atslēga." });
				return;
			}
			const abort = new AbortController();
			o.signal.addEventListener("abort", () => abort.abort(), { once: true });
			try {
				mkdirSync(o.runDir, { recursive: true });
				const st: ClaudeState = { turns: 0, names: new Map() };
				for await (const msg of query({ prompt: o.prompt, options: claudeOptions(o, key, abort) })) {
					for (const r of claudeEvents(msg, st)) o.onEvent(r);
				}
			} catch (e) {
				o.onEvent({ type: "error", engine: "claude", message: (e as Error).message });
			}
		},
	};
}
