import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { applySections, focusedDocs, FOCUSED_INSTRUCTIONS, topicStems } from "../src/main/fill/tasks.ts";
import { excerpt } from "../src/main/tasks/docs.ts";
import type { SheetItem } from "../src/shared/state.ts";

const item = (heading: string): SheetItem => ({ slotId: "s:" + heading.length, kind: "section", label: heading.split("›").pop()!.trim(), heading, value: "", status: "missing", cites: [], by: null });

test("topicStems: the two longest words of the section's own heading, 8-letter stems", () => {
	assert.deepEqual(topicStems(item("APSAIMNIEKOŠANA › Garantijas laiks")), ["garantij"]);
	assert.deepEqual(topicStems(item("BIM modeļu nodošana ekspluatācijai › Lāzerskanēšana un pārbaude")), ["lāzerska", "pārbaude"]);
	assert.deepEqual(topicStems(item("X › Īss")), []);
});

test("focusedDocs: only passages about the topic; documents with nothing on it are dropped; no topic words → everything stays", () => {
	const pip = { file: "PIP.docx", text: ["Ievads", "x", "x", "Garantijas laikā izpildītājs novērš defektus.", "Garantijas laiks ir 60 mēneši.", "x", "x", "x", "Cita tēma"].join("\n") };
	const other = { file: "TS.docx", text: "Nekas par šo tēmu" };
	const out = focusedDocs([item("A › Garantijas laiks")], [pip, other], (d, re) => excerpt(d, re, { head: 0, ctx: 1, maxChars: 5000 }));
	assert.deepEqual(out.map((d) => d.file), ["PIP.docx"]);
	assert.match(out[0].text, /Garantijas laiks ir 60 mēneši/);
	assert.doesNotMatch(out[0].text, /Ievads/);
	assert.equal(focusedDocs([item("X › Īss")], [pip, other], (d) => d).length, 2);
});

test("second-pass answer is accepted only with a quote found in the focused passages", () => {
	const docs = [{ file: "PIP.docx", text: "Garantijas laiks ir 60 mēneši." }];
	const sec = item("A › Garantijas laiks");
	const good = applySections([sec], { items: [{ id: sec.slotId, text: "Tiks nodrošināta atbilstība PIP prasībai par garantijas laiku.", sources: [{ quote: "Garantijas laiks ir 60 mēneši", file: "PIP.docx" }] }] }, docs);
	assert.equal(good.items[0].status, "source");
	const bad = applySections([sec], { items: [{ id: sec.slotId, text: "Garantija 10 gadi.", sources: [{ quote: "Garantija ir 10 gadi", file: "PIP.docx" }] }] }, docs);
	assert.equal(bad.items[0].status, "missing");
	assert.equal(bad.rejected, 1);
	assert.match(FOCUSED_INSTRUCTIONS, /FRAGMENTI/);
});

// ---------- the user's real project: the ten sections that stayed empty do have their text in the PIP ----------
const OUT = "E:/BV BIM/Paraugmodeli/VUGD koledgza 2/IESNIEDZAMIE/.konkurss/";
test("real VUGD 2 project: for every section still empty, the PIP holds passages about its topic and the focused input is small", { skip: !existsSync(OUT + "project.json") }, () => {
	const s = JSON.parse(readFileSync(OUT + "project.json", "utf8"));
	const sheet = Object.values(s.fills)[0] as { items: SheetItem[] };
	const empty = sheet.items.filter((i) => i.kind === "section" && !i.value && i.by === null);
	const id = (f: { root: string; rel: string }) => createHash("sha1").update(`${f.root}:${f.rel.toLowerCase()}`).digest("hex").slice(0, 16);
	const pipFile = s.files.find((f: { kind: string; where: string }) => f.kind === "pip" && f.where === "konkurss");
	const pip = { file: "PIP", text: readFileSync(OUT + "text/" + id(pipFile) + ".txt", "utf8") };
	let covered = 0;
	for (const it of empty) {
		const docs = focusedDocs([it], [pip], (d, re) => excerpt(d, re, { head: 0, ctx: 10, maxChars: 20_000 }));
		const size = docs.reduce((n, d) => n + d.text.length, 0);
		if (size > 0) covered++;
		assert.ok(size < 25_000, `${it.heading}: ${size} chars`);
	}
	console.log(`  ${covered} of ${empty.length} empty sections have PIP passages (input ≤ 20 000 chars each)`);
	assert.equal(covered, empty.length, "every empty section has something to read in the PIP");
});
