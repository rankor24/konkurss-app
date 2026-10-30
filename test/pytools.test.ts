import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fillDocx, fillXlsx, grepTerms, inspectDocx, runTool, toolsConfig } from "../src/main/pytools.ts";

const cfg = toolsConfig(process.env, join(import.meta.dirname, "..", "python", "konkurss_tools.py"));
const TPL = "E:\\BV BIM\\Paraugmodeli\\260811_NVA_Remonta baze\\KONKURSS\\5.pielikums_Pirms_liguma_BIP.docx";
const MATRICA = "E:\\BV BIM\\Paraugmodeli\\260811_NVA_Remonta baze\\KONKURSS\\5.A.pielikums_Atbildibas_matrica.xlsx";
const tmp = mkdtempSync(join(tmpdir(), "konkurss-py-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

test("inspect: the real NVA BIP template → 4 tables, headings, italic instruction paragraphs, stable skeleton", { skip: !existsSync(TPL), timeout: 120_000 }, async () => {
	const a = await inspectDocx(cfg, TPL);
	const b = await inspectDocx(cfg, TPL);
	assert.equal(a.tables.length, 4);
	assert.equal(a.tables[0].cells[0][0], "Projekta nosaukums:");
	assert.deepEqual(a.tables[1].cells[0], ["Loma", "Būvprojekta daļa", "Uzņēmums", "Vārds Uzvārds"]);
	assert.ok(a.paragraphs.filter((p) => p.heading > 0).length > 20);
	assert.ok(a.paragraphs.filter((p) => p.italic > 0.6 && p.text.length > 40).length > 15, "instruction paragraphs are italic");
	assert.equal(a.skeleton, b.skeleton, "same template → same skeleton");
});

test("fill-docx: writes a NEW file with coloured values and a source note; the template is untouched", { skip: !existsSync(TPL), timeout: 120_000 }, async () => {
	const before = sha(TPL);
	const dst = join(tmp, "BIP_v1.docx");
	const info = await inspectDocx(cfg, TPL);
	const italic = info.paragraphs.find((p) => p.italic > 0.6 && p.text.length > 40)!;
	const r = await fillDocx(cfg, {
		src: TPL,
		dst,
		legend: [["zaļš = no pasūtītāja dokumenta", "source"], ["sarkans = trūkst", "missing"]],
		edits: [
			{ kind: "cell", t: 0, r: 0, c: 1, text: "Ugunsdzēsības bāzes komplekss", status: "source", note: "Avots: NOLIKUMS_14_07_2026.docx, 1.1." },
			{ kind: "cell", t: 0, r: 1, c: 1, text: "", status: "missing" },
			{ kind: "paragraph", i: italic.i, text: "Mērķi tiks īstenoti saskaņā ar PIP 2.1.", status: "source", note: "Avots: PIP 2.1." },
		],
	});
	assert.equal(r.edits, 3);
	assert.ok(existsSync(dst));
	assert.equal(sha(TPL), before, "template byte-identical");
	const back = await inspectDocx(cfg, dst);
	assert.equal(back.tables[0].cells[0][1].split("\n")[0], "Ugunsdzēsības bāzes komplekss");
	assert.match(back.tables[0].cells[0][1], /Avots: NOLIKUMS/);
	assert.match(back.tables[0].cells[1][1], /\[aizpildīt\]/);
	const p = back.paragraphs.find((x) => x.text.startsWith("Mērķi tiks īstenoti"))!;
	assert.ok(p && p.italic < 0.3, "the italic instruction was replaced by normal text");
	assert.ok(back.paragraphs[0].text.includes("zaļš = no pasūtītāja"), "legend at the top");
});

test("fill-docx refuses to overwrite the template, to write a folder, or to create .edoc", { skip: !existsSync(TPL), timeout: 60_000 }, async () => {
	await assert.rejects(fillDocx(cfg, { src: TPL, dst: TPL, edits: [] }), /tas pats/);
	await assert.rejects(fillDocx(cfg, { src: TPL, dst: join(tmp, "x.edoc"), edits: [] }), /\.edoc/);
	await assert.rejects(fillDocx(cfg, { src: TPL, dst: tmp, edits: [] }), /mape/);
});

test("fill-xlsx: writes author cells into a COPY of the real matrica, merged cells handled, comment kept", { skip: !existsSync(MATRICA), timeout: 120_000 }, async () => {
	const before = sha(MATRICA);
	const dst = join(tmp, "matrica_v1.xlsx");
	await fillXlsx(cfg, {
		src: MATRICA,
		dst,
		edits: [
			{ ref: "E16", value: "Jānis Kreics", status: "source", note: "Avots: BIP 7.1" },
			{ ref: "E22", value: null, status: "missing" },
		],
	});
	assert.equal(sha(MATRICA), before);
	const spec = join(tmp, "dump.json");
	writeFileSync(spec, JSON.stringify({ files: [dst], terms: ["Jānis Kreics", "aizpildīt"] }));
	const g = await runTool<{ hits: { term: string }[] }>(cfg, "grep-terms", spec);
	assert.ok(g.hits.some((h) => h.term === "Jānis Kreics"));
	assert.ok(g.hits.some((h) => h.term === "aizpildīt"));
});

test("grep-terms finds other tenders' names ignoring case and diacritics, reports unreadable files", async () => {
	const dst = join(tmp, "BIP_v1.docx");
	if (!existsSync(dst)) return;
	const r = await grepTerms(cfg, { files: [dst, join(tmp, "nav.docx")], terms: ["UGUNSDZESIBAS BAZES", "Duntes 8"] });
	assert.ok(r.hits.some((h) => h.term === "UGUNSDZESIBAS BAZES" && h.file === dst));
	assert.ok(r.hits.some((h) => h.term === null && /NEIZDEVĀS NOLASĪT/.test(h.context)), "an unreadable file is reported, not skipped silently");
	assert.ok(!r.hits.some((h) => h.term === "Duntes 8"));
});
