import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { emptyState } from "../src/shared/state.ts";
import { allStepStatuses } from "../src/shared/steps.ts";
import type { Project } from "../src/shared/types.ts";
import type { HarvestProposal } from "../src/shared/library.ts";

(globalThis as { window?: unknown }).window = { konkurss: { invoke: async () => null, on: () => () => {} } };
const project: Project = { id: "p", name: "Bauska", sourceDir: "C:/x/KONKURSS", outputDir: "C:/x/IESNIEDZAMIE", variant: "V2", builders: ["FF"], createdAt: "" };
const bundle = () => {
	const state = emptyState();
	return { state, steps: allStepStatuses(state), progress: { done: 0, total: 10, problems: 0 }, checklist: { done: 0, total: 13 }, warnings: [], editions: { candidates: [], guess: {} } };
};
const JARGON = /\b(JSON|IPC|regex|profils|validācija|ekstrakcija|hash)\b/;

test("Paka: loads, and says nothing in jargon", async () => {
	const { Paka } = await import("../src/renderer/screens/Paka.tsx");
	const html = renderToStaticMarkup(h(Paka, { project, bundle: bundle() }));
	assert.match(html, /Ielādē/);
	assert.doesNotMatch(html, JARGON);
});

test("Profile card: unread profile offers to read it from the documents", async () => {
	const { ProfileCard } = await import("../src/renderer/screens/Profils.tsx");
	const html = renderToStaticMarkup(h(ProfileCard, { project, profile: undefined, reload: async () => {} }));
	assert.match(html, /Konkursa kārtība/);
	assert.match(html, /Nolasīt no dokumentiem/);
	assert.doesNotMatch(html, JARGON);
});

test("Harvest proposal card: files, cited facts, the three decisions", async () => {
	const { Proposal } = await import("../src/renderer/screens/Biblioteka.tsx");
	const p: HarvestProposal = { key: "menesg sabile", label: "Sabilex Menesgaismas", uses: 91, tenders: [], files: [{ path: "B:/01_Konkursi/261105_RNP_x/IESNIEDZAMIE/3_3Atsauksme.edoc", kind: "atsauksme", mtimeMs: 1, size: 1 }], facts: [{ key: "Būvvaldes atzīmes datums", value: "26.06.2024", cite: { file: "B:/01_Konkursi/261105_RNP_x/IESNIEDZAMIE/3_0BPV.docx", quote: "26.06.2024" } }], match: null, decision: null };
	const html = renderToStaticMarkup(h(Proposal, { p, objects: [], onAccept: () => {}, onMerge: () => {}, onIgnore: () => {}, busy: false }));
	assert.match(html, /izmantots 91 iesniegumos/);
	assert.match(html, /Atsauksme/);
	assert.match(html, /„26\.06\.2024”/);
	assert.match(html, /261105_RNP_x/);
	for (const b of ["Pievienot kā jaunu objektu", "Pievienot failus esošam", "Nav objekts / atmest"]) assert.match(html, new RegExp(b));
	assert.doesNotMatch(html, JARGON);
});

test("Tāfele and Cenas: first render is the loading state, without jargon", async () => {
	const { Tafele } = await import("../src/renderer/screens/Tafele.tsx");
	const { Cenas } = await import("../src/renderer/screens/Cenas.tsx");
	const a = renderToStaticMarkup(h(Tafele, { onOpen: () => {}, onAdd: () => {} }));
	const b = renderToStaticMarkup(h(Cenas, { project }));
	assert.match(a, /Konkursu tāfele/);
	assert.match(b, /Ielādē/);
	assert.doesNotMatch(a + b, JARGON);
});
