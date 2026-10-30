import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import * as R from "../src/main/checks/rules.ts";
import { sameName, matchEdoc, verdict } from "../src/main/checks/signatures.ts";
import { matrixLayout } from "../src/main/fill/matrica.ts";
import { inspectXlsx, readEdoc, toolsConfig, type InspectedSheet } from "../src/main/pytools.ts";
import { emptyRegisters } from "../src/main/registers/registers.ts";
import { emptyState, type Cited } from "../src/shared/state.ts";
import type { SignatureRow } from "../src/shared/checks.ts";

const cfg = toolsConfig(process.env, join(import.meta.dirname, "..", "python", "konkurss_tools.py"));
const NVA_MATRICA = "E:\\BV BIM\\Paraugmodeli\\260811_NVA_Remonta baze\\KONKURSS\\5.A.pielikums_Atbildibas_matrica.xlsx";
const EDOC = "E:\\BV BIM\\Paraugmodeli\\260713_Salacgriva_Sila iela 2\\IESNIEDZAMIE\\2_1Atsauksme_BD291-2023_Sabilex_Menesgaismas.edoc";

const cited = <T,>(value: T): Cited<T> => ({ value, status: "manual" });
const colName = (c: number) => String.fromCharCode(64 + c);

function input(over: Partial<R.CheckInput> = {}): R.CheckInput {
	const state = emptyState();
	state.variant = { value: "V2", status: "manual" };
	return { state, registers: emptyRegisters(), builders: [], docs: [], matrices: [], leaks: {}, projectCode: null, pipLod: [], today: new Date("2026-08-01"), ...over };
}
const doc = (over: Partial<R.OutDoc>): R.OutDoc => ({ file: "x.docx", label: "x", builder: "", kind: "other", text: "", paragraphs: [], tables: [], ...over });
const find = (fs: ReturnType<typeof R.runRules>, id: string) => fs.find((f) => f.id === id)!;

// ---------- the commission's three findings on NVA 2025/122 (B12–B14), reproduced on the real matrica template ----------
test("NVA fixture: coordinator mismatch (B12), LOD without author (B13), non-BIM software (B14) are all reported with consequence and place", { skip: !existsSync(NVA_MATRICA), timeout: 120_000 }, async () => {
	const x = await inspectXlsx(cfg, NVA_MATRICA);
	const sheet: InspectedSheet = { ...x.sheets[0], cells: { ...x.sheets[0].cells } };
	const layout = matrixLayout(sheet)!;
	const comb = layout.rows.find((r) => r.kind === "combined")!;
	// the BIP names Kreics BIM coordinator; the matrica (filled by hand) has Varlamovs as author of the combined model
	for (const c of layout.authorCols) sheet.cells[`${colName(c)}${comb.row}`] = "Boriss Varlamovs";
	// KC LOD 200 for IN / IE / TN (as read from the PIP) but the authors left blank
	for (const code of ["IN", "IE", "TN"]) {
		const row = layout.rows.find((r) => r.code === code)!;
		sheet.cells[`${colName(layout.authorCols[0])}${row.row}`] = "";
		sheet.cells[`${colName(layout.lodCols[0])}${row.row}`] = "200";
	}
	const state = emptyState();
	state.variant = { value: "V2", status: "manual" };
	state.roles.design = [{ id: "1", role: "BIM koordinators", part: "", company: "SIA BŪVDIZAINS", person: "Jānis Kreics" }];
	const bip = doc({ kind: "bip", label: "BIP", text: "Autodesk Civil 3D", tables: [[["Programmatūra", "Civil 3D"]]] });
	const fs = R.runRules(input({ state, matrices: [{ file: "m.xlsx", builder: "", sheet }], docs: [bip] }));

	const coord = find(fs, "coordinator");
	assert.equal(coord.status, "fail");
	assert.match(coord.detail, /Jānis Kreics/);
	assert.match(coord.detail, /Boriss Varlamovs/);
	assert.ok(coord.where.length > 0 && coord.step === "kas");

	const lod = find(fs, "lod-author");
	assert.equal(lod.status, "fail");
	for (const code of ["IN", "IE", "TN"]) assert.match(lod.detail, new RegExp(`${code}: KC`));
	assert.match(lod.detail, /izslēgšanas kritērijs/);

	const sw = find(fs, "software");
	assert.equal(sw.status, "warn");
	assert.match(sw.detail, /Civil 3D/i);
	assert.match(sw.detail, /apliecinošu dokumentu/);

	// failures sort first
	assert.equal(fs[0].status, "fail");
	assert.ok(fs.findIndex((f) => f.status === "ok") > fs.findIndex((f) => f.status === "warn"));
});

test("coordinator: no matrica → ⊘ with the reason, not silence", () => {
	const na = R.ruleCoordinator(input());
	assert.equal(na.status, "na");
	assert.match(na.detail, /atbildības matricas/);
});

// ---------- exact rules ----------
test("company name: any spelling that differs from the register is a failure, naming the document", () => {
	const reg = emptyRegisters();
	reg.company.fields = [{ key: "Nosaukums", value: 'SIA "BŪVDIZAINS"' }];
	const state = emptyState();
	state.variant = { value: "V1", status: "manual" };
	const ok = R.ruleCompanyName(input({ state, registers: reg, docs: [doc({ label: "Pieteikums", text: 'SIA "BŪVDIZAINS"' })] }));
	assert.equal(ok.status, "ok");
	const bad = R.ruleCompanyName(input({ state, registers: reg, docs: [doc({ label: "Kvalifikācija", text: "SIA Būvdizains.lv" })] }));
	assert.equal(bad.status, "fail");
	assert.deepEqual(bad.where, ["Kvalifikācija"]);
});

test("project code: a different 3-letter code in the BIP/matrica is a failure", () => {
	assert.equal(R.ruleProjectCode(input()).status, "na");
	const bad = R.ruleProjectCode(input({ projectCode: "KRB", docs: [doc({ kind: "bip", label: "BIP", text: "Failu nosaukumi: NVA_AR_MOD" })] }));
	assert.equal(bad.status, "fail");
	assert.match(bad.detail, /NVA/);
	assert.equal(R.ruleProjectCode(input({ projectCode: "KRB", docs: [doc({ kind: "bip", label: "BIP", text: "KRB_AR_MOD" })] })).status, "ok");
});

test("leftover template italics: long italic paragraphs left in the BIP fail; short labels and legend lines do not", () => {
	const long = "Šeit aprakstiet, kā tiks nodrošināta modeļu koordinācija un kādi rīki tiks izmantoti projektā.";
	const bad = R.ruleLeftoverInstructions(input({ docs: [doc({ kind: "bip", label: "BIP", paragraphs: [{ text: long, italic: 1 }, { text: "Avots: nolikums", italic: 1 }, { text: "Īss", italic: 1 }] })] }));
	assert.equal(bad.status, "fail");
	assert.match(bad.detail, /BIP: 1 /);
	const ok = R.ruleLeftoverInstructions(input({ docs: [doc({ kind: "bip", label: "BIP", paragraphs: [{ text: long, italic: 0 }] })] }));
	assert.equal(ok.status, "ok");
});

test("criteria sum: 100 ok, other sum warns, no criteria is ⊘", () => {
	const state = emptyState();
	assert.equal(R.ruleCriteriaSum(input({ state })).status, "na");
	const c = (n: string, p: number) => ({ name: cited(n), points: cited(p), formula: cited(""), objectsNeeded: null });
	state.requirements.vertesana = [c("Cena", 60), c("Pieredze", 40)];
	assert.equal(R.ruleCriteriaSum(input({ state })).status, "ok");
	state.requirements.vertesana = [c("Cena", 60), c("Pieredze", 30)];
	assert.equal(R.ruleCriteriaSum(input({ state })).status, "warn");
});

test("builder leaks: another builder's name or person inside a builder's copy fails; own data does not", () => {
	const state = emptyState();
	state.variant = { value: "V2", status: "manual" };
	state.roles.build = { UPB: [{ id: "1", role: "x", part: "", company: "UPB", person: "Persona Upb" }], Pillar: [{ id: "2", role: "y", part: "", company: "Pillar SIA", person: "Persona Pillar" }] };
	const ok = R.ruleBuilderLeaks(input({ state, builders: ["UPB", "Pillar"], docs: [doc({ builder: "UPB", label: "BIP_UPB", text: "UPB Persona Upb" })] }));
	assert.equal(ok.status, "ok");
	const bad = R.ruleBuilderLeaks(input({ state, builders: ["UPB", "Pillar"], docs: [doc({ builder: "UPB", label: "BIP_UPB", text: "UPB Persona Upb un Persona Pillar" })] }));
	assert.equal(bad.status, "fail");
	assert.match(bad.detail, /Persona Pillar/);
	assert.equal(R.ruleBuilderLeaks(input({ builders: ["UPB"] })).status, "na");
});

test("markers: [aizpildīt] and BŪVNIEKS left in a document are reported as a warning with counts", () => {
	const w = R.ruleMarkers(input({ docs: [doc({ label: "BIP", text: "[aizpildīt] un [aizpildīt] un BŪVNIEKS" })] }));
	assert.equal(w.status, "warn");
	assert.match(w.detail, /2 × \[aizpildīt\], 1 × BŪVNIEKS/);
	assert.equal(R.ruleMarkers(input({ docs: [doc({ text: "viss gatavs" })] })).status, "ok");
	assert.equal(R.ruleMarkers(input()).status, "na");
});

test("LOD vs PIP and BIP vs matrica: lower LOD fails, differing tables are listed", { skip: !existsSync(NVA_MATRICA), timeout: 120_000 }, async () => {
	const x = await inspectXlsx(cfg, NVA_MATRICA);
	const sheet = x.sheets[0];
	const layout = matrixLayout(sheet)!;
	const ar = layout.rows.find((r) => r.code === "AR")!;
	const have = Number(sheet.cells[`${colName(layout.lodCols[0])}${ar.row}`]);
	const m = [{ file: "m.xlsx", builder: "", sheet }];
	const low = R.ruleLodPip(input({ matrices: m, pipLod: [{ code: "AR", phase: "KC", lod: have + 100, cite: { file: "pip.docx", quote: "AR KC" } }] }));
	assert.equal(low.status, "fail");
	assert.match(low.detail, new RegExp(`AR KC: ${have} < ${have + 100}`));
	const fine = R.ruleLodPip(input({ matrices: m, pipLod: [{ code: "AR", phase: "KC", lod: have, cite: { file: "pip.docx", quote: "AR KC" } }] }));
	assert.equal(fine.status, "ok");
	const bip = doc({ kind: "bip", label: "BIP", tables: [[["Modelis", "KC", "ST"], ["AR", String(have + 100), String(have)]]] });
	const diff = R.ruleBipVsMatricaLod(input({ docs: [bip], matrices: m }));
	assert.equal(diff.status, "fail");
	assert.match(diff.detail, /AR KC: BIP/);
	assert.equal(R.ruleLodPip(input()).status, "na");
});

test("BPV / specialists / certificates are ⊘ outside V1 and report real gaps inside V1", () => {
	assert.equal(R.ruleBpv(input()).status, "na");
	const state = emptyState();
	state.variant = { value: "V1", status: "manual" };
	state.requirements.specialisti = [{ field: cited("Atbildīgais būvprojekta vadītājs"), certificate: cited("10-xxxx"), mandatory: true }];
	const missing = R.ruleSpecialists(input({ state }));
	assert.equal(missing.status, "fail");
	assert.match(missing.detail, /būvprojekta vadītājs/i);
	const reg = emptyRegisters();
	reg.specialists = [{ id: "s1", name: "Andis Kalniņš", field: "BPV", certificate: "10-1", type: "A", via: "", note: "", validUntil: "2026-09-01" }];
	state.choices.specialists = { "0": "s1" };
	assert.equal(R.ruleSpecialists(input({ state, registers: reg })).status, "ok");
	state.deadline.date = cited("20.09.2026");
	const cert = R.ruleCertificates(input({ state, registers: reg, today: new Date("2026-08-01") }));
	assert.equal(cert.status, "warn");
	assert.match(cert.detail, /Kalniņš/);
	reg.specialists[0].validUntil = "2026-07-01";
	assert.equal(R.ruleCertificates(input({ state, registers: reg, today: new Date("2026-08-01") })).status, "fail");
});

test("leaks: foreign tender names, work notes and unreadable files are all reported", () => {
	assert.equal(R.ruleLeaks(input()).status, "na");
	const r = R.ruleLeaks(input({ leaks: { "E:\\o\\BIP.docx": { clean: false, foreign: [{ term: "Duntes 8", context: "…", where: "p3" }], notes: [], unreadable: [] } as never } }));
	assert.equal(r.status, "fail");
	assert.match(r.detail, /Duntes 8/);
});

// ---------- signatures ----------
test("sameName: order, case and diacritics do not matter; a different person does", () => {
	assert.ok(sameName("Andis Kalniņš", "KALNINS ANDIS"));
	assert.ok(sameName("Jānis Kreics", "Kreics Jānis"));
	assert.equal(sameName("Andis Kalniņš", "Pēteris Tereško"), false);
	assert.equal(sameName("", "Anyone"), false);
});

test("signature verdicts: EIS needs no file; wrong signer is caught; manual entry is its own state", () => {
	const row = (over: Partial<SignatureRow>): SignatureRow => ({ id: "k", label: "Vērtēšanas veidlapa", via: "eParaksts", expected: { role: "BPV", name: "Andis Kalniņš" }, file: null, actual: [], manual: null, ...over });
	assert.equal(verdict(row({ via: "EIS" })), "eis");
	assert.equal(verdict(row({})), "unsigned");
	assert.equal(verdict(row({ file: "a.edoc" })), "unread");
	assert.equal(verdict(row({ file: "a.edoc", actual: [{ name: "KALNINS ANDIS", time: null }] })), "ok");
	assert.equal(verdict(row({ file: "a.edoc", actual: [{ name: "TERESKO PETERIS", time: null }] })), "wrong");
	assert.equal(verdict(row({ manual: { name: "Andis Kalniņš", at: "t" } })), "manual");
	assert.equal(verdict(row({ manual: { name: "Cits Cilvēks", at: "t" } })), "wrong");
});

test("matchEdoc picks the newest .edoc whose name starts with the template's name", () => {
	const list = ["C:\\o\\Vertesanas veidlapa_v1.edoc", "C:\\o\\Vertesanas veidlapa_v2.edoc", "C:\\o\\Pieteikums.edoc"];
	assert.equal(matchEdoc("Vertesanas veidlapa.docx", list), "C:\\o\\Vertesanas veidlapa_v2.edoc");
	assert.equal(matchEdoc("Nav.docx", list), null);
});

test("readEdoc on a real signed container returns names and never a personal code", { skip: !existsSync(EDOC), timeout: 120_000 }, async () => {
	const r = await readEdoc(cfg, EDOC);
	assert.ok(r.ok);
	assert.ok(r.signers.length >= 1, "at least one signer found");
	for (const s of r.signers) {
		assert.ok(s.name.length > 2);
		assert.doesNotMatch(s.name, /PNO[A-Z]{2}-|\d{6}-\d{5}/);
	}
	console.log("  signers:", r.signers.map((s) => s.name).join(" | "));
});
