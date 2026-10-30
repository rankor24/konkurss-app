// File names below are real names from the NVA 2025/122 and VUGD 2 (2025/95) tender folders.
import { test } from "node:test";
import assert from "node:assert/strict";
import { guessKind, guessWhere } from "../src/shared/classify.ts";

const cases: [string, string][] = [
	["NOLIKUMS_14_07_2026.docx", "nolikums"],
	["NOLIKUMS_2026_95_2_posms_31_07.docx", "nolikums"],
	["5.pielikums_Pirms_liguma_BIP.docx", "bip_veidne"],
	["4.pielikums_Pirms_liguma_BIP.docx", "bip_veidne"],
	["5.B.pielikums_Pirms_liguma_BIP_vertesanas_kriteriji.docx", "bip_kriteriji"],
	["5.A.pielikums_Atbildibas_matrica.xlsx", "matrica"],
	["4.A.pielikums_Atbildibas_matrica (veidlapa).xlsx", "matrica"],
	["6.pielikums_Paraugmodelu_prasibas.docx", "paraugmodelu_prasibas"],
	["6.A.pielikums_Paraugmodelu_vertesanas_kriteriji.docx", "paraugmodelu_kriteriji"],
	["1.pielikums_Tehniska_specifikacija.docx", "tehniska_specifikacija"],
	["TS_4.pielikums_BIM_prasibas/TS_4.pielikums_Pasūtītāja BIM prasības_PIP.docx", "pip"],
	["GROZIJUMI/Groz_1_pielikums tehniska specifikacija.docx", "grozijumi"],
	["Jautajumi un atbildes/Visiem_ieinteresetajiem_piegadatajiem_2025_95_13.docx", "qa"],
	["Jautajumi un atbildes/Dokuments_institucija__PAD.edoc", "qa"],
	["Projektesanas uzdevums/3.pielikums_Buvatlauja/Dok.Nr_DA-26-112-abv.edoc", "buvatlauja"],
	["Projektesanas uzdevums/4.pielikums_Tehniskie_noteikumi/TN_Krustpils_10.edoc", "tehniskie_noteikumi"],
	["Finansu_piedavajums 31072026.xlsx", "finansu"],
	["9.pielikums_Ligums_DzG_14-07-2026.docx", "ligums"],
	["something_unrecognised.bin", "cits"],
];

for (const [path, kind] of cases) {
	test(`kind of ${path.split("/").pop()} → ${kind}`, () => assert.equal(guessKind(path), kind));
}

test("the permit folder decides when the file name says nothing", () => {
	assert.equal(guessKind("Projektesanas uzdevums/3.pielikums_Buvatlauja/ABC123.edoc"), "buvatlauja");
});

test("Latvian diacritics do not break matching", () => {
	assert.equal(guessKind("Vērtēšanas_kritēriji_Pirms_līguma_BIP.docx"), "bip_kriteriji");
});

test("where: source → konkurss, output → piedavajums, workflow/extracted/.konkurss → darba", () => {
	assert.equal(guessWhere("NOLIKUMS.docx", "source"), "konkurss");
	assert.equal(guessWhere("BIP_v2.docx", "output"), "piedavajums");
	assert.equal(guessWhere("workflow/extracted/x.txt", "source"), "darba");
	assert.equal(guessWhere("extracted/x.txt", "output"), "darba");
});
