// The pi engine's event mapper, on pi's own event shapes (pi-agent-core AgentEvent), like the other engines' mappers.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import { newPiState, piEvents } from "../src/agent-pi/events.ts";
import type { RunEvent } from "../src/shared/types.ts";

const brief = (e: RunEvent) => (e.type === "tool" ? `tool:${e.name}` : e.type === "tool_result" ? `result:${e.name}:${e.ok}` : e.type === "turn" ? `turn:${e.n}` : e.type);

const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const assistant = (content: unknown[], more: Record<string, unknown> = {}) => ({ role: "assistant", content, api: "x", provider: "p", model: "m", usage, stopReason: "stop", timestamp: 0, ...more });
const run = (events: object[]) => {
	const st = newPiState();
	return { out: (events as AgentEvent[]).flatMap((e) => piEvents(e, st)), st };
};

test("pi: turns, streamed thinking and text, a tool call with its result, the answer", () => {
	const { out, st } = run([
		{ type: "agent_start" },
		{ type: "turn_start" },
		{ type: "message_start", message: assistant([]) },
		{ type: "message_update", message: assistant([]), assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "Jālasa ", partial: assistant([]) } },
		{ type: "message_update", message: assistant([]), assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "PIP.", partial: assistant([]) } },
		{ type: "message_update", message: assistant([]), assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "Lasu.", partial: assistant([]) } },
		{ type: "message_update", message: assistant([]), assistantMessageEvent: { type: "toolcall_delta", contentIndex: 2, delta: "{", partial: assistant([]) } },
		{
			type: "message_end",
			message: assistant([{ type: "thinking", thinking: "Jālasa PIP." }, { type: "text", text: "Lasu." }, { type: "toolCall", id: "tc1", name: "read_doc", arguments: { path: "C:/t/PIP.docx" } }], { stopReason: "toolUse" }),
		},
		{ type: "tool_execution_start", toolCallId: "tc1", toolName: "read_doc", args: { path: "C:/t/PIP.docx" } },
		{ type: "tool_execution_update", toolCallId: "tc1", toolName: "read_doc", args: {}, partialResult: {} },
		{ type: "tool_execution_end", toolCallId: "tc1", toolName: "read_doc", result: { content: [{ type: "text", text: "Garantijas laiks…" }], details: {} }, isError: false },
		{ type: "message_start", message: { role: "toolResult" } },
		{ type: "message_end", message: { role: "toolResult", toolCallId: "tc1", toolName: "read_doc", content: [], isError: false, timestamp: 0 } },
		{ type: "turn_end", message: assistant([]), toolResults: [] },
		{ type: "turn_start" },
		{ type: "message_start", message: assistant([]) },
		{ type: "message_update", message: assistant([]), assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Gatavs.", partial: assistant([]) } },
		{ type: "message_end", message: assistant([{ type: "text", text: "Gatavs." }]) },
		{ type: "turn_end", message: assistant([]), toolResults: [] },
		{ type: "agent_end", messages: [] },
	]);
	assert.deepEqual(out.map(brief), ["turn:1", "thinking", "thinking", "text", "tool:read_doc", "result:read_doc:true", "turn:2", "text", "done"]);
	const call = out.find((e) => e.type === "tool")!;
	assert.ok(call.type === "tool" && call.id === "tc1" && call.detail === '{"path":"C:/t/PIP.docx"}');
	const result = out.find((e) => e.type === "tool_result")!;
	assert.ok(result.type === "tool_result" && result.id === "tc1" && result.output === "Garantijas laiks…" && result.detail === undefined);
	assert.deepEqual(out.at(-1), { type: "done", text: "Gatavs." });
	assert.equal(st.last, "Gatavs.", "the last message is the answer");
});

test("pi: a provider that does not stream still shows its reasoning and text, once", () => {
	const { out } = run([
		{ type: "turn_start" },
		{ type: "message_start", message: assistant([]) },
		{ type: "message_end", message: assistant([{ type: "thinking", thinking: "Domāju." }, { type: "thinking", thinking: "x", redacted: true }, { type: "text", text: "Atbilde." }]) },
		{ type: "agent_end", messages: [] },
	]);
	assert.deepEqual(out.map(brief), ["turn:1", "thinking", "text", "done"]);
	assert.deepEqual(out.at(-1), { type: "done", text: "Atbilde." });
});

test("pi: a failed tool says so with the tool's own text; a result of a blocked call still names the tool", () => {
	const { out } = run([
		{ type: "tool_execution_start", toolCallId: "a", toolName: "set_field", args: {} },
		{ type: "tool_execution_end", toolCallId: "a", toolName: "set_field", result: { content: [{ type: "text", text: "Citāts nav atrasts" }] }, isError: true },
		{ type: "tool_execution_end", toolCallId: "b", toolName: "write_text", result: { content: [{ type: "text", text: "Blocked" }] }, isError: true },
	]);
	assert.deepEqual(out.map(brief), ["tool:set_field", "result:set_field:false", "result:write_text:false"]);
	const bad = out[1];
	assert.ok(bad.type === "tool_result" && !bad.ok && bad.detail === "Citāts nav atrasts" && bad.output === "Citāts nav atrasts");
});

test("pi: a provider error is shown exactly as written, and no done follows it", () => {
	const raw = "429 You exceeded your current quota, please check your plan and billing details.";
	const { out, st } = run([
		{ type: "turn_start" },
		{ type: "message_start", message: assistant([]) },
		{ type: "message_end", message: assistant([{ type: "text", text: "" }], { stopReason: "error", errorMessage: raw }) },
		{ type: "agent_end", messages: [] },
	]);
	assert.deepEqual(out, [{ type: "turn", n: 1 }, { type: "error", engine: "pi", message: raw }]);
	assert.equal(st.errored, true);
});

test("pi: an aborted run is reported as an error with pi's own reason", () => {
	const { out } = run([
		{ type: "message_end", message: assistant([], { stopReason: "aborted" }) },
		{ type: "agent_end", messages: [] },
	]);
	assert.deepEqual(out, [{ type: "error", engine: "pi", message: "aborted" }]);
});

test("pi: long tool output and arguments are cut for the side panel", () => {
	const { out } = run([
		{ type: "tool_execution_start", toolCallId: "a", toolName: "read_doc", args: { path: "x".repeat(2000) } },
		{ type: "tool_execution_end", toolCallId: "a", toolName: "read_doc", result: { content: [{ type: "text", text: "y".repeat(5000) }] }, isError: false },
	]);
	assert.equal((out[0] as { detail: string }).detail.length, 600);
	assert.equal((out[1] as { output: string }).output.length, 2000);
});
