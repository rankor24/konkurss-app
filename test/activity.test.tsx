import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { describe, progressText, targetOf, taskTitle, toolWords, type Activity } from "../src/shared/activity.ts";
import { withActivity } from "../src/main/activity.ts";
import type { Engine, RunOptions } from "../src/main/engines/types.ts";

(globalThis as { window?: unknown }).window = { konkurss: { invoke: async () => null, on: () => () => {} } };

test("tool calls become plain Latvian with the file name only", () => {
	assert.equal(describe({ type: "tool", name: "mcp__konkurss-tools__read_doc", detail: '{"path":"E:\\\\BV BIM\\\\KONKURSS\\\\NOLIKUMS_14_07_2026.docx"}' })!.text, "Lasa dokumentu: NOLIKUMS_14_07_2026.docx");
	assert.equal(describe({ type: "tool", name: "list_files", detail: '{"dir":"E:/x/KONKURSS"}' })!.text, "Skatās failu sarakstu: KONKURSS");
	assert.equal(describe({ type: "tool", name: "something_else" })!.text, "Izmanto rīku");
	assert.equal(toolWords("write_text"), "Raksta failu");
	assert.equal(targetOf("not json"), "");
	assert.equal(describe({ type: "tool_result", name: "read_doc", ok: false })!.text, "Lasa dokumentu — neizdevās");
	assert.equal(describe({ type: "tool_result", name: "read_doc", ok: true }), null, "successful results add no noise");
	assert.equal(describe({ type: "text", text: "x" }), null);
	assert.deepEqual(describe({ type: "done", text: "" }), { kind: "done", text: "Pabeigts" });
});

test("errors are shown exactly as the provider wrote them", () => {
	const raw = "grok exit 1: 426 Upgrade Required";
	assert.deepEqual(describe({ type: "error", engine: "grok", message: raw }), { kind: "error", text: raw });
});

test("progress and title helpers", () => {
	assert.match(progressText(3400), /^Atbilde — 3.400 zīmes|^Atbilde — 3 400 zīmes|3,400|3400/);
	assert.equal(taskTitle(["Tu esi BŪVDIZAINS asistents.", "Šis ir uzdevums: NEIZMANTO rīkus.", "Atrodi prasības speciālistiem.", "Vēl"].join("\n")), "Atrodi prasības speciālistiem.", "the fixed preamble is not the title");
	assert.equal(taskTitle("\n\nDots konkursa nolikums.\nVēl").startsWith("Dots konkursa nolikums"), true);
	assert.ok(taskTitle("x".repeat(300)).length <= 110);
});

function fakeEngine(): Engine {
	return {
		id: "grok",
		status: async () => ({ id: "grok", ready: true, reason: "", canLogin: false }),
		async run(o: RunOptions) {
			o.onEvent({ type: "tool", name: "read_doc", detail: '{"path":"C:/t/Nolikums.docx"}' });
			o.onEvent({ type: "text", text: "abc" });
			o.onEvent({ type: "text", text: "defg" });
			o.onEvent({ type: "done", text: "abcdefg" });
		},
	};
}

test("withActivity reports start, tool, progress (throttled) and done for the right project, and passes every event on unchanged", async () => {
	const seen: Activity[] = [];
	const passed: string[] = [];
	const eng = withActivity(fakeEngine(), (a) => seen.push(a), (dir) => (dir === "/run/p1" ? "p1" : null));
	await eng.run({ prompt: "Atrodi prasības.\nVēl teksts", runDir: "/run/p1", pluginDir: "", mcp: { command: "", args: [], env: {} }, signal: new AbortController().signal, onEvent: (e) => passed.push(e.type) });
	assert.deepEqual(seen.map((a) => a.kind), ["start", "tool", "answer", "answer", "done"], "the first chunk shows at once, the rest is flushed when the next event arrives");
	assert.equal(seen[0].detail, "Atrodi prasības.\nVēl teksts", "the whole task is kept");
	assert.deepEqual([seen[2].detail, seen[3].detail], ["abc", "abcdefg"], "the answer block grows and ends complete");
	assert.ok(seen.every((a) => a.project === "p1" && a.engine === "grok" && a.run === seen[0].run));
	assert.equal(seen[0].text, "Atrodi prasības.");
	assert.equal(seen[1].text, "Lasa dokumentu: Nolikums.docx");
	assert.deepEqual(passed, ["tool", "text", "text", "done"]);
	assert.equal(eng.id, "grok");
});

test("panel: progress lines of one run replace each other; running until done/error; filtered per project; empty state", async () => {
	const { ActivityPanel, addActivity, runningNow } = await import("../src/renderer/screens/ActivityPanel.tsx");
	const a = (kind: Activity["kind"], text: string, run = "r1", detail?: string): Activity => ({ run, project: "p1", engine: "grok", at: "2026-10-30T13:55:00Z", kind, text, detail });
	let list: Activity[] = [];
	list = addActivity(list, a("start", "Uzdevums"));
	list = addActivity(list, a("answer", "Atbilde — 10 zīmes", "r1", "abc"));
	list = addActivity(list, a("answer", "Atbilde — 90 zīmes", "r1", "abcdef"));
	assert.equal(list.length, 2);
	assert.equal(list[0].detail, "abcdef");
	assert.equal(runningNow(list), true);
	list = addActivity(list, a("done", "Pabeigts"));
	assert.equal(runningNow(list), false);
	assert.equal(runningNow([]), false);
	assert.equal(addActivity(Array.from({ length: 200 }, () => a("tool", "x")), a("tool", "y")).length, 200, "list is capped");

	const html = renderToStaticMarkup(h(ActivityPanel, { projectId: "p1" }));
	assert.match(html, /Ko dara aģents/);
	assert.match(html, /Šobrīd nekas nenotiek/);
});
