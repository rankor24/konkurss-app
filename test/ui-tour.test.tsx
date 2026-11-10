import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { STEPS } from "../src/shared/state.ts";
import type { Project } from "../src/shared/types.ts";

(globalThis as { window?: unknown }).window = { konkurss: { invoke: async () => null, on: () => () => {} }, addEventListener: () => {}, removeEventListener: () => {}, innerWidth: 1280, innerHeight: 800 };

const SRC = join(import.meta.dirname, "..", "src", "renderer");
const sources = () => {
	const out: string[] = [];
	const walk = (d: string) => readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(join(d, e.name)) : /\.tsx?$/.test(e.name) && out.push(readFileSync(join(d, e.name), "utf8"))));
	walk(SRC);
	return out.join("\n");
};

test("tour content: every step says what the person does and what the app does; ids unique; every stage on the map has a step", async () => {
	const { TOUR, TOUR_MAP, firstOfStage } = await import("../src/renderer/tour/steps.ts");
	assert.ok(TOUR.length >= 20, "the whole process, not a teaser");
	assert.equal(new Set(TOUR.map((s) => s.id)).size, TOUR.length);
	for (const s of TOUR) for (const k of ["title", "you", "app"] as const) assert.ok(s[k].trim().length > 10, `${s.id}.${k}`);
	for (const g of TOUR_MAP) for (const st of g.stages) assert.ok(firstOfStage(st.id) >= 0, `map stage ${st.id} has a step`);
	// all ten work steps are in it, in order
	const order = STEPS.map((x) => TOUR.findIndex((s) => s.stage === x.id));
	assert.ok(order.every((i) => i >= 0));
	assert.deepEqual([...order].sort((a, b) => a - b), order);
	for (const s of TOUR.filter((x) => STEPS.some((st) => st.id === x.stage))) assert.equal(s.go?.kind, "project", `${s.id} opens a tender`);
});

test("tour anchors: every element a step points at exists in the screens", async () => {
	const { TOUR } = await import("../src/renderer/tour/steps.ts");
	const { LIBRARY_TABS } = await import("../src/renderer/screens/Biblioteka.tsx");
	const src = sources();
	const tabs = ["uznemums", "specialisti", "objekti", ...Object.keys(LIBRARY_TABS)];
	for (const s of TOUR) {
		if (!s.anchor) continue;
		const a = s.anchor;
		if (a.startsWith("step-") && STEPS.some((st) => `step-${st.id}` === a)) assert.match(src, /data-tour=\{`step-\$\{st\.id\}`\}/);
		else if (a.startsWith("tab-") && tabs.includes(a.slice(4))) assert.match(src, /data-tour=\{`tab-\$\{t\}`\}/);
		else assert.ok(src.includes(`data-tour="${a}"`), `data-tour="${a}" is in the renderer`);
	}
});

test("tour language: no hidden jargon and no tender data in any step", async () => {
	const { TOUR } = await import("../src/renderer/tour/steps.ts");
	const { HIDDEN_JARGON } = await import("../src/renderer/ui.tsx");
	const text = TOUR.map((s) => `${s.title} ${s.you} ${s.app} ${s.note ?? ""}`).join("\n");
	for (const w of HIDDEN_JARGON) assert.ok(!new RegExp(`\\b${w}\\b`, "i").test(text), w);
	assert.doesNotMatch(text, /\b\d{11}\b/, "no registration numbers");
	assert.doesNotMatch(text, /\b[A-ZĀČĒĢĪĶĻŅŠŪŽ]{2,6}\s*20\d\d\/\d+/, "no tender identifiers");
});

test("card position: beside the element when it fits, below otherwise, centred without one, always inside the window", async () => {
	const { cardPosition } = await import("../src/renderer/screens/Tour.tsx");
	const view = { w: 1280, h: 800 };
	assert.deepEqual(cardPosition({ top: 300, left: 0, width: 180, height: 30 }, view), { top: 280, left: 194 });
	const below = cardPosition({ top: 100, left: 1000, width: 200, height: 30 }, view);
	assert.equal(below.top, 144);
	assert.ok(below.left + 460 <= 1280 - 14);
	const centred = cardPosition(null, view);
	assert.equal(centred.left, (1280 - 460) / 2);
	const low = cardPosition({ top: 790, left: 0, width: 180, height: 30 }, view);
	assert.ok(low.top + 320 <= 800);
});

test("navigation: project steps open the latest tender, or stay put without one; registers open on the named tab", async () => {
	const { tourView } = await import("../src/renderer/App.tsx");
	const p = (id: string, createdAt: string): Project => ({ id, name: id, sourceDir: "", outputDir: "", variant: null, builders: [], createdAt });
	assert.deepEqual(tourView({ kind: "project", step: "paka" }, [], { kind: "list" }), { kind: "list" });
	assert.deepEqual(tourView({ kind: "project", step: "paka" }, [p("old", "2026-10-01"), p("new", "2026-11-05")], { kind: "list" }), { kind: "project", id: "new", step: "paka" });
	assert.deepEqual(tourView({ kind: "registers", tab: "ieteikumi" }, [], { kind: "list" }), { kind: "registers", tab: "ieteikumi" });
	assert.deepEqual(tourView(undefined, [], { kind: "board" }), { kind: "board" });
});

test("tour card: the whole map, the current stage marked; skip on the way, the two ways to start at the end", async () => {
	const { Tour } = await import("../src/renderer/screens/Tour.tsx");
	const { TOUR } = await import("../src/renderer/tour/steps.ts");
	const noop = () => {};
	const first = renderToStaticMarkup(h(Tour, { index: 0, onIndex: noop, onClose: noop, hasProject: false, onFinish: noop }));
	for (const l of ["Reģistri", "Tāfele", "1 Dokumenti", "6 Aizpildīt", "Cenas", "Paka", "8 Pārbaude", "10 Rezultāts"]) assert.ok(first.includes(l), l);
	assert.match(first, /Izlaist/);
	assert.match(first, /Ko dari tu/);
	assert.match(first, /Ko dara app/);
	assert.match(first, /role="dialog"/);
	const paka = renderToStaticMarkup(h(Tour, { index: TOUR.findIndex((s) => s.id === "paka"), onIndex: noop, onClose: noop, hasProject: false, onFinish: noop }));
	assert.match(paka, /class="tour-stage current[^"]*"[^>]*aria-current="step"[^>]*>Paka</);
	assert.match(paka, /Kad pievienosi pirmo konkursu/, "without a tender the project step says where it will be");
	const last = renderToStaticMarkup(h(Tour, { index: TOUR.length - 1, onIndex: noop, onClose: noop, hasProject: true, onFinish: noop }));
	assert.doesNotMatch(last, /Izlaist/);
	assert.match(last, /Atvērt tāfeli/);
	assert.match(last, /Jauns konkurss/);
});

test("Iestatījumi: the tutorial can be played again", async () => {
	const { SettingsScreen } = await import("../src/renderer/screens/Settings.tsx");
	const html = renderToStaticMarkup(h(SettingsScreen, { onReplayTour: () => {} }));
	assert.match(html, /Rādīt apmācību vēlreiz/);
	assert.match(html, /data-tour="tour-replay"/);
});
