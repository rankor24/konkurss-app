// Read-only check against a real tender folder (NVA 2025/122). Skipped where the
// folder is absent. Writes go to a temp folder; the tender folder is hashed before
// and after to prove nothing in it changed (plan §9 verification 6).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const FIXTURE = "E:\\BV BIM\\Paraugmodeli\\260811_NVA_Remonta baze\\KONKURSS";
const appRoot = join(import.meta.dirname, "..");

function hashTree(dir: string): string {
	const h = createHash("sha256");
	const walk = (d: string) => {
		for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			const p = join(d, e.name);
			if (e.isDirectory()) walk(p);
			else h.update(p).update(String(statSync(p).size)).update(readFileSync(p));
		}
	};
	walk(dir);
	return h.digest("hex");
}

test("reads a real tender .docx through the skill scripts; tender folder unchanged", { skip: !existsSync(FIXTURE) }, async () => {
	const before = hashTree(FIXTURE);
	const out = mkdtempSync(join(tmpdir(), "konkurss-nva-"));
	const client = new Client({ name: "fixture", version: "0" });
	await client.connect(
		new StdioClientTransport({
			command: process.execPath,
			args: ["--import", "tsx", join(appRoot, "src", "mcp", "server.ts")],
			cwd: appRoot,
			env: {
				...(process.env as Record<string, string>),
				KONKURSS_READ_DIRS: FIXTURE,
				KONKURSS_WRITE_DIR: out,
				KONKURSS_SKILLS_DIR: join(appRoot, "resources", "plugin", "skills"),
			},
		}),
	);
	try {
		const doc = join(FIXTURE, "6.pielikums_Paraugmodelu_prasibas.docx");
		const r = (await client.callTool({ name: "read_doc", arguments: { path: doc } })) as { content: { text: string }[]; isError?: boolean };
		const text = r.content.map((c) => c.text).join("\n");
		assert.ok(!r.isError, text.slice(0, 500));
		assert.match(text, /KRB/);
		assert.match(text, / \| /, "table cell boundaries preserved");

		const denied = (await client.callTool({ name: "write_text", arguments: { path: join(FIXTURE, "x.md"), content: "x" } })) as { isError?: boolean };
		assert.equal(denied.isError, true);
	} finally {
		await client.close();
		rmSync(out, { recursive: true, force: true });
	}
	assert.equal(hashTree(FIXTURE), before, "tender folder must be byte-identical");
});
