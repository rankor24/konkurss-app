import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { emptyState } from "../src/shared/state.ts";
import { allStepStatuses } from "../src/shared/steps.ts";
import type { Project } from "../src/shared/types.ts";

(globalThis as { window?: unknown }).window = { konkurss: { invoke: async () => null, on: () => () => {} } };
const project: Project = { id: "p", name: "NVA", sourceDir: "E:/x/KONKURSS", outputDir: "E:/x/IESNIEDZAMIE", variant: "V2", builders: ["UPB"], createdAt: "" };

function bundle(extra: Record<string, unknown> = {}) {
	const state = { ...emptyState(), ...extra };
	return { state, steps: allStepStatuses(state), progress: { done: 0, total: 10, problems: 0 }, checklist: { done: 0, total: 13 }, warnings: [], editions: { candidates: [], guess: {} } };
}

test("Pārbaude: before a run it says nothing was checked; after a run it shows consequence, place, both quotes and the ⊘ group with reasons", async () => {
	const { Parbaude } = await import("../src/renderer/screens/Parbaude.tsx");
	const empty = renderToStaticMarkup(h(Parbaude, { project, bundle: bundle(), reload: async () => {} }));
	assert.match(empty, /8\. Pārbaude/);
	assert.match(empty, /class="intro"/);
	assert.match(empty, /Vēl nav pārbaudīts/);
	assert.match(empty, /Pārbaudīt tagad/);
	assert.match(empty, /Pārbaudīt saturu/);

	const checks = {
		ranAt: "2026-09-18T10:00:00Z",
		findings: [
			{ id: "coordinator", kind: "precīza", status: "fail", title: "BIM koordinators nesakrīt ar savietotā modeļa autoru", detail: "BIP: Jānis Kreics, matricā Boriss Varlamovs. Piedāvājums ir pretrunīgs.", where: ["Matrica_v1.xlsx"], step: "kas", fix: "Salāgot lomas" },
			{ id: "substance-tech", kind: "satura", status: "warn", title: "Tehniskais piedāvājums atbild specifikācijai", detail: "„termiņš 60 dienas” — piedāvājumā atbildes nav.", where: [], cites: [{ file: "TS.docx", quote: "termiņš ir 60 dienas" }] },
			{ id: "leaks", kind: "precīza", status: "ok", title: "Citu konkursu datu nav", detail: "3 dokumenti pārbaudīti.", where: [] },
			{ id: "energy", kind: "precīza", status: "na", title: "Energoklašu salīdzinājums", detail: "Šis konkurss energoefektivitāti nevērtē.", where: [] },
		],
	};
	const html = renderToStaticMarkup(h(Parbaude, { project, bundle: bundle({ checks }), reload: async () => {}, go: () => {} }));
	assert.match(html, /✗ 1 kļūdas/);
	assert.match(html, /⚠ 1 jāpārbauda/);
	assert.match(html, /Piedāvājums ir pretrunīgs/);
	assert.match(html, /Kur: Matrica_v1\.xlsx/);
	assert.match(html, /Salāgot lomas → 5\. Kas ko dara/);
	assert.match(html, /satura pārbaude/);
	assert.match(html, /TS\.docx/);
	assert.match(html, /Neattiecas šim konkursam \(1\)/);
	assert.match(html, /Šis konkurss energoefektivitāti nevērtē/);
	assert.doesNotMatch(html, /Visas kļūdas un brīdinājumi ir novērsti/);

	const acked = renderToStaticMarkup(h(Parbaude, { project, bundle: bundle({ checks, checkAck: { coordinator: true, "substance-tech": true } }), reload: async () => {} }));
	assert.match(acked, /Visas kļūdas un brīdinājumi ir novērsti vai apzināti atstāti/);
});

test("Paraksti: intro, privacy note and the empty state are present", async () => {
	const { Paraksti } = await import("../src/renderer/screens/Paraksti.tsx");
	const html = renderToStaticMarkup(h(Paraksti, { project, bundle: bundle(), reload: async () => {} }));
	assert.match(html, /9\. Paraksti/);
	assert.match(html, /class="intro"/);
	assert.match(html, /Personas kodi netiek rādīti/);
});

test("Rezultāts: result choices, post-win deadlines with the empty state, register button, clarification box", async () => {
	const { Rezultats } = await import("../src/renderer/screens/Rezultats.tsx");
	const html = renderToStaticMarkup(h(Rezultats, { project, bundle: bundle(), reload: async () => {} }));
	assert.match(html, /10\. Rezultāts/);
	assert.match(html, /Gaidām rezultātu/);
	assert.match(html, /Uzvara/);
	assert.match(html, /Zaudējums/);
	assert.match(html, /Termiņi pēc uzvaras/);
	assert.match(html, /Vēl nav nolasīti/);
	assert.match(html, /Pievienot objektu reģistram/);
	assert.match(html, /negrozot saturu/);
	assert.match(html, /komercnoslēpuma rindu/);
	assert.match(html, /Sagatavot atbildi/);
});
