// Claude engine — official Claude Agent SDK, authenticated with a Console API key.
// claude.ai login is deliberately not offered (Agent SDK terms; see PLAN.md §3.1).
import { query, type HookCallback, type Options } from "@anthropic-ai/claude-agent-sdk";
import { mkdirSync } from "node:fs";
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

export function claudeOptions(o: RunOptions, apiKey: string, abort: AbortController): Options {
	return {
		cwd: o.runDir,
		model: o.model,
		abortController: abort,
		env: { ...(process.env as Record<string, string>), ANTHROPIC_API_KEY: apiKey },
		// Never pick up a colleague's personal ~/.claude settings, CLAUDE.md or skills.
		settingSources: [],
		plugins: [{ type: "local", path: o.pluginDir, skipMcpDiscovery: true }],
		mcpServers: { [MCP_SERVER_NAME]: { type: "stdio", ...o.mcp } },
		allowedTools: CLAUDE_ALLOWED,
		disallowedTools: CLAUDE_DISALLOWED,
		permissionMode: "dontAsk",
		hooks: { PreToolUse: [{ hooks: [denyUnlisted] }] },
	};
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
				for await (const msg of query({ prompt: o.prompt, options: claudeOptions(o, key, abort) })) {
					if (msg.type === "assistant") {
						if (msg.error) o.onEvent({ type: "error", engine: "claude", message: String(msg.error) });
						for (const block of msg.message.content) {
							if (block.type === "text") o.onEvent({ type: "text", text: block.text });
							else if (block.type === "tool_use") o.onEvent({ type: "tool", name: block.name, detail: JSON.stringify(block.input).slice(0, 300) });
						}
					} else if (msg.type === "result") {
						if (msg.subtype === "success" && !msg.is_error) o.onEvent({ type: "done", text: msg.result });
						else o.onEvent({ type: "error", engine: "claude", message: `${msg.subtype}${"errors" in msg ? `: ${JSON.stringify(msg.errors)}` : ""}` });
					}
				}
			} catch (e) {
				o.onEvent({ type: "error", engine: "claude", message: (e as Error).message });
			}
		},
	};
}
