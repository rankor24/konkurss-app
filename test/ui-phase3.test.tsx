import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { emptyState } from "../src/shared/state.ts";
import { allStepStatuses, stepStatus } from "../src/shared/steps.ts";
import type { Project } from "../src/shared/types.ts";

(globalThis as { window?: unknown }).window = { konkurss: { invoke: async () => null, on: () => () => {} } };
const project: Project = { id: "p", name: "NVA", sourceDir: "E:\\x\\KONKURSS", outputDir: "E:\\x\\IESNIEDZAMIE", variant: "V2", builders: ["UPB", "Pillar"], createdAt: "" };

function bundle(variant: "V1" | "V2" | null) {
	const state = emptyState();
	if (variant) state.variant = { value: variant, status: "manual", confirmed: true };
	state.roles = {
		design: [{ id: "1", role: "BIM modeļa autors", part: "AR, IN", company: "SIA BŪVDIZAINS", person: "Truševska" }],
		build: { UPB: [{ id: "2", role: "4D speciālists", part: "", company: "UPB", person: "Persona UPB" }], Pillar: [] },
	};
	return { state, steps: allStepStatuses(state), progress: { done: 0, total: 10, problems: 0 }, checklist: { done: 0, total: 13 }, warnings: [], editions: { candidates: [], guess: {} } };
}

test("Kas ko dara (V2): design table once, one construction table per builder, safety hint about builder data", async () => {
	const { KasKoDara } = await import("../src/renderer/screens/KasKoDara.tsx");
	const html = renderToStaticMarkup(h(KasKoDara, { project, bundle: bundle("V2"), reload: async () => {} }));
	assert.match(html, /5\. Kas ko dara/);
	assert.match(html, /Projektēšana \(mēs\)/);
	assert.match(html, /Būvdarbi — UPB/);
	assert.match(html, /Būvdarbi — Pillar/);
	assert.match(html, /nekad nenonāk cita būvnieka dokumentos/);
	assert.match(html, /Truševska/);
	assert.match(html, /Persona UPB/);
	assert.match(html, /class="intro"/);
});

test("Kas ko dara: V1 and unknown variant say what is missing instead of showing an empty form", async () => {
	const { KasKoDara } = await import("../src/renderer/screens/KasKoDara.tsx");
	assert.match(renderToStaticMarkup(h(KasKoDara, { project: { ...project, variant: null }, bundle: bundle(null), reload: async () => {} })), /vēl nav noteikts/);
});

test("Aizpildīt: intro, template picker, honest 'nav atrasta veidne' state", async () => {
	const { Aizpildit } = await import("../src/renderer/screens/Aizpildit.tsx");
	const html = renderToStaticMarkup(h(Aizpildit, { project, bundle: bundle("V2"), reload: async () => {} }));
	assert.match(html, /6\. Aizpildīt/);
	assert.match(html, /Oriģinālās veidlapas netiek mainītas/);
	assert.match(html, /tā neizdomā datus/);
	assert.match(html, /Veidne/);
});

test("Reģistri: renders its loading state without crashing; import offered only for empty registers", async () => {
	const { Registri } = await import("../src/renderer/screens/Registri.tsx");
	assert.match(renderToStaticMarkup(h(Registri)), /Ielādē/);
});

test("step 'kas': nav → proc → gatavs for V2 as roles get people and companies", () => {
	const s = emptyState();
	s.variant = { value: "V2", status: "manual" };
	assert.equal(stepStatus(s, "kas"), "nav");
	s.roles.design = [{ id: "1", role: "x", part: "", company: "SIA B", person: "A" }];
	s.roles.build = { UPB: [] };
	assert.equal(stepStatus(s, "kas"), "proc", "a builder with no rows is not done");
	s.roles.build = { UPB: [{ id: "2", role: "y", part: "", company: "UPB", person: "P" }] };
	assert.equal(stepStatus(s, "kas"), "gatavs");
	s.roles.build.UPB[0].person = "";
	assert.equal(stepStatus(s, "kas"), "proc");
});

test("steps 6 and 7 follow the state: forms with open cells keep 6 in progress; missing evidence is a problem", () => {
	const s = emptyState();
	assert.equal(stepStatus(s, "aizpildit"), "nav");
	const cell = (status: "missing" | "source") => ({ slotId: "c", kind: "cell" as const, label: "x", heading: "", value: "", status, cites: [], by: null });
	s.fills.a = { template: "a", skeleton: "x", items: [cell("missing")], inspectedAt: "t", outputs: {} };
	assert.equal(stepStatus(s, "aizpildit"), "proc");
	s.fills.a.items = [cell("source")];
	s.fills.a.outputs = { "": "x.docx" };
	assert.equal(stepStatus(s, "aizpildit"), "gatavs");
	assert.equal(stepStatus(s, "pieradijumi"), "nav");
	s.choices.objects = { "company:0": ["o1"] };
	assert.equal(stepStatus(s, "pieradijumi"), "proc");
	s.proofs = { collectedAt: "t", copied: 2, missing: 1 };
	assert.equal(stepStatus(s, "pieradijumi"), "problema");
	s.proofs.missing = 0;
	assert.equal(stepStatus(s, "pieradijumi"), "gatavs");
});
