import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";

(globalThis as { window?: unknown }).window = { konkurss: { invoke: async () => null, on: () => () => {} } };

test("Iestatījumi shows the agents, the 'Vai dators ir gatavs' card and the activity log", async () => {
	const { SettingsScreen } = await import("../src/renderer/screens/Settings.tsx");
	const html = renderToStaticMarkup(h(SettingsScreen));
	assert.match(html, /Iestatījumi/);
	assert.match(html, /Vai dators ir gatavs/);
	assert.match(html, /Ja kaut kas nestrādā, sāc šeit/);
	assert.match(html, /Darbību žurnāls/);
	assert.match(html, /neko nevar izdzēst no šejienes/);
});

test("Aģents screen says it fills fields (not only answers), with the safety rules and clickable examples", async () => {
	const { Chat } = await import("../src/renderer/screens/Chat.tsx");
	const html = renderToStaticMarkup(h(Chat, { project: { id: "p", name: "N", sourceDir: "S", outputDir: "O", variant: null, builders: [], createdAt: "" } }));
	assert.match(html, /<h2>Aģents<\/h2>/);
	assert.match(html, /<b>aizpilda<\/b>/);
	assert.match(html, /Ieraksta tikai to, ko var citēt/);
	assert.match(html, /ko tu pats esi ierakstījis, to neaizstāj/);
	assert.match(html, /aizpildi tukšās BIP sadaļas/);
});
