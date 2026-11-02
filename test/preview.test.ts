import { test } from "node:test";
import { join } from "node:path";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { buildPreview } from "../src/main/fill/preview.ts";
import { newSheet } from "../src/main/fill/sheet.ts";
import { inspectDocx, toolsConfig } from "../src/main/pytools.ts";
import type { Inspected } from "../src/main/pytools.ts";

const p = (i: number, text: string, extra: Partial<Inspected["paragraphs"][number]> = {}) => ({ i, text, style: "Normal", heading: 0, italic: 0, ...extra });
const INSTR = "Izpildītājam jāapraksta, kā tiks nodrošināta garantijas laika apkalpošana un kā tiks pārvaldīti saistītie jautājumi.";

const info: Inspected = {
	ok: true,
	skeleton: "x",
	paragraphs: [p(0, "BIM izpildes plāns", { heading: 1 }), p(1, ""), p(2, "Garantijas laiks", { heading: 2 }), p(3, INSTR, { italic: 1 }), p(4, INSTR + " Otrā rindkopa.", { italic: 1 }), p(5, "Noslēgums")],
	tables: [{ t: 0, rows: 2, cols: 2, cells: [["Projekta nosaukums:", ""], ["Pasūtītājs:", ""]], after_p: 0 }],
};

test("preview: document order, headings, a section's instruction paragraphs become one field, tables sit after their paragraph, blanks are dropped", () => {
	const sheet = newSheet("k", info);
	const blocks = buildPreview(info, sheet);
	assert.deepEqual(
		blocks.map((b) => (b.kind === "text" ? `text:${b.level}:${b.text}` : b.kind === "slot" ? `slot:${b.slotId}` : `table:${b.t}`)),
		["text:1:BIM izpildes plāns", "table:0", "text:2:Garantijas laiks", "slot:s:p3", "text:0:Noslēgums"],
	);
	const t = blocks.find((b) => b.kind === "table")!;
	assert.ok(t.kind === "table");
	if (t.kind === "table") {
		assert.deepEqual(t.rows[0].map((c) => c.slotId ?? null), [null, "c:t0:r0:c1"], "the empty cell is a field, the label is the template's own text");
		assert.equal(t.rows[1][0].text, "Pasūtītājs:");
	}
});

test("preview: rows added to a table by the roles fill are shown, and the delete-this-note paragraph is not", () => {
	const sheet = newSheet("k", info);
	sheet.items.push({ slotId: "c:t0:r3:c1", kind: "cell", label: "x", heading: "", t: 0, r: 3, c: 1, value: "v", status: "source", cites: [], by: "code" });
	sheet.items.push({ slotId: "d:p1", kind: "delete", label: "n", heading: "", paragraphs: [5], value: "", status: "na", cites: [], by: null });
	const blocks = buildPreview(info, sheet);
	const t = blocks.find((b) => b.kind === "table");
	assert.ok(t && t.kind === "table" && t.rows.length === 4);
	assert.ok(!blocks.some((b) => b.kind === "text" && b.text === "Noslēgums"), "hidden paragraph is not drawn");
});

// ---------- the real NVA BIP template ----------
const TPL = "E:/BV BIM/Paraugmodeli/260811_NVA_Remonta baze/KONKURSS/5.pielikums_Pirms_liguma_BIP.docx";
test("preview: the real BIP template draws every section field exactly once, in document order", { skip: !existsSync(TPL), timeout: 120_000 }, async () => {
	const real = await inspectDocx(toolsConfig(process.env, join(import.meta.dirname, "..", "python", "konkurss_tools.py")), TPL);
	const sheet = newSheet("k", real);
	const blocks = buildPreview(real, sheet);
	const slots = blocks.filter((b) => b.kind === "slot").map((b) => (b.kind === "slot" ? b.slotId : ""));
	const sections = sheet.items.filter((i) => i.kind === "section").map((i) => i.slotId);
	assert.deepEqual(slots, sections);
	const cells = blocks.flatMap((b) => (b.kind === "table" ? b.rows.flat().filter((c) => c.slotId).map((c) => c.slotId) : []));
	assert.equal(new Set(cells).size, sheet.items.filter((i) => i.kind === "cell").length, "every cell field is in a table");
});
