import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { bpvConsistency, feasibility } from "../src/main/v1/feasibility.ts";
import { emptyFinance, formatCents, loadFinance, saveFinance, toCents, totals } from "../src/main/v1/finance.ts";
import { experienceSlots, parseObject, qualify } from "../src/main/v1/objects.ts";
import { importFromSkillData } from "../src/main/registers/registers.ts";
import { emptyCited, emptyState, type Cited } from "../src/shared/state.ts";

const DATA = join(homedir(), ".claude", "skills", "konkurss", "data");
const have = existsSync(join(DATA, "specialisti.md"));
const reg = () => importFromSkillData({ uznemums: readFileSync(join(DATA, "uznemums.md"), "utf8"), specialisti: readFileSync(join(DATA, "specialisti.md"), "utf8"), objekti: readFileSync(join(DATA, "atsauces_objekti.md"), "utf8") });
const m = <T,>(value: T): Cited<T> => ({ value, status: "manual" });

/** Requirements shaped like LNP 2026/96 (Salacgrīva): the tender the first version of this logic was built from. */
function salacgriva() {
	const r = emptyState().requirements;
	r.pieredze = [{ text: m("Vismaz 1 pieredze energoefektivitātes paaugstināšanas būvniecības ieceres dokumentācijas izstrādē iepriekšējos 3 gados"), count: m(1), periodYears: m(3), objectType: m("Energoefektivitātes paaugstināšanas objekti") }];
	r.vertesana = [
		{ name: m("Piedāvājuma cena, EUR bez PVN."), points: m(65), formula: emptyCited(), objectsNeeded: null },
		{ name: m("Būvprojekta vadītāja pieredze"), points: m(30), formula: m("Pabeigtas publisku ēku būvniecības ieceres dokumentācijas izstrādes iepriekšējo 3 (trīs) gadu laikā"), objectsNeeded: 3 },
		{ name: m("Atbildīgā projektētāja pieredze energoefektīvu projektu izstrādē"), points: m(5), formula: m("pēdējo 5 gadu laikā energosertifikāts"), objectsNeeded: 1 },
	];
	r.specialisti = [
		"Atbildīgais būvprojekta vadītājs",
		"Elektroietaišu sistēmu projektēšanā sertificēts projektētājs",
		"Ūdensapgādes un kanalizācijas sistēmu projektēšanā sertificēts projektētājs",
		"Siltumapgādes, ventilācijas un gaisa kondicionēšanas sistēmu projektēšanā sertificēts projektētājs",
		"elektronisko sakaru sistēmu un tīklu projektēšanā sertificēts projektētājs",
	].map((f) => ({ field: m(f), certificate: emptyCited<string>(), mandatory: true }));
	return r;
}
const DEADLINE = new Date(2026, 6, 13, 10, 0);

test("parseObject reads area, code, group, public status, energy class and the accept date from the register fields", { skip: !have }, () => {
	const o = reg().objects;
	const by = (re: RegExp) => parseObject(o.find((x) => re.test(x.name))!);
	const mens = by(/Mēnesgaismas/);
	assert.deepEqual([mens.area, mens.code, mens.group, mens.isPublic, mens.energyClass], [1984, "1211", 3, true, "A+"]);
	assert.equal(mens.acceptDate?.toDateString(), new Date(2024, 5, 27).toDateString());
	assert.match(mens.bpv, /Kalniņš/);
	const ann = by(/Anniņmuižas|Tirdzniecības/);
	assert.equal(ann.isPublic, true, "1230 + III grupa → public");
	assert.equal(ann.energyClass, "B");
	const kuld = by(/Traktortehnikas/);
	assert.deepEqual([kuld.code, kuld.group, kuld.isPublic, kuld.energyClass], ["1251", 2, false, "A"]);
	assert.equal(kuld.acceptDate?.getDate(), 18, "a date range counts the later day");
	assert.equal(by(/Saulkrastu/).energyClass, "E");
});

test("experience slots come from the requirements — company (energy, 3 y), BPV (public, 3 objects), energy criterion", () => {
	const slots = experienceSlots(salacgriva());
	assert.deepEqual(slots.map((s) => [s.kind, s.count, s.needsPublic, s.needsEnergy]), [["company", 1, false, true], ["bpv", 3, true, false], ["energy", 1, false, true]]);
	assert.equal(slots[1].years, 3);
	assert.equal(slots[1].points, 30);
});

test("qualification states the reason: not public, energy E, outside the window", { skip: !have }, () => {
	const o = reg().objects;
	const slots = experienceSlots(salacgriva());
	const get = (re: RegExp) => o.find((x) => re.test(x.name))!;
	const kuld = qualify(get(/Traktortehnikas/), slots[1], DEADLINE);
	assert.equal(kuld.ok, false);
	assert.match(kuld.reasons[0], /nav publiska ēka \(kods 1251, 2\. grupa\) — prasa publisku/);
	const saul = qualify(get(/Saulkrastu/), slots[2], DEADLINE);
	assert.match(saul.reasons[0], /apkure E — nav energoefektīvs/);
	assert.equal(qualify(get(/Saulkrastu/), slots[1], DEADLINE).ok, true, "public and inside the window → fits the BPV slot");
	const old = { ...slots[0], years: 1 };
	assert.match(qualify(get(/Mēnesgaismas/), old, DEADLINE).reasons[0], /ārpus 1 gadu loga/);
	assert.equal(qualify(get(/Mēnesgaismas/), slots[0], DEADLINE).ok, true);
});

test("feasibility on the real register: 4 of 5 specialists, the ESS gap is a blocker, points reachable are computed", { skip: !have }, () => {
	const f = feasibility(salacgriva(), reg(), DEADLINE);
	assert.equal(f.specialistsCovered, 4);
	assert.equal(f.specialists.length, 5);
	assert.ok(f.blockers.some((b) => /elektronisko sakaru/i.test(b)));
	const bpv = f.slots.find((s) => s.slot.kind === "bpv")!;
	assert.ok(bpv.met, `${bpv.qualifying.length} objects qualify`);
	assert.ok(bpv.excluded.some((e) => /Traktortehnikas/.test(e.object.name) && /publisk/.test(e.reasons[0])));
	assert.equal(f.points.price, 65);
	assert.equal(f.points.total, 100);
	assert.equal(f.points.reachable, 35, "BPV 30 + energy 5; price depends on competitors");
	assert.deepEqual(f.points.lost, []);
});

test("feasibility: too few qualifying objects → the points are listed as lost, with the count", { skip: !have }, () => {
	const r = reg();
	r.objects = r.objects.filter((o) => /Mēnesgaismas|Traktortehnikas/.test(o.name));
	const f = feasibility(salacgriva(), r, DEADLINE);
	assert.equal(f.points.reachable, 5);
	assert.equal(f.points.lost[0].points, 30);
	assert.match(f.points.lost[0].why, /1 no 3/);
});

test("BPV consistency reproduces the original LNP 2026/96 error and clears it when fixed", { skip: !have }, () => {
	const r = reg();
	const teresko = r.specialists.find((s) => s.name === "Aigars Tereško")!;
	const kalnins = r.specialists.find((s) => s.name === "Andis Kalniņš")!;
	const objs = r.objects.filter((o) => /Mēnesgaismas/.test(o.name));
	const bad = bpvConsistency({ chosen: teresko, objects: objs, points: 30 });
	assert.equal(bad[0].ok, false);
	assert.match(bad[0].message, /Aigars Tereško \(1-00076\)/);
	assert.match(bad[0].message, /Andis Kalniņš, 1-00619/);
	assert.match(bad[0].message, /30 punkti var netikt piešķirti/);
	const good = bpvConsistency({ chosen: kalnins, objects: objs, points: 30 });
	assert.equal(good[0].ok, true);
	assert.equal(bpvConsistency({ chosen: undefined, objects: objs, points: 30 })[0].ok, false);
});

// ---------- prices ----------
test("money in whole cents: parsing, formatting, VAT, totals, EIS amount", () => {
	assert.equal(toCents("75 000,00"), 7500000);
	assert.equal(toCents("75000.5"), 7500050);
	assert.equal(toCents("12"), 1200);
	assert.equal(toCents("abc"), null);
	assert.equal(toCents("1,234"), null, "three decimals is not a price");
	assert.equal(formatCents(9680000), "96 800,00");
	assert.equal(formatCents(5), "0,05");
	const t = totals({ rows: [{ name: "Būvniecības ieceres dokumentācija", amount: "75 000,00" }, { name: "Autoruzraudzība", amount: "5 000,00" }], vatPercent: 21, eisAmount: null });
	assert.deepEqual([t.net, t.vat, t.gross, t.eis], [8000000, 1680000, 9680000, 8000000]);
	assert.equal(t.rows[0].vat, 1575000);
});

test("totals: an unreadable amount is reported and does not count; rounding is done once on the total", () => {
	const t = totals({ rows: [{ name: "A", amount: "10,01" }, { name: "B", amount: "oops" }, { name: "C", amount: "10,01" }], vatPercent: 21, eisAmount: "20,02" });
	assert.deepEqual(t.invalid, ["B"]);
	assert.equal(t.net, 2002);
	assert.equal(t.vat, 420);
	assert.equal(t.eis, 2002);
	assert.equal(totals({ rows: [], vatPercent: 21, eisAmount: "bad" }).eis, null);
});

const tmp = mkdtempSync(join(tmpdir(), "konkurss-fin-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
test("finance lives in its own file, never in project.json", () => {
	saveFinance(tmp, { ...emptyFinance(), rows: [{ name: "X", amount: "1 000,00" }] });
	assert.equal(loadFinance(tmp).rows[0].amount, "1 000,00");
	const state = readFileSync(join(tmp, ".konkurss", "finanses.json"), "utf8");
	assert.match(state, /1 000,00/);
	assert.equal(existsSync(join(tmp, ".konkurss", "project.json")), false);
});
