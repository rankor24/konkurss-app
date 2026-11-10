import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { anonymityFinding, anonymityInFolder, anonymityProblems, devizesIn, identityTerms, mayIdentify } from "../src/main/checks/anonymity.ts";
import { ruleAnonymity } from "../src/main/checks/rules.ts";
import { docxPlainText, readDocx } from "../src/main/office.ts";
import { proposeProfile } from "../src/main/profile.ts";
import { buildManifest } from "../src/main/pack/manifest.ts";
import { deadlineIn } from "../src/main/board/discover.ts";
import { emptyRegisters } from "../src/main/registers/registers.ts";
import { stepsNotApplicable } from "../src/shared/profile.ts";
import { allStepStatuses } from "../src/shared/steps.ts";
import { emptyState } from "../src/shared/state.ts";

const B = "B:/01_Konkursi";
const haveB = existsSync(B);
const METS = join(B, "00_Metu Konkursi", "251003_METS_Matisa iela 8", "IESNIEDZAMIE");

function reg() {
	const r = emptyRegisters();
	r.company.fields = [{ key: "Nosaukums", value: "SIA “BŪVDIZAINS”" }, { key: "Reģistrācijas Nr.", value: "43603011124" }, { key: "E-pasts", value: "info@buvdizains.lv" }];
	r.company.persons = [{ role: "Valdes priekšsēdētājs", person: "Jānis Kreics", note: "" }];
	r.specialists = [{ id: "a", name: "Andis Kalniņš", field: "", certificate: "", type: "A", via: "", note: "", validUntil: "" }];
	return r;
}

test("mets: which documents may name us (the inner envelope) and which may not", () => {
	for (const f of ["2_Devizes atsifrejums_2. pielikums.docx", "3_Pieteikums_3. pielikums.docx", "5_Specialistu CV_AR_A. Kalnins.docx", "Aploksnes/IEKŠĒJĀ APLOKSNE - KVALIFIKĀCIJAS DOKUMENTI.docx"]) assert.ok(mayIdentify(f), f);
	for (const f of ["02_titullapa.docx", "4_Finansu piedavajums_4. pielikums.docx", "Aploksnes/ĀRĒJĀ APLOKSNE - META PIEDAVAJUMS.docx", "Planšete 1.pdf"]) assert.ok(!mayIdentify(f), f);
	assert.deepEqual(devizesIn("Meta ar devīzi “NES718” autors ir … NES718 /Devīze/ … DEVĪZE “NES718”"), ["NES718"]);
});

test("mets: our name, number, domain and people are caught in any form; a second devīze is caught", () => {
	const terms = identityTerms(reg()).map((t) => t.label);
	assert.deepEqual(terms, ["BŪVDIZAINS", "43603011124", "buvdizains.lv", "Andis Kalniņš", "Jānis Kreics"]);
	const { problems, devize } = anonymityProblems(
		[
			{ file: "2_Devizes atsifrejums.docx", text: "Meta ar devīzi “NES718” autors ir: SIA “BŪVDIZAINS”, Andis Kalniņš" },
			{ file: "02_titullapa.docx", text: "METU KONKURSS · Rīga, 2025 · sagatavoja A. Kalniņš" },
			{ file: "4_Finansu piedavajums.docx", text: "NES718 /Devīze/ · kontakti: info@buvdizains.lv" },
			{ file: "ĀRĒJĀ APLOKSNE.docx", text: "DEVĪZE “NES781”" },
		],
		reg(),
	);
	assert.equal(devize, "NES718");
	assert.deepEqual(problems.map((p) => `${p.file}|${p.kind}`).sort(), ["02_titullapa.docx|identity", "4_Finansu piedavajums.docx|identity", "ĀRĒJĀ APLOKSNE.docx|devize"]);
	assert.equal(anonymityFinding({ problems, devize }, 4, []).status, "fail");
	assert.equal(anonymityFinding({ problems: [], devize }, 4, ["Planšete.pdf"]).status, "warn", "files the check cannot read are said, not passed");
});

test("mets rule: ⊘ for tenders that are not anonymous", () => {
	const s = emptyState();
	const f = ruleAnonymity({ state: s, registers: reg(), builders: [], docs: [], matrices: [], leaks: {} } as never);
	assert.equal(f.status, "na");
});

test("ORACLE: the real Matīsa 8 submission is anonymous with one devīze; a name put on its title page is caught", { skip: !haveB }, () => {
	const r = anonymityInFolder(METS, reg());
	assert.deepEqual(r.problems, []);
	assert.equal(r.devize, "NES718");
	assert.ok(r.checked >= 8);
	assert.ok(r.unread.some((f) => /\.pdf$/i.test(f)), "the PDF design board is listed as not checked");
	const title = docxPlainText(readDocx(join(METS, "02_titullapa.docx")));
	const injected = anonymityProblems([{ file: "02_titullapa.docx", text: `${title}\nIzstrādāja: SIA “BŪVDIZAINS”` }], reg());
	assert.equal(injected.problems.length, 1);
	assert.equal(injected.problems[0].kind, "identity");
});

test("ORACLE: Tilde TAA cenu aptauja end to end in code — profile, deadline, steps, pack, e-mail address", { skip: !haveB }, () => {
	const dir = join(B, "261111_Tilde_TAA_Liela iela 19 Tukums_CA");
	const invite = join(dir, "00_Uzaicinajums_TAA_Liela_iela_19_Kandava.docx");
	const text = docxPlainText(readDocx(invite));
	const profile = { ...proposeProfile([{ file: invite, text, priority: 0 }], [], []), confirmed: true };
	assert.deepEqual([profile.procedure.value, profile.subject.value, profile.submission.value, profile.email.value], ["Cenu aptauja", "TAA", "e-pasts", "info@ktilde.lv"]);
	assert.deepEqual(stepsNotApplicable(profile), [], "a cenu aptauja still has versions and signatures");
	const dl = deadlineIn(text, invite)!;
	assert.deepEqual([dl.date, dl.time], ["2026-11-11", "12:00"]);
	// the documents the invitation lists under "5 Iesniedzamie dokumenti", as step 3 would read them
	const s = emptyState();
	s.profile = profile;
	const listed = ["Piedāvājuma vēstule un informācija par Pretendentu", "Apsekošanas uzdevums", "Apliecinājums par objekta apsekošanu", "Kvalifikāciju apliecinošu dokumentu kopijas"];
	for (const name of listed) assert.ok(text.toLowerCase().includes(name.toLowerCase().split(" ")[0].slice(0, 8)), `the invitation names ${name}`);
	s.requirements.dokumenti = listed.map((n) => ({ name: { value: n, status: "model" as const, cite: { file: invite, quote: n } }, mandatory: true }));
	const sheet = { template: "", skeleton: "", items: [], inspectedAt: "", outputs: {} };
	s.fills = { "source:01_Pielikums_Piedavajuma_vestule_Liela_iela_19_Kandava.docx": sheet, "source:02_Pielikums_Apsekosanas_uzdevums_Liela_iela_19_Kandava.docx": sheet, "source:03_Pielikums_Apliecinajums_par_objekta_apsekosanu_Liela_iela_19_Kandava.docx": sheet };
	const m = buildManifest({ state: s, registers: reg(), builders: [], profile, evidence: [] });
	assert.deepEqual(m.items.map((i) => [i.number, i.source]), [["1", "form"], ["2", "form"], ["3", "form"], ["4", "manual"]]);
	assert.deepEqual(m.unmatched, ["Kvalifikāciju apliecinošu dokumentu kopijas"]);
	assert.equal(allStepStatuses(s).versija === "neattiecas", false);
});
