import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { inspectDocx, toolsConfig, type Inspected } from "../src/main/pytools.ts";
import { fillableSlots, templateSlots } from "../src/main/templates/slots.ts";

const mk = (over: Partial<Inspected>): Inspected => ({ ok: true, paragraphs: [], tables: [], skeleton: "x", ...over });
const p = (i: number, text: string, heading = 0, italic = 0) => ({ i, text, style: heading ? `Heading ${heading}` : "Normal", heading, italic });

test("label table: empty cell next to a label becomes a slot named after the label", () => {
	const slots = templateSlots(mk({ tables: [{ t: 0, rows: 2, cols: 2, cells: [["Projekta nosaukums:", ""], ["Datums:", "2026-07-01"]] }] }));
	assert.equal(slots.length, 1);
	assert.deepEqual(slots[0], { id: "c:t0:r0:c1", kind: "cell", t: 0, r: 0, c: 1, label: "Projekta nosaukums", heading: "", shape: "label" });
});

test("row table: header row names the columns, empty body cells are slots, filled cells are not", () => {
	const slots = templateSlots(mk({ tables: [{ t: 1, rows: 3, cols: 4, cells: [["Loma", "Būvprojekta daļa", "Uzņēmums", "Vārds Uzvārds"], ["BIM koordinators", "", "", ""], ["", "", "", ""]] }] }));
	const labels = slots.map((s) => (s.kind === "cell" ? s.label : ""));
	assert.ok(labels.includes("Būvprojekta daļa (1. rinda)"));
	assert.ok(!labels.some((l) => l.startsWith("Loma (1.")), "already-filled cell is not a slot");
	assert.ok(labels.includes("Loma (2. rinda)"));
	assert.equal(slots.length, 3 + 4);
});

test("italic instruction paragraphs become section slots under their heading path; consecutive ones are one slot", () => {
	const slots = templateSlots(
		mk({
			paragraphs: [
				p(0, "IEVADS", 1),
				p(1, "Slīprakstā norādītā informācija ir jāizdzēš un jānomaina ar Izpildītāja reālo piedāvājumu.", 0, 1),
				p(2, "Informācijas pārvaldība", 1),
				p(3, "Vienotā datu vide (VDV)", 2),
				p(4, "Izpildītājam jāapraksta, kā tiks organizēta informācijas apmaiņa projekta ietvaros.", 0, 1),
				p(5, "", 0, 0),
				p(6, "Izpildītājam jānorāda, kādi statusi tiks lietoti informācijas aprites ciklā.", 0, 1),
				p(7, "Cits virsraksts", 2),
				p(8, "Īss slīpraksts", 0, 1),
			],
		}),
	);
	assert.equal(slots.length, 2, "short italic text (<40 chars) is not an instruction");
	assert.equal(slots[0].kind, "delete");
	const s = slots[1];
	assert.equal(s.kind, "section");
	if (s.kind === "section") {
		assert.deepEqual(s.paragraphs, [4, 6]);
		assert.equal(s.heading, "Informācijas pārvaldība › Vienotā datu vide (VDV)");
		assert.equal(s.label, "Vienotā datu vide (VDV)");
	}
	assert.equal(fillableSlots(slots).length, 1);
});

test("a table with no sensible header row yields no slots", () => {
	assert.deepEqual(templateSlots(mk({ tables: [{ t: 0, rows: 2, cols: 3, cells: [["", "", ""], ["", "", ""]] }] })), []);
});

const TPL = "E:\\BV BIM\\Paraugmodeli\\260811_NVA_Remonta baze\\KONKURSS\\5.pielikums_Pirms_liguma_BIP.docx";
test("real NVA BIP template: project-info cells, role/software rows and ~25 instruction sections are found", { skip: !existsSync(TPL), timeout: 120_000 }, async () => {
	const info = await inspectDocx(toolsConfig(process.env, join(import.meta.dirname, "..", "python", "konkurss_tools.py")), TPL);
	const slots = templateSlots(info);
	const cells = slots.filter((s) => s.kind === "cell");
	const sections = slots.filter((s) => s.kind === "section");
	console.log(`  ${cells.length} cell slots, ${sections.length} section slots, ${slots.filter((s) => s.kind === "delete").length} delete`);
	assert.ok(cells.some((s) => s.kind === "cell" && s.label === "Projekta nosaukums"));
	assert.ok(cells.some((s) => s.kind === "cell" && /Programmatūra/.test(s.label)));
	assert.ok(sections.length >= 20, `found ${sections.length} sections`);
	assert.ok(sections.some((s) => /Vienotā datu vide/.test(s.heading)));
	assert.equal(slots.filter((s) => s.kind === "delete").length, 1);
	assert.equal(new Set(slots.map((s) => s.id)).size, slots.length, "slot ids are unique");
});

test("cell slots know the heading above their table, so design-phase and build-phase role tables can be told apart", { skip: !existsSync(TPL), timeout: 120_000 }, async () => {
	const info = await inspectDocx(toolsConfig(process.env, join(import.meta.dirname, "..", "python", "konkurss_tools.py")), TPL);
	const roleTables = info.tables.filter((t) => t.cells[0]?.[0] === "Loma");
	assert.equal(roleTables.length, 2);
	const slots = templateSlots(info);
	const headingOf = (t: number) => (slots.find((s) => s.kind === "cell" && s.t === t) as { heading: string }).heading;
	const [a, b] = roleTables.map((t) => headingOf(t.t));
	console.log(`  role table headings: "${a}" / "${b}"`);
	assert.notEqual(a, b);
	assert.match(a, /PROJEKT/i);
	assert.match(b, /B[ŪU]VDARB/i);
});
