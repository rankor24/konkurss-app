import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { emptyState } from "../src/shared/state.ts";
import { allStepStatuses } from "../src/shared/steps.ts";
import type { Project } from "../src/shared/types.ts";

(globalThis as { window?: unknown }).window = { konkurss: { invoke: async () => null, on: () => () => {} } };
const project: Project = { id: "p", name: "Salacgrīva", sourceDir: "E:/x/KONKURSS", outputDir: "E:/x/IESNIEDZAMIE", variant: "V1", builders: [], createdAt: "" };
function bundle() {
	const state = emptyState();
	state.variant = { value: "V1", status: "manual" };
	state.tech = { boilerplate: "E:\old\5_Tehniskais piedāvājums.docx", changes: [{ i: 7, before: "Ēka Sila ielā 2, Salacgrīvā.", after: "Ēka Jaunā ielā 5, Valmierā.", why: "objekts", cites: [{ file: "nolikums.docx", quote: "Jaunā ielā 5, Valmierā" }], decision: null }] };
	return { state, steps: allStepStatuses(state), progress: { done: 0, total: 10, problems: 0 }, checklist: { done: 0, total: 13 }, warnings: [], editions: { candidates: [], guess: {} } };
}

test("Vai varam: without confirmed requirements it asks for step 3 instead of showing an invented verdict", async () => {
	const { Varam } = await import("../src/renderer/screens/Varam.tsx");
	const html = renderToStaticMarkup(h(Varam, { project, bundle: bundle(), reload: async () => {} }));
	assert.match(html, /4\. Vai varam pieteikties/);
	assert.match(html, /class="intro"/);
	assert.match(html, /Vispirms 3\. solī izlasi/);
});

test("Pierādījumi: intro, the numbering explanation and the surname-folder rule; no objects chosen → says so", async () => {
	const { Pieradijumi } = await import("../src/renderer/screens/Pieradijumi.tsx");
	const html = renderToStaticMarkup(h(Pieradijumi, { project, bundle: bundle(), reload: async () => {} }));
	assert.match(html, /7\. Pierādījumi/);
	assert.match(html, /2_1/);
	assert.match(html, /BPV uzvārdu/);
	assert.match(html, /Vēl nav izvēlēts neviens objekts/);
});

test("Technical proposal: shows the old paragraph, the proposed one with its source quote, accept/reject", async () => {
	const { TechV1 } = await import("../src/renderer/screens/FormsV1.tsx");
	const html = renderToStaticMarkup(h(TechV1, { project, bundle: bundle(), reload: async () => {} }));
	assert.match(html, /Netiek rakstīts no nulles/);
	assert.match(html, /Ēka Sila ielā 2, Salacgrīvā\./);
	assert.match(html, /Jaunā ielā 5, Valmierā/);
	assert.match(html, /Pieņemt/);
	assert.match(html, /Atmest/);
	assert.match(html, /vēl nav izlemts/);
});

test("V1 forms: the explanation of 'No kurienes' and the empty state are present", async () => {
	const { FormsV1 } = await import("../src/renderer/screens/FormsV1.tsx");
	const html = renderToStaticMarkup(h(FormsV1, { project, bundle: bundle() }));
	assert.match(html, /No kurienes/);
	assert.match(html, /app to atcerēsies/);
	assert.match(html, /Piesaistīt datus/);
});
