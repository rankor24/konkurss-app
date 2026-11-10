import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { docxPlainText, readDocx } from "../src/main/office.ts";
import { lotsFromFolders, proposeProfile, sentenceAt, type TextDoc } from "../src/main/profile.ts";
import { assemblePack, buildManifest, folderItemFiles, manifestFromFolder, nameScore, numberOf, requiredKind, stripNumber, withStatus } from "../src/main/pack/manifest.ts";
import { emptyRegisters } from "../src/main/registers/registers.ts";
import { recipients, stepsNotApplicable, variantFor, type TenderProfile } from "../src/shared/profile.ts";
import { emptyState, type Cited } from "../src/shared/state.ts";
import { allStepStatuses } from "../src/shared/steps.ts";
import type { EvidenceItem } from "../src/main/v1/evidence.ts";

const B = "B:/01_Konkursi";
const haveB = existsSync(B);
const c = <T>(value: T): Cited<T> => ({ value, status: "manual" });

// ---------- profile ----------
test("profile rules on real wordings; quotes are substrings of the text", () => {
	const doc = (text: string): TextDoc[] => [{ file: "n.docx", text, priority: 0 }];
	const tilde = proposeProfile(doc("Uzaicinājums piedalīties cenu aptaujā\nTehniskās apsekošanas atzinuma sagatavošana daudzdzīvokļu dzīvojamai mājai\nPiedāvājums jāiesniedz līdz 2026. gada 11. novembrim plkst. 12.00, nosūtot to elektroniski uz e-pasta adresi info@ktilde.lv."), [], []);
	assert.deepEqual([tilde.procedure.value, tilde.subject.value, tilde.submission.value, tilde.email.value, tilde.ourRole.value], ["Cenu aptauja", "TAA", "e-pasts", "info@ktilde.lv", "pretendents"]);
	const pb = proposeProfile(doc("Atklāts konkurss\n“Būvniecības ieceres dokumentācijas izstrāde, būvdarbu veikšana un autoruzraudzība objektu pielāgošanai”\nEIS e-konkursu apakšsistēmā"), [], []);
	assert.deepEqual([pb.procedure.value, pb.subject.value, pb.ourRole.value, pb.submission.value], ["Atklāts konkurss", "Projektē/Būvē", "apaksuznemejs", "EIS"]);
	assert.ok(pb.subject.cite!.quote.includes("būvdarbu veikšana"));
	// design-only tenders say "autoruzraudzība būvdarbu laikā" — that is not projektē un būvē
	const design = proposeProfile(doc("Atklāts konkurss\nBūvprojekta izstrāde un autoruzraudzība būvdarbu laikā Liepājā"), [], []);
	assert.equal(design.subject.value, "Projektēšana/Autoruzraudzība");
	// the regulation's name is not a design competition; questions by e-mail are not an e-mailed offer
	const mnp = proposeProfile(doc("saskaņā ar MK noteikumiem “Iepirkuma procedūru un metu konkursu norises kārtība”. Jautājumus nosūtot uz e-pasta adresi a@b.lv. Iepirkums PIL 9.panta kārtībā."), [], []);
	assert.notEqual(mnp.procedure.value, "Mets");
	assert.notEqual(mnp.submission.value, "e-pasts");
	assert.equal(sentenceAt("Pirmais teikums. Otrais teikums par cenu aptauju.\nCits", 30), "Otrais teikums par cenu aptauju.");
});

test("daļas from EIS folder names and from hand-made folders", () => {
	assert.deepEqual(lotsFromFolders(["Iepirkuma priekšmeta 2.daļas prasības, 1.versija", "Iepirkuma priekšmeta 1.daļas prasības, 1.versija", "Nolikums"]).map((l) => l.n), [1, 2]);
	assert.deepEqual(lotsFromFolders(["1.dala", "2.dala", "3.dala"]).map((l) => l.n), [1, 2, 3]);
});

test("profile → variant, steps that do not apply, recipients", () => {
	const p = (subject: string, ourRole: string, procedure = "Atklāts konkurss", submission = "EIS"): TenderProfile => ({ procedure: c(procedure) as never, subject: c(subject) as never, ourRole: c(ourRole) as never, lots: [], submission: c(submission) as never, email: { value: null, status: "missing" }, readAt: "", confirmed: true });
	assert.equal(variantFor(p("Projektē/Būvē", "apaksuznemejs")), "V2");
	assert.equal(variantFor(p("BIM daļa", "pretendents")), "V3");
	assert.equal(variantFor(p("TAA", "pretendents")), "V1");
	assert.deepEqual(stepsNotApplicable(p("Projektēšana/Autoruzraudzība", "pretendents", "Neregulēts iepirkums")), ["versija"]);
	assert.deepEqual(stepsNotApplicable(p("Mets", "pretendents", "Mets", "anonīms")), ["paraksti"]);
	const s = emptyState();
	s.profile = p("Projektēšana/Autoruzraudzība", "pretendents", "Neregulēts iepirkums");
	assert.equal(allStepStatuses(s).versija, "neattiecas");
	s.profile.confirmed = false;
	assert.notEqual(allStepStatuses(s).versija, "neattiecas", "an unconfirmed profile changes nothing");
	assert.deepEqual(recipients(p("Projektē/Būvē", "apaksuznemejs"), ["AIDACO", "BILDBERG"]), ["builder:AIDACO", "builder:BILDBERG"]);
	assert.deepEqual(recipients(p("Projektēšana/Autoruzraudzība", "pretendents"), []), [""]);
});

const PROFILE_ORACLE: [string, RegExp, Partial<Record<"procedure" | "subject" | "submission", string>>, number][] = [
	["261105_RNP_Ulbrokas sporta kompleksa gerbtuves", /nolikums/i, { procedure: "9.pants", subject: "Projektēšana/Autoruzraudzība", submission: "EIS" }, 0],
	["261110_BNP_Bauskas patvertnes/KONKURSS", /nolik|pielikums/i, { procedure: "Atklāts konkurss", subject: "Projektē/Būvē", submission: "EIS" }, 3],
	["261111_Tilde_TAA_Liela iela 19 Tukums_CA", /uzaicin/i, { procedure: "Cenu aptauja", subject: "TAA", submission: "e-pasts" }, 0],
	["261113_MNP_Vienkarsotas atjaunosanas darbi", /noteikumi/i, { subject: "Projektē/Būvē", submission: "EIS" }, 4],
	["00_Metu Konkursi/251003_METS_Matisa iela 8/KONKURSS", /nolik/i, { procedure: "Mets", subject: "Mets", submission: "anonīms" }, 0],
	["261109_SN_VSAC Zemgale", /pieteikums|nolik/i, { procedure: "Atklāts konkurss", subject: "Projektē/Būvē" }, 0],
	["261130_LVP_Liepajas pludmales izejas", /nolik|pieteik/i, { procedure: "Atklāts konkurss", subject: "Projektēšana/Autoruzraudzība" }, 3],
];

test("ORACLE: profiles of seven real tender types read in code from their own documents", { skip: !haveB, timeout: 300_000 }, () => {
	const walk = (d: string, depth = 0): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (depth < 2 && !/iesniedz|piedavaj/i.test(e.name) ? walk(join(d, e.name), depth + 1) : []) : [join(d, e.name)]));
	const dirs = (d: string, depth = 0): string[] => readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).flatMap((e) => [e.name, ...(depth < 1 ? dirs(join(d, e.name), depth + 1) : [])]);
	for (const [t, pri, want, lots] of PROFILE_ORACLE) {
		const root = join(B, t);
		const docs = walk(root).filter((f) => /\.docx$/i.test(f)).flatMap((f) => {
			try {
				return [{ file: f, text: docxPlainText(readDocx(f)), priority: pri.test(f) ? 0 : 5 }];
			} catch {
				return [];
			}
		});
		const p = proposeProfile(docs, dirs(root), []);
		for (const [k, v] of Object.entries(want)) assert.equal((p as unknown as Record<string, Cited<string>>)[k].value, v, `${t}: ${k}`);
		for (const k of Object.keys(want)) {
			const cite = (p as unknown as Record<string, Cited<string>>)[k].cite!;
			const text = docs.find((d) => d.file === cite.file)!.text.replace(/\s+/g, " ");
			assert.ok(text.includes(cite.quote), `${t}: the ${k} quote stands in its file`);
		}
		assert.equal(p.lots.length, lots, `${t}: daļas`);
	}
});

// ---------- manifest ----------
test("numbering helpers in the office's styles", () => {
	assert.equal(numberOf("3_12Ekspluatācijas_Akts.pdf"), "3_12");
	assert.equal(numberOf("1_Specialistu saraksts.docx"), "1");
	assert.equal(numberOf("P8_1Atsauksme.edoc"), "P8_1");
	assert.equal(stripNumber("3_1Atsauksme_Anninmuizas iela AU.edoc"), "Atsauksme_Anninmuizas iela AU.edoc");
	assert.ok(nameScore("Finanšu piedāvājums", "source:6_Finansu piedavajums.docx") > 0);
	assert.equal(nameScore("Pieteikums", "source:Liguma_projekts.docx"), 0);
	assert.equal(requiredKind("Speciālista apliecinājums par gatavību piedalīties līguma izpildē"), "spec_apliec");
	assert.equal(requiredKind("Apakšuzņēmēja apliecinājums"), "apaksuzn_apliec");
	assert.equal(requiredKind("Speciālistu pieredzes apraksts"), "pieredze");
});

function packState() {
	const s = emptyState();
	const req = (n: string) => ({ name: { value: n, status: "model" as const, cite: { file: "nolikums.docx", quote: n } }, mandatory: true });
	s.requirements.dokumenti = ["Speciālistu saraksts", "Speciālista apliecinājums", "Speciālistu pieredzes apraksts", "Apakšuzņēmēju darbu saraksts", "Apakšuzņēmēja apliecinājums"].map(req);
	const sheet = (out: Record<string, string>) => ({ template: "", skeleton: "", items: [], inspectedAt: "", outputs: out });
	s.fills = { "source:1.pielikums_Specialistu_saraksts.docx": sheet({ "": "C:/o/Iesniedzamie/Specialistu_saraksts_v1.docx", AIDACO: "C:/o/AIDACO/Specialistu_saraksts_v1.docx" }), "source:7.pielikums_Specialistu_pieredzes_apraksts.docx": sheet({}), "source:8.pielikums_Apaksuznemeju_darbu_saraksts.docx": sheet({}) };
	const reg = emptyRegisters();
	reg.company.fields = [{ key: "Nosaukums", value: "SIA “BŪVDIZAINS”" }];
	reg.company.persons = [{ role: "Paraksttiesīgais", person: "Jānis Kreics", note: "" }];
	reg.specialists = [{ id: "sp1", name: "Andis Kalniņš", field: "arhitekts", certificate: "1-1", type: "A", via: "", note: "", validUntil: "" }];
	s.requirements.specialisti = [{ field: c("Būvprojekta vadītājs"), certificate: c("arh"), mandatory: true }];
	s.choices.specialists = { "0": "sp1" };
	const evidence: EvidenceItem[] = [
		{ slot: "bpv:0", object: "Mēnesgaismas", label: "Atsauksme", from: "B:/x/3_3Atsauksme_BD291-2023_Sabilex_Menesgaismas.edoc", toRel: "", status: "ok" },
		{ slot: "bpv:0", object: "Mēnesgaismas", label: "Būvatļauja", from: "B:/x/3_4Buvatlauja_Menessgaismas.pdf", toRel: "", status: "ok" },
	];
	return { s, reg, evidence };
}

test("manifest: order and numbers from the tender's list; evidence under the experience form; one statement per person", () => {
	const { s, reg, evidence } = packState();
	const m = buildManifest({ state: s, registers: reg, builders: [], evidence });
	const names = m.items.map((i) => i.fileName);
	assert.deepEqual(names, [
		"1_Specialistu_saraksts.docx",
		"2_Spec. apliec. A. Kalniņš.docx",
		"3_0_Specialistu_pieredzes_apraksts.docx",
		"3_1Atsauksme_BD291-2023_Sabilex_Menesgaismas.edoc",
		"3_2Buvatlauja_Menessgaismas.pdf",
		"4_Apaksuznemeju_darbu_saraksts.docx",
	]);
	assert.equal(m.items[1].signer, "Andis Kalniņš");
	assert.equal(m.items[0].signer, "Jānis Kreics");
	assert.equal(m.items[3].signer, null, "an atsauksme is signed by whoever issued it");
	assert.deepEqual(m.unmatched, ["Apakšuzņēmēja apliecinājums"], "no firm to write it for: says so");
});

test("manifest for builders: every builder gets the whole pack; a form's builder copy is used when it exists", () => {
	const { s, reg, evidence } = packState();
	const profile = { procedure: c("Atklāts konkurss"), subject: c("Projektē/Būvē"), ourRole: c("apaksuznemejs"), lots: [], submission: c("EIS"), email: { value: null, status: "missing" }, readAt: "", confirmed: true } as unknown as TenderProfile;
	const m = buildManifest({ state: s, registers: reg, builders: ["AIDACO", "BILDBERG"], profile, evidence });
	const by = (r: string) => m.items.filter((i) => i.recipient === r);
	assert.equal(by("builder:AIDACO").length, by("builder:BILDBERG").length);
	assert.equal(by("").length, 0);
	assert.equal(by("builder:AIDACO")[0].from, "C:/o/AIDACO/Specialistu_saraksts_v1.docx");
	assert.equal(by("builder:BILDBERG")[0].from, "C:/o/Iesniedzamie/Specialistu_saraksts_v1.docx");
	// our own subcontractor statement appears once we design for builders
	assert.ok(by("builder:AIDACO").some((i) => /Apaksuzn\. apliec\. BŪVDIZAINS/.test(i.fileName) && i.signer === "Jānis Kreics"));
	assert.deepEqual(m.unmatched.filter((u) => /Apakšuzņēmēja/.test(u)), []);
});

test("assemble copies into Paka, never over an existing file; status follows what is in the folder", () => {
	const dir = mkdtempSync(join(tmpdir(), "konk-pack-"));
	const src = join(dir, "src.docx");
	writeFileSync(src, "draft");
	const m = { builtAt: "", unmatched: [], items: [{ id: "a", recipient: "", number: "1", label: "Pieteikums", source: "form" as const, ref: "k", fileName: "1_Pieteikums.docx", from: src, signer: "J. K.", status: "nav" as const }, { id: "b", recipient: "builder:FF", number: "2", label: "x", source: "manual" as const, ref: "", fileName: "2_X.docx", from: null, signer: null, status: "nav" as const }] };
	const r1 = assemblePack(m, dir);
	assert.deepEqual([r1.copied, r1.missing], [["1_Pieteikums.docx"], [join("FF", "2_X.docx")]]);
	writeFileSync(join(dir, "Paka", "1_Pieteikums.docx"), "edited by a person");
	const r2 = assemblePack(m, dir);
	assert.deepEqual(r2.kept, ["1_Pieteikums.docx"]);
	assert.equal(readFileSync(join(dir, "Paka", "1_Pieteikums.docx"), "utf8"), "edited by a person");
	assert.equal(withStatus(m, join(dir, "Paka")).items[0].status, "melnraksts");
	writeFileSync(join(dir, "Paka", "1_Pieteikums.edoc"), "signed");
	assert.equal(withStatus(m, join(dir, "Paka")).items[0].status, "parakstits");
	mkdirSync(join(dir, "done"));
});

test("ORACLE: the manifest model represents real packs exactly — BNP Bauska (19 files) and IE67 Mārupe (two builders)", { skip: !haveB }, () => {
	const bauska = join(B, "261110_BNP_Bauskas patvertnes", "IESNIEDZAMIE");
	const items = manifestFromFolder(bauska);
	assert.deepEqual(folderItemFiles(items), readdirSync(bauska).filter((f) => !f.startsWith("~$")).sort());
	assert.equal(items.length, 17, "a .docx and its signed .edoc are one document");
	assert.ok(items.some((i) => i.number === "3_0") && items.some((i) => i.number === "3_12"));
	assert.ok(items.filter((i) => i.exts.includes(".edoc") && i.exts.includes(".docx")).length >= 2);
	const marupe = manifestFromFolder(join(B, "261113_IE67_Dienas centrs Marupe BIM", "IESNIEDZAMIE"));
	const nums = (r: string) => marupe.filter((i) => i.recipient === r).map((i) => `${i.number}|${i.kind}`).sort();
	assert.ok(nums("builder:AIDACO").length >= 10);
	assert.deepEqual(nums("builder:AIDACO"), nums("builder:BILDBERG"), "each builder's pack is a copy of the same pack");
});
