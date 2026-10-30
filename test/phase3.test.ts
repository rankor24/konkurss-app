import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkDocument, foreignTerms, otherBuilderTerms, tenderLabel } from "../src/main/fill/leaks.ts";
import { groundLod, matrixLayout, planAuthors, planLods, templateLod } from "../src/main/fill/matrica.ts";
import { BUILDER_MARKER, codeFill, isRolesTable, newSheet, openItems, toEdits } from "../src/main/fill/sheet.ts";
import { applyCells, applySections } from "../src/main/fill/tasks.ts";
import { fillDocx, inspectDocx, inspectXlsx, toolsConfig } from "../src/main/pytools.ts";
import { emptyRegisters, type Registers } from "../src/main/registers/registers.ts";
import { emptyState, type FillSheet } from "../src/shared/state.ts";
import type { Project } from "../src/shared/types.ts";

const cfg = toolsConfig(process.env, join(import.meta.dirname, "..", "python", "konkurss_tools.py"));
const BASE = "E:\\BV BIM\\Paraugmodeli";
const NVA_BIP = `${BASE}\\260811_NVA_Remonta baze\\KONKURSS\\5.pielikums_Pirms_liguma_BIP.docx`;
const NVA_MATRICA = `${BASE}\\260811_NVA_Remonta baze\\KONKURSS\\5.A.pielikums_Atbildibas_matrica.xlsx`;
const VUGD_MATRICA = `${BASE}\\VUGD koledgza 2\\KONKURSS\\4.A.pielikums_Atbildibas_matrica (veidlapa).xlsx`;
const tmp = mkdtempSync(join(tmpdir(), "konkurss-p3-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const registers = (): Registers => ({
	...emptyRegisters(),
	company: {
		fields: [{ key: "Nosaukums", value: 'SIA "BŪVDIZAINS"' }, { key: "Vienotais reģ. Nr.", value: "43603011124" }, { key: "Juridiskā adrese", value: "Kalnciema ceļš 126A, Jelgava, LV-3002" }],
		persons: [],
		answers: [],
	},
});
const roles = () => ({
	design: [
		{ id: "1", role: "BIM koordinators", part: "", company: "SIA BŪVDIZAINS", person: "Jānis Kreics" },
		{ id: "2", role: "BIM modeļa autors", part: "AR, IN", company: "SIA BŪVDIZAINS", person: "Truševska" },
		{ id: "3", role: "BIM modeļa autors", part: "BK", company: "SIA BŪVDIZAINS", person: "Trušelis" },
	],
	build: { UPB: [{ id: "4", role: "BIM modeļa autors", part: "AVK-A", company: "", person: "Upbs Persona" }], Pillar: [{ id: "5", role: "4D speciālists", part: "", company: "Pillar SIA", person: "Pillar Cilvēks" }] },
});

// ---------- BIP code fill on the real template ----------
test("BIP: bidder fields come from our register (V1); roles tables from the roles screen; project name stays for the tender documents", { skip: !existsSync(NVA_BIP), timeout: 120_000 }, async () => {
	const info = await inspectDocx(cfg, NVA_BIP);
	const sheet = newSheet("source:5.pielikums_Pirms_liguma_BIP.docx", info);
	const state = emptyState();
	state.roles = roles();
	const filled = codeFill(sheet, info, { variant: "V1", state, registers: registers() });
	const val = (label: string) => filled.items.find((i) => i.kind === "cell" && i.label === label);
	assert.equal(val("Izpildītājs")?.value, 'SIA "BŪVDIZAINS"');
	assert.equal(val("Izpildītāja reģistrācijas numurs")?.value, "43603011124");
	assert.equal(val("Izpildītāja juridiskā adrese")?.status, "source");
	assert.equal(val("Izpildītāja biroja adrese")?.status, "missing", "no biroja adrese in the register → open, not guessed");
	assert.match(val("Izpildītāja biroja adrese")?.note ?? "", /reģistrā nav/);
	assert.equal(val("Projekta nosaukums")?.status, "missing", "left for the tender documents");
	// design roles table: 3 rows needed, 2 in the template → one row is added
	assert.deepEqual(filled.addRows, { "1": 1 });
	const person = (r: number) => filled.items.find((i) => i.slotId === `c:t1:r${r}:c3`)?.value;
	assert.deepEqual([person(1), person(2), person(3)], ["Jānis Kreics", "Truševska", "Trušelis"]);
	// build table in a V1 tender is left to the person; nothing invented
	assert.ok(isRolesTable(["Loma", "Būvprojekta daļa", "Uzņēmums", "Vārds Uzvārds"]));
});

test("BIP, V2 base copy: builder side shows the BŪVNIEKS marker; builder copies carry only their own people", { skip: !existsSync(NVA_BIP), timeout: 120_000 }, async () => {
	const info = await inspectDocx(cfg, NVA_BIP);
	const sheet = newSheet("k", info);
	const state = emptyState();
	state.roles = roles();
	const base = codeFill(sheet, info, { variant: "V2", state, registers: registers() });
	assert.equal(base.items.find((i) => i.label === "Izpildītājs")?.value, BUILDER_MARKER);
	assert.equal(base.items.find((i) => i.slotId === "c:t3:r1:c3")?.value, BUILDER_MARKER);
	assert.match(base.items.find((i) => i.slotId === "c:t3:r1:c3")?.note ?? "", /Ievadīt/);

	const upb = codeFill(sheet, info, { variant: "V2", state, registers: registers(), builder: "UPB" });
	assert.equal(upb.items.find((i) => i.label === "Izpildītājs")?.value, "UPB");
	assert.equal(upb.items.find((i) => i.slotId === "c:t3:r1:c3")?.value, "Upbs Persona");
	assert.equal(upb.items.find((i) => i.slotId === "c:t3:r1:c2")?.value, "UPB", "company defaults to the builder");
	const pillar = codeFill(sheet, info, { variant: "V2", state, registers: registers(), builder: "Pillar" });
	assert.equal(pillar.items.find((i) => i.slotId === "c:t3:r1:c3")?.value, "Pillar Cilvēks");
	const allUpb = JSON.stringify(upb.items.map((i) => i.value));
	assert.doesNotMatch(allUpb, /Pillar/, "no other builder in this copy");
});

test("a person's edit survives a code re-fill", { skip: !existsSync(NVA_BIP), timeout: 120_000 }, async () => {
	const info = await inspectDocx(cfg, NVA_BIP);
	const sheet = newSheet("k", info);
	const item = sheet.items.find((i) => i.label === "Izpildītājs")!;
	Object.assign(item, { value: "Mans teksts", status: "manual", by: "manual" });
	const state = emptyState();
	const out = codeFill(sheet, info, { variant: "V1", state, registers: registers() });
	assert.equal(out.items.find((i) => i.label === "Izpildītājs")?.value, "Mans teksts");
});

test("sheet → document: edits written to a NEW BIP; delete note removed; instruction replaced; placeholders red; template untouched", { skip: !existsSync(NVA_BIP), timeout: 180_000 }, async () => {
	const info = await inspectDocx(cfg, NVA_BIP);
	let sheet: FillSheet = newSheet("k", info);
	const state = emptyState();
	state.roles = roles();
	sheet = codeFill(sheet, info, { variant: "V1", state, registers: registers() });
	const sec = sheet.items.find((i) => i.kind === "section")!;
	Object.assign(sec, { value: "Tiks nodrošināta atbilstība PIP 5.1.", status: "source", by: "model", cites: [{ file: "PIP.docx", quote: "VDV jānodrošina visiem dalībniekiem" }], note: "Papildināt: izmantotā VDV platforma." });
	const dst = join(tmp, "BIP_v1.docx");
	await fillDocx(cfg, { src: NVA_BIP, dst, edits: toEdits(sheet) });
	const back = await inspectDocx(cfg, dst);
	assert.ok(!back.paragraphs.some((p) => /Slīprakstā norādītā informācija ir jāizdzēš/.test(p.text)), "delete note removed");
	assert.ok(back.paragraphs.some((p) => p.text.startsWith("Tiks nodrošināta atbilstība PIP 5.1.")));
	assert.ok(back.paragraphs.some((p) => /Avots: PIP\.docx/.test(p.text) && /Papildināt: izmantotā VDV platforma/.test(p.text)), "source + what is still missing, under the text");
	assert.equal(back.tables[1].cells[1][3], "Jānis Kreics");
	assert.equal(back.tables[1].rows, 4, "a third role row was appended");
	assert.equal(back.tables[1].cells[3][3], "Trušelis");
	assert.match(back.tables[0].cells[2][1], /^SIA "BŪVDIZAINS"/);
	assert.match(back.tables[0].cells[4][1], /^Kalnciema ceļš 126A/);
	assert.doesNotMatch(back.tables[0].cells[2][1], /Avots/, "values from our own register carry no source line in the document");
	assert.match(back.tables[0].cells[0][1], /\[aizpildīt\]/, "project name unknown → red placeholder");
	const left = back.paragraphs.filter((p) => p.italic > 0.6 && p.text.length > 40 && !/^Avots:/.test(p.text));
	console.log(`  ${left.length} instruction paragraphs still italic (sections not filled yet)`);
	assert.ok(openItems(sheet).length > 20);
});

// ---------- model tasks: grounding ----------
const docs = [{ file: "PIP.docx", text: "5.1. VDV jānodrošina visiem dalībniekiem piekļuvi.\nProjekta nosaukums: Ugunsdzēsības bāzes komplekss" }];
test("cells: a value needs a verified quote; a made-up quote leaves the slot open", () => {
	const items = newSheet("k", { ok: true, paragraphs: [], skeleton: "x", tables: [{ t: 0, rows: 2, cols: 2, cells: [["Projekta nosaukums:", ""], ["Pasūtītājs:", ""]], after_p: -1 }] }).items;
	const r = applyCells(items, { items: [{ id: "c:t0:r0:c1", value: "Ugunsdzēsības bāzes komplekss", quote: "Projekta nosaukums: Ugunsdzēsības bāzes komplekss", file: "PIP.docx" }, { id: "c:t0:r1:c1", value: "Nezināma iestāde", quote: "Pasūtītājs ir Nezināma iestāde", file: "PIP.docx" }] }, docs);
	assert.equal(r.items[0].status, "source");
	assert.equal(r.items[0].cites[0].file, "PIP.docx");
	assert.equal(r.items[1].status, "missing");
	assert.equal(r.rejected, 1);
});

test("sections: text kept only with a verified source; 'missing' details become a note", () => {
	const items = [
		{ slotId: "s:p1", kind: "section" as const, label: "VDV", heading: "VDV", instruction: "Izpildītājam jāapraksta VDV", value: "", status: "missing" as const, cites: [], by: null },
		{ slotId: "s:p2", kind: "section" as const, label: "X", heading: "X", instruction: "…", value: "", status: "missing" as const, cites: [], by: null },
	];
	const r = applySections(items, { items: [{ id: "s:p1", text: "VDV tiks nodrošināta visiem dalībniekiem.", sources: [{ quote: "VDV jānodrošina visiem dalībniekiem piekļuvi", file: "PIP.docx" }], missing: ["VDV platforma"] }, { id: "s:p2", text: "Izdomāts teksts", sources: [{ quote: "tāda citāta nav", file: "PIP.docx" }] }] }, docs);
	assert.equal(r.items[0].status, "source");
	assert.equal(r.items[0].note, "Papildināt: VDV platforma.");
	assert.equal(r.items[1].status, "missing");
	assert.equal(r.items[1].value, "");
	assert.match(r.items[1].note ?? "", /citāts dokumentos netika atrasts/);
	assert.equal(r.rejected, 1);
});

// ---------- leaks ----------
const project = (name: string, id = name): Project => ({ id, name, sourceDir: "", outputDir: join(tmp, "none", name), variant: null, builders: [], createdAt: "" });
test("foreignTerms: other tenders' names yes, this tender's own identity no", () => {
	const cur = project("260811_NVA_Remonta baze", "a");
	const st = emptyState();
	st.requirements.dati.purchaser = { value: "Nodrošinājuma valsts aģentūra", status: "manual" };
	const others = [project("260713_Salacgriva_Sila iela 2", "b"), project("VUGD koledgza 2", "c")];
	const terms = foreignTerms({ project: cur, state: st }, others, ["Duntes 8", "Remonta baze"]);
	assert.ok(terms.includes("Salacgriva Sila iela 2"));
	assert.ok(terms.includes("VUGD koledgza 2"));
	assert.ok(terms.includes("Duntes 8"));
	assert.ok(!terms.includes("Remonta baze"), "this tender's own name is not a leak");
	assert.equal(tenderLabel("260713_Salacgriva_Sila iela 2"), "Salacgriva Sila iela 2");
});

test("otherBuilderTerms: other builders and their people, not shared design staff or this builder's people", () => {
	const st = emptyState();
	st.roles = roles();
	st.roles.design.push({ id: "9", role: "x", part: "", company: "", person: "Upbs Persona" });
	const t = otherBuilderTerms(st, ["UPB", "Pillar"], "UPB");
	assert.ok(t.includes("Pillar") && t.includes("Pillar Cilvēks") && t.includes("Pillar SIA"));
	assert.ok(!t.includes("UPB") && !t.includes("Upbs Persona"));
});

test("checkDocument: finds a foreign tender name and a stray [working note]; ignores our own markers", { skip: !existsSync(NVA_BIP), timeout: 120_000 }, async () => {
	const info = await inspectDocx(cfg, NVA_BIP);
	const sheet = newSheet("k", info);
	Object.assign(sheet.items.find((i) => i.kind === "section")!, { value: "Skatīt Salacgriva Sila iela 2 projektu. [pārbaudīt vai tas der] [aizpildīt]", status: "source", by: "manual" });
	const dst = join(tmp, "leaky.docx");
	await fillDocx(cfg, { src: NVA_BIP, dst, edits: toEdits(sheet) });
	const r = await checkDocument(cfg, dst, ["Salacgriva Sila iela 2", "Duntes 8"]);
	assert.equal(r.clean, false);
	assert.deepEqual(r.foreign.map((h) => h.term), ["Salacgriva Sila iela 2"]);
	assert.equal(r.notes.length, 1);
	assert.match(r.notes[0].context, /pārbaudīt vai tas der/);
});

// ---------- matrica ----------
const matrica = async (path: string) => {
	const x = await inspectXlsx(cfg, path);
	const sheet = x.sheets[0];
	return { sheet, layout: matrixLayout(sheet)! };
};

test("matrica NVA: 7 phases found, template LODs read, models listed incl. combined model", { skip: !existsSync(NVA_MATRICA), timeout: 120_000 }, async () => {
	const { sheet, layout } = await matrica(NVA_MATRICA);
	assert.deepEqual(layout.phases, ["KC", "ST", "DT", "AP", "BV", "IM", "AIM"]);
	assert.equal(layout.phasesAssumed, false);
	const codes = layout.rows.filter((r) => r.kind === "model").map((r) => r.code);
	for (const c of ["TS-L", "AR", "IN", "IE", "TN", "UR", "BK", "AVK-A", "AVK-V", "EL", "UATS", "UKT", "SAT", "DOP"]) assert.ok(codes.includes(c), c);
	assert.ok(layout.rows.some((r) => r.kind === "combined"));
	const ar = layout.rows.find((r) => r.code === "AR")!;
	assert.equal(templateLod(sheet, layout, ar, 0), 200);
	assert.equal(templateLod(sheet, layout, ar, 4), 400);
	console.log(`  ${layout.rows.length} rows, ${codes.length} models`);
});

test("matrica VUGD 2: broken phase header (all 'KC') → default phases assumed and said so", { skip: !existsSync(VUGD_MATRICA), timeout: 120_000 }, async () => {
	const { layout } = await matrica(VUGD_MATRICA);
	assert.equal(layout.phasesAssumed, true);
	assert.deepEqual(layout.phases, ["KC", "ST", "DT", "AP", "BV", "IM", "AIM"]);
	assert.ok(layout.rows.filter((r) => r.kind === "model").length > 25);
});

test("matrica authors: from the roles screen by model code; builder phases only from that builder; unknown → marked", { skip: !existsSync(VUGD_MATRICA), timeout: 120_000 }, async () => {
	const { sheet, layout } = await matrica(VUGD_MATRICA);
	const state = emptyState();
	state.roles = roles();
	const plan = planAuthors(sheet, layout, state, "UPB");
	const at = (row: string, phaseIdx: number) => {
		const r = layout.rows.find((x) => x.code === row)!;
		const colL = String.fromCharCode(64 + layout.authorCols[phaseIdx]);
		return plan.edits.find((e) => e.ref === `${colL}${r.row}`);
	};
	assert.equal(at("AR", 0)?.value, "Truševska");
	assert.equal(at("AR", 0)?.status, "source");
	assert.equal(at("BK", 2)?.value, "Trušelis");
	assert.equal(at("AVK-A", 4)?.value, "Upbs Persona", "BV phase → UPB's own person");
	assert.equal(at("AVK-A", 0)?.status, "missing", "no design author for AVK-A → open");
	assert.equal(at("AR", 4)?.value, BUILDER_MARKER, "no builder author for AR → marker, not an invented name");
	assert.ok(plan.filled > 5 && plan.missing > 20);
	const none = planAuthors(sheet, layout, state, "Pillar");
	assert.ok(!JSON.stringify(none.edits).includes("Upbs Persona"), "another builder's author never appears");
});

test("matrica LOD: only numbers that appear in their PIP quote; blank cells filled, template LODs kept", { skip: !existsSync(NVA_MATRICA), timeout: 120_000 }, async () => {
	const { sheet, layout } = await matrica(NVA_MATRICA);
	const pip = [{ file: "PIP.docx", text: "| AR | 200 | 200 | 300 | 300 | 400 | 400 | 400 |\n| IN | - | 200 | 200 | 350 | 400 | 400 | 400 |" }];
	const g = groundLod(
		{ rows: [{ code: "AR", phases: { KC: 200, ST: 250, BV: 400 }, quote: "| AR | 200 | 200 | 300 | 300 | 400 | 400 | 400 |", file: "PIP.docx" }, { code: "XX", phases: { KC: 100 }, quote: "tādas rindas nav", file: "PIP.docx" }] },
		pip,
	);
	assert.equal(g.rejected, 1);
	assert.deepEqual(g.proposals.map((p) => `${p.code}:${p.phase}:${p.lod}`), ["AR:KC:200", "AR:BV:400"], "250 is not in the quote → dropped");
	const edits = planLods(sheet, layout, g.proposals);
	assert.equal(edits.length, 0, "the NVA template already has these LODs → left alone");
});
