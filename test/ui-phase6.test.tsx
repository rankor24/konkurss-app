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
