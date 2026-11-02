// The Aģents chat: events become blocks (thinking you can open, tool calls with input and result, an answer), and the blocks render as such.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { addEvent, prettyInput, type Block } from "../src/renderer/transcript.ts";
import type { RunEvent } from "../src/shared/types.ts";

const run = (events: RunEvent[]): Block[] => events.reduce<Block[]>(addEvent, []);

test("streamed answer and reasoning join; a tool result completes the call with the same id and keeps input and output", () => {
	const blocks = run([
		{ type: "turn", n: 1 },
		{ type: "thinking", text: "Jāatrod " },
		{ type: "thinking", text: "termiņš." },
		{ type: "tool", name: "mcp__konkurss-tools__read_doc", id: "a", detail: '{"path":"E:\\\\BV BIM\\\\Nolikums.docx"}' },
		{ type: "tool", name: "shell", id: "b", kind: "shell", detail: "dir" },
		{ type: "tool_result", name: "read_doc", id: "a", ok: true, output: "Nolikuma teksts" },
		{ type: "tool_result", name: "shell", id: "b", ok: false, detail: "exit 1", output: "nav" },
		{ type: "text", text: "Termiņš " },
		{ type: "text", text: "ir 5. novembris." },
		{ type: "done", text: "" },
	]);
	assert.deepEqual(blocks.map((b) => b.k), ["thinking", "tool", "tool", "answer", "done"]);
	assert.equal((blocks[0] as { text: string }).text, "Jāatrod termiņš.");
	const read = blocks[1] as Extract<Block, { k: "tool" }>;
	assert.deepEqual([read.words, read.target, read.status, read.output], ["Lasa dokumentu", "Nolikums.docx", "ok", "Nolikuma teksts"]);
	assert.match(read.input ?? "", /Nolikums\.docx/);
	const sh = blocks[2] as Extract<Block, { k: "tool" }>;
	assert.deepEqual([sh.words, sh.target, sh.status, sh.error], ["Komanda", "dir", "failed", "exit 1"]);
	assert.equal((blocks[3] as { text: string }).text, "Termiņš ir 5. novembris.");
});

test("a field the agent writes shows the value it wrote; a result with no call before it is still listed; an error keeps the engine's words", () => {
	const blocks = run([
		{ type: "tool", name: "set_field", id: "s", detail: '{"slot_id":"c:t1:r2:c0","value":"Būvprojekta vadītājs","quote":"x","file":"y.docx"}' },
		{ type: "tool_result", name: "orphan", id: "zz", ok: true },
		{ type: "error", engine: "codex", message: "429 rate limit" },
	]);
	const set = blocks[0] as Extract<Block, { k: "tool" }>;
	assert.equal(set.target, "y.docx", "a named file is the target");
	const dl = run([{ type: "tool", name: "set_deadline", id: "d", detail: '{"value":"2026-11-05 10:00"}' }])[0] as Extract<Block, { k: "tool" }>;
	assert.equal(dl.target, "2026-11-05 10:00", "with no file, the value it writes");
	assert.equal(blocks[1].k, "tool");
	assert.deepEqual(blocks[2], { k: "error", text: "Kļūda (codex): 429 rate limit" });
	assert.equal(prettyInput('{"a":1}'), '{\n  "a": 1\n}');
	assert.equal(prettyInput("dir"), "dir");
});

test("transcript renders thinking you can open, tool cards with input and result, the answer, and a working indicator between steps", async () => {
	const { Transcript, Prose } = await import("../src/renderer/screens/Transcript.tsx");
	const blocks = run([
		{ type: "tool", name: "read_doc", id: "a", detail: '{"path":"C:\\\\x\\\\Nolikums.docx"}' },
		{ type: "tool_result", name: "read_doc", id: "a", ok: true, output: "Nolikuma teksts" },
		{ type: "thinking", text: "**Plāns** — vispirms termiņš" },
		{ type: "tool", name: "read_doc", id: "b", detail: '{"path":"C:\\\\x\\\\Cits.docx"}' },
		{ type: "tool_result", name: "read_doc", id: "b", ok: false, detail: "nav faila" },
		{ type: "text", text: "## Rezultāts\n- pirmais\n- **otrais** `kods`" },
	]);
	const done = renderToStaticMarkup(h(Transcript, { blocks: [{ k: "user", text: "Atrodi termiņu" }, ...blocks], active: false, engine: "Codex" }));
	assert.match(done, /tx-user/);
	assert.match(done, /k-read ok/, "a finished read is coloured as a read");
	assert.match(done, /Ievade/);
	assert.match(done, /Rezultāts<\/div><pre class="tx-pre">Nolikuma teksts/, "the result can be opened");
	assert.match(done, /k-read failed/);
	assert.match(done, /tx-think[^"]*"/);
	assert.match(done, /Domāja/, "reasoning is shown, not hidden");
	assert.match(done, /<h3>Rezultāts<\/h3>/);
	assert.match(done, /<li><b>otrais<\/b> <code>kods<\/code><\/li>/);
	assert.equal(done.includes("tx-wait"), false);

	const live = renderToStaticMarkup(h(Transcript, { blocks: blocks.slice(0, 1), active: true, engine: "Codex" }));
	assert.match(live, /tx-wait/, "between two steps it says the agent is still working");
	const pending = run([{ type: "tool", name: "read_doc", id: "c", detail: '{"path":"C:\\\\x\\\\Nolikums.docx"}' }]);
	const running = renderToStaticMarkup(h(Transcript, { blocks: pending, active: true, engine: "Codex" }));
	assert.match(running, /tx-tool k-read running/);
	assert.match(running, /class="spin"/);
	assert.equal(running.includes("tx-wait"), false, "a running call is its own indicator");
	const stopped = renderToStaticMarkup(h(Transcript, { blocks: pending, active: false, engine: "Codex" }));
	assert.match(stopped, /stopped/, "a call whose run was stopped is not shown as running");
	assert.equal(stopped.includes('class="spin"'), false);

	assert.equal(renderToStaticMarkup(h(Prose, { text: "<script>x</script>" })).includes("<script>"), false, "model text is never inserted as markup");
});
