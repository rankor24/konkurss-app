// Renders the screens to static HTML in Node (no browser): catches import errors, crashes on
// first render and missing intro text. Effects do not run in server rendering, so this covers
// the initial state of each screen only; data-driven behaviour is covered by the logic tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { emptyState, STEPS } from "../src/shared/state.ts";
import { allStepStatuses } from "../src/shared/steps.ts";
import type { Project } from "../src/shared/types.ts";

// The screens call window.konkurss only inside effects/handlers, but import-time access must not crash.
(globalThis as { window?: unknown }).window = { konkurss: { invoke: async () => null, on: () => () => {} } };
(globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {} };

const project: Project = { id: "p", name: "260811_NVA_Remonta baze", sourceDir: "E:\\x\\KONKURSS", outputDir: "E:\\x\\IESNIEDZAMIE", variant: "V2", builders: ["UPB"], createdAt: "" };

async function bundle() {
	const state = emptyState();
	state.files.push({ rel: "NOLIKUMS.docx", root: "source", where: "konkurss", kind: "nolikums", kindSetByUser: false, size: 2048, mtimeMs: 1, text: "ok", textChars: 100 });
	state.files.push({ rel: "skens.pdf", root: "source", where: "konkurss", kind: "cits", kindSetByUser: true, size: 10, mtimeMs: 1, text: "tukss", textNote: "Skenēts attēls — tekstu nolasīt nevar, pārbaudi ar aci." });
	state.scannedAt = state.extractedAt = "t";
	return { state, steps: allStepStatuses(state), progress: { done: 1, total: 10, problems: 1 }, checklist: { done: 3, total: 13 }, warnings: ["1 PDF ir skenēti attēli — tekstu nolasīt nevar. Pārbaudi tos ar aci."] };
}

test("every screen renders its two-line intro (what / why)", async () => {
	const { Konkursi } = await import("../src/renderer/screens/Konkursi.tsx");
	const { NewProject } = await import("../src/renderer/screens/NewProject.tsx");
	const { SettingsScreen } = await import("../src/renderer/screens/Settings.tsx");
	const { FirstRun } = await import("../src/renderer/screens/FirstRun.tsx");
	const { Dokumenti } = await import("../src/renderer/screens/Dokumenti.tsx");
	const { Stub } = await import("../src/renderer/screens/Stub.tsx");
	const noop = () => {};
	const screens: [string, string][] = [
		["Konkursi", renderToStaticMarkup(h(Konkursi, { onOpen: noop, onNew: noop }))],
		["NewProject", renderToStaticMarkup(h(NewProject, { onCreated: noop, onCancel: noop }))],
		["Settings", renderToStaticMarkup(h(SettingsScreen))],
		["FirstRun", renderToStaticMarkup(h(FirstRun, { onNewProject: noop, onSkip: noop }))],
		["Dokumenti", renderToStaticMarkup(h(Dokumenti, { project, bundle: await bundle(), reload: async () => {}, onProjectChanged: noop }))],
		["Stub", renderToStaticMarkup(h(Stub, { title: "2. Kura versija", what: "Kas te notiek.", why: "Kāpēc tas svarīgi.", phase: 2 }))],
	];
	for (const [name, html] of screens) {
		assert.match(html, /class="intro"/, `${name} has an intro block`);
		assert.match(html, /<h1>/, `${name} has a heading`);
	}
});

test("Dokumenti shows the scanned-PDF warning, the file table and the safety wording", async () => {
	const { Dokumenti } = await import("../src/renderer/screens/Dokumenti.tsx");
	const html = renderToStaticMarkup(h(Dokumenti, { project, bundle: await bundle(), reload: async () => {}, onProjectChanged: () => {} }));
	assert.match(html, /skenēti attēli/);
	assert.match(html, /NOLIKUMS\.docx/);
	assert.match(html, /Pārskatīt mapi/);
	assert.match(html, /Nolasīt tekstu/);
	assert.match(html, /labots/, "a person's kind correction is marked");
	assert.match(html, /Konkursa veids/);
});

test("the stub says plainly that the step is not built yet, with no invented data", async () => {
	const { Stub } = await import("../src/renderer/screens/Stub.tsx");
	const html = renderToStaticMarkup(h(Stub, { title: "9. Paraksti", what: "x", phase: 5 }));
	assert.match(html, /vēl nav gatavs/);
});

test("CitedValue: model value shows the quote mark; manual shows 'ievadīts ar roku'; missing shows 'nav atrasts'", async () => {
	const { CitedValue } = await import("../src/renderer/ui.tsx");
	const model = renderToStaticMarkup(h(CitedValue, { c: { value: "V2", status: "model", cite: { file: "PIP.docx", quote: "Projektē un būvē" } } }));
	assert.match(model, /class="cite"/);
	const manual = renderToStaticMarkup(h(CitedValue, { c: { value: "V1", status: "manual" } }));
	assert.match(manual, /ievadīts ar roku/);
	assert.doesNotMatch(manual, /class="cite"/);
	const missing = renderToStaticMarkup(h(CitedValue, { c: { value: null, status: "missing" } }));
	assert.match(missing, /nav atrasts/);
	const conflict = renderToStaticMarkup(h(CitedValue, { c: { value: "13.07.2026", status: "model", cite: { file: "a", quote: "q" }, conflict: { value: "14.07.2026" } } }));
	assert.match(conflict, /otra nolasīšana: 14\.07\.2026/);
});

test("the rail lists all ten steps in order with their status icons", async () => {
	assert.deepEqual(STEPS.map((s) => s.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
	const src = readFileSync(join(import.meta.dirname, "..", "src", "renderer", "App.tsx"), "utf8");
	assert.match(src, /STEPS\.map/);
	assert.match(src, /Jautāt aģentam/);
	assert.match(src, /Nekas netiek dzēsts, oriģināli netiek mainīti/, "status bar repeats the safety guarantee");
});

test("theme tokens from the v1 spec exist for light and dark", () => {
	const css = readFileSync(join(import.meta.dirname, "..", "src", "renderer", "styles.css"), "utf8");
	const dark = css.slice(css.indexOf("prefers-color-scheme: dark"));
	const light = css.slice(0, css.indexOf("prefers-color-scheme: dark"));
	const spec: Record<string, [string, string]> = {
		"--bg": ["#f6f7f9", "#15181d"], "--panel": ["#ffffff", "#1c2027"], "--rail": ["#edeff3", "#12151a"],
		"--ink": ["#1b2028", "#e7eaef"], "--ink-2": ["#5c6675", "#96a0af"], "--line": ["#d7dce3", "#2a2f38"],
		"--accent": ["#2b5c8a", "#5b94c9"], "--critical": ["#b4342c", "#e06b62"], "--warning": ["#9a6b0c", "#d9a22b"],
		"--good": ["#2e6b4f", "#5fa37e"], "--secret": ["#6b4e8a", "#a98bd1"], "--model": ["#3f6e5a", "#7fb79c"],
	};
	for (const [token, [l, d]] of Object.entries(spec)) {
		assert.match(light, new RegExp(`${token}:\\s*${l}`, "i"), `${token} light`);
		assert.match(dark, new RegExp(`${token}:\\s*${d}`, "i"), `${token} dark`);
	}
	assert.match(css, /Segoe UI/);
	assert.match(css, /Consolas/);
});
