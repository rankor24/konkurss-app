import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyState } from "../src/shared/state.ts";
import type { ExtraSource } from "../src/shared/sources.ts";
import type { Project } from "../src/shared/types.ts";
import type { StateBundle } from "../src/renderer/api.ts";

const project: Project = { id: "p1", name: "VUGD 2", sourceDir: "S", outputDir: "O", variant: "V1", builders: [], createdAt: "" };
const bundleWith = (sources?: ExtraSource[]): StateBundle => {
	const state = emptyState();
	if (sources) state.sources = { aizpildit: sources };
	return { state, steps: {} as StateBundle["steps"], progress: { done: 0, total: 0, problems: 0 }, checklist: { done: 0, total: 0 }, warnings: [], editions: { candidates: [], guess: {} } };
};
const file = (rel: string, text: "ok" | "tukss", note?: string) => ({ abs: `C:/x/${rel}`, rel, size: 1, mtimeMs: 1, text, textNote: note });

test("sources panel: empty it only invites; with sources it lists them with note, read count and the files that gave no text", async () => {
	const { ExtraSources } = await import("../src/renderer/screens/Sources.tsx");
	const render = (b: StateBundle) => renderToStaticMarkup(h(ExtraSources, { project, bundle: b, reload: async () => {}, page: "aizpildit" }));

	const empty = render(bundleWith());
	assert.match(empty, /Papildu avoti/);
	assert.match(empty, /nav pievienotu/);
	assert.match(empty, /Pievienot failus…/);
	assert.match(empty, /Pievienot mapi…/);
	assert.match(empty, /mūsu iepriekšējo BIP/, "says what the agent does with them on this page");
	assert.equal(empty.includes("src-row"), false);

	const src: ExtraSource = {
		id: "s1",
		path: "C:/x/Iepriekšējie BIP",
		kind: "folder",
		note: "VUGD Daugavpils, ņemt formulējumus",
		addedAt: "2026-11-02T08:00:00Z",
		files: [file("VUGD.docx", "ok"), file("skens.pdf", "tukss", "Skenēts attēls — tekstu nolasīt nevar, pārbaudi ar aci.")],
		truncated: true,
	};
	const html = render(bundleWith([src]));
	assert.match(html, /1 pievienoti/);
	assert.match(html, /C:\/x\/Iepriekšējie BIP/);
	assert.match(html, /nolasīti 1 no 2/);
	assert.match(html, /value="VUGD Daugavpils, ņemt formulējumus"/, "the note stays editable");
	assert.match(html, /skens\.pdf: Skenēts attēls/, "a file that gave no text is named");
	assert.match(html, /pirmie 60/, "a cut folder says so");
	assert.match(html, /Nolasīt vēlreiz/);
	assert.match(html, /Noņemt/);
});

test("sources panel: another page's sources are not shown here", async () => {
	const { ExtraSources } = await import("../src/renderer/screens/Sources.tsx");
	const b = bundleWith();
	b.state.sources = { prasibas: [{ id: "x", path: "C:/cita-lapa.docx", kind: "file", note: "", addedAt: "", files: [file("cita-lapa.docx", "ok")] }] };
	const html = renderToStaticMarkup(h(ExtraSources, { project, bundle: b, reload: async () => {}, page: "aizpildit" }));
	assert.equal(html.includes("cita-lapa"), false);
	assert.match(html, /nav pievienotu/);
});
