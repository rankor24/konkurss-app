import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ZipReader } from "../src/main/zip.ts";
import { readDocxZip, readXlsx, readXlsxZip, excelDate } from "../src/main/office.ts";
import { parseDay, parseEur, parseResult, parseSubcontractors, parseTracker, parseTrackerSheet, parseWinner, trackerStats } from "../src/main/library/imports.ts";
import { clusterEvidence, companyMentions, evidenceKind, experienceRows, factsFor, harvest, isBuilderFolder, keyString, objectKey, readableStem, type SubFile } from "../src/main/library/harvest.ts";
import { acceptAsNew, carryDecisions, factsToFields, mergeBuilders, mergeInto } from "../src/main/library/accept.ts";
import { emptyRegisters } from "../src/main/registers/registers.ts";
import { Store } from "../src/main/store.ts";
import { planEvidence } from "../src/main/v1/evidence.ts";
import { parseObject } from "../src/main/v1/objects.ts";
import { emptyChoices } from "../src/shared/state.ts";
import type { HarvestProposal } from "../src/shared/library.ts";
import { makeDocx, makeXlsx, makeZip } from "./helpers/zipwrite.ts";

const B = "B:/01_Konkursi";
const haveB = existsSync(B);

// ---------- zip / office ----------
test("zip: stored and deflated entries both read back byte for byte; UTF-8 names", () => {
	for (const deflate of [false, true]) {
		const z = ZipReader.fromBuffer(makeZip({ "a.txt": "Mēnesgaismas", "dir/ķ.xml": "<x>1</x>" }, deflate));
		assert.equal(z.text("a.txt"), "Mēnesgaismas");
		assert.equal(z.text("dir/ķ.xml"), "<x>1</x>");
		assert.equal(z.read("nav.txt"), null);
	}
	assert.throws(() => ZipReader.fromBuffer(Buffer.from("not a zip at all, definitely not")), /nav ZIP/);
});

test("docx: paragraphs outside tables, tables as rows of cells; entities decoded; multi-paragraph cells joined", () => {
	const d = readDocxZip(ZipReader.fromBuffer(makeDocx(["7. pielikums", "SIA “BŪVDIZAINS” & partneri"], [[["Pasūtītājs", "Pieredzes raksturojums"], ["SIA \"SaBiLex\"", "Dienesta viesnīca\nJaunbūve"]]])));
	assert.deepEqual(d.paragraphs, ["7. pielikums", "SIA “BŪVDIZAINS” & partneri"]);
	assert.deepEqual(d.tables, [[["Pasūtītājs", "Pieredzes raksturojums"], ['SIA "SaBiLex"', "Dienesta viesnīca Jaunbūve"]]]);
});

test("xlsx: sheet names through relationships, shared strings, numbers kept as written", () => {
	const s = readXlsxZip(ZipReader.fromBuffer(makeXlsx([{ name: "2026", rows: [{ A: "Liekam", C: "46246" }] }, { name: "BBR", rows: [{ B: "AR", D: "12405" }] }])));
	assert.deepEqual(s.map((x) => x.name), ["2026", "BBR"]);
	assert.deepEqual(s[0].rows[0], { n: 1, cells: { A: "Liekam", C: "46246" } });
	assert.equal(excelDate("46246"), "2026-08-12"); // 2026-01-01 = 46023
});

// ---------- tracker / subcontractors ----------
test("amounts and dates in the office's spellings", () => {
	assert.equal(parseEur("65 800,00"), 6580000);
	assert.equal(parseEur("1437577.07"), 143757707);
	assert.equal(parseEur("4 509.50"), 450950);
	assert.equal(parseEur("78400"), 7840000);
	assert.equal(parseEur("NAV I posms"), null);
	assert.equal(parseDay("25.03.2022"), "2022-03-25");
	assert.equal(parseDay("46246"), "2026-08-12");
});

test("results and winners as the tracker writes them", () => {
	assert.equal(parseResult("Zaudēts (pārāk augsta cena)", true), "zaudejums");
	assert.equal(parseResult("Līguma slēgšanas process", true), "uzvara");
	assert.equal(parseResult("Pārtraukts (pasūtītājs veiks izmaiņas dokumentācijā)", true), "parstraukts");
	assert.equal(parseResult("", true), "gaida");
	assert.equal(parseResult("", false), "nav");
	assert.deepEqual(parseWinner("Personu apvienība SIA “KORP” un SIA “I.S.A.M.” 1437577.07 EUR"), { winner: "Personu apvienība SIA “KORP” un SIA “I.S.A.M.”", cents: 143757707 });
	assert.deepEqual(parseWinner('SIA “Livland Group” 65 800,00 EUR(atcelts) SIA "BM-projekts" 70 000.00 EUR'), { winner: "SIA “Livland Group”", cents: 6580000 });
	assert.equal(parseWinner("Turpinam nākamo posmu"), null);
});

test("tracker: legacy layout and the 2026 triage layout (result and comment columns swapped) both parse by header", () => {
	const legacy = parseTrackerSheet({ name: "2025", rows: [{ n: 1, cells: { A: "Npk.", B: "Iepirkuma nosaukums", D: "Pasūtītājs", E: "BD Summa, eur bez PVN", F: "Iesniegšanas termiņš", G: "Rezultāts Uzvarēts (jeb līgums)/zaudēts", H: "Cēlonis, komentārs, piezīmes(uzvarētāja cena un nosaukums)" } }, { n: 2, cells: { A: "1", B: "Kalnamuižas siltumnīcas", D: "Saldus novada pašvaldība", E: "9100", F: "06.01.2025", G: "Zaudēts", H: "Raimonds Brikmanis 1 200.00 EUR" } }] });
	assert.equal(legacy.length, 1);
	assert.equal(legacy[0].submitted, true);
	assert.equal(legacy[0].result, "zaudejums");
	assert.equal(legacy[0].ourCents, 910000);
	assert.equal(legacy[0].deadline, "2025-01-06");
	const t26 = parseTrackerSheet({
		name: "2026",
		rows: [
			{ n: 1, cells: { A: "Liekam / Neliekam", B: "Iesniegs / Neiesniegts", C: "Iesniegšanas datums ", D: "Saite uz iepirkumu", E: "Iepirkuma nosaukums", F: "Darbu veids (projektēšana, autoruzraudzība utml) un/vai pieredze", G: "Pasūtītājs", J: "Iepirkuma veids", K: "Darbu veids", M: "BD Summa, eur bez PVN", N: "Cēlonis, komentārs, piezīmes(uzvarētāja cena un nosaukums)", O: "Rezultāts Uzvarēts (jeb līgums)/zaudēts" } },
			{ n: 2, cells: { A: "Liekam", B: "Iesniegts", C: "46246", D: "https://www.eis.gov.lv/EKEIS/Supplier/Procurement/173541", E: "Sociālo mājokļu atjaunošana Skolas ielā 1A, Zantē", G: "Tukuma novada pašvaldība/BILDBERG/KUUM", J: "Atklāts konkurss", K: "Projektē/Būvē", M: "110000", N: "Zaudēts (pārāk augsta cena)", O: "Personu apvienība SIA “KORP” un SIA “I.S.A.M.” 1437577.07 EUR" } },
			{ n: 3, cells: { A: "Interesē/nav pieredze", B: "Neiesniegts", E: "Skolas pārbūve" } },
		],
	});
	assert.equal(t26.length, 2);
	assert.deepEqual([t26[0].purchaser, t26[0].builders], ["Tukuma novada pašvaldība", ["BILDBERG", "KUUM"]]);
	assert.equal(t26[0].result, "zaudejums");
	assert.equal(t26[0].winnerCents, 143757707);
	assert.equal(t26[0].procedure, "Atklāts konkurss");
	assert.equal(t26[0].subject, "Projektē/Būvē");
	assert.equal(t26[0].deadline, "2026-08-12");
	assert.equal(t26[1].decision, "interesē_nav_pieredzes");
	assert.equal(t26[1].submitted, false);
	assert.deepEqual(trackerStats(t26)[0], { sheet: "2026", rows: 2, submitted: 1, won: 0, lost: 1, decided: { liekam: 1, "interesē_nav_pieredzes": 1 } });
});

test("subcontractors: a firm's parts on following rows join the firm; ratings come from the sub-header columns", () => {
	const subs = parseSubcontractors({
		name: "Reģistrs",
		rows: [
			{ n: 1, cells: { A: "Projekta sadaļas (FILTRĒJAMAS)", B: "Uzņēmuma nosaukums, amats", C: "Uzvārds, Vārds", D: "Telefons", E: "E-pasts", F: "Apraksts (atzīmē ar \"+\" vai \"-\")", I: "Piezīmes" } },
			{ n: 2, cells: { F: "Cena", G: "Kvalitāte", H: "Termiņi" } },
			{ n: 3, cells: { A: "UK", B: "SIA “ARDIKO - projektēšana\"", C: "Māris Reinfelds ", D: "29493408", E: "ardiko@inbox.lv", F: "+", G: "+", H: "+" } },
			{ n: 4, cells: { A: "AVK", F: "+" } },
			{ n: 5, cells: { A: "SM" } },
			{ n: 6, cells: { A: "Būvakustika", B: "SIA “R&D Akustika”, Akustikas speciālists", C: "Saprovskis Juris", F: "-", G: "+", H: "+" } },
		],
	});
	assert.equal(subs.length, 2);
	assert.deepEqual(subs[0].parts, ["UK", "AVK", "SM"]);
	assert.equal(subs[0].person, "Māris Reinfelds");
	assert.deepEqual([subs[1].price, subs[1].quality, subs[1].terms], ["-", "+", "+"]);
	assert.equal(subs[1].source, "xlsx:6");
});

// ---------- harvesting ----------
test("evidence kind and object key from the office's real file names", () => {
	assert.equal(evidenceKind("3_1Atsauksme_Anninmuizas iela AU.edoc"), "atsauksme");
	assert.equal(evidenceKind("P8_1Atsauksme_BD291-2023_Sabilex_Menesgaismas.edoc"), "atsauksme");
	assert.equal(evidenceKind("4_4Ekspluatacijas_Akts_Cigorinu 3.pdf"), "ekspluatacija");
	assert.equal(evidenceKind("3_7Buvatlauja_PN_atzime.pdf"), "buvatlauja");
	assert.equal(evidenceKind("Pieredze.zip"), null);
	assert.equal(evidenceKind("6_Finansu piedavajums.docx"), null);
	// one object, three spellings
	assert.equal(keyString(objectKey("3_4Buvatlauja_Menessgaismas.pdf")), "menesg");
	assert.equal(keyString(objectKey("1_Atsauksme_BD291-2023_Sabilex_Menesgaismas.edoc")), "menesg sabile");
	// different addresses stay different
	assert.notEqual(keyString(objectKey("4_1Atsauksme_Cigorinu 3.edoc")), keyString(objectKey("3_2Buvatlauja_Cigorinu 1.pdf")));
	// generic names carry no object
	assert.deepEqual(objectKey("3_6Buvatlauja.pdf").words, []);
	assert.equal(readableStem("3_1Atsauksme_Cigorinu 3 AU.edoc"), "Cigorinu 3 AU");
	assert.equal(readableStem("P8_1Atsauksme_BD291-2023_Sabilex_Menesgaismas.edoc"), "BD291-2023_Sabilex_Menesgaismas".replace(/_/g, " "));
});

const sf = (tender: string, name: string, mtimeMs = 1): SubFile => ({ tender, path: `B:/x/${tender}/IESNIEDZAMIE/${name}`, rel: name, name, size: 1, mtimeMs, builder: "" });

test("clustering: spellings of one object merge; a key that could mean two addresses stays apart", () => {
	const files = [
		sf("t1", "3_1Atsauksme_BD291-2023_Sabilex_Menesgaismas.edoc"),
		sf("t1", "3_2Buvatlauja_Menessgaismas.pdf"),
		sf("t2", "1_Atsauksme_BD291-2023_Sabilex_Menesgaismas.edoc"),
		sf("t2", "4_1Atsauksme_Cigorinu 3.edoc"),
		sf("t3", "4_2Buvatlauja_Cigorinu 3 AU.pdf"),
		sf("t3", "2_Buvatlauja_Cigorinu 1.pdf"),
		sf("t4", "2_Atsauksme_Cigorinu 1.edoc"),
		sf("t4", "3_Atsauksme_Cigorinu iela.edoc"),
		sf("t4", "3_6Buvatlauja.pdf"),
	];
	const { clusters, unnamed } = clusterEvidence(files);
	const keys = clusters.map((c) => keyString(c.key)).sort();
	assert.deepEqual(keys, ["cigori", "cigori #1", "cigori #3", "menesg sabile"]);
	assert.equal(clusters.find((c) => keyString(c.key) === "menesg sabile")!.files.length, 3);
	assert.equal(unnamed, 1);
});

test("builder folders: company names yes; document groups and persons no", () => {
	for (const n of ["SANART", "Pillar", "BCC group", "RTS buve", "HOMELAND BŪVE", "AIDACO"]) assert.ok(isBuilderFolder(n), n);
	for (const n of ["Pieredze", "Pieredzes objekti", "NODROSINAJUMS", "BIM", "Apliecinajumi", "Licences", "Drafts", "N.Pavars", "A. Kalnins", "IP", "KUUM nepiedalas, nav brivo lidzeklu"]) assert.ok(!isBuilderFolder(n), n);
});

test("company + reg. Nr. in the real wordings; the FF statement pairs FF with BŪVDIZAINS's number", () => {
	const sanart = companyMentions("Apliecinām, ka mēs SIA “BŪVDIZAINS”, reģ. nr. 43603011124, esam gatavi … ja ar pretendentu SIA “SANART”, reģ. nr. 44103043748 tiks noslēgts iepirkuma līgums");
	assert.deepEqual(sanart.map((m) => [m.name, m.regNr]), [["SIA “BŪVDIZAINS”", "43603011124"], ["SIA “SANART”", "44103043748"]]);
	const ff = companyMentions("Pretendents SIA “FF” Reģ. Nr. 40003670683 Ar šo SIA “BŪVDIZAINS”, reģ. nr. 43603011124, Kalnciema ceļš 126A … kā SIA “FF”, reģ. nr. _43603011124, turpmāk – Pretendents");
	assert.deepEqual(ff.map((m) => [m.key, m.regNr]), [["ff", "40003670683"], ["buvdizains", "43603011124"], ["ff", "43603011124"]]);
});

test("experience rows: header found by its words, placeholder rows dropped, cells kept verbatim", () => {
	const rows = experienceRows(
		[[
			["Nr. p.k.", "Pasūtītājs (nosaukums, reģ. Nr. un pasūtītāja kontaktpersona)", "Pieredzes raksturojums (objekta nosaukums, objekta adrese, veikto darbu apraksts)", "Līguma izpildes laiks (no/līdz)", "Būvvaldes atzīmes datums", "Datums, kad nodots ekspluatācijā"],
			["", "", "", "", "-", ""],
			["1.", "SIA \"SaBiLex\", Reģ. Nr. 40003743440", "Dienesta viesnīcas ēka ar kafejnīcu adresē “Mēnesgaismas”, Mārupe, Jaunbūve, Publiska ēka – III grupa, Būves kods – 1211", "17.03.2023-27.06.2024", "26.06.2024", "-"],
		]],
		"B:/x/3_0Specialistu pieredze.docx",
		5,
	);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].cells["Būvvaldes atzīmes datums"], "26.06.2024");
	assert.equal(rows[0].cells["Nodots ekspluatācijā"], undefined);
	const facts = factsFor(objectKey("Atsauksme_BD291-2023_Sabilex_Menesgaismas.edoc"), rows);
	assert.equal(facts.find((f) => f.key === "Līguma izpildes laiks")!.cite.quote, "17.03.2023-27.06.2024");
	// fields land on the register's own keys; derived ones only from words in the cell
	const { fields, cites } = factsToFields(facts);
	const f = Object.fromEntries(fields.map((x) => [x.key, x.value]));
	assert.equal(f["Būvvaldes akcepts"], "26.06.2024");
	assert.equal(f["Būvniecības veids"], "Jaunbūve");
	assert.equal(f["Platība / kods / grupa"], "— / 1211 / Publiska ēka III grupa");
	assert.ok(cites["Būvniecības veids"].quote.includes("Jaunbūve"));
	// and v1/objects.ts reads them like a hand-made object
	const facts2 = parseObject({ id: "o", name: "Mēnesgaismas", fields, evidence: [] });
	assert.deepEqual([facts2.code, facts2.group, facts2.isPublic, facts2.acceptDate?.getFullYear()], ["1211", 3, true, 2024]);
});

const proposal = (key: string, extra: Partial<HarvestProposal> = {}): HarvestProposal => ({ key, label: key, uses: 3, tenders: [], files: [{ path: `B:/x/${key}.edoc`, kind: "atsauksme", mtimeMs: 1, size: 1 }], facts: [], match: null, decision: null, ...extra });

test("accept / merge / ignore: decisions stick; merge never replaces a value a person typed", () => {
	const reg = emptyRegisters();
	reg.harvest = { ranAt: "", roots: [], submissions: 0, files: 0, unnamed: 0, proposals: [proposal("menesg sabile", { facts: [{ key: "Būvvaldes atzīmes datums", value: "26.06.2024", cite: { file: "f", quote: "26.06.2024" } }] }), proposal("aninmu")], builders: [] };
	const o = acceptAsNew(reg, reg.harvest.proposals[0], "Mēnesgaismas", "id1");
	assert.equal(o.evidence[0].kind, "atsauksme");
	assert.equal(reg.harvest.proposals[0].decision, "accepted");
	reg.objects.push({ id: "id2", name: "Anniņmuiža", fields: [{ key: "Būvvaldes akcepts", value: "21.06.2024 (ievadīts)" }], evidence: [] });
	reg.harvest.proposals[1].facts = [{ key: "Būvvaldes atzīmes datums", value: "01.01.2020", cite: { file: "f", quote: "01.01.2020" } }];
	mergeInto(reg, reg.harvest.proposals[1], "id2");
	assert.equal(reg.objects[1].fields[0].value, "21.06.2024 (ievadīts)");
	assert.equal(reg.objects[1].evidence.length, 1);
	const next = carryDecisions(reg.harvest.proposals, [proposal("menesg sabile"), proposal("new")]);
	assert.deepEqual(next.map((p) => p.decision), ["accepted", null]);
});

test("builders: a re-run fills the reg. Nr. but keeps what a person typed", () => {
	const merged = mergeBuilders([{ id: "kuum", name: "KUUM", regNr: "", address: "Rīga, ievadīts", signatory: "", signatoryTitle: "", contact: "", seenIn: ["a"], cites: [] }], [{ id: "kuum", name: "SIA “KUUM”", regNr: "40103198971", address: "", signatory: "", signatoryTitle: "", contact: "", seenIn: ["b"], cites: [{ file: "f", quote: "q" }] }]);
	assert.equal(merged.length, 1);
	assert.deepEqual([merged[0].name, merged[0].regNr, merged[0].address, merged[0].seenIn], ["SIA “KUUM”", "40103198971", "Rīga, ievadīts", ["a", "b"]]);
});

test("store: a shared library folder keeps dated backups and refuses while someone else holds the lock", () => {
	const dir = mkdtempSync(join(tmpdir(), "konk-store-"));
	const lib = join(dir, "lib");
	const st = new Store(join(dir, "app"), { available: () => false, encrypt: () => Buffer.alloc(0), decrypt: () => "" });
	st.saveSettings({ libraryDir: lib });
	const r = emptyRegisters();
	st.saveRegisters(r, "Boriss", new Date("2026-11-06T10:00:00Z"));
	r.objects.push({ id: "1", name: "X", fields: [], evidence: [] });
	st.saveRegisters(r, "Boriss", new Date("2026-11-06T10:01:00Z"));
	assert.equal(st.registers().objects.length, 1);
	assert.equal(readdirSync(join(lib, "backups")).length, 1);
	writeFileSync(join(lib, "registers.lock"), JSON.stringify({ who: "Inese", at: Date.now() }));
	assert.throws(() => st.saveRegisters(r, "Boriss"), /Inese/);
	assert.equal(JSON.parse(readFileSync(join(lib, "registers.json"), "utf8")).objects.length, 1);
	mkdirSync(join(dir, "x"));
});

// ---------- real data (read-only) ----------
test("real tracker: 2022–2026 sheets parse; 2026 carries the triage decisions", { skip: !haveB }, () => {
	const rows = parseTracker(readXlsx(join(B, "02_Iepirkumi_BD_jauns.xlsx")));
	const stats = Object.fromEntries(trackerStats(rows).map((s) => [s.sheet, s]));
	for (const y of ["2022", "2023", "2024", "2025", "2026"]) assert.ok(stats[y]?.rows > 80, y);
	assert.ok((stats["2026"].decided.liekam ?? 0) > 50);
	assert.ok((stats["2026"].decided["interesē_nav_pieredzes"] ?? 0) > 20);
	assert.ok(stats["2024"].won > 10 && stats["2024"].lost > 40);
	assert.ok(rows.some((r) => r.sheet === "2026" && r.builders.includes("KUUM")));
});

test("real subcontractor register: firms with their parts", { skip: !haveB }, () => {
	const subs = parseSubcontractors(readXlsx(join(B, "00_Specialistu un apaksuznemeju reg..xlsx"))[0]);
	assert.ok(subs.length > 50);
	const ardiko = subs.find((s) => /ARDIKO/.test(s.company))!;
	assert.ok(ardiko.parts.includes("UK") && ardiko.parts.includes("AVK"));
});

test("ORACLE: harvested library gives step 7 the same evidence files RNP Ulbroka actually submitted; nothing on B:\\ changes", { skip: !haveB, timeout: 600_000 }, async () => {
	const oracleDir = join(B, "261105_RNP_Ulbrokas sporta kompleksa gerbtuves", "IESNIEDZAMIE");
	const before = readdirSync(oracleDir).map((f) => f + ":" + readFileSync(join(oracleDir, f)).length).sort();
	const run = await harvest({ roots: [B, join(B, "07_IESNIEGTI")], objects: [] });
	assert.ok(run.proposals.filter((p) => p.uses >= 5).length >= 20, "at least 20 objects used in 5+ submissions");
	assert.ok(run.builders.filter((b) => /^\d{11}$/.test(b.regNr)).length >= 10, "at least 10 builders with a cited reg. Nr.");

	// the named evidence files of the real package
	const submitted = readdirSync(oracleDir).filter((f) => evidenceKind(f) && objectKey(f).words.length > 0);
	assert.ok(submitted.length >= 7, submitted.join(", "));
	// accept the proposals those files belong to, then plan step 7 for those objects
	const reg = emptyRegisters();
	reg.harvest = run;
	const chosen: string[] = [];
	for (const f of submitted) {
		const k = objectKey(f);
		const words = (key: string) => key.split(" #")[0].split(" ");
		const nums = (key: string) => (key.split(" #")[1] ?? "").split(",").filter(Boolean);
		// same rule as the clusterer: all words and all address numbers of the file are in the proposal key
		const p = run.proposals.find((x) => x.tenders.includes("261105_RNP_Ulbrokas sporta kompleksa gerbtuves") && k.words.every((w) => words(x.key).includes(w)) && k.nums.every((n) => nums(x.key).includes(n)));
		assert.ok(p, `no proposal for ${f}`);
		if (p.decision) continue;
		chosen.push(acceptAsNew(reg, p, p.label).id);
	}
	const choices = emptyChoices();
	choices.objects["company:0"] = chosen;
	const plan = planEvidence(choices, reg, undefined);
	const stem = (n: string) => keyString(objectKey(n)) + "|" + evidenceKind(n);
	const planned = new Set(plan.filter((x) => x.status === "ok").map((x) => stem(x.from)));
	const missing = submitted.filter((f) => !planned.has(stem(f)));
	assert.deepEqual(missing, [], "every submitted evidence file has a planned counterpart");
	const after = readdirSync(oracleDir).map((f) => f + ":" + readFileSync(join(oracleDir, f)).length).sort();
	assert.deepEqual(after, before);
});
