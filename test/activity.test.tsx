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

test("withActivity turns a whole agent run into steps: turns, thinking that grows in place, a tool call that finishes with its output, the answer", async () => {
	const rich: Engine = {
		id: "codex",
		status: async () => ({ id: "codex", ready: true, reason: "", canLogin: false }),
		async run(o: RunOptions) {
			o.onEvent({ type: "turn", n: 1 });
			o.onEvent({ type: "thinking", text: "**Meklēju garantijas laiku**\nIzlasīšu PIP 9.2." });
			o.onEvent({ type: "tool", id: "t1", name: "read_doc", detail: '{"path":"C:/t/PIP.docx"}' });
			o.onEvent({ type: "tool", id: "t2", name: "shell", kind: "search", detail: "rg garantij PIP.txt" });
			o.onEvent({ type: "tool_result", id: "t2", name: "shell", ok: true, output: "924:Garantijas laiks" });
			o.onEvent({ type: "tool_result", id: "t1", name: "read_doc", ok: true, output: "Garantijas laiks ..." });
			o.onEvent({ type: "turn", n: 2 });
			o.onEvent({ type: "tool", id: "t3", name: "set_field", detail: "{}" });
			o.onEvent({ type: "tool_result", id: "t3", name: "set_field", ok: false, detail: "Citāts nav atrasts", output: "x" });
			o.onEvent({ type: "text", text: "Gatavs." });
			o.onEvent({ type: "done", text: "Gatavs." });
		},
	};
	const seen: Activity[] = [];
	await withActivity(rich, (a) => seen.push(a), () => "p1").run({ prompt: "Atrodi garantiju.", runDir: "/r", pluginDir: "", mcp: { command: "", args: [], env: {} }, signal: new AbortController().signal, onEvent: () => {} });

	assert.deepEqual(seen.map((a) => a.kind), ["start", "turn", "thinking", "tool", "tool", "tool", "tool", "turn", "tool", "tool", "answer", "done"]);
	assert.equal(seen[1].text, "Gājiens 1");
	assert.equal(seen[2].text, "Meklēju garantijas laiku", "the first line of the reasoning, without markdown");
	assert.match(seen[2].detail!, /Izlasīšu PIP 9\.2\./);

	const read = seen.filter((a) => a.text.startsWith("Lasa dokumentu"));
	assert.equal(read.length, 2);
	assert.equal(read[0].step, read[1].step, "the result updates the call it answers");
	assert.deepEqual([read[0].status, read[1].status, read[0].tool], ["running", "ok", "read"]);
	assert.equal(read[1].detail, '{"path":"C:/t/PIP.docx"}\n\n→ Garantijas laiks ...', "input first, then what it returned");

	const search = seen.filter((a) => a.tool === "search");
	assert.deepEqual(search.map((a) => a.status), ["running", "ok"]);
	assert.equal(search[0].text, "Meklē: rg garantij PIP.txt");

	const refused = seen.filter((a) => a.text.startsWith("Ieraksta lauku"));
	assert.deepEqual(refused.map((a) => [a.status, a.tool]), [["running", "edit"], ["failed", "edit"]]);
	assert.equal(refused[1].text, "Ieraksta lauku — neizdevās");
	assert.match(refused[1].detail!, /Citāts nav atrasts/, "the refusal's own words are kept");
});

test("panel: lines stay in the order they happened; a step's later line replaces its earlier one; running until done/error; runs are grouped; empty state", async () => {
	const { ActivityPanel, addActivity, groupRuns, runningNow } = await import("../src/renderer/screens/ActivityPanel.tsx");
	const a = (kind: Activity["kind"], text: string, run = "r1", more: Partial<Activity> = {}): Activity => ({ run, project: "p1", engine: "grok", at: "2026-10-30T13:55:00Z", kind, text, ...more });
	let list: Activity[] = [];
	list = addActivity(list, a("start", "Uzdevums"));
	list = addActivity(list, a("tool", "Lasa dokumentu: PIP.docx", "r1", { step: "s1", status: "running", tool: "read" }));
	list = addActivity(list, a("thinking", "Domā", "r1", { step: "s2", detail: "a" }));
	list = addActivity(list, a("tool", "Lasa dokumentu: PIP.docx", "r1", { step: "s1", status: "ok", tool: "read" }));
	list = addActivity(list, a("thinking", "Domā vēl", "r1", { step: "s2", detail: "ab" }));
	assert.deepEqual(list.map((x) => `${x.kind}:${x.status ?? x.detail ?? ""}`), ["start:", "tool:ok", "thinking:ab"], "the tool call went from running to ok where it stood");
	assert.equal(runningNow(list), true);
	list = addActivity(list, a("done", "Pabeigts"));
	assert.equal(runningNow(list), false);
	assert.equal(runningNow([]), false);
	list = addActivity(list, a("start", "Otrs uzdevums", "r2"));
	assert.deepEqual(groupRuns(list).map((g) => [g.run, g.lines.length]), [["r1", 4], ["r2", 1]]);
	// older lines without a step: the growing answer replaces the answer before it
	let old: Activity[] = [];
	old = addActivity(old, a("answer", "Atbilde — 10 zīmes", "r1", { detail: "abc" }));
	old = addActivity(old, a("answer", "Atbilde — 90 zīmes", "r1", { detail: "abcdef" }));
	assert.equal(old.length, 1);
	assert.equal(addActivity(Array.from({ length: 600 }, () => a("tool", "x")), a("tool", "y")).length, 600, "list is capped");

	const html = renderToStaticMarkup(h(ActivityPanel, { projectId: "p1" }));
	assert.match(html, /Ko dara aģents/);
	assert.match(html, /Šobrīd nekas nenotiek/);
});

test("panel: a run reads as a transcript — task, turn dividers, thinking, tool steps with state, the end", async () => {
	const { Run } = await import("../src/renderer/screens/ActivityPanel.tsx");
	const a = (kind: Activity["kind"], text: string, more: Partial<Activity> = {}): Activity => ({ run: "r1", project: "p1", engine: "codex", at: "2026-10-30T13:55:00Z", kind, text, ...more });
	const lines = [
		a("start", "Atrodi garantiju.", { detail: "Pilns uzdevums" }),
		a("turn", "Gājiens 1"),
		a("thinking", "Meklēju garantijas laiku", { step: "t", detail: "Izlasīšu PIP 9.2." }),
		a("tool", "Lasa dokumentu: PIP.docx", { step: "r", tool: "read", status: "ok", detail: "{}\n\n→ teksts" }),
		a("tool", "Meklē: rg garantij", { step: "s", tool: "search", status: "running" }),
		a("tool", "Ieraksta lauku — neizdevās", { step: "e", tool: "edit", status: "failed", detail: "Citāts nav atrasts" }),
		a("answer", "Atbilde — 5 zīmes", { step: "a", detail: "Gatavs" }),
		a("done", "Pabeigts"),
	];
	const html = renderToStaticMarkup(h(Run, { lines, latest: true }));
	assert.match(html, /Atrodi garantiju\./);
	assert.match(html, /Uzdevums aģentam/);
	assert.match(html, /act-turn"><span>Gājiens 1/);
	assert.match(html, /<span class="kind">Domā<\/span>/);
	assert.match(html, /<span class="kind">Lasa<\/span>/);
	assert.match(html, /<span class="kind">Meklē<\/span>/);
	assert.match(html, /<span class="kind">Raksta<\/span>/);
	assert.match(html, /class="spin"/, "a running tool shows it is working");
	assert.match(html, /aria-label="neizdevās"/);
	assert.match(html, /Citāts nav atrasts/, "details are in the page, folded");
	assert.ok(html.indexOf("Gājiens 1") < html.indexOf("Meklēju garantijas") && html.indexOf("Meklēju garantijas") < html.indexOf("Lasa dokumentu") && html.indexOf("Lasa dokumentu") < html.indexOf("Pabeigts"), "order of events");
	assert.match(html, /Codex/);
});
