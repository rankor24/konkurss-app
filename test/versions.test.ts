import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { changedWords, diffParagraphs } from "../src/main/versions/diff.ts";
import { compareTemplates, sameLabel, tableBlocks } from "../src/main/versions/templates.ts";
import { readerFor, runPython, pyConfigFromEnv } from "../src/mcp/python.ts";

test("diff: identical texts, whitespace and quote-style changes are not changes", () => {
	assert.deepEqual(diffParagraphs("a\nb\nc", "a\nb\nc"), []);
	assert.deepEqual(diffParagraphs('Tas ir „teksts"  ar  atstarpēm', 'Tas ir "teksts" ar atstarpēm'), []);
});

test("diff: a modified paragraph is one change with before and after", () => {
	const c = diffParagraphs("viens\nizmērīto energoefektivitāti\ntrīs", "viens\naprēķinātajiem vai izmērītajiem\ntrīs");
	assert.deepEqual(c, [{ before: "izmērīto energoefektivitāti", after: "aprēķinātajiem vai izmērītajiem" }]);
});

test("diff: pure additions and pure removals", () => {
	assert.deepEqual(diffParagraphs("a\nb", "a\nNEW\nb"), [{ before: "", after: "NEW" }]);
	assert.deepEqual(diffParagraphs("a\nOLD\nb", "a\nb"), [{ before: "OLD", after: "" }]);
});

test("diff: several separate changes stay separate and in order", () => {
	const c = diffParagraphs("a\nX\nb\nc\nY\nd", "a\nX2\nb\nc\nY2\nd");
	assert.equal(c.length, 2);
	assert.equal(c[0].before, "X");
	assert.equal(c[1].after, "Y2");
});

test("changedWords narrows a long paragraph to the words that differ", () => {
	const r = changedWords("Pieredze par pabeigtu projektu izmērīto energoefektivitāti pēdējos gados", "Pieredze par pabeigtu projektu aprēķināto vai izmērīto energoefektivitāti pēdējos gados", 2);
	assert.match(r.before, /izmērīto/);
	assert.match(r.after, /aprēķināto vai izmērīto/);
	assert.ok(r.before.length < "Pieredze par pabeigtu projektu izmērīto energoefektivitāti pēdējos gados".length);
});

test("tableBlocks groups consecutive table rows", () => {
	const t = "teksts\n| Speciālists | Vārds |\n| Atbildīgais BPV |  |\n| Elektro |  |\nvēl teksts\n| a | b |\n| c | d |";
	const b = tableBlocks(t);
	assert.equal(b.length, 2);
	assert.equal(b[0].rows.length, 3);
	assert.deepEqual(b[0].labels, ["speciālists", "atbildīgais bpv", "elektro"]);
});

test("sameLabel tolerates a small wording difference but not a different row", () => {
	assert.ok(sameLabel("elektroietaišu sistēmu projektēšanā sertificēts projektētājs", "elektroietaišu sistēmu projektēšanā sertificēts projektētājs"));
	assert.equal(sameLabel("atbildīgais būvprojekta vadītājs", "elektroietaišu sistēmu projektēšanā sertificēts projektētājs"), false);
});

const form = "| Speciālists | Vārds | Sfēra |\n| Atbildīgais BPV |  |  |\n| Elektro |  |  |\n| Siltumapgāde |  |  |\n";
const embedded5 = "| Speciālists | Vārds | Sfēra |\n| Atbildīgais BPV |  |  |\n| Elektro |  |  |\n| Elektronisko sakaru; projektētājs |  |  |\n| Siltumapgāde |  |  |\n";

test("templates: 4 rows in the distributed form vs 5 in the nolikums → not equal, names the missing row", () => {
	const [d] = compareTemplates([{ file: "Kvalifikacija.docx", text: form }], { file: "nolikums.docx", text: embedded5 });
	assert.equal(d.equal, false);
	assert.equal(d.distributedRows, 4);
	assert.equal(d.embeddedRows, 5);
	assert.deepEqual(d.missingLabels, ["Elektronisko sakaru; projektētājs"]);
	assert.equal(d.embeddedFile, "nolikums.docx");
});

test("templates: identical tables → equal; a form with no counterpart is not flagged", () => {
	assert.equal(compareTemplates([{ file: "a.docx", text: form }], { file: "n.docx", text: form })[0].equal, true);
	const lonely = compareTemplates([{ file: "a.docx", text: form }], { file: "n.docx", text: "tikai teksts bez tabulām" })[0];
	assert.equal(lonely.equal, true);
	assert.equal(lonely.embeddedFile, "");
});

// ---- real Salacgrīva (LNP 2026/96) ---------------------------------------------------------
const SAL = "E:\\BV BIM\\Paraugmodeli\\260713_Salacgriva_Sila iela 2\\KONKURSS";
const py = { ...pyConfigFromEnv(process.env), skillsDir: join(import.meta.dirname, "..", "resources", "plugin", "skills") };
const read = async (rel: string) => {
	const full = join(SAL, rel);
	const r = readerFor(py.skillsDir, full)!;
	return (await runPython(py, r.script, r.args)).replace(/\r\n?/g, "\n");
};

test("Salacgrīva: both nolikums editions → the criterion wording change and the added specialist row are found", { skip: !existsSync(SAL), timeout: 120_000 }, async () => {
	const one = await read("Nolikums un tā pielikumi\\nolikums96_28_05_2.docx");
	const two = await read("Nolikums_grozījumu redakcijā_26_06\\nolikums96_26_06_grozijumu_redakcija_2.docx");
	const changes = diffParagraphs(one, two);
	console.log(`  ${changes.length} changes between the editions`);
	assert.ok(changes.length >= 3 && changes.length < 30);
	assert.ok(changes.some((c) => c.before === "" && /elektronisko sakaru/i.test(c.after)), "added specialist row");
	assert.ok(changes.some((c) => /energoefektīv/i.test(c.before + c.after) && /izmērī/i.test(c.before + c.after)), "criterion 3 wording");
});

test("Salacgrīva: the 2.versija Kvalifikācija has 4 specialist rows, the amended nolikums 5; Pieteikums matches", { skip: !existsSync(SAL), timeout: 120_000 }, async () => {
	const nol = await read("Nolikums_grozījumu redakcijā_26_06\\nolikums96_26_06_grozijumu_redakcija_2.docx");
	const kv = await read("Iepirkuma priekšmeta prasības, 2.versija\\Kvalifikacija_Kvalifikacija_96_1.docx");
	const pi = await read("Iepirkuma priekšmeta prasības, 2.versija\\Pieteikums_Pieteikums_96.docx");
	const diffs = compareTemplates(
		[{ file: "Kvalifikacija_Kvalifikacija_96_1.docx", text: kv }, { file: "Pieteikums_Pieteikums_96.docx", text: pi }],
		{ file: "nolikum96_26_06_grozijumu_redakcija_2.docx", text: nol },
	);
	for (const d of diffs) console.log(`  ${d.name}: ${d.distributedRows} vs ${d.embeddedRows} rows, missing: ${JSON.stringify(d.missingLabels)}, equal ${d.equal}`);
	const k = diffs[0];
	assert.equal(k.equal, false);
	assert.ok(k.missingLabels.some((l) => /elektronisko sakaru/i.test(l)), "the fifth specialist is named");
	assert.equal(k.embeddedRows - k.distributedRows, 1);
});
