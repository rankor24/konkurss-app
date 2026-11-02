import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import type { PreviewBlock } from "../src/shared/preview.ts";
import type { SheetItem } from "../src/shared/state.ts";

(globalThis as { window?: unknown }).window = { konkurss: { invoke: async () => ({ engineForTasks: "claude", models: {}, hasClaudeKey: false }), on: () => () => {} } };

const item = (slotId: string, over: Partial<SheetItem>): SheetItem => ({ slotId, kind: "section", label: slotId, heading: "", value: "", status: "missing", cites: [], by: null, ...over });

const items = new Map<string, SheetItem>([
	["s:p10", item("s:p10", { instruction: "Izpildītājam jāapraksta, kā garantijas laikā tiks pārvaldīti jautājumi." })],
	["s:p20", item("s:p20", { value: "Tiks nodrošināta atbilstība PIP 9.2. punktam.", status: "source", by: "model", cites: [{ file: "PIP.docx", quote: "Pasūtītājs plāno izmantot VDV" }] })],
	["c:t0:r0:c1", item("c:t0:r0:c1", { kind: "cell", value: "Valsts ugunsdzēsības dienests", status: "source", by: "model" })],
	["c:t0:r1:c1", item("c:t0:r1:c1", { kind: "cell", status: "missing" })],
]);
const blocks: PreviewBlock[] = [
	{ kind: "text", text: "BIM izpildes plāns", level: 1 },
	{ kind: "text", text: "Ievada rindkopa.", level: 0 },
	{ kind: "table", t: 0, rows: [[{ text: "Projekta nosaukums:" }, { text: "", slotId: "c:t0:r0:c1" }], [{ text: "Pasūtītājs:" }, { text: "", slotId: "c:t0:r1:c1" }]] },
	{ kind: "slot", slotId: "s:p10" },
	{ kind: "slot", slotId: "s:p20" },
];

test("Dokuments: the template reads top to bottom; an empty section keeps the instruction and a red marker, a filled one shows its text and source; cells sit in the table", async () => {
	const { DocPreview } = await import("../src/renderer/screens/DocPreview.tsx");
	const html = renderToStaticMarkup(h(DocPreview, { blocks, items, onSave: () => {} }));
	assert.match(html, /doc-h1">BIM izpildes plāns/);
	assert.match(html, /Ievada rindkopa\./);
	assert.match(html, /<td>Projekta nosaukums:<\/td>/, "the template's own label is plain text");
	assert.match(html, /Valsts ugunsdzēsības dienests/);
	assert.match(html, /doc-instruction">Izpildītājam jāapraksta/, "the instruction stays until the section is written");
	assert.equal((html.match(/\[aizpildīt\]/g) ?? []).length, 2, "one empty section, one empty cell");
	assert.match(html, /avots: PIP\.docx/);
	assert.match(html, /“Pasūtītājs plāno izmantot VDV”/);
	assert.equal((html.match(/>labot</g) ?? []).length, 4, "every field can be edited in place");
	assert.match(html, /s-source/);
	assert.match(html, /s-missing open/);
	assert.ok(html.indexOf("BIM izpildes plāns") < html.indexOf("Projekta nosaukums") && html.indexOf("Projekta nosaukums") < html.indexOf("Izpildītājam jāapraksta"), "document order");
});

test("Aģents switch: shown on the screens where the agent works, on by default, with the plain-language label", async () => {
	const { ScreenHead } = await import("../src/renderer/ui.tsx");
	const on = renderToStaticMarkup(h(ScreenHead, { title: "6. Aizpildīt", what: "x", agent: true }));
	assert.match(on, /role="switch"/);
	assert.match(on, /Aģents: ieslēgts/);
	assert.doesNotMatch(renderToStaticMarkup(h(ScreenHead, { title: "Reģistri", what: "x" })), /role="switch"/, "screens without the agent have no switch");
});
