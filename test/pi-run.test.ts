// A whole pi run with no network and no credits: pi's own faux model plays the model, the real
// konkurss-tools server is reached through pi-mcp over stdio (the path every pi run takes).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxThinking, fauxToolCall } from "@earendil-works/pi-ai";
import { connectMcpTools, runPi, type McpLaunchSpec } from "../src/agent-pi/index.ts";
import { KONKURSS_TOOLS } from "../src/main/engines/types.ts";
import type { RunEvent } from "../src/shared/types.ts";

const appRoot = join(import.meta.dirname, "..");
const tmp = mkdtempSync(join(tmpdir(), "konkurss-pi-"));
const source = join(tmp, "KONKURSS");
const output = join(tmp, "IESNIEDZAMIE");
const outside = join(tmp, "PIEDAVAJUMS");

const spec: McpLaunchSpec = {
	command: process.execPath,
	args: ["--import", "tsx", join(appRoot, "src", "mcp", "server.ts")],
	cwd: appRoot,
	env: {
		KONKURSS_READ_DIRS: source,
		KONKURSS_WRITE_DIR: output,
		KONKURSS_SKILLS_DIR: join(appRoot, "resources", "plugin", "skills"),
		KONKURSS_AUDIT: join(output, ".konkurss", "audit.jsonl"),
		KONKURSS_ENGINE: "pi",
	},
};

before(() => {
	mkdirSync(source, { recursive: true });
	mkdirSync(outside, { recursive: true });
	writeFileSync(join(source, "Jautajumi.txt"), "GIPP netiek iesniegts kopā ar piedāvājumu.", "utf8");
	writeFileSync(join(outside, "cenas.txt"), "slepens", "utf8");
});
after(() => rmSync(tmp, { recursive: true, force: true }));

const brief = (e: RunEvent) => (e.type === "tool" ? `tool:${e.name}` : e.type === "tool_result" ? `result:${e.name}:${e.ok}` : e.type === "turn" ? `turn:${e.n}` : e.type);

function fauxModels() {
	const faux = fauxProvider({ models: [{ id: "faux-1", reasoning: true }] });
	const models = createModels();
	models.setProvider(faux.provider);
	return { faux, models, model: faux.getModel() };
}

test("pi-mcp offers exactly the allowed konkurss tools, with plain JSON Schema arguments", async () => {
	const tools = await connectMcpTools(spec, { allow: KONKURSS_TOOLS });
	try {
		assert.deepEqual(tools.tools.map((t) => t.name).sort(), [...KONKURSS_TOOLS].sort());
		assert.deepEqual(tools.missing, []);
		const readDoc = tools.tools.find((t) => t.name === "read_doc")!;
		const schema = readDoc.parameters as unknown as { type: string; properties: Record<string, unknown>; $schema?: string };
		assert.equal(schema.type, "object");
		assert.ok("path" in schema.properties);
		assert.equal(schema.$schema, undefined);
		// a tool outside the allow list is not offered
		const some = await connectMcpTools(spec, { allow: ["read_doc", "nav_tadu_rika"] });
		assert.deepEqual(some.tools.map((t) => t.name), ["read_doc"]);
		assert.deepEqual(some.missing, ["nav_tadu_rika"]);
		await some.close();
	} finally {
		await tools.close();
	}
});

test("pi run: the model reads a document through the tool server, is refused outside the tender folders, and answers", async () => {
	const { faux, models, model } = fauxModels();
	faux.setResponses([
		fauxAssistantMessage([fauxThinking("Jālasa jautājumu fails."), fauxToolCall("read_doc", { path: join(source, "Jautajumi.txt") }, { id: "t1" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("read_doc", { path: join(outside, "cenas.txt") }, { id: "t2" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("GIPP netiek iesniegts. Ārpus mapes nelasīju.")]),
	]);
	const events: RunEvent[] = [];
	await runPi({ models, model, prompt: "Kas ir par GIPP?", mcp: spec, allowedTools: KONKURSS_TOOLS, signal: new AbortController().signal, onEvent: (e) => events.push(e) });

	assert.deepEqual(events.map(brief).filter((x, i, a) => !(x === "thinking" && a[i - 1] === "thinking") && !(x === "text" && a[i - 1] === "text")), [
		"turn:1",
		"thinking",
		"tool:read_doc",
		"result:read_doc:true",
		"turn:2",
		"tool:read_doc",
		"result:read_doc:false",
		"turn:3",
		"text",
		"done",
	]);
	const first = events.find((e) => e.type === "tool_result" && e.id === "t1")!;
	assert.ok(first.type === "tool_result" && /GIPP/.test(first.output ?? ""));
	const denied = events.find((e) => e.type === "tool_result" && e.id === "t2")!;
	assert.ok(denied.type === "tool_result" && !denied.ok && !/slepens/.test(`${denied.output}${denied.detail}`), "the file outside the tender folders was not read");
	const done = events.at(-1)!;
	assert.ok(done.type === "done" && done.text === "GIPP netiek iesniegts. Ārpus mapes nelasīju.");
	assert.equal(faux.state.callCount, 3);
});

test("pi run: a provider error ends the run with the provider's own words and no done", async () => {
	const { faux, models, model } = fauxModels();
	const raw = "401 Incorrect API key provided";
	faux.setResponses([fauxAssistantMessage([], { stopReason: "error", errorMessage: raw })]);
	const events: RunEvent[] = [];
	await runPi({ models, model, prompt: "x", mcp: spec, allowedTools: KONKURSS_TOOLS, signal: new AbortController().signal, onEvent: (e) => events.push(e) });
	assert.equal(events.filter((e) => e.type === "error").length, 1, "reported once");
	assert.deepEqual(events.find((e) => e.type === "error"), { type: "error", engine: "pi", message: raw });
	assert.ok(!events.some((e) => e.type === "done"));
});

test("pi run: the step limit stops a model that keeps calling tools", async () => {
	const { faux, models, model } = fauxModels();
	faux.setResponses(Array.from({ length: 5 }, (_, i) => fauxAssistantMessage([fauxToolCall("list_files", {}, { id: `l${i}` })], { stopReason: "toolUse" })));
	const events: RunEvent[] = [];
	await runPi({ models, model, prompt: "x", mcp: spec, allowedTools: KONKURSS_TOOLS, maxTurns: 2, signal: new AbortController().signal, onEvent: (e) => events.push(e) });
	assert.equal(events.filter((e) => e.type === "turn").length, 2);
	const err = events.find((e) => e.type === "error");
	assert.ok(err && err.type === "error" && /limit of 2/.test(err.message));
	assert.ok(!events.some((e) => e.type === "done"));
});

test("pi run: a tool server that cannot start is reported, not thrown", async () => {
	const { models, model } = fauxModels();
	const events: RunEvent[] = [];
	await runPi({ models, model, prompt: "x", mcp: { command: process.execPath, args: ["--no-such-flag-xyz"], env: {} }, signal: new AbortController().signal, onEvent: (e) => events.push(e) });
	assert.equal(events.length, 1);
	assert.equal(events[0].type, "error");
});
