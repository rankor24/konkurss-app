import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assignTracker, deadlineIn, decide, discover, folderDate, trackerCandidates, type Deadline } from "../src/main/board/discover.ts";
import { parseTracker } from "../src/main/library/imports.ts";
import { readXlsx } from "../src/main/office.ts";
import type { TrackerRow } from "../src/shared/library.ts";
import { makeDocx } from "./helpers/zipwrite.ts";

const B = "B:/01_Konkursi";
const haveB = existsSync(B);

const row = (n: number, title: string, deadline: string | null, extra: Partial<TrackerRow> = {}): TrackerRow => ({ sheet: "2026", row: n, title, work: "", purchaser: "", builders: [], ourAmount: "", ourCents: null, deadline, procedure: "Atklāts konkurss", subject: "Projektēšana/Autoruzraudzība", decision: "liekam", submitted: null, result: "nav", comment: "", winner: null, winnerCents: null, eisUrl: null, ...extra });

test("folder names carry the deadline date", () => {
	assert.equal(folderDate("261111_Tilde_TAA_Liela iela 19"), "2026-11-11");
	assert.equal(folderDate("Rīgas satiksme, DUS"), null);
	assert.equal(folderDate("261399_x"), null);
});

test("deadline: the sentence about submitting the offer, in both date styles; not the questions deadline", () => {
	const a = deadlineIn("Jautājumus var uzdot līdz 2026. gada 4. novembrim.\nPiedāvājums jāiesniedz līdz 2026. gada 11. novembrim plkst. 12.00, nosūtot to elektroniski uz e-pasta adresi info@ktilde.lv.", "u.docx")!;
	assert.deepEqual([a.date, a.time, a.source], ["2026-11-11", "12:00", "dokuments"]);
	assert.ok(a.cite!.quote.startsWith("Piedāvājums jāiesniedz"));
	const b = deadlineIn("Piedāvājumi iesniedzami EIS e-konkursu apakšsistēmā līdz 05.11.2026. plkst. 10:00.", "n.docx")!;
	assert.deepEqual([b.date, b.time], ["2026-11-05", "10:00"]);
	assert.equal(deadlineIn("Objekta apsekošana līdz 2026. gada 1. novembrim.", "x.docx"), null);
});

test("tracker matching: one row per folder and one folder per row; one shared word needs agreeing dates", () => {
	const rows = [row(1, "Bauskas novada skolas jumta remonts", "2026-10-26"), row(2, "Patvertņu ierīkošana Rīgas valstspilsētas skolās", "2026-11-10"), row(3, "Ulbrokas sporta kompleksa ģērbtuvju pārbūve", "2026-11-05")];
	assert.deepEqual(trackerCandidates("261110_BNP_Bauskas patvertnes", "2026-11-10", rows).map((c) => c.r.row), [2], "row 1 shares a word but its date is 15 days off");
	const m = assignTracker([{ folder: "261105_RNP_Ulbrokas sporta kompleksa gerbtuves", date: "2026-11-05" }, { folder: "261105_RNP_Ulbrokas sporta zale", date: "2026-11-05" }], rows);
	assert.equal(m.get("261105_RNP_Ulbrokas sporta kompleksa gerbtuves")?.row, 3);
	assert.equal(m.get("261105_RNP_Ulbrokas sporta zale"), undefined, "the row is already taken by the better match");
});

test("status: a person's choice wins; a prepared pack outranks a tracker 'Neinteresē'", () => {
	const dl = (date: string): Deadline => ({ date, time: null, source: "uzskaite", cite: null });
	const t = { sheet: "2026", row: 1, title: "", decision: "neinteresē", procedure: "", subject: "", work: "", eisUrl: null, score: 1 };
	assert.equal(decide({ deadline: dl("2026-11-20"), tracker: t, submission: { files: 0, builders: [] }, projectId: null }, "2026-11-06").status, "atteikts");
	assert.equal(decide({ deadline: dl("2026-11-20"), tracker: t, submission: { files: 19, builders: [] }, projectId: null }, "2026-11-06").status, "gatavo");
	assert.equal(decide({ deadline: dl("2026-11-01"), tracker: t, submission: { files: 19, builders: [] }, projectId: null }, "2026-11-06").status, "iesniegts");
	const manual = decide({ deadline: dl("2026-11-20"), tracker: null, submission: { files: 0, builders: [] }, projectId: null }, "2026-11-06", { status: "izverte", note: "", at: "" });
	assert.deepEqual([manual.status, manual.statusBy], ["izverte", "person"]);
});

test("discover on a folder tree: deadline from the document beats the folder name; conflicts kept; cache re-used", async () => {
	const root = mkdtempSync(join(tmpdir(), "konk-board-"));
	mkdirSync(join(root, "261111_Tilde_TAA_Liela iela 19"));
	writeFileSync(join(root, "261111_Tilde_TAA_Liela iela 19", "00_Uzaicinajums.docx"), makeDocx(["Uzaicinājums piedalīties cenu aptaujā", "Piedāvājums jāiesniedz līdz 2026. gada 10. novembrim plkst. 12.00, nosūtot to uz e-pasta adresi a@b.lv."]));
	mkdirSync(join(root, "261120_RNP_Garkalnes stadions", "IESNIEDZAMIE"), { recursive: true });
	writeFileSync(join(root, "261120_RNP_Garkalnes stadions", "IESNIEDZAMIE", "1_Pieteikums.docx"), "x");
	mkdirSync(join(root, "07_IESNIEGTI"));
	const cache: Record<string, { sig: string; deadline: Deadline | null }> = {};
	const rows = await discover({ root, projects: [], tracker: [row(9, "Garkalnes stadiona pārbūve", "2026-11-19")], manual: {}, cache, today: new Date("2026-11-06") });
	assert.deepEqual(rows.map((r) => r.folder), ["261111_Tilde_TAA_Liela iela 19", "261120_RNP_Garkalnes stadions"], "folders sorted by deadline; the archive is not a tender");
	const tilde = rows[0];
	assert.deepEqual([tilde.deadline!.date, tilde.deadline!.source], ["2026-11-10", "dokuments"]);
	assert.deepEqual(tilde.conflicts, [{ date: "2026-11-11", source: "mapes nosaukums" }]);
	const g = rows[1];
	assert.deepEqual([g.deadline!.date, g.deadline!.source, g.status, g.submission.files, g.code], ["2026-11-19", "uzskaite", "gatavo", 1, "RNP"]);
	assert.ok(cache["261111_Tilde_TAA_Liela iela 19"].deadline);
	// the second run takes the deadline from the cache
	cache["261111_Tilde_TAA_Liela iela 19"].deadline!.time = "13:00";
	const again = await discover({ root, projects: [], tracker: [], manual: {}, cache, today: new Date("2026-11-06") });
	assert.equal(again[0].deadline!.time, "13:00");
});

test("ORACLE: the real tenders folder — every open folder with a deadline or „nav atrasts”, tracker rows used once, nothing changed", { skip: !haveB, timeout: 600_000 }, async () => {
	const before = readdirSync(B).map((n) => `${n}@${statSync(join(B, n)).mtimeMs}`).sort();
	const tracker = parseTracker(readXlsx(join(B, "02_Iepirkumi_BD_jauns.xlsx")));
	const rows = await discover({ root: B, projects: [], tracker, manual: {}, today: new Date("2026-11-06") });
	const folders = readdirSync(B, { withFileTypes: true }).filter((d) => d.isDirectory() && /^\d{6}_/.test(d.name)).length;
	assert.equal(rows.length, folders);
	assert.ok(rows.every((r) => r.deadline !== null), "every folder named YYMMDD_ has at least the folder date");
	const matched = rows.filter((r) => r.tracker);
	assert.ok(matched.length >= 30, `${matched.length} folders matched to the tracker`);
	const keys = matched.map((r) => `${r.tracker!.sheet}|${r.tracker!.row}`);
	assert.equal(new Set(keys).size, keys.length, "no tracker row claimed twice");
	const tilde = rows.find((r) => r.folder.startsWith("261111_Tilde_TAA_Liela"))!;
	assert.deepEqual([tilde.deadline!.date, tilde.deadline!.time, tilde.deadline!.source], ["2026-11-11", "12:00", "dokuments"]);
	assert.ok(tilde.deadline!.cite!.quote.includes("info@ktilde.lv"));
	const bauska = rows.find((r) => r.folder.startsWith("261110_BNP_Bauskas"))!;
	assert.notEqual(bauska.status, "atteikts", "a folder with a prepared pack is never auto-rejected");
	const after = readdirSync(B).map((n) => `${n}@${statSync(join(B, n)).mtimeMs}`).sort();
	assert.deepEqual(after, before);
});
