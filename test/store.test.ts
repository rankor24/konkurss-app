import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultName, Store, summarizeFolder } from "../src/main/store.ts";

const tmp = mkdtempSync(join(tmpdir(), "konkurss-store-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

// Stand-in for Electron safeStorage: reversible, but not plain text.
const fakeCrypto = {
	available: () => true,
	encrypt: (s: string) => Buffer.from(s, "utf8").reverse(),
	decrypt: (b: Buffer) => Buffer.from(b).reverse().toString("utf8"),
};

const source = join(tmp, "260811_NVA_Remonta baze", "KONKURSS");
mkdirSync(join(source, "GROZIJUMI"), { recursive: true });
writeFileSync(join(source, "NOLIKUMS.docx"), "x");
writeFileSync(join(source, "GROZIJUMI", "Groz_1.docx"), "x");
writeFileSync(join(source, "Buvatlauja.edoc"), "x");
const output = join(tmp, "260811_NVA_Remonta baze", "IESNIEDZAMIE");

test("project name defaults to the tender folder, not 'KONKURSS'", () => {
	assert.equal(defaultName(source), "260811_NVA_Remonta baze");
});

test("add, update, forget — forgetting never touches folders", () => {
	const store = new Store(join(tmp, "data"), fakeCrypto);
	const p = store.addProject({ sourceDir: source, outputDir: output, variant: "V2", builders: [" UPB ", "", "Pillar"] });
	assert.deepEqual(p.builders, ["UPB", "Pillar"]);
	assert.equal(store.updateProject(p.id, { variant: "V3" }).variant, "V3");
	store.forgetProject(p.id);
	assert.equal(store.projects().length, 0);
	assert.ok(existsSync(join(source, "NOLIKUMS.docx")));
});

test("rejects missing source and source == output", () => {
	const store = new Store(join(tmp, "data2"), fakeCrypto);
	assert.throws(() => store.addProject({ sourceDir: join(tmp, "nav"), outputDir: output }), /neeksistē/);
	assert.throws(() => store.addProject({ sourceDir: source, outputDir: source }), /viena un tā pati/);
});

test("claude key: validated, stored encrypted, read back", () => {
	const store = new Store(join(tmp, "data3"), fakeCrypto);
	assert.throws(() => store.setClaudeKey("hello"), /sk-ant-/);
	store.setClaudeKey("sk-ant-api03-abc");
	assert.equal(store.claudeKey(), "sk-ant-api03-abc");
	assert.equal(store.settings().hasClaudeKey, true);
	assert.doesNotMatch(readFileSync(join(tmp, "data3", "claude.key"), "latin1"), /sk-ant-api03-abc/);
});

test("refuses to store a key when encryption is unavailable", () => {
	const store = new Store(join(tmp, "data4"), { ...fakeCrypto, available: () => false });
	assert.throws(() => store.setClaudeKey("sk-ant-x"), /šifrēšana/);
});

test("folder summary counts files by type, recursively", () => {
	const s = summarizeFolder(source);
	assert.equal(s.total, 3);
	assert.equal(s.byExt[".docx"], 2);
	assert.equal(s.byExt[".edoc"], 1);
	assert.equal(summarizeFolder(join(tmp, "nav")).exists, false);
});
