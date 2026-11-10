import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { bindingShapeOk, resolveBinding, vocabulary, type BindCtx } from "../src/main/v1/bindings.ts";
import { builderFor, builderSheet } from "../src/main/v1/forms.ts";
import { emptyFinance } from "../src/main/v1/finance.ts";
import { distance, identityFinding, identityInFolder, identityProblems } from "../src/main/checks/identity.ts";
import { balancedQuote, fillTemplate, longDate, statementBlocks, templateFromDocument } from "../src/main/library/statements.ts";
import { buildManifest, generatedKey } from "../src/main/pack/manifest.ts";
import { isBuilderFolder } from "../src/main/library/harvest.ts";
import { readDocx } from "../src/main/office.ts";
import { emptyRegisters } from "../src/main/registers/registers.ts";
import { emptyChoices, emptyState, type FillSheet } from "../src/shared/state.ts";
import type { Builder } from "../src/shared/library.ts";

const B = "B:/01_Konkursi";
const haveB = existsSync(B);

function reg() {
	const r = emptyRegisters();
	r.company.fields = [{ key: "Nosaukums", value: "SIA “BŪVDIZAINS”" }, { key: "Reģistrācijas Nr.", value: "43603011124" }];
	r.company.persons = [{ role: "Valdes priekšsēdētājs", person: "Jānis Kreics", note: "" }];
	r.specialists = [{ id: "sp1", name: "Andis Kalniņš", field: "arhitekts", certificate: "1-00619", type: "A", via: "", note: "", validUntil: "" }];
	r.builders = [b("ff", "SIA “FF”", "40003670683"), b("kuum", "SIA “KUUM”", "40103198971")];
	return r;
}
const b = (id: string, name: string, regNr: string, extra: Partial<Builder> = {}): Builder => ({ id, name, regNr, address: "", signatory: "", signatoryTitle: "", contact: "", seenIn: [], cites: [], ...extra });
const ctx = (r = reg()): BindCtx => ({ reg: r, req: emptyState().requirements, choices: emptyChoices(), finance: emptyFinance(), today: new Date(2026, 10, 6) });

test("builder bindings: a marker on the base sheet, the builder's own data in its copy, nothing when the register lacks it", () => {
	assert.ok(bindingShapeOk("builder:regNr"));
	assert.ok(!bindingShapeOk("builder:shoeSize"));
	assert.match(resolveBinding("builder:name", ctx())!.value, /‹būvnieks: nosaukums›/);
	assert.equal(resolveBinding("builder:regNr", { ...ctx(), builder: reg().builders![0] })!.value, "40003670683");
	assert.equal(resolveBinding("builder:signatory", { ...ctx(), builder: reg().builders![0] }), null);
	assert.ok(vocabulary(ctx()).some((v) => v.id === "builder:regNr"));
});

test("builder register lookup by name without the legal form", () => {
	const r = reg();
	assert.equal(builderFor("KUUM", r.builders)?.regNr, "40103198971");
	assert.equal(builderFor("ff", r.builders)?.regNr, "40003670683");
	assert.equal(builderFor("Pillar", r.builders), undefined);
});

test("builder copy: only builder slots change; a builder missing a field is reported, not filled with ours", () => {
	const sheet: FillSheet = {
		template: "",
		skeleton: "",
		inspectedAt: "",
		outputs: {},
		items: [
			{ slotId: "a", kind: "cell", label: "Pretendents", heading: "", value: "‹būvnieks: nosaukums›", status: "source", cites: [], by: "code", binding: "builder:name" },
			{ slotId: "b", kind: "cell", label: "Reģ. Nr.", heading: "", value: "‹būvnieks: reģ. Nr.›", status: "source", cites: [], by: "code", binding: "builder:regNr" },
			{ slotId: "c", kind: "cell", label: "Apakšuzņēmējs", heading: "", value: "SIA “BŪVDIZAINS”", status: "source", cites: [], by: "code", binding: "company:Nosaukums" },
			{ slotId: "d", kind: "cell", label: "Paraksttiesīgais", heading: "", value: "", status: "missing", cites: [], by: "code", binding: "builder:signatory" },
		],
	};
	const ff = reg().builders![0];
	const { sheet: copy, missing } = builderSheet(sheet, ctx(), ff);
	assert.deepEqual(copy.items.map((i) => i.value), ["SIA “FF”", "40003670683", "SIA “BŪVDIZAINS”", ""]);
	assert.deepEqual(missing, ["Paraksttiesīgais"]);
	assert.equal(sheet.items[0].value, "‹būvnieks: nosaukums›", "the base sheet is not changed");
});

test("identity: the four ways a company can carry the wrong number", () => {
	const r = reg();
	const docs = [
		{ file: "apaksuzn.docx", builder: "", text: "Pretendents SIA “FF” Reģ. Nr. 40003670683 Ar šo SIA “BŪVDIZAINS”, reģ. nr. 43603011124 apliecina … kā SIA “FF”, reģ. nr. _43603011124, turpmāk – Pretendents" },
		{ file: "typo.docx", builder: "", text: "mēs SIA “BŪVDZIAINS”, reģ. nr. 43603011124, esam gatavi" },
		{ file: "kuum.docx", builder: "", text: "ja ar pretendentu SIA “KUUM”, reģ. nr. 40103198970 tiks noslēgts" },
		{ file: "NORD/x.docx", builder: "NORD SW", text: "pretendentu SIA “INO”, reģ. nr. 40003080667" },
		{ file: "ok.docx", builder: "", text: "mēs SIA “BŪVDIZAINS”, reģ. nr. 43603011124, ja ar pretendentu SIA “KUUM”, reģ. nr. 40103198971" },
	];
	const ps = identityProblems(docs, r, ["NORD SW", "INO"]);
	const kinds = (f: string) => ps.filter((p) => p.file === f).map((p) => p.kind).sort();
	assert.deepEqual(kinds("apaksuzn.docx"), ["our_number", "two_numbers"]);
	assert.deepEqual(kinds("typo.docx"), ["our_name_spelling"]);
	assert.deepEqual(kinds("kuum.docx"), ["register_number"]);
	assert.deepEqual(kinds("NORD/x.docx"), ["other_builder"]);
	assert.deepEqual(kinds("ok.docx"), []);
	assert.equal(distance("buvdziains", "buvdizains"), 2);
	const f = identityFinding(ps, docs.length);
	assert.equal(f.status, "fail");
	assert.match(f.detail, /noraidīt/);
	assert.equal(identityFinding([], 3).status, "ok");
	assert.equal(identityFinding([], 0).status, "na");
});

test("ORACLE: the identity check finds the FF error in the real Bauska pack and nothing in the correct SANART pack", { skip: !haveB }, () => {
	const r = reg();
	const bauska = identityInFolder(join(B, "261110_BNP_Bauskas patvertnes", "IESNIEDZAMIE"), r, [], isBuilderFolder);
	const ff = bauska.problems.filter((p) => /5_Apaksuzn apliec\. BUVDIZAINS\.docx$/.test(p.file));
	assert.deepEqual(ff.map((p) => p.kind).sort(), ["our_number", "two_numbers"]);
	assert.ok(ff.some((p) => p.quote.includes("43603011124")));
	const sanart = identityInFolder(join(B, "261109_SN_VSAC Zemgale", "IESNIEDZAMIE"), r, ["SANART"], isBuilderFolder);
	assert.ok(sanart.checked >= 5);
	assert.deepEqual(sanart.problems, []);
});

test("quotes: nested „…“ titles are taken whole", () => {
	const s = "atklāta konkursa “Būvprojekta izstrāde VSAC “Zemgale” filiālē “Rūja”” identifikācijas Nr.";
	const at = s.indexOf("“");
	assert.equal(balancedQuote(s, at)!.inner, "Būvprojekta izstrāde VSAC “Zemgale” filiālē “Rūja”");
	assert.equal(longDate(new Date(2026, 10, 6)), "2026. gada 6. novembris");
});

test("statement template from a real submitted wording; filled for another tender, person and builder", () => {
	const paragraphs = [
		"6. pielikums",
		"SPECIĀLISTA APLIECINĀJUMS",
		"Atklāts konkurss",
		"“Būvniecības ieceres dokumentācijas izstrāde, būvdarbu veikšana un autoruzraudzība objektu pielāgošanai civilās aizsardzības mērķiem Bauskas novadā” ,",
		"identifikācijas Nr. BNP 2026/100/ERAF",
		"Parakstot šo apliecinājumu, es, Andis Kalniņš, apliecinu, ka apņemos piedalīties iepirkuma līguma izpildē kā _būvprojekta vadītājs/arhitekts/autoruzraugs, gadījumā, ja pretendentam SIA “FF” tiks piešķirtas tiesības slēgt Līgumu atklātā konkursā “Būvniecības ieceres dokumentācijas izstrāde, būvdarbu veikšana un autoruzraudzība objektu pielāgošanai civilās aizsardzības mērķiem Bauskas novadā” ar identifikācijas Nr. BNP 2026/100/ERAF.",
		"Vārds, uzvārds:",
		"Andis kalniņš",
		"Datums:",
		"2026. gada 26. oktobris",
	];
	const { template, residue } = templateFromDocument(paragraphs, "specialista_apliecinajums", "x.docx", reg(), "t1");
	const text = template.paragraphs.join("\n");
	assert.ok(!/Bauskas|BNP 2026|Kalniņš|kalniņš|“FF”|26\. oktobris/.test(text), text);
	assert.ok(!/6\. pielikums/.test(text), "the tender's annex number goes");
	for (const ph of ["{{tender:subject}}", "{{tender:id}}", "{{who:name}}", "{{who:role}}", "{{builder:name}}", "{{date:long}}"]) assert.ok(text.includes(ph), ph);
	assert.ok(residue.includes("Atklāts konkurss"), "inflected procedure words are left for a person");

	const r = reg();
	const req = emptyState().requirements;
	req.dati.subject = { value: "Saldus tehnikuma ēkas pārbūve", status: "manual" };
	req.dati.id = { value: "STV 2026/7", status: "manual" };
	const filled = fillTemplate(template, { reg: r, req, builder: r.builders![1], who: { specialist: r.specialists[0], role: "būvprojekta vadītājs" }, today: new Date(2026, 10, 6) });
	assert.deepEqual(filled.missing, []);
	const out = filled.paragraphs.join("\n");
	assert.ok(out.includes("“Saldus tehnikuma ēkas pārbūve”") && out.includes("STV 2026/7") && out.includes("SIA “KUUM”") && out.includes("2026. gada 6. novembris"));
	assert.ok(out.includes("es, Andis Kalniņš, apliecinu"));
	const noBuilder = fillTemplate(template, { reg: r, req, today: new Date() });
	assert.ok(noBuilder.missing.includes("builder:name"));
	assert.deepEqual(statementBlocks(["SPECIĀLISTA APLIECINĀJUMS", "Teksts"]), [{ text: "SPECIĀLISTA APLIECINĀJUMS", bold: true }, { text: "Teksts" }]);
});

test("ORACLE: a real submitted statement becomes a template with every tender value replaced", { skip: !haveB }, () => {
	const f = join(B, "261109_SN_VSAC Zemgale", "IESNIEDZAMIE", "SANART", "0_Apaksuzn. apliec._BUVDIZAINS.docx");
	const { template, residue } = templateFromDocument(readDocx(f).paragraphs, "apaksuznemeja_apliecinajums", f, reg());
	const text = template.paragraphs.join("\n");
	assert.ok(!/SANART|44103043748|43603011124|Rūja|ŠN 2026/.test(text), text);
	assert.ok(text.includes("{{builder:regNr}}") && text.includes("{{company:Reģistrācijas Nr.}}") && text.includes("{{tender:subject}}"));
	assert.ok(residue.some((x) => /Kalniņu/.test(x)), "a declined name in the resources list is reported");
});

test("manifest: a generated statement's file becomes the item's source", () => {
	const s = emptyState();
	s.requirements.dokumenti = [{ name: { value: "Speciālista apliecinājums", status: "manual" }, mandatory: true }];
	s.requirements.specialisti = [{ field: { value: "BPV", status: "manual" }, certificate: { value: "", status: "manual" }, mandatory: true }];
	s.choices.specialists = { "0": "sp1" };
	const m0 = buildManifest({ state: s, registers: reg(), builders: [], evidence: [] });
	assert.equal(m0.items[0].from, null);
	s.generated = { [generatedKey("", "specialist:sp1", "1")]: "C:/o/Iesniedzamie/1_Spec_v1.docx" };
	assert.equal(buildManifest({ state: s, registers: reg(), builders: [], evidence: [] }).items[0].from, "C:/o/Iesniedzamie/1_Spec_v1.docx");
});
