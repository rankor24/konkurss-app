import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { emptyState } from "../src/shared/state.ts";
import { allStepStatuses } from "../src/shared/steps.ts";
import type { Project } from "../src/shared/types.ts";

(globalThis as { window?: unknown }).window = { konkurss: { invoke: async () => null, on: () => () => {} } };

const project: Project = { id: "p", name: "Salacgrīva", sourceDir: "E:\\x\\KONKURSS", outputDir: "E:\\x\\IESNIEDZAMIE", variant: "V1", builders: [], createdAt: "" };

function bundle() {
	const state = emptyState();
	state.versions.templates = [{ name: "Kvalifikacija", distributedFile: "Kvalifikacija_96.docx", embeddedFile: "nolikums.docx", distributedRows: 4, embeddedRows: 5, missingLabels: ["elektronisko sakaru sistēmu un tīklu; projektēšanā sertificēts projektētājs"], equal: false }];
	state.versions.templatesComparedAt = "t";
	state.versions.changes = [{ before: "izmērīto energoefektivitāti", after: "aprēķinātajiem vai izmērītajiem", impact: "kriterijs", impactBy: "model", confirmed: false }];
	state.versions.diffedAt = "t";
	state.versions.qa = [{ nr: "1", question: "Vai fasādes siltināšana visai ēkai?", answer: "Visai ēkai", file: "atb.edoc", impact: "maina_apjomu", confirmed: false }];
	const cite = { file: "nolikums.docx", quote: "2.2.1. atbildīgais būvprojekta vadītājs" };
	state.requirements.specialisti = [{ field: { value: "Atbildīgais būvprojekta vadītājs", status: "model", cite }, certificate: { value: null, status: "missing" }, mandatory: true }];
	state.requirements.vertesana = [
		{ name: { value: "Cena", status: "model", cite }, points: { value: 65, status: "model", cite }, formula: { value: null, status: "missing" }, objectsNeeded: null },
		{ name: { value: "BPV", status: "manual" }, points: { value: 30, status: "manual" }, formula: { value: null, status: "missing" }, objectsNeeded: 3 },
	];
	state.requirements.apaksuznemeji.threshold = { value: null, status: "missing", note: "nav atrasts dokumentos — jāaizpilda pašam" };
	state.deadline.date = { value: "13.07.2026", status: "model", cite, conflict: { value: "14.07.2026" } };
	return {
		state,
		steps: allStepStatuses(state),
		progress: { done: 0, total: 10, problems: 1 },
		checklist: { done: 0, total: 13 },
		warnings: [],
		editions: { candidates: ["source:nolikums96_28_05_2.docx", "source:nolikums96_26_06_groz.docx"], guess: { original: "source:nolikums96_28_05_2.docx", amended: "source:nolikums96_26_06_groz.docx" } },
	};
}

test("Versija: shows both editions, the change with its proposed impact, Q&A, the 4-vs-5 form warning and the source-priority hint", async () => {
	const { Versija } = await import("../src/renderer/screens/Versija.tsx");
	const html = renderToStaticMarkup(h(Versija, { project, bundle: bundle(), reload: async () => {} }));
	assert.match(html, /2\. Kura versija spēkā/);
	assert.match(html, /class="intro"/);
	assert.match(html, /Strādājam ar/);
	assert.match(html, /izmērīto energoefektivitāti/);
	assert.match(html, /piedāvā aģents/);
	assert.match(html, /Vai fasādes siltināšana/);
	assert.match(html, /izsniegtajā veidlapā 4 rindas, nolikumā 5/);
	assert.match(html, /elektronisko sakaru sistēmu/);
	assert.match(html, /komisijas atbildes → grozījumi/);
	assert.match(html, /Termiņš parasti nav nolikumā/);
});

test("Versija with a single nolikums edition says so and does not ask to compare", async () => {
	const { Versija } = await import("../src/renderer/screens/Versija.tsx");
	const b = bundle();
	b.editions = { candidates: ["source:NOLIKUMS.docx"], guess: { original: "source:NOLIKUMS.docx" } };
	const html = renderToStaticMarkup(h(Versija, { project, bundle: b, reload: async () => {} }));
	assert.match(html, /Atrasta viena nolikuma redakcija/);
	assert.doesNotMatch(html, />Salīdzināt</);
});

test("Prasibas: six blocks, quote marks on read values, 'nav atrasts' on missing, criteria sum", async () => {
	const { Prasibas, sumOf } = await import("../src/renderer/screens/Prasibas.tsx");
	const html = renderToStaticMarkup(h(Prasibas, { project, bundle: bundle(), reload: async () => {} }));
	for (const t of ["Konkursa dati", "Kas jāiesniedz", "Pretendenta pieredze", "Speciālisti un viņu pieredze", "Apsekošana", "Nodrošinājums", "Izpildes termiņš", "Finanšu piedāvājums", "Tehniskais piedāvājums", "Apliecinājumi", "Kā vērtē piedāvājumus", "Apakšuzņēmēji"]) assert.match(html, new RegExp(t));
	assert.match(html, /class="cite"/, "read values carry the quote mark");
	assert.match(html, /nav atrasts — jāaizpilda pašai/);
	assert.match(html, /Kopā 95 ⚠ nav 100/, "95 points are flagged, not accepted");
	assert.match(html, /Otrā nolasīšana/);
	assert.equal(sumOf(bundle().state.requirements.vertesana).sum, 95);
});

test("Prasibas: 100 points show a tick; unknown points show 'trūkst punktu'", async () => {
	const { sumOf } = await import("../src/renderer/screens/Prasibas.tsx");
	const mk = (n: number | null) => ({ name: { value: "k", status: "manual" as const }, points: n === null ? { value: null, status: "missing" as const } : { value: n, status: "manual" as const }, formula: { value: null, status: "missing" as const }, objectsNeeded: null });
	assert.deepEqual(sumOf([mk(65), mk(30), mk(5)]), { sum: 100, complete: true });
	assert.equal(sumOf([mk(65), mk(null)]).complete, false);
});

test("a second-pass conflict is visible with both choices", async () => {
	const { EditableCited } = await import("../src/renderer/ui.tsx");
	const html = renderToStaticMarkup(h(EditableCited, { c: bundle().state.deadline.date, onChange: () => {} }));
	assert.match(html, /otra nolasīšana: 14\.07\.2026/);
	assert.match(html, /Atstāt pirmo/);
	assert.match(html, /Ņemt otro/);
});
