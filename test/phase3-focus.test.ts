import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { applySections, FOCUSED_INSTRUCTIONS } from "../src/main/fill/tasks.ts";
import { makeRetriever, queryOf, type RankedDoc } from "../src/main/fill/retrieve.ts";
import type { SheetItem } from "../src/shared/state.ts";

const item = (heading: string, instruction = ""): SheetItem => ({ slotId: "s:" + heading.length, kind: "section", label: heading.split("›").pop()!.trim(), heading, value: "", status: "missing", cites: [], by: null, instruction });

const noise = (n: number, word = "Cits") => Array.from({ length: n }, (_, i) => `${word} teikums numur ${i} par pavisam citu tēmu, kas aizņem vietu.`);

test("queryOf: heading words count more than instruction words; acronyms are kept; filler words are not", () => {
	const q = queryOf(item("A › Lāzerskanēšana un pārbaude", "Izpildītājam jāapraksta, kā dati tiks iesniegti E57 formātā."));
	assert.equal(q.get("lāzers"), 3, "heading word, 6-letter stem — survives the typo skanēšana/skenēšana");
	assert.equal(q.get("pārbau"), 3);
	assert.equal(q.get("e57"), 1);
	assert.equal(q.has("un"), false);
});

test("retrieve: the section's own heading in the document wins over the contents page and long table rows; the body under it is included", () => {
	const pip: RankedDoc = {
		file: "PIP.docx",
		weight: 1.6,
		text: [
			"SATURS",
			"9.2.\tGarantijas laiks\t45",
			...noise(400),
			"| 9 | Garantijas laiks | " + "garantijas laikā izpildītājs apsaimniekošanas programmnodrošinājums ".repeat(6) + " |",
			...noise(400),
			"Garantijas laiks",
			"Pasūtītājs plāno izmantot VDV, lai paziņotu par defektiem garantijas laikā.",
			"Būvuzņēmējam ir pienākums reaģēt uz reģistrētajiem jautājumiem.",
			...noise(300),
		].join("\n"),
	};
	const qa: RankedDoc = { file: "QA.docx", weight: 1, text: ["Jautājums par garantijas laiku.", "Atbilde: garantijas laiks ir 60 mēneši."].join("\n") };
	const r = makeRetriever([qa, pip])(item("APSAIMNIEKOŠANA › Garantijas laiks", "Izpildītājam jāapraksta, kā garantijas laikā tiks pārvaldīti jautājumi."));
	const text = r.docs.map((d) => d.text).join("\n");
	assert.match(text, /Pasūtītājs plāno izmantot VDV/, "the clause under the real heading");
	assert.match(text, /reaģēt uz reģistrētajiem/);
	assert.ok(r.docs.reduce((n, d) => n + d.text.length, 0) <= 18_000, "bounded input");
	assert.equal(r.docs[0].file, "PIP.docx", "the client's BIM requirements come before a Q&A letter");
});

test("retrieve: nothing about the topic → no documents (the caller says so instead of asking the model)", () => {
	const r = makeRetriever([{ file: "X.docx", text: noise(50).join("\n") }])(item("A › Lāzerskanēšana"));
	assert.deepEqual(r.docs, []);
});

test("retrieve: kept lines are verbatim, so a quote taken from a passage is still found in the whole document", () => {
	const full = ["Ievads", "Garantijas laiks", "Garantijas laiks ir 60 mēneši no pieņemšanas akta.", "Beigas"].join("\n");
	const r = makeRetriever([{ file: "PIP.docx", text: full }])(item("A › Garantijas laiks"));
	for (const l of r.docs[0].text.split("\n").filter((x) => x !== "[…]")) assert.ok(full.includes(l));
});

test("second-pass answer is accepted only with a quote found in the retrieved passages", () => {
	const docs = [{ file: "PIP.docx", text: "Garantijas laiks ir 60 mēneši." }];
	const sec = item("A › Garantijas laiks");
	const good = applySections([sec], { items: [{ id: sec.slotId, text: "Tiks nodrošināta atbilstība PIP prasībai par garantijas laiku.", sources: [{ quote: "Garantijas laiks ir 60 mēneši", file: "PIP.docx" }] }] }, docs);
	assert.equal(good.items[0].status, "source");
	const bad = applySections([sec], { items: [{ id: sec.slotId, text: "Garantija 10 gadi.", sources: [{ quote: "Garantija ir 10 gadi", file: "PIP.docx" }] }] }, docs);
	assert.equal(bad.items[0].status, "missing");
	assert.equal(bad.rejected, 1);
	assert.match(FOCUSED_INSTRUCTIONS, /FRAGMENTI/);
});

// ---------- the user's real project: the ten sections that stayed empty ----------
const OUT = "E:/BV BIM/Paraugmodeli/VUGD koledgza 2/IESNIEDZAMIE/.konkurss/";
/** First words of the PIP's own text under each heading (lines checked by hand in the PIP file). */
const SENTINEL: Record<string, string> = {
	"s:p167": "Izpildītājam (būvprojekta izstrādātājam/autoram) B",
	"s:p175": "Būvdarbu noslēgumā Izpildītājam jāveic objekta lāz",
	"s:p177": "Konstatējot neatbilstības starp skenējumu un model",
	"s:p179": "Visiem dokumentiem un datnēm, kas attiecas uz būvd",
	"s:p181": "Izpildītājam pieprasītā informācija Pasūtītājam ir",
	"s:p183": "Izpildītājam pieprasītā informācija Pasūtītājam ir",
	"s:p186": "Būvuzņēmējs savlaicīgi veic Lietotāju apmācību, ka",
	"s:p189": "Grafiskie modeļi, kas izveidoti projektēšanas un b",
	"s:p191": "Pasūtītājs plāno izmantot VDV, lai paziņotu par id",
	"s:p193": "Pasūtītājs plāno veikt ēkas darbības novērtēšanu p",
};
test("real VUGD 2 project: for each of the ten empty sections the model is given the PIP's own text under that heading, in about 5–14 thousand characters", { skip: !existsSync(OUT + "project.json"), timeout: 60_000 }, () => {
	const s = JSON.parse(readFileSync(OUT + "project.json", "utf8"));
	const sheet = Object.values(s.fills)[0] as { items: SheetItem[] };
	const id = (f: { root: string; rel: string }) => createHash("sha1").update(`${f.root}:${f.rel.toLowerCase()}`).digest("hex").slice(0, 16);
	const W: Record<string, number> = { pip: 1.6, paraugmodelu_prasibas: 1.3, tehniska_specifikacija: 1, pu: 1, grozijumi: 1, qa: 1 };
	const docs: (RankedDoc & { kind: string })[] = s.files
		.filter((f: { where: string; text: string; kind: string }) => f.where === "konkurss" && f.text === "ok" && f.kind in W)
		.map((f: { root: string; rel: string; kind: string }) => ({ file: f.rel, kind: f.kind, weight: W[f.kind], text: readFileSync(OUT + "text/" + id(f) + ".txt", "utf8") }));
	const pip = docs.find((d) => d.kind === "pip")!;
	const retrieve = makeRetriever(docs);
	let checked = 0;
	for (const [slot, first] of Object.entries(SENTINEL)) {
		const it = sheet.items.find((i) => i.slotId === slot);
		if (!it) continue; // this section was filled since
		const r = retrieve(it);
		const size = r.docs.reduce((n, d) => n + d.text.length, 0);
		assert.ok(size > 0 && size <= 18_000, `${it.heading}: ${size} chars`);
		assert.ok(r.docs.find((d) => d.file === pip.file)?.text.includes(first), `${it.heading}: the PIP text under the heading is in the input`);
		checked++;
	}
	console.log(`  ${checked} sections checked against the real PIP`);
});
