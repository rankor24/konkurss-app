import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyState, type RoleSuggestion } from "../src/shared/state.ts";
import type { Project } from "../src/shared/types.ts";
import type { StateBundle } from "../src/renderer/api.ts";

const project: Project = { id: "p1", name: "VUGD 2", sourceDir: "S", outputDir: "O", variant: "V2", builders: ["Pillar", "UPB"], createdAt: "" };
const bundle = (items?: RoleSuggestion[]): StateBundle => {
	const state = emptyState();
	state.variant = { value: "V2", status: "manual", confirmed: true };
	if (items) state.rolePicks = { items, readAt: "2026-11-02T09:00:00Z", already: 1, rejected: 2 };
	return { state, steps: {} as StateBundle["steps"], progress: { done: 0, total: 0, problems: 0 }, checklist: { done: 0, total: 0 }, warnings: [], editions: { candidates: [], guess: {} } };
};
const sug = (role: string, side: RoleSuggestion["side"], decision: RoleSuggestion["decision"] = null, part = ""): RoleSuggestion => ({ id: role, role, part, side, cite: { file: "PIP.docx", quote: `Pretendents nodrošina ${role}` }, decision });

test("step 5 has the agent switch, the sources panel and the role suggestions", async () => {
	const { KasKoDara } = await import("../src/renderer/screens/KasKoDara.tsx");
	const html = renderToStaticMarkup(h(KasKoDara, { project, bundle: bundle(), reload: async () => {} }));
	assert.match(html, /agent-switch/, "the agent switch is on this page too");
	assert.match(html, /Papildu avoti/);
	assert.match(html, /Ieteikt lomas no konkursa/);
	assert.equal(html.includes("Atmest"), false, "nothing to decide before the agent has read");
});

test("suggestions: each with its quote and file, a button per place it can go, dismissed ones hidden, the counts said", async () => {
	const { KasKoDara } = await import("../src/renderer/screens/KasKoDara.tsx");
	const html = renderToStaticMarkup(
		h(KasKoDara, { project, bundle: bundle([sug("VDV pārvaldnieks", "projektesana", null, "AR, BK"), sug("4D speciālists", "buvdarbi"), sug("Drona pilots", "buvdarbi", "rejected"), sug("Ugunsdrošības konsultants", "nav_skaidrs", "added")]), reload: async () => {} }),
	);
	assert.match(html, /VDV pārvaldnieks/);
	assert.match(html, /AR, BK/);
	assert.match(html, /„Pretendents nodrošina VDV pārvaldnieks”/);
	assert.match(html, /PIP\.docx/);
	assert.match(html, /→ Projektēšana \(mēs\)/);
	assert.match(html, /→ Pillar/);
	assert.match(html, /→ UPB/);
	assert.equal(html.includes("Drona pilots"), false, "a dismissed role is not shown again");
	assert.equal(html.includes("Ugunsdrošības konsultants"), false, "a role already copied into the table is not shown again");
	assert.match(html, /2 ieteikumi/);
	assert.match(html, /1 jau ir tabulā/);
	assert.match(html, /2 atmesti/);
	assert.match(html, /projektētāja puse/);
});
