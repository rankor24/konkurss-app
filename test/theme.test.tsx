import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Store } from "../src/main/store.ts";
import { THEMES, themeAttr, themeOf } from "../src/shared/theme.ts";

const tmp = mkdtempSync(join(tmpdir(), "konkurss-theme-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const fakeCrypto = { available: () => true, encrypt: (s: string) => Buffer.from(s, "utf8"), decrypt: (b: Buffer) => b.toString("utf8") };

test("theme: only light and dark are forced; anything else follows the system and sets no attribute", () => {
	assert.deepEqual(THEMES.map((t) => t.id), ["auto", "light", "dark"]);
	assert.equal(themeOf("light"), "light");
	assert.equal(themeOf("dark"), "dark");
	for (const bad of [undefined, null, "", "Dark", "blue", 3]) assert.equal(themeOf(bad), "auto");
	assert.equal(themeAttr("auto"), null);
	assert.equal(themeAttr("light"), "light");
	assert.equal(themeAttr("dark"), "dark");
});

test("theme: the choice is kept in the settings across a restart, and a new install follows the system", () => {
	const store = new Store(join(tmp, "data"), fakeCrypto);
	assert.equal(themeOf(store.settings().theme), "auto");
	store.saveSettings({ theme: "dark" });
	assert.equal(new Store(join(tmp, "data"), fakeCrypto).settings().theme, "dark");
	assert.match(readFileSync(join(tmp, "data", "settings.json"), "utf8"), /"theme": ?"dark"/);
});

test("theme switch: three buttons in the top bar, none pressed by someone else's choice but the current one", async () => {
	const { ThemeSwitch } = await import("../src/renderer/ui.tsx");
	const html = renderToStaticMarkup(h(ThemeSwitch));
	for (const t of THEMES) assert.match(html, new RegExp(`>${t.label}</button>`));
	assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1, "exactly one is current");
	assert.match(html, /aria-pressed="true"[^>]*>Auto<|class="on"[^>]*aria-pressed="true"[^>]*>Auto</, "a fresh start follows the system");
});
