import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadState, saveState, stateDir, updateState } from "../src/main/project-state.ts";
import { emptyState } from "../src/shared/state.ts";
import { allStepStatuses, progress, stepStatus } from "../src/shared/steps.ts";

const tmp = mkdtempSync(join(tmpdir(), "konkurss-state-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

test("a new project loads as an empty state", () => {
	const s = loadState(join(tmp, "a"));
	assert.equal(s.schema, 1);
	assert.deepEqual(s.files, []);
});

test("save is atomic and keeps the previous version", () => {
	const dir = join(tmp, "b");
	updateState(dir, (s) => void (s.scannedAt = "1"));
	updateState(dir, (s) => void (s.scannedAt = "2"));
	assert.equal(loadState(dir).scannedAt, "2");
	assert.equal(JSON.parse(readFileSync(join(stateDir(dir), "project.prev.json"), "utf8")).scannedAt, "1");
	assert.ok(!existsSync(join(stateDir(dir), "project.json.tmp")), "no temp file left behind");
});

test("a state file from an older version gets new keys filled in, nothing lost", () => {
	const dir = join(tmp, "c");
	mkdirSync(stateDir(dir), { recursive: true });
	writeFileSync(join(stateDir(dir), "project.json"), JSON.stringify({ schema: 1, files: [], scannedAt: "x", future: { keep: true } }));
	const s = loadState(dir);
	assert.equal(s.scannedAt, "x");
	assert.deepEqual(s.future, { keep: true });
	assert.ok(s.requirements.dati);
});

test("a corrupt state file is reported, not silently replaced", () => {
	const dir = join(tmp, "d");
	mkdirSync(stateDir(dir), { recursive: true });
	writeFileSync(join(stateDir(dir), "project.json"), "{ not json");
	assert.throws(() => loadState(dir), /bojāts/);
});

test("a failed change leaves the file untouched", () => {
	const dir = join(tmp, "e");
	updateState(dir, (s) => void (s.scannedAt = "ok"));
	assert.throws(() =>
		updateState(dir, (s) => {
			s.scannedAt = "half";
			throw new Error("boom");
		}),
	);
	assert.equal(loadState(dir).scannedAt, "ok");
});

test("step status: dokumenti goes nav → proc → gatavs / problema", () => {
	const s = emptyState();
	assert.equal(stepStatus(s, "dokumenti"), "nav");
	s.scannedAt = "t";
	assert.equal(stepStatus(s, "dokumenti"), "proc");
	s.extractedAt = "t";
	assert.equal(stepStatus(s, "dokumenti"), "gatavs");
	s.files.push({ rel: "a.pdf", root: "source", where: "konkurss", kind: "cits", kindSetByUser: false, size: 1, mtimeMs: 1, text: "tukss" });
	assert.equal(stepStatus(s, "dokumenti"), "problema");
});

test("step status: versija flags a template mismatch as a problem", () => {
	const s = emptyState();
	s.versions.inForce = "amended";
	s.deadline.date = { value: "13.07.2026", status: "manual" };
	assert.equal(stepStatus(s, "versija"), "gatavs");
	s.versions.templates.push({ name: "Kvalifikācija", distributedFile: "a", embeddedFile: "b", distributedRows: 4, embeddedRows: 5, missingLabels: [], equal: false });
	assert.equal(stepStatus(s, "versija"), "problema");
});

test("step status: prasibas needs every block read and confirmed; a D6 conflict is a problem", () => {
	const s = emptyState();
	assert.equal(stepStatus(s, "prasibas"), "nav");
	s.requirements.readAt.dati = "t";
	assert.equal(stepStatus(s, "prasibas"), "proc");
	for (const b of ["dati", "dokumenti", "pieredze", "specialisti", "vertesana", "apaksuznemeji"] as const) {
		s.requirements.readAt[b] = "t";
		s.requirements.confirmed[b] = true;
	}
	assert.equal(stepStatus(s, "prasibas"), "gatavs");
	s.deadline.date = { value: "13.07.2026", status: "model", conflict: { value: "14.07.2026" } };
	assert.equal(stepStatus(s, "prasibas"), "problema");
});

test("progress counts done steps and problems", () => {
	const s = emptyState();
	s.scannedAt = s.extractedAt = "t";
	assert.deepEqual(progress(s), { done: 1, total: 10, problems: 0 });
	assert.equal(Object.keys(allStepStatuses(s)).length, 10);
});

test("saveState works on a path that does not exist yet", () => {
	const dir = join(tmp, "f", "deep", "IESNIEDZAMIE");
	saveState(dir, emptyState());
	assert.ok(existsSync(join(stateDir(dir), "project.json")));
});
