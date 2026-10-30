import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileWarnings } from "../src/main/extract.ts";
import { Store } from "../src/main/store.ts";
import { excerpt } from "../src/main/tasks/docs.ts";
import { quoteFound } from "../src/main/tasks/grounding.ts";
import type { FileEntry } from "../src/shared/state.ts";

const tmp = mkdtempSync(join(tmpdir(), "konkurss-p1-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const file = (rel: string, text: FileEntry["text"]): FileEntry => ({ rel, root: "source", where: "konkurss", kind: "cits", kindSetByUser: false, size: 1, mtimeMs: 1, text });

test("warnings: scanned PDFs, unopenable .edoc and other failures are named in plain Latvian", () => {
	const w = fileWarnings([file("a.pdf", "tukss"), file("b.pdf", "tukss"), file("c.edoc", "kluda"), file("d.xlsx", "kluda"), file("e.docx", "ok")]);
	assert.equal(w.length, 3);
	assert.match(w[0], /^2 PDF ir skenēti attēli/);
	assert.match(w[1], /1 parakstītus \.edoc/);
	assert.match(w[1], /lasāmu kopiju/);
	assert.match(w[2], /1 failus neizdevās nolasīt/);
	assert.deepEqual(fileWarnings([file("e.docx", "ok")]), []);
});

test("excerpt keeps the head and matching lines with context, verbatim, and marks gaps", () => {
	const text = Array.from({ length: 200 }, (_, i) => (i === 120 ? "Iepirkuma priekšmets: projektēšana un būvdarbi" : `rinda ${i}`)).join("\n");
	const e = excerpt({ file: "x.docx", text }, /priekšmets/i, { head: 3, ctx: 1 });
	assert.match(e.text, /rinda 0/);
	assert.match(e.text, /rinda 119\nIepirkuma priekšmets: projektēšana un būvdarbi\nrinda 121/);
	assert.doesNotMatch(e.text, /rinda 60/);
	assert.match(e.text, /\[…\]/);
	// a quote taken from the excerpt is found in the full document — grounding stays valid
	assert.ok(quoteFound("Iepirkuma priekšmets: projektēšana un būvdarbi", text));
});

test("excerpt respects the size cap", () => {
	const text = Array.from({ length: 5000 }, () => "projektēšana būvdarbi").join("\n");
	assert.ok(excerpt({ file: "x", text }, /projekt/, { maxChars: 2000 }).text.length < 2100);
});

const fakeCrypto = { available: () => true, encrypt: (s: string) => Buffer.from(s), decrypt: (b: Buffer) => b.toString() };
const FIXTURES: [string, string, string[]][] = [
	["NVA 2025/122", "E:\\BV BIM\\Paraugmodeli\\260811_NVA_Remonta baze\\KONKURSS", ["SB", "Pillar", "UPB"]],
	["VUGD koledža 2", "E:\\BV BIM\\Paraugmodeli\\VUGD koledgza 2\\KONKURSS", ["MARPIBUVE", "UPB"]],
];
for (const [name, source, builders] of FIXTURES) {
	test(`${name}: project created from the real folder with its builders (V2); source untouched`, { skip: !existsSync(source) }, () => {
		const store = new Store(join(tmp, name.replace(/\W/g, "_")), fakeCrypto);
		const output = join(tmp, "out", name.replace(/\W/g, "_"), "IESNIEDZAMIE");
		const p = store.addProject({ sourceDir: source, outputDir: output, variant: "V2", builders });
		assert.equal(p.variant, "V2");
		assert.deepEqual(p.builders, builders);
		assert.notEqual(p.name, "KONKURSS", "named after the tender folder");
		assert.equal(store.projects().length, 1);
		assert.ok(!existsSync(output), "creating a project writes nothing to the output folder yet");
	});
}
