import { test } from "node:test";
import assert from "node:assert/strict";
import type { ThreadEvent } from "@openai/codex-sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { claudeEvents, claudeOptions, type ClaudeState } from "../src/main/engines/claude.ts";
import { codexEvents, type CodexState } from "../src/main/engines/codex.ts";
import { grokEvents, type GrokState } from "../src/main/engines/grok.ts";
import { shellKind } from "../src/shared/activity.ts";
import type { RunEvent } from "../src/shared/types.ts";

const brief = (e: RunEvent) => (e.type === "tool" ? `tool:${e.name}:${e.kind ?? ""}` : e.type === "tool_result" ? `result:${e.name}:${e.ok}` : e.type === "turn" ? `turn:${e.n}` : e.type);

// ---------- Grok: the lines are the ones in Grok's own documentation (docs/user-guide/14-headless-mode.md, streaming-json) ----------
const GROK_LINES = [
	'{"type":"thought","data":"Analyzing the directory structure..."}',
	'{"type":"tool_call","toolCallId":"call_1","title":"Read","kind":"read","status":"in_progress","toolName":"read_file","rawInput":{"path":"src/main.rs"},"content":[],"locations":[]}',
	'{"type":"tool_call_update","toolCallId":"call_1","status":"completed","content":[],"rawOutput":{"lines":42},"locations":[]}',
	'{"type":"usage","messageId":"resp_1","stopReason":"tool_use","usage":{"input_tokens":812,"output_tokens":45}}',
	'{"type":"thought","data":"Now answer."}',
	'{"type":"text","data":"Here\'s a summary"}',
	'{"type":"usage","messageId":"resp_2","stopReason":"end_turn","usage":{}}',
	'{"type":"end","stopReason":"end_turn","sessionId":"abc123","num_turns":2}',
];

test("Grok: thought → thinking, tool_call/update → one tool with its output, each usage line closes a turn, end → done with the whole answer", () => {
	const st: GrokState = { text: "", turns: 0, newTurn: true, finished: false, names: new Map() };
	const events = GROK_LINES.flatMap((l) => grokEvents(l, st));
	assert.deepEqual(events.map(brief), ["turn:1", "thinking", "tool:read_file:read", "result:read_file:true", "turn:2", "thinking", "text", "done"]);
	const result = events.find((e) => e.type === "tool_result")!;
	assert.ok(result.type === "tool_result" && result.output === '{"lines":42}' && result.id === "call_1");
	const call = events.find((e) => e.type === "tool")!;
	assert.ok(call.type === "tool" && call.id === "call_1" && call.detail === '{"path":"src/main.rs"}');
	assert.deepEqual(events.at(-1), { type: "done", text: "Here's a summary" });
	assert.equal(st.finished, true);
});

test("Grok: execute/search/fetch kinds, a plan, a failed tool, an error exactly as written, and noise lines ignored", () => {
	const st: GrokState = { text: "", turns: 0, newTurn: true, finished: false, names: new Map() };
	const run = (o: object | string) => grokEvents(typeof o === "string" ? o : JSON.stringify(o), st);
	assert.deepEqual(run("not json").length + run("").length, 0);
	assert.equal((run({ type: "tool_call", toolCallId: "a", toolName: "run_terminal_cmd", kind: "execute", rawInput: { command: "dir" } }).find((e) => e.type === "tool") as { kind: string }).kind, "shell");
	assert.equal((run({ type: "tool_call", toolCallId: "b", toolName: "grep", kind: "search" }).find((e) => e.type === "tool") as { kind: string }).kind, "search");
	assert.equal((run({ type: "tool_call", toolCallId: "c", toolName: "web_fetch", kind: "fetch" }).find((e) => e.type === "tool") as { kind: string }).kind, "web");
	const failed = run({ type: "tool_call_update", toolCallId: "a", status: "failed", rawOutput: "denied" })[0];
	assert.ok(failed.type === "tool_result" && !failed.ok && failed.name === "run_terminal_cmd" && failed.output === "denied");
	const plan = run({ type: "plan", entries: [{ content: "Izlasīt PIP", status: "completed" }, { content: "Ierakstīt", status: "pending" }] });
	assert.deepEqual(plan.map(brief), ["tool:plan:plan", "result:plan:true"]);
	assert.equal((plan[0] as { detail: string }).detail, "[x] Izlasīt PIP\n[ ] Ierakstīt");
	assert.deepEqual(run({ type: "error", message: "426 Upgrade Required" }), [{ type: "error", engine: "grok", message: "426 Upgrade Required" }]);
});

// ---------- Codex: events of the SDK's own types ----------
const codexRun = (events: ThreadEvent[]) => {
	const st: CodexState = { turns: 0, last: "" };
	return { out: events.flatMap((e) => codexEvents(e, st)), st };
};

test("Codex: turn, reasoning, an MCP call with its result, a search command, web search, plan, the answer", () => {
	const { out, st } = codexRun([
		{ type: "turn.started" },
		{ type: "item.completed", item: { id: "r1", type: "reasoning", text: "**Plānoju**\nJālasa PIP." } },
		{ type: "item.started", item: { id: "m1", type: "mcp_tool_call", server: "konkurss", tool: "read_doc", arguments: { path: "C:/t/PIP.docx" }, status: "in_progress" } },
		{ type: "item.completed", item: { id: "m1", type: "mcp_tool_call", server: "konkurss", tool: "read_doc", arguments: {}, status: "completed", result: { content: [{ type: "text", text: "Garantijas laiks…" }], structured_content: null } } },
		{ type: "item.started", item: { id: "c1", type: "command_execution", command: "rg garantij PIP.txt", aggregated_output: "", status: "in_progress" } },
		{ type: "item.completed", item: { id: "c1", type: "command_execution", command: "rg garantij PIP.txt", aggregated_output: "924:Garantijas laiks", exit_code: 0, status: "completed" } },
		{ type: "item.started", item: { id: "w1", type: "web_search", query: "LBN 501" } },
		{ type: "item.completed", item: { id: "w1", type: "web_search", query: "LBN 501" } },
		{ type: "item.completed", item: { id: "p1", type: "todo_list", items: [{ text: "Lasīt", completed: true }, { text: "Rakstīt", completed: false }] } },
		{ type: "item.completed", item: { id: "a1", type: "agent_message", text: "Gatavs." } },
	] as ThreadEvent[]);
	assert.deepEqual(out.map(brief), ["turn:1", "thinking", "tool:read_doc:", "result:read_doc:true", "tool:shell:search", "result:shell:true", "tool:web_search:web", "result:web_search:true", "tool:plan:plan", "result:plan:true", "text"]);
	const mcp = out.find((e) => e.type === "tool_result" && e.name === "read_doc")!;
	assert.ok(mcp.type === "tool_result" && mcp.id === "m1" && mcp.output === "Garantijas laiks…");
	const sh = out.find((e) => e.type === "tool_result" && e.name === "shell")!;
	assert.ok(sh.type === "tool_result" && sh.output === "924:Garantijas laiks");
	assert.equal(st.last, "Gatavs.", "the last message is the answer");
});

test("Codex: a failed command and a failed MCP call say so; failed turns and errors are reported as they are", () => {
	const { out } = codexRun([
		{ type: "item.completed", item: { id: "c1", type: "command_execution", command: "dir x", aggregated_output: "nav", exit_code: 1, status: "failed" } },
		{ type: "item.completed", item: { id: "m1", type: "mcp_tool_call", server: "konkurss", tool: "set_field", arguments: {}, status: "failed", error: { message: "Citāts nav atrasts" } } },
		{ type: "turn.failed", error: { message: "out of credits" } },
	] as ThreadEvent[]);
	assert.deepEqual(out.map(brief), ["result:shell:false", "result:set_field:false", "error"]);
	assert.equal((out[1] as { detail: string }).detail, "Citāts nav atrasts");
	assert.equal((out[0] as { detail: string }).detail, "exit 1");
	assert.deepEqual(out[2], { type: "error", engine: "codex", message: "out of credits" });
});

test("shell commands are told apart: searching, reading, anything else", () => {
	assert.equal(shellKind("rg garantij PIP.txt"), "search");
	assert.equal(shellKind('Select-String -Path a.txt -Pattern "x"'), "search");
	assert.equal(shellKind("Get-Content PIP.txt"), "read");
	assert.equal(shellKind("python build.py"), "shell");
});

// ---------- Claude: messages of the Agent SDK's shape ----------
test("Claude: an assistant message is a turn with thinking, text and a tool call; the user message carries the result; result → done", () => {
	const st: ClaudeState = { turns: 0, names: new Map() };
	const msgs = [
		{ type: "assistant", message: { content: [{ type: "thinking", thinking: "Jālasa PIP.", signature: "s" }, { type: "text", text: "Lasu." }, { type: "tool_use", id: "tu1", name: "mcp__konkurss__read_doc", input: { path: "C:/t/PIP.docx" } }] } },
		{ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", content: [{ type: "text", text: "Garantijas laiks…" }] }] } },
		{ type: "assistant", message: { content: [{ type: "tool_use", id: "tu2", name: "mcp__konkurss__set_field", input: {} }] } },
		{ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu2", content: "Citāts nav atrasts", is_error: true }] } },
		{ type: "result", subtype: "success", is_error: false, result: "Gatavs." },
	] as unknown as SDKMessage[];
	const out = msgs.flatMap((m) => claudeEvents(m, st));
	assert.deepEqual(out.map(brief), ["turn:1", "thinking", "text", "tool:mcp__konkurss__read_doc:", "result:mcp__konkurss__read_doc:true", "turn:2", "tool:mcp__konkurss__set_field:", "result:mcp__konkurss__set_field:false", "done"]);
	const ok = out[4];
	assert.ok(ok.type === "tool_result" && ok.id === "tu1" && ok.output === "Garantijas laiks…");
	const bad = out[7];
	assert.ok(bad.type === "tool_result" && !bad.ok && bad.detail === "Citāts nav atrasts");
});

test("Claude asks for a summary of its reasoning so the panel has something to show", () => {
	const o = claudeOptions({ prompt: "x", runDir: "/r", pluginDir: "/p", mcp: { command: "node", args: [], env: {} }, signal: new AbortController().signal, onEvent: () => {} }, "sk-ant-test", new AbortController());
	assert.deepEqual(o.thinking, { type: "adaptive", display: "summarized" });
});
