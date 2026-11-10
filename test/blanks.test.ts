import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blankEdits, wantOf } from "../src/main/fill/blanks.ts";
import { fillDocx, inspectDocx, toolsConfig } from "../src/main/pytools.ts";
import { docxPlainText, readDocx } from "../src/main/office.ts";
import { identityProblems } from "../src/main/checks/identity.ts";
import { emptyRegisters } from "../src/main/registers/registers.ts";

const FORM = "B:/01_Konkursi/261110_BNP_Bauskas patvertnes/KONKURSS/1.dala/9.pielikums_BNP_2026_100_ERAF.docx";
const FROZEN = join(import.meta.dirname, "..", "build", "tools", "konkurss-tools", "konkurss-tools.exe");
const values = { builderName: "SIA “FF”", builderRegNr: "40003670683", ourName: "SIA “BŪVDIZAINS”", ourRegNr: "43603011124", ourAddress: "Kalnciema ceļš 126A, Jelgava, LV-3002" };

// the paragraphs with blanks of the real Bauska subcontractor form (9. pielikums)
const PARAS = [
	{ i: 6, text: "____.daļā “____________________________________”" },
	{ i: 7, text: "Pretendents ______________________________________ " },
	{ i: 8, text: "Reģ. Nr. _________________________________________" },
	{ i: 10, text: "Ar šo ________________________ (norāda apakšuzņēmēja nosaukumu, reģistrācijas numuru un adresi) apliecina, ka:" },
	{ i: 12, text: "… identifikācijas Nr. X, kā ________________ (norāda pretendenta nosaukumu), __________________ (norāda pretendenta reģistrācijas numuru), turpmāk – Pretendents, apakšuzņēmējs, kā arī" },
	{ i: 18, text: "______________________________ (īss darbu apraksts atbilstoši Apakšuzņēmējiem nododamo darbu sarakstā norādītajam)" },
];

test("bracket hints say whose value a blank is", () => {
	assert.equal(wantOf("pretendenta nosaukumu"), "builderName");
	assert.equal(wantOf("pretendenta reģistrācijas numuru"), "builderRegNr");
	assert.equal(wantOf("apakšuzņēmēja nosaukumu, reģistrācijas numuru un adresi"), "ourFull");
	assert.equal(wantOf("īss darbu apraksts"), null);
});

test("blanks: the pretendents' number comes from the builder — never ours; unknown blanks are left and reported", () => {
	const r = blankEdits(PARAS, values);
	const text = Object.fromEntries(r.edits.map((e) => [(e as { i: number }).i, (e as { text: string }).text]));
	assert.equal(text[7], "Pretendents SIA “FF”");
	assert.equal(text[8], "Reģ. Nr. 40003670683");
	assert.equal(text[10], "Ar šo SIA “BŪVDIZAINS”, reģ. nr. 43603011124, Kalnciema ceļš 126A, Jelgava, LV-3002 apliecina, ka:");
	assert.match(text[12], /kā SIA “FF”, 40003670683, turpmāk – Pretendents/);
	assert.doesNotMatch(text[12], /43603011124/);
	assert.deepEqual(r.left.map((x) => x.split(":")[0]), ["p6", "p18"]);
	assert.deepEqual(r.missing, []);
	// "Reģ. Nr. ___" only after a Pretendents line
	assert.equal(blankEdits([{ i: 1, text: "Reģ. Nr. ______" }], values).edits.length, 0);
	// a value the register lacks blocks instead of guessing
	assert.ok(blankEdits(PARAS, { ...values, ourAddress: "" }).missing.some((m) => /adrese/.test(m)));
});

test("ORACLE: a builder copy of the real Bauska form, written by the frozen tools, carries each builder's own number", { skip: !existsSync(FORM) || !existsSync(FROZEN), timeout: 120_000 }, async () => {
	const dir = mkdtempSync(join(tmpdir(), "konk-blanks-"));
	const src = join(dir, "form.docx");
	copyFileSync(FORM, src);
	const cfg = toolsConfig({ KONKURSS_TOOLS_EXE: FROZEN }, "");
	const paras = (await inspectDocx(cfg, src)).paragraphs.map((p) => ({ i: p.i, text: p.text }));
	const reg = emptyRegisters();
	reg.company.fields = [{ key: "Nosaukums", value: "SIA “BŪVDIZAINS”" }, { key: "Reģistrācijas Nr.", value: "43603011124" }];
	for (const b of [{ name: "SIA “FF”", regNr: "40003670683" }, { name: "SIA “KUUM”", regNr: "40103198971" }]) {
		const dst = join(dir, `${b.regNr}.docx`);
		await fillDocx(cfg, { src, dst, edits: blankEdits(paras, { ...values, builderName: b.name, builderRegNr: b.regNr }).edits });
		const text = docxPlainText(readDocx(dst));
		assert.ok(text.includes(`Pretendents ${b.name}`) && text.includes(`Reģ. Nr. ${b.regNr}`));
		assert.ok(text.includes(`kā ${b.name}, ${b.regNr}, turpmāk – Pretendents`));
		assert.deepEqual(identityProblems([{ file: dst, builder: "", text }], reg, []), []);
	}
});
