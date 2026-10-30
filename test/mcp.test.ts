// Drives the real konkurss-tools server over stdio MCP — the same protocol Claude,
// Codex and Grok use — against throwaway folders.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const appRoot = join(import.meta.dirname, "..");
const tmp = mkdtempSync(join(tmpdir(), "konkurss-mcp-"));
const source = join(tmp, "KONKURSS");
const output = join(tmp, "IESNIEDZAMIE");
const outside = join(tmp, "PIEDAVAJUMS");
const auditFile = join(output, ".konkurss", "audit.jsonl");
let client: Client;

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };
const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as ToolResult;
const text = (r: ToolResult) => r.content.map((c) => c.text).join("\n");

before(async () => {
	mkdirSync(source, { recursive: true });
	mkdirSync(outside, { recursive: true });
	writeFileSync(join(source, "Jautajumi.txt"), "GIPP netiek iesniegts kopā ar piedāvājumu.", "utf8");
	writeFileSync(join(outside, "cenas.txt"), "slepens", "utf8");
	const skillsDir = existsSync(join(appRoot, "resources", "plugin", "skills"))
		? join(appRoot, "resources", "plugin", "skills")
		: join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".claude", "skills");
	client = new Client({ name: "test", version: "0" });
	await client.connect(
		new StdioClientTransport({
			command: process.execPath,
			args: ["--import", "tsx", join(appRoot, "src", "mcp", "server.ts")],
			cwd: appRoot,
			env: {
				...(process.env as Record<string, string>),
				KONKURSS_READ_DIRS: source,
				KONKURSS_WRITE_DIR: output,
				KONKURSS_SKILLS_DIR: skillsDir,
				KONKURSS_AUDIT: auditFile,
				KONKURSS_ENGINE: "test",
			},
		}),
	);
});

after(async () => {
	await client?.close();
	rmSync(tmp, { recursive: true, force: true });
});

test("exposes exactly the four konkurss tools", async () => {
	const { tools } = await client.listTools();
	assert.deepEqual(tools.map((t) => t.name).sort(), ["get_skill", "list_files", "read_doc", "write_text"]);
});

test("list_files covers source and output", async () => {
	const r = await call("list_files", {});
	assert.ok(!r.isError);
	assert.match(text(r), /Jautajumi\.txt/);
});

test("read_doc reads inside, refuses outside", async () => {
	assert.match(text(await call("read_doc", { path: join(source, "Jautajumi.txt") })), /GIPP/);
	const denied = await call("read_doc", { path: join(outside, "cenas.txt") });
	assert.equal(denied.isError, true);
	assert.doesNotMatch(text(denied), /slepens/);
});

test("write_text writes in output, never in source, never .edoc", async () => {
	assert.ok(!(await call("write_text", { path: join(output, "piezimes.md"), content: "v1" })).isError);
	assert.equal(readFileSync(join(output, "piezimes.md"), "utf8"), "v1");

	const intoSource = await call("write_text", { path: join(source, "Jautajumi.txt"), content: "pārrakstīts" });
	assert.equal(intoSource.isError, true);
	assert.equal(readFileSync(join(source, "Jautajumi.txt"), "utf8"), "GIPP netiek iesniegts kopā ar piedāvājumu.");

	assert.equal((await call("write_text", { path: join(output, "x.edoc"), content: "x" })).isError, true);
	assert.equal((await call("write_text", { path: join(output, "x.docx"), content: "x" })).isError, true);
	assert.equal((await call("write_text", { path: join(output, "..", "PIEDAVAJUMS", "x.md"), content: "x" })).isError, true);
});

test("overwriting keeps a backup of the previous version", async () => {
	await call("write_text", { path: join(output, "atskaite.md"), content: "pirmā" });
	const r = await call("write_text", { path: join(output, "atskaite.md"), content: "otrā" });
	assert.match(text(r), /Iepriekšējā versija/);
	const backups = join(output, ".konkurss", "backup");
	const stamp = readdirSync(backups).at(-1)!;
	assert.equal(readFileSync(join(backups, stamp, "atskaite.md"), "utf8"), "pirmā");
});

test("get_skill returns the mistake catalogue", async () => {
	const r = await call("get_skill", { skill: "konkurss", file: "references/kludu_katalogs.md" });
	assert.ok(!r.isError, text(r));
	assert.match(text(r), /Kļūdu katalogs/);
	assert.equal((await call("get_skill", { skill: "konkurss", file: "../../../.ssh/id_rsa" })).isError, true);
});

test("every call, allowed or denied, lands in the audit log", () => {
	const lines = readFileSync(auditFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
	assert.ok(lines.some((l) => l.tool === "write_text" && l.ok === false));
	assert.ok(lines.some((l) => l.tool === "read_doc" && l.ok === true && l.engine === "test"));
});
