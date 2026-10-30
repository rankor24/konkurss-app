// 1. Dokumenti on two real tenders (read-only): scan, classify, extract all text.
// Skipped where the folders are absent. Output goes to a temp folder; the tender
// folders are hashed before and after.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractAll, fileWarnings, readCachedText, scanFolders } from "../src/main/extract.ts";
import { loadState, saveState } from "../src/main/project-state.ts";
import { pyConfigFromEnv } from "../src/mcp/python.ts";
import { emptyState } from "../src/shared/state.ts";
import { allStepStatuses } from "../src/shared/steps.ts";
import type { Project } from "../src/shared/types.ts";

const appRoot = join(import.meta.dirname, "..");
const py = { ...pyConfigFromEnv(process.env), skillsDir: join(appRoot, "resources", "plugin", "skills") };

function hashTree(dir: string): string {
	const h = createHash("sha256");
	const walk = (d: string) => {
		for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			const p = join(d, e.name);
			if (e.isDirectory()) walk(p);
			else h.update(p).update(String(statSync(p).size)).update(readFileSync(p));
		}
	};
	walk(dir);
	return h.digest("hex");
}

const FIXTURES = [
	{
		name: "NVA 2025/122",
		source: "E:\\BV BIM\\Paraugmodeli\\260811_NVA_Remonta baze\\KONKURSS",
		expect: { nolikums: "NOLIKUMS_14_07_2026.docx", bip: "5.pielikums_Pirms_liguma_BIP.docx", matrica: "5.A.pielikums_Atbildibas_matrica.xlsx", paraug: "6.pielikums_Paraugmodelu_prasibas.docx" },
	},
	{
		name: "VUGD koledža 2 (2025/95)",
		source: "E:\\BV BIM\\Paraugmodeli\\VUGD koledgza 2\\KONKURSS",
		expect: { nolikums: "NOLIKUMS_2026_95_2_posms_31_07.docx", bip: "4.pielikums_Pirms_liguma_BIP.docx", matrica: "4.A.pielikums_Atbildibas_matrica (veidlapa).xlsx", paraug: "5.pielikums_Paraugmodelu_prasibas.docx" },
	},
];

for (const fx of FIXTURES) {
	test(`${fx.name}: scan, classify, read 100% of readable files, report failures`, { skip: !existsSync(fx.source), timeout: 900_000 }, async () => {
		const before = hashTree(fx.source);
		const out = mkdtempSync(join(tmpdir(), "konkurss-fx-"));
		const project: Project = { id: "fx", name: fx.name, sourceDir: fx.source, outputDir: out, variant: null, builders: [], createdAt: "" };
		try {
			const state = emptyState();
			state.files = scanFolders(project, []);
			state.scannedAt = "t";
			assert.ok(state.files.length > 30, `scanned ${state.files.length} files`);

			// classification of the key documents (1.9)
			const kind = (name: string) => state.files.find((f) => f.rel.endsWith(name))?.kind;
			assert.equal(kind(fx.expect.nolikums), "nolikums");
			assert.equal(kind(fx.expect.bip), "bip_veidne");
			assert.equal(kind(fx.expect.matrica), "matrica");
			assert.equal(kind(fx.expect.paraug), "paraugmodelu_prasibas");
			assert.ok(state.files.every((f) => f.where === "konkurss"), "everything in izejas dati is Konkursa dokumenti");

			// extraction (1.10)
			let last = 0;
			state.files = await extractAll(project, state, py, (done) => (last = done));
			state.extractedAt = "t";
			const readable = state.files.filter((f) => f.text !== "neattiecas");
			const ok = state.files.filter((f) => f.text === "ok");
			const bad = state.files.filter((f) => f.text === "kluda" || f.text === "tukss");
			console.log(`  ${fx.name}: ${state.files.length} files, ${readable.length} readable, ${ok.length} read ok, ${bad.length} need attention`);
			for (const f of bad) console.log(`    ⚠ ${f.rel} — ${f.textNote}`);
			assert.ok(last > 0);
			assert.equal(ok.length + bad.length, readable.length, "every readable file got a verdict — none silently skipped");
			assert.ok(ok.length / readable.length > 0.8, "most files read");

			const nol = state.files.find((f) => f.rel.endsWith(fx.expect.nolikums))!;
			assert.equal(nol.text, "ok");
			assert.match(readCachedText(project, nol) ?? "", /nolikum/i);

			// Excel: every sheet, with cell references (regression: single .xlsx used to fail outright)
			const matrica = state.files.find((f) => f.rel.endsWith(fx.expect.matrica))!;
			assert.equal(matrica.text, "ok");
			assert.match(readCachedText(project, matrica) ?? "", /^## [^\n]+\n[A-Z]+\d+: /m, "sheet heading and cell refs");
			assert.ok(!(readCachedText(project, matrica) ?? "").includes("\r"), "cache uses \\n only");
			assert.equal(state.files.filter((f) => f.rel.endsWith(".xlsx") && f.text === "kluda").length, 0, "no workbook fails to read");

			// the table survives as cell separators
			const bip = state.files.find((f) => f.rel.endsWith(fx.expect.bip))!;
			assert.match(readCachedText(project, bip) ?? "", / \| /);

			// state round-trips and the rail reflects it
			saveState(out, state);
			const reloaded = loadState(out);
			assert.equal(reloaded.files.length, state.files.length);
			assert.equal(allStepStatuses(reloaded).dokumenti, bad.length ? "problema" : "gatavs");
			assert.ok(Array.isArray(fileWarnings(reloaded.files)));

			// a second scan keeps text and a person's kind correction (1.9)
			const target = reloaded.files.find((f) => f.rel.endsWith(fx.expect.nolikums))!;
			target.kind = "cits";
			target.kindSetByUser = true;
			const rescanned = scanFolders(project, reloaded.files);
			const again = rescanned.find((f) => f.rel === target.rel)!;
			assert.equal(again.kind, "cits", "user correction survives a rescan");
			assert.equal(again.text, "ok", "unchanged file keeps its extracted text");
		} finally {
			rmSync(out, { recursive: true, force: true });
		}
		assert.equal(hashTree(fx.source), before, "tender folder byte-identical");
	});
}
