// The model-task runner with a fake engine: no model is called.
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { extractJson, runModelTask } from "../src/main/tasks/runner.ts";
import { groundVariant, variantSchema } from "../src/main/tasks/variant.ts";
import type { Engine, RunOptions } from "../src/main/engines/types.ts";

const base = {
	runDir: "C:\\run",
	pluginDir: "C:\\plugin",
	mcp: { command: "node", args: [], env: {} },
	signal: new AbortController().signal,
};
const docs = [{ file: "PIP.docx", text: "Līguma veids – Projektē un būvē" }];

/** Engine that answers each call with the next canned reply (or error). */
function fakeEngine(replies: ({ text: string } | { error: string })[]): Engine & { prompts: string[] } {
	const prompts: string[] = [];
	let i = 0;
	return {
		id: "claude",
		prompts,
		status: async () => ({ id: "claude", ready: true, reason: "", canLogin: false }),
		async run(o: RunOptions) {
			prompts.push(o.prompt);
			const r = replies[Math.min(i++, replies.length - 1)];
			if ("error" in r) o.onEvent({ type: "error", engine: "claude", message: r.error });
			else {
				o.onEvent({ type: "text", text: r.text });
				o.onEvent({ type: "done", text: r.text });
			}
		},
	};
}

const good = JSON.stringify({ variant: { value: "V2", quote: "Līguma veids – Projektē un būvē", file: "PIP.docx" }, reason: "PIP tabula." });

const run = (engine: Engine) =>
	runModelTask({ engine, base, instructions: "x", schemaHint: "{}", schema: variantSchema, docs });

test("extractJson handles code fences and chatter around the object", () => {
	assert.deepEqual(extractJson('Lūk:\n```json\n{"a":1}\n```\nPaldies'), { a: 1 });
	assert.deepEqual(extractJson('Atbilde {"a":{"b":2}} beigas'), { a: { b: 2 } });
	assert.throws(() => extractJson("nav json"), /strukturēta/);
});

test("valid reply → ok, grounded variant carries the quote", async () => {
	const r = await run(fakeEngine([{ text: good }]));
	assert.ok(r.ok);
	if (r.ok) {
		const v = groundVariant(r.data, docs);
		assert.equal(v.value, "V2");
		assert.equal(v.status, "model");
		assert.equal(v.cite?.file, "PIP.docx");
	}
});

test("malformed reply gets exactly one retry, with the problem named in the prompt", async () => {
	const e = fakeEngine([{ text: "nav json" }, { text: good }]);
	const r = await run(e);
	assert.ok(r.ok);
	assert.equal(e.prompts.length, 2);
	assert.match(e.prompts[1], /IEPRIEKŠĒJĀ ATBILDE NEDERĒJA/);
});

test("malformed twice → error, never a salvaged partial", async () => {
	const e = fakeEngine([{ text: "nav json" }, { text: '{"variant": 5}' }]);
	const r = await run(e);
	assert.equal(r.ok, false);
	assert.equal(e.prompts.length, 2);
});

test("provider error is returned raw, without retry or fallback (D11)", async () => {
	const e = fakeEngine([{ error: "API error (status 529): overloaded" }, { text: good }]);
	const r = await run(e);
	assert.equal(r.ok, false);
	if (!r.ok) assert.equal(r.error, "API error (status 529): overloaded");
	assert.equal(e.prompts.length, 1);
});

test("a fabricated quote is dropped by grounding even though the reply was valid JSON", async () => {
	const fake = JSON.stringify({ variant: { value: "V1", quote: "Šis ir projektēšanas konkurss", file: "PIP.docx" }, reason: "x" });
	const r = await run(fakeEngine([{ text: fake }]));
	assert.ok(r.ok);
	if (r.ok) {
		const v = groundVariant(r.data, docs);
		assert.equal(v.value, null);
		assert.equal(v.status, "missing");
	}
});

test("documents are fenced in the prompt with their file names", async () => {
	const e = fakeEngine([{ text: good }]);
	await run(e);
	assert.match(e.prompts[0], /=== DOKUMENTS: PIP\.docx ===/);
	assert.match(e.prompts[0], /NEIZMANTO rīkus/);
});

test("schema type check: z.infer drives the result", async () => {
	const schema = z.object({ n: z.number() });
	const r = await runModelTask({ engine: fakeEngine([{ text: '{"n": 3}' }]), base, instructions: "x", schemaHint: "{}", schema, docs });
	assert.ok(r.ok && r.data.n === 3);
});
