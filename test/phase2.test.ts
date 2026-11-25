import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dateInQuote, numberInQuote, timeInQuote } from "../src/main/tasks/grounding-extra.ts";
import * as T from "../src/main/tasks/phase2.ts";
import * as R from "../src/main/tasks/phase2-run.ts";
import { fileId, textPath } from "../src/main/extract.ts";
import { loadState, saveState } from "../src/main/project-state.ts";
import { emptyState, type FileEntry } from "../src/shared/state.ts";
import type { Engine, RunOptions } from "../src/main/engines/types.ts";
import type { Project } from "../src/shared/types.ts";

test("dateInQuote: numeric and Latvian-text dates, not other dates", () => {
	assert.ok(dateInQuote("Piedāvājumi jāiesniedz līdz 13.07.2026. plkst. 10:00", 2026, 7, 13));
	assert.ok(dateInQuote("līdz 2026. gada 13. jūlijam", 2026, 7, 13));
	assert.ok(dateInQuote("2026-07-13", 2026, 7, 13));
	assert.equal(dateInQuote("līdz 14.07.2026", 2026, 7, 13), false);
	assert.equal(dateInQuote("113.07.2026", 2026, 7, 13), false);
});

test("timeInQuote", () => {
	assert.ok(timeInQuote("plkst. 10:00", 10, 0));
	assert.ok(timeInQuote("pulksten 10.00", 10, 0));
	assert.equal(timeInQuote("plkst. 11:00", 10, 0), false);
});

test("numberInQuote: thousands separators, decimals, whole-number match only", () => {
	assert.ok(numberInQuote(10000, "vismaz 10 000 euro"));
	assert.ok(numberInQuote(10000, "10000 EUR"));
	assert.ok(numberInQuote(65, "| Piedāvājuma cena | 65 | lētākais |"));
	assert.ok(numberInQuote(65, "65,00 punkti"));
	assert.equal(numberInQuote(5, "kopā 65 punkti"), false);
	assert.equal(numberInQuote(30, "300 m2"), false);
});

const nol = { file: "nolikums.docx", text: "| 3. | Kritērijs | 65 | lētākais cena\n| 4. | BPV pieredze | 30 | 3 objekti\nTermiņš 13.07.2026 plkst. 10:00\n2.2. atbildīgais būvprojekta vadītājs; elektroietaišu projektētājs" };

test("deadline: grounded only when date and time are really in the quote", () => {
	const d = T.groundDeadline(
		{ date: { value: "13.07.2026", quote: "Termiņš 13.07.2026 plkst. 10:00", file: "nolikums.docx" }, time: { value: "10:00", quote: "Termiņš 13.07.2026 plkst. 10:00", file: "nolikums.docx" }, source: "nolikums" },
		[nol],
	);
	assert.equal(d.date.status, "model");
	assert.equal(d.time.value, "10:00");
	assert.equal(d.source, "nolikums");
	const wrong = T.groundDeadline(
		{ date: { value: "15.07.2026", quote: "Termiņš 13.07.2026 plkst. 10:00", file: "nolikums.docx" }, time: { value: null, quote: null, file: null }, source: "iub" },
		[nol],
	);
	assert.equal(wrong.date.value, null, "a date that is not in its quote is refused");
	assert.equal(wrong.source, null);
});

test("deadline: no date in the documents → 'nav atrasts', not a guess", () => {
	const d = T.groundDeadline({ date: { value: null, quote: null, file: null }, time: { value: null, quote: null, file: null }, source: null }, [nol]);
	assert.equal(d.date.status, "missing");
	assert.match(d.date.note ?? "", /nav atrasts/);
});

test("criteria: points count only when the number is in the quote; rows with invented quotes are rejected", () => {
	const g = T.groundVertesana(
		{
			items: [
				{ name: "Piedāvājuma cena", points: 65, formula: "lētākais = 65", objectsNeeded: null, quote: "| 3. | Kritērijs | 65 | lētākais cena", file: "nolikums.docx" },
				{ name: "BPV pieredze", points: 99, formula: null, objectsNeeded: 3, quote: "| 4. | BPV pieredze | 30 | 3 objekti", file: "nolikums.docx" },
				{ name: "Izdomāts", points: 5, formula: null, objectsNeeded: null, quote: "šāda kritērija dokumentā nav nekur", file: "nolikums.docx" },
			],
		},
		[nol],
	);
	assert.equal(g.rejected, 1);
	assert.equal(g.items[0].points.value, 65);
	assert.equal(g.items[1].points.value, null, "99 is not in the quote");
	assert.match(g.items[1].points.note ?? "", /skaitlis nav citātā/);
	const s = T.criteriaSum(g.items);
	assert.deepEqual(s, { sum: 65, complete: false });
});

test("criteriaSum: complete and 100", () => {
	const mk = (n: number) => ({ name: { value: "k", status: "manual" as const }, points: { value: n, status: "manual" as const }, formula: { value: null, status: "missing" as const }, objectsNeeded: null });
	assert.deepEqual(T.criteriaSum([mk(65), mk(30), mk(5)]), { sum: 100, complete: true });
	assert.equal(T.criteriaSum([]).complete, false);
});

test("mergeCriteria: second reading with a different number marks a conflict; matching rows stay clean", () => {
	const row = (name: string, pts: number) => ({ name: { value: name, status: "model" as const }, points: { value: pts, status: "model" as const, cite: { file: "f", quote: "q" } }, formula: { value: null, status: "missing" as const }, objectsNeeded: null });
	const m = T.mergeCriteria([row("Cena", 65), row("BPV pieredze", 30)], [row("Cena", 65), row("BPV pieredze", 35)]);
	assert.equal(m[0].points.conflict, undefined);
	assert.equal(m[1].points.conflict?.value, 35);
	const missingOne = T.mergeCriteria([row("Cena", 65), row("Papildu", 5)], [row("Cena", 65)]);
	assert.ok(missingOne[1].name.conflict, "a criterion the second reading did not find is flagged");
});

test("Q&A grounding: question must be a real quote; answer kept only if verified", () => {
	const doc = { file: "atbilde.edoc", text: "Jautājums Nr.1: Vai fasādes siltināšana paredzēta visai ēkai?\nAtbilde: Fasādes siltināšana paredzēta visai ēkai." };
	const g = T.groundQa(
		{
			items: [
				{ nr: "1", question_quote: "Vai fasādes siltināšana paredzēta visai ēkai?", answer_quote: "Fasādes siltināšana paredzēta visai ēkai.", file: "atbilde.edoc", impact: "maina_apjomu" },
				{ nr: "2", question_quote: "Jautājums, kura dokumentā nav", answer_quote: "x", file: "atbilde.edoc", impact: "skaidro" },
				{ nr: "3", question_quote: "Vai fasādes siltināšana paredzēta visai ēkai?", answer_quote: "izdomāta atbilde, kas nav tekstā", file: "atbilde.edoc", impact: "skaidro" },
			],
		},
		[doc],
	);
	assert.equal(g.rejected, 1);
	assert.equal(g.items.length, 2);
	assert.equal(g.items[0].answer, "Fasādes siltināšana paredzēta visai ēkai.");
	assert.equal(g.items[1].answer, "", "an unverifiable answer is dropped, not shown");
});

test("classification never overwrites a person's confirmed choice", () => {
	const changes = [
		{ before: "a", after: "b", impact: "prasiba" as const, impactBy: "manual" as const, confirmed: true },
		{ before: "c", after: "d", impact: null, impactBy: null, confirmed: false },
	];
	const out = T.applyClassification(changes, { items: [{ i: 1, impact: "redakcionala" }, { i: 2, impact: "kriterijs" }] });
	assert.equal(out[0].impact, "prasiba");
	assert.equal(out[1].impact, "kriterijs");
	assert.equal(out[1].impactBy, "model");
	assert.equal(out[1].confirmed, false, "model proposals still need a person's confirmation");
});

// ---------- runners with a fake engine on a temp project ----------
const tmp = mkdtempSync(join(tmpdir(), "konkurss-p2-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

function makeProject(name: string, files: { rel: string; kind: FileEntry["kind"]; text: string }[]) {
	const out = join(tmp, name, "IESNIEDZAMIE");
	const project: Project = { id: name, name, sourceDir: join(tmp, name, "KONKURSS"), outputDir: out, variant: null, builders: [], createdAt: "" };
	const s = emptyState();
	for (const f of files) {
		const entry: FileEntry = { rel: f.rel, root: "source", where: "konkurss", kind: f.kind, kindSetByUser: false, size: 1, mtimeMs: 1, text: "ok", textChars: f.text.length };
		s.files.push(entry);
		const tp = textPath(project, entry);
		mkdirSync(join(tp, ".."), { recursive: true });
		writeFileSync(tp, f.text, "utf8");
	}
	s.scannedAt = s.extractedAt = "t";
	saveState(out, s);
	return project;
}

const base = { runDir: "", pluginDir: "", mcp: { command: "node", args: [], env: {} }, signal: new AbortController().signal };
function fake(replies: string[]): Engine & { prompts: string[] } {
	let i = 0;
	const prompts: string[] = [];
	return {
		id: "claude",
		prompts,
		status: async () => ({ id: "claude", ready: true, reason: "", canLogin: false }),
		async run(o: RunOptions) {
			prompts.push(o.prompt);
			const text = replies[Math.min(i++, replies.length - 1)];
			o.onEvent({ type: "text", text });
			o.onEvent({ type: "done", text });
		},
	};
}

const NOL1 = "Nolikums\n| 2.2. | Speciālisti: atbildīgais būvprojekta vadītājs; elektroietaišu projektētājs |\nPunkti: cena 65";
const NOL2 = "Nolikums GROZĪTS\n| 2.2. | Speciālisti: atbildīgais būvprojekta vadītājs; elektroietaišu projektētājs; elektronisko sakaru projektētājs |\nPunkti: cena 65";

test("two nolikums editions and no choice → asks which is in force; nothing is read", async () => {
	const p = makeProject("ed", [{ rel: "nolikums_1.docx", kind: "nolikums", text: NOL1 }, { rel: "nolikums_groz.docx", kind: "grozijumi", text: NOL2 }]);
	const e = fake(["{}"]);
	const r = await R.readBlock(p, e, base, "specialisti");
	assert.equal(r.ok, false);
	if (!r.ok) assert.match(r.error, /izvēlies, kura ir spēkā/);
	assert.equal(e.prompts.length, 0, "the model was not called");
});

test("guessEditions pre-selects the 'groz' file as amended", () => {
	const s = loadState(join(tmp, "ed", "IESNIEDZAMIE"));
	const g = R.guessEditions(s.files);
	assert.equal(g.amended, "source:nolikums_groz.docx");
	assert.equal(g.original, "source:nolikums_1.docx");
});

test("diff + in-force + block reading uses ONLY the edition in force; quotes are grounded; state commits once", async () => {
	const p = makeProject("ed2", [{ rel: "nolikums_1.docx", kind: "nolikums", text: NOL1 }, { rel: "nolikums_groz.docx", kind: "grozijumi", text: NOL2 }]);
	R.setEditions(p, "source:nolikums_1.docx", "source:nolikums_groz.docx");
	const d = R.diffEditions(p);
	assert.ok(d.ok && d.changes >= 1, "adjacent changed lines are one change");
	R.setInForce(p, "amended");
	const reply = JSON.stringify({
		items: [
			{ field: "Atbildīgais būvprojekta vadītājs", certificate: "arhitekta prakse", mandatory: true, quote: "atbildīgais būvprojekta vadītājs; elektroietaišu projektētājs; elektronisko sakaru projektētājs", file: "nolikums_groz.docx" },
			{ field: "Izdomāta joma", certificate: null, mandatory: true, quote: "tāda teikuma nolikumā nav", file: "nolikums_groz.docx" },
		],
	});
	const e = fake([reply]);
	const r = await R.readBlock(p, e, base, "specialisti");
	assert.ok(r.ok);
	if (!r.ok) return;
	assert.match(e.prompts[0], /nolikums_groz\.docx/);
	assert.doesNotMatch(e.prompts[0], /=== DOKUMENTS: nolikums_1\.docx/, "the old edition is not shown to the model");
	assert.equal(r.rejected, 1);
	assert.equal(r.patch.specialisti?.length, 1);
	assert.equal(loadState(p.outputDir).requirements.specialisti.length, 0, "nothing committed yet");
	R.storeBlock(p, "specialisti", r.patch);
	const st = loadState(p.outputDir);
	assert.equal(st.requirements.specialisti[0].field.cite?.file, "nolikums_groz.docx");
	assert.ok(st.requirements.readAt.specialisti);
	assert.equal(st.requirements.confirmed.specialisti, false);
});

test("re-reading a block clears the person's earlier confirmation", () => {
	const p = makeProject("conf", [{ rel: "nolikums.docx", kind: "nolikums", text: NOL1 }]);
	R.confirmBlock(p, "vertesana", true);
	assert.equal(loadState(p.outputDir).requirements.confirmed.vertesana, true);
	R.storeBlock(p, "vertesana", { vertesana: [] });
	assert.equal(loadState(p.outputDir).requirements.confirmed.vertesana, false);
});

test("a provider error leaves the project file byte-for-byte unchanged", async () => {
	const p = makeProject("err", [{ rel: "nolikums.docx", kind: "nolikums", text: NOL1 }]);
	const before = JSON.stringify(loadState(p.outputDir));
	const failing: Engine = { ...fake([]), async run(o) { o.onEvent({ type: "error", engine: "claude", message: "API error (status 529): overloaded" }); } };
	const r = await R.readBlock(p, failing, base, "dokumenti");
	assert.equal(r.ok, false);
	if (!r.ok) assert.equal(r.error, "API error (status 529): overloaded");
	assert.equal(JSON.stringify(loadState(p.outputDir)), before);
});

test("a manually entered deadline is never overwritten by a model reading", () => {
	const p = makeProject("dl", [{ rel: "nolikums.docx", kind: "nolikums", text: NOL1 }]);
	R.setManualDeadline(p, "13.07.2026", "10:00", "iub");
	R.storeDeadline(p, { date: { value: "20.07.2026", status: "model", cite: { file: "x", quote: "y" } }, time: { value: null, status: "missing" }, source: "nolikums" });
	const d = loadState(p.outputDir).deadline;
	assert.equal(d.date.value, "13.07.2026");
	assert.equal(d.date.status, "manual");
});

test("second pass: disagreement becomes a visible conflict, agreement stays clean", async () => {
	const p = makeProject("sp", [{ rel: "nolikums.docx", kind: "nolikums", text: "Termiņš 13.07.2026 plkst. 10:00\n| Cena | 65 |\n| BPV | 30 |\napakšuzņēmēji no 10 000 euro" }]);
	R.storeDeadline(p, { date: { value: "13.07.2026", status: "model", cite: { file: "nolikums.docx", quote: "Termiņš 13.07.2026 plkst. 10:00" } }, time: { value: "10:00", status: "model", cite: { file: "nolikums.docx", quote: "Termiņš 13.07.2026 plkst. 10:00" } }, source: "nolikums" });
	R.storeBlock(p, "vertesana", { vertesana: T.groundVertesana({ items: [{ name: "Cena", points: 65, formula: null, objectsNeeded: null, quote: "| Cena | 65 |", file: "nolikums.docx" }, { name: "BPV", points: 30, formula: null, objectsNeeded: 3, quote: "| BPV | 30 |", file: "nolikums.docx" }] }, [{ file: "nolikums.docx", text: "| Cena | 65 |\n| BPV | 30 |" }]).items });
	R.storeBlock(p, "apaksuznemeji", { apaksuznemeji: T.groundApaks({ threshold: { value: 10000, quote: "apakšuzņēmēji no 10 000 euro", file: "nolikums.docx" } }, [{ file: "nolikums.docx", text: "apakšuzņēmēji no 10 000 euro" }]) });
	const second = [
		JSON.stringify({ date: { value: "13.07.2026", quote: "Termiņš 13.07.2026 plkst. 10:00", file: "nolikums.docx" }, time: { value: "10:00", quote: "Termiņš 13.07.2026 plkst. 10:00", file: "nolikums.docx" }, source: "nolikums" }),
		JSON.stringify({ items: [{ name: "Cena", points: 65, formula: null, objectsNeeded: null, quote: "| Cena | 65 |", file: "nolikums.docx" }, { name: "BPV", points: 30, formula: null, objectsNeeded: 3, quote: "| BPV | 30 |", file: "nolikums.docx" }] }),
		JSON.stringify({ threshold: { value: 10000, quote: "apakšuzņēmēji no 10 000 euro", file: "nolikums.docx" } }),
	];
	const r = await R.secondPass(p, fake(second), base);
	assert.ok(r.ok);
	if (r.ok) assert.equal(r.conflicts, 0);
	const st = loadState(p.outputDir);
	assert.equal(st.requirements.apaksuznemeji.threshold.value, 10000);
	assert.equal(st.requirements.apaksuznemeji.threshold.status, "model");

	// now a second reading that disagrees on the deadline
	const bad = [
		JSON.stringify({ date: { value: "14.07.2026", quote: "Termiņš 13.07.2026 plkst. 10:00", file: "nolikums.docx" }, time: { value: "10:00", quote: "Termiņš 13.07.2026 plkst. 10:00", file: "nolikums.docx" }, source: "nolikums" }),
		second[1],
		second[2],
	];
	// the 14.07 date is not in its quote → grounding turns it into 'missing' → first reading stays, no false conflict
	const r2 = await R.secondPass(p, fake(bad), base);
	assert.ok(r2.ok);
	const truth = [
		JSON.stringify({ date: { value: "14.07.2026", quote: "Termiņš pagarināts līdz 14.07.2026", file: "nolikums.docx" }, time: { value: "10:00", quote: "Termiņš 13.07.2026 plkst. 10:00", file: "nolikums.docx" }, source: "nolikums" }),
		second[1],
		second[2],
	];
	// make the quote real in the document
	const f = loadState(p.outputDir).files[0];
	writeFileSync(textPath(p, f), "Termiņš 13.07.2026 plkst. 10:00\nTermiņš pagarināts līdz 14.07.2026\n| Cena | 65 |\n| BPV | 30 |\napakšuzņēmēji no 10 000 euro");
	const r3 = await R.secondPass(p, fake(truth), base);
	assert.ok(r3.ok);
	if (r3.ok) assert.equal(r3.conflicts, 1);
	const d = loadState(p.outputDir).deadline.date;
	assert.equal(d.value, "13.07.2026", "the first reading is kept");
	assert.equal(d.conflict?.value, "14.07.2026", "the other reading is shown, not silently chosen");
});

test("compareForms uses the edition in force and stores the result", () => {
	const form = "| Speciālists | Vārds |\n| Atbildīgais BPV |  |\n| Elektro |  |\n";
	const emb = "| Speciālists | Vārds |\n| Atbildīgais BPV |  |\n| Elektro |  |\n| Sakaru projektētājs |  |\n";
	const p = makeProject("cf", [{ rel: "nolikums.docx", kind: "nolikums", text: emb }, { rel: "Kvalifikacija.docx", kind: "kvalifikacija", text: form }]);
	const r = R.compareForms(p);
	assert.ok(r.ok && r.differing === 1);
	const st = loadState(p.outputDir);
	assert.ok(st.versions.templatesComparedAt);
	assert.deepEqual(st.versions.templates[0].missingLabels, ["Sakaru projektētājs"]);
});

test("fileId is stable and distinguishes roots", () => {
	assert.equal(fileId({ root: "source", rel: "A.docx" }), fileId({ root: "source", rel: "a.docx" }));
	assert.notEqual(fileId({ root: "source", rel: "a.docx" }), fileId({ root: "output", rel: "a.docx" }));
});

test("classify prompt shows the words that changed in a long table row, not just its start", () => {
	const head = "| 3. | Atbildīgā projektētāja pieredze energoefektīvu projektu izstrādē; " + "Pieredze apliecināma iepriekšējo 5 gadu laikā, ".repeat(12);
	const before = `${head}par pabeigtu projektu izmērīto energoefektivitāti | 5 |`;
	const after = `${head}par pabeigtu projektu aprēķinātajiem vai izmērītajiem energoefektivitātes rādītājiem | 5 |`;
	const prompt = T.classifyPrompt([{ before, after }]);
	assert.match(prompt, /izmērīto energoefektivitāti/);
	assert.match(prompt, /aprēķinātajiem vai izmērītajiem/);
	assert.ok(prompt.length < before.length + after.length, "shorter than the two full rows");
});

test("numberInQuote: table cells separated by spaces are separate numbers; thousands still work", () => {
  assert.ok(numberInQuote(200, "| AR | 200 | 200 | 300 | 300 | 400 | 400 | 400 |"));
  assert.ok(numberInQuote(300, "| AR | 200 | 200 | 300 | 300 |"));
  assert.equal(numberInQuote(250, "| AR | 200 | 200 | 300 |"), false);
  assert.ok(numberInQuote(10000, "no 10 000 euro"));
  assert.equal(numberInQuote(200300, "200 200 300"), false);
});

test("key blocks: site visit, security, term, price form, technical parts and statements are grounded in a quote", () => {
	const docs = [{ file: "nolikums.docx", text: "Objekta apsekošana nav obligāta. Piedāvājuma nodrošinājums 1000 EUR. Izpildes termiņš 90 dienas. Finanšu piedāvājums Excel tāmē. Jāiesniedz laika grafiks. Apliecinājums par speciālistiem." }];
	const c = (value: string, quote: string) => ({ value, quote, file: "nolikums.docx" });
	const none = { value: null, quote: null, file: null };
	assert.equal(T.groundApsekosana({ status: c("Nav obligāta", "Objekta apsekošana nav obligāta."), details: none }, docs).status.status, "model");
	assert.equal(T.groundNodrosinajums({ offer: c("1000 EUR", "Piedāvājuma nodrošinājums 1000 EUR."), contract: none }, docs).contract.value, null);
	assert.equal(T.groundIzpilde({ term: c("90 dienas", "Izpildes termiņš 90 dienas.") }, docs).term.value, "90 dienas");
	assert.equal(T.groundFinanses({ form: c("Excel tāme", "Finanšu piedāvājums Excel tāmē."), notes: none }, docs).form.value, "Excel tāme");
	const list = T.groundDocList({ items: [{ name: "Laika grafiks", mandatory: true, condition: null, quote: "Jāiesniedz laika grafiks.", file: "nolikums.docx" }, { name: "Izdomāts", mandatory: true, condition: null, quote: "šāda teikuma nav", file: "nolikums.docx" }] }, docs);
	assert.equal(list.items.length, 1);
	assert.equal(list.rejected, 1);
});
