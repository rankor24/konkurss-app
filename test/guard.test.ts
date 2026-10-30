import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { checkRead, checkWrite, isInside } from "../src/mcp/guard.ts";

const root = process.platform === "win32" ? "E:\\BV BIM\\Paraugmodeli\\260811_NVA" : "/tenders/260811_NVA";
const source = join(root, "KONKURSS");
const output = join(root, "IESNIEDZAMIE");
const cfg = { readDirs: [source], writeDir: output };

test("isInside handles self, children, siblings with shared prefix", () => {
	assert.equal(isInside(source, source), true);
	assert.equal(isInside(join(source, "a", "b.docx"), source), true);
	assert.equal(isInside(join(root, "KONKURSS2", "x.docx"), source), false);
	assert.equal(isInside(root, source), false);
});

test("reads allowed in source and output, denied elsewhere", () => {
	assert.equal(checkRead(cfg, join(source, "NOLIKUMS.docx")).ok, true);
	assert.equal(checkRead(cfg, join(output, "BIP.docx")).ok, true);
	assert.equal(checkRead(cfg, join(root, "PIEDAVAJUMS", "cenas.xlsx")).ok, false);
	assert.equal(checkRead(cfg, process.platform === "win32" ? "C:\\Users\\BD30\\.ssh\\id_rsa" : "/etc/passwd").ok, false);
});

test("path traversal out of the output folder is denied", () => {
	assert.equal(checkWrite(cfg, join(output, "..", "KONKURSS", "NOLIKUMS.docx")).ok, false);
	assert.equal(checkRead(cfg, join(source, "..", "..", "secret.txt")).ok, false);
});

test("writes only in output; source and .edoc denied", () => {
	assert.equal(checkWrite(cfg, join(output, "BIP_v2.docx")).ok, true);
	assert.equal(checkWrite(cfg, join(source, "NOLIKUMS.docx")).ok, false);
	assert.equal(checkWrite(cfg, join(output, "paraksts.edoc")).ok, false);
	assert.equal(checkWrite(cfg, join(output, "PARAKSTS.EDOC")).ok, false);
});

test("source nested inside output stays read-only", () => {
	const nested = { readDirs: [source], writeDir: root };
	assert.equal(checkWrite(nested, join(root, "IESNIEDZAMIE", "x.md")).ok, true);
	assert.equal(checkWrite(nested, join(source, "x.md")).ok, false);
});

test("output nested inside source root may be written (deeper folder wins)", () => {
	const nested = { readDirs: [root], writeDir: output };
	assert.equal(checkWrite(nested, join(output, "x.md")).ok, true);
	assert.equal(checkWrite(nested, join(source, "x.md")).ok, false);
});

test("empty or missing path is denied", () => {
	assert.equal(checkWrite(cfg, "").ok, false);
	assert.equal(checkRead(cfg, "").ok, false);
});
