import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { Store, validateFolders } from "../src/main/store.ts";
import { packReadiness, type PackManifest } from "../src/shared/pack.ts";

(globalThis as { window?: unknown }).window = { konkurss: { invoke: async () => null, on: () => () => {} } };
const crypto = { available: () => false, encrypt: () => Buffer.alloc(0), decrypt: () => "" };

test("the work folder can never be inside the tenders folder; elsewhere it is fine", () => {
	const root = mkdtempSync(join(tmpdir(), "konk-root-"));
	const tender = join(root, "261110_BNP_Bauskas patvertnes");
	mkdirSync(join(tender, "KONKURSS"), { recursive: true });
	const err = validateFolders(join(tender, "KONKURSS"), join(tender, "IESNIEDZAMIE"), root);
	assert.match(err ?? "", /Darba mape nedrīkst būt konkursu mapē/);
	assert.match(err ?? "", /pārvieto pats/);
	assert.equal(validateFolders(join(tender, "KONKURSS"), join(tmpdir(), "Konkursi", "x"), root), null);
	// a name that only starts like the tenders folder is not inside it
	assert.equal(validateFolders(join(tender, "KONKURSS"), `${root}-darbs`, root), null);
	// and the store applies the rule when a tender is added
	const st = new Store(join(root, "..", "app-" + Date.now()), crypto, join(tmpdir(), "Docs"));
	st.saveSettings({ tendersRoot: root });
	assert.throws(() => st.addProject({ sourceDir: join(tender, "KONKURSS"), outputDir: join(tender, "IESNIEDZAMIE") }), /konkursu mapē/);
});

test("work folder: each user's own My Documents\\Konkursi\\<tender folder>; the setting wins", () => {
	const st = new Store(mkdtempSync(join(tmpdir(), "konk-app-")), crypto, "C:\\Users\\Inese\\OneDrive\\Dokumenti");
	assert.equal(st.workRoot(), join("C:\\Users\\Inese\\OneDrive\\Dokumenti", "Konkursi"));
	assert.equal(st.workFolderFor("B:\\01_Konkursi\\261110_BNP_Bauskas patvertnes\\KONKURSS"), join("C:\\Users\\Inese\\OneDrive\\Dokumenti", "Konkursi", "261110_BNP_Bauskas patvertnes"));
	assert.equal(st.workFolderFor("B:\\01_Konkursi\\261111_Tilde_TAA_Liela iela 19 Tukums_CA"), join("C:\\Users\\Inese\\OneDrive\\Dokumenti", "Konkursi", "261111_Tilde_TAA_Liela iela 19 Tukums_CA"));
	st.saveSettings({ workRoot: "D:\\Darbs" });
	assert.equal(st.workRoot(), "D:\\Darbs");
});

const item = (status: "nav" | "melnraksts" | "parakstits" | "gatavs") => ({ id: Math.random().toString(), recipient: "", number: "1", label: "x", source: "form" as const, ref: "", fileName: "1_x.docx", from: null, signer: "J. K.", status });
const manifest = (items: ReturnType<typeof item>[], unmatched: string[] = []): PackManifest => ({ builtAt: "", items, unmatched });

test("ready to move only when everything is in the pack, signed, made and checked", () => {
	const ok = { ranAt: "t", failsOpen: 0 };
	assert.equal(packReadiness(manifest([item("parakstits"), item("gatavs")]), ok).ready, true);
	const r = packReadiness(manifest([item("nav"), item("melnraksts")], ["Kvalifikāciju dokumenti"]), { ranAt: "t", failsOpen: 2 });
	assert.deepEqual([r.ready, r.notInPack, r.unsigned, r.toMake, r.checkErrors], [false, 1, 1, 1, 2]);
	assert.equal(packReadiness(manifest([item("gatavs")]), null).checkMissing, true, "never checked = not ready");
	assert.equal(packReadiness(manifest([]), ok).ready, false, "an empty pack is not ready");
});

test("the folder explanation: three places, who writes where, and why the tender folder is only read", async () => {
	const { FolderRules } = await import("../src/renderer/ui.tsx");
	const html = renderToStaticMarkup(h(FolderRules, { tender: "B:\\01_Konkursi\\X", work: "C:\\Users\\a\\Documents\\Konkursi\\X", target: "B:\\01_Konkursi\\X\\IESNIEDZAMIE" }));
	for (const s of ["Konkursa mape", "app tikai lasa", "Darba mape", "Tu pārvieto", "Kāpēc konkursa mapi tikai lasa?", "oficiālā kopija", "B:\\01_Konkursi\\X\\IESNIEDZAMIE"]) assert.ok(html.includes(s), s);
	const { NewProject } = await import("../src/renderer/screens/NewProject.tsx");
	const np = renderToStaticMarkup(h(NewProject, { onCreated: () => {}, onCancel: () => {} }));
	assert.match(np, /Kur būs faili/);
	assert.match(np, /tikai lasīšanai/);
	assert.match(np, /Darba mape \(šajā datorā\)/);
	const { tenderOf } = await import("../src/renderer/screens/NewProject.tsx");
	assert.equal(tenderOf("B:\\01_Konkursi\\T\\KONKURSS"), "B:\\01_Konkursi\\T");
	assert.equal(tenderOf("B:\\01_Konkursi\\T"), "B:\\01_Konkursi\\T");
});
