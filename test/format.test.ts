import { test } from "node:test";
import assert from "node:assert/strict";
import { ago, bytes, countdown, parseDeadline } from "../src/shared/format.ts";
import { checklist } from "../src/shared/steps.ts";
import { emptyState } from "../src/shared/state.ts";

test("parseDeadline reads Latvian and ISO dates, with and without time", () => {
	const a = parseDeadline("13.07.2026", "10:00")!;
	assert.deepEqual([a.getFullYear(), a.getMonth(), a.getDate(), a.getHours(), a.getMinutes()], [2026, 6, 13, 10, 0]);
	const b = parseDeadline("2026-07-13")!;
	assert.deepEqual([b.getDate(), b.getHours(), b.getMinutes()], [13, 23, 59]); // no time → end of day
	assert.equal(parseDeadline("13.07.2026", "10.30")!.getMinutes(), 30);
});

test("parseDeadline rejects nonsense and impossible dates", () => {
	assert.equal(parseDeadline(null), null);
	assert.equal(parseDeadline("rīt"), null);
	assert.equal(parseDeadline("31.02.2026"), null);
});

const at = (s: string) => new Date(s);

test("countdown: days+hours, hours+minutes, minutes", () => {
	const dl = at("2026-07-13T10:00:00");
	assert.equal(countdown(dl, at("2026-07-10T06:00:00"))!.text, "3d 4h");
	assert.equal(countdown(dl, at("2026-07-13T07:30:00"))!.text, "2h 30min");
	assert.equal(countdown(dl, at("2026-07-13T09:40:00"))!.text, "20min");
});

test("countdown is critical under 24 h and after the deadline", () => {
	const dl = at("2026-07-13T10:00:00");
	assert.equal(countdown(dl, at("2026-07-12T12:00:00"))!.critical, true);
	assert.equal(countdown(dl, at("2026-07-10T06:00:00"))!.critical, false);
	const passed = countdown(dl, at("2026-07-14T00:00:00"))!;
	assert.deepEqual([passed.passed, passed.critical, passed.text], [true, true, "termiņš pagājis"]);
	assert.equal(countdown(null), null);
});

test("ago and bytes", () => {
	const now = at("2026-07-10T12:00:00Z");
	assert.equal(ago("2026-07-10T11:59:50Z", now), "tikko");
	assert.equal(ago("2026-07-10T09:00:00Z", now), "pirms 3 h");
	assert.equal(ago("2026-07-09T11:00:00Z", now), "vakar");
	assert.equal(ago("2026-07-07T12:00:00Z", now), "pirms 3 dienām");
	assert.equal(bytes(512), "512 B");
	assert.equal(bytes(2048), "2 KB");
	assert.equal(bytes(5 * 1024 * 1024), "5.0 MB");
});

test("checklist counts concrete items derived from state", () => {
	const s = emptyState();
	assert.equal(checklist(s).filter((i) => i.done).length, 0);
	s.scannedAt = s.extractedAt = "t";
	s.versions.inForce = "amended";
	s.deadline.date = { value: "13.07.2026", status: "manual" };
	s.requirements.confirmed.pieredze = true;
	const items = checklist(s);
	assert.equal(items.length, 15);
	assert.equal(items.filter((i) => i.done).length, 6);
});

test("checklist: an unreadable file keeps 'all files read' open", () => {
	const s = emptyState();
	s.scannedAt = s.extractedAt = "t";
	s.files.push({ rel: "x.pdf", root: "source", where: "konkurss", kind: "cits", kindSetByUser: false, size: 1, mtimeMs: 1, text: "tukss" });
	assert.equal(checklist(s).find((i) => i.label.startsWith("Visi nolasāmie"))!.done, false);
});
