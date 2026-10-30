import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { coverage, covers, expiring, importFromSkillData, mdSections, parseObjects, stems, type Specialist } from "../src/main/registers/registers.ts";

const DATA = join(homedir(), ".claude", "skills", "konkurss", "data");
const have = existsSync(join(DATA, "specialisti.md"));
const read = (f: string) => readFileSync(join(DATA, f), "utf8");

test("mdSections: header and separator rows are not data; ** and ` are stripped", () => {
	const s = mdSections("## Sekcija\n\n| Lauks | Vērtība |\n|---|---|\n| **Nosaukums** | `SIA X` |\n");
	assert.equal(s.length, 1);
	assert.deepEqual(s[0].rows, [["#header", "Lauks", "Vērtība"], ["Nosaukums", "SIA X"]]);
});

test("real skill data imports: company fields, 4+1 specialists, gaps, 5 objects", { skip: !have }, () => {
	const r = importFromSkillData({ uznemums: read("uznemums.md"), specialisti: read("specialisti.md"), objekti: read("atsauces_objekti.md") });
	assert.ok(r.company.fields.some((f) => f.key === "Nosaukums" && /BŪVDIZAINS/.test(f.value)));
	assert.ok(r.company.fields.some((f) => /reģ/i.test(f.key)), "reg number present");
	assert.ok(r.company.persons.some((p) => /Kreics/.test(p.person)));
	assert.ok(r.company.answers.length >= 4);
	const names = r.specialists.map((s) => s.name);
	for (const n of ["Andis Kalniņš", "Aigars Tereško", "Aija Gaile", "Jānis Jurševskis", "Igors Musijenko"]) assert.ok(names.includes(n), n);
	assert.equal(r.specialists.find((s) => s.name === "Igors Musijenko")!.type, "B");
	assert.match(r.specialists.find((s) => s.name === "Igors Musijenko")!.via, /3D Vājstrāvu/);
	assert.ok(r.gaps.some((g) => /Elektronisko sakaru/i.test(g.field)));
	assert.equal(r.objects.length, 5);
	const mens = r.objects.find((o) => /Mēnesgaismas/.test(o.name))!;
	assert.ok(mens.fields.some((f) => f.key === "Būvvaldes akcepts" && /27\.06\.2024/.test(f.value)));
	assert.ok(r.specialists.every((s) => s.validUntil === ""), "validity dates are never guessed");
});

const sp = (name: string, field: string, validUntil = ""): Specialist => ({ id: name, name, field, certificate: "", type: "A", via: "", note: "", validUntil });

test("certificate expiry: within 3 months → soon, past → expired, blank → silent, month-only = end of month", () => {
	const now = new Date("2026-07-10T12:00:00");
	const list = [sp("a", "x", "2026-09-30"), sp("b", "x", "2027-12-31"), sp("c", "x", "2026-06-30"), sp("d", "x", ""), sp("e", "x", "2026-09")];
	const e = expiring(list, now);
	assert.deepEqual(e.map((x) => [x.name, x.status]), [["a", "soon"], ["c", "expired"], ["e", "soon"]]);
});

test("coverage by distinctive words — the original Salacgrīva mistake: nobody covers electronic communications", { skip: !have }, () => {
	const r = importFromSkillData({ uznemums: read("uznemums.md"), specialisti: read("specialisti.md"), objekti: read("atsauces_objekti.md") });
	const required = [
		"Atbildīgais būvprojekta vadītājs",
		"Elektroietaišu sistēmu projektēšanā sertificēts projektētājs",
		"Ūdensapgādes un kanalizācijas sistēmu projektēšanā sertificēts projektētājs",
		"Siltumapgādes, ventilācijas un gaisa kondicionēšanas sistēmu projektēšanā sertificēts projektētājs",
		"elektronisko sakaru sistēmu un tīklu projektēšanā sertificēts projektētājs",
	];
	const cov = coverage(required, r.specialists);
	console.log("  " + cov.map((c) => `${c.covered ? "✓" : "✗"} ${c.required.slice(0, 40)} ← ${c.by.map((b) => b.name).join(", ") || "—"}`).join("\n  "));
	assert.deepEqual(cov.map((c) => c.covered), [true, true, true, true, false]);
	assert.ok(cov[1].by.some((b) => b.name === "Igors Musijenko" && b.type === "B"), "the subcontractor covers electrical, visibly as type B");
});

test("covers: related-looking but different fields are not confused", () => {
	assert.equal(covers("elektronisko sakaru sistēmu un tīklu projektēšanā", "Elektroietaišu projektēšana (līdz 1 kV)"), false);
	assert.equal(covers("Elektroietaišu sistēmu projektēšanā sertificēts projektētājs", "Elektronisko sakaru sistēmu un tīklu projektēšana"), false);
	assert.equal(covers("Siltumapgādes sistēmu projektēšanā", "Siltumapgādes, ventilācijas un gaisa kondicionēšanas sistēmu projektēšana"), true);
	assert.deepEqual([...stems("Ūdensapgādes un kanalizācijas sistēmu projektēšanā")], ["udensapga", "kanalizac"]);
});

test("parseObjects ignores non-numbered sections (summary matrix)", () => {
	const o = parseObjects("## 1. Objekts A\n\n| Lauks | Vērtība |\n|---|---|\n| Platība | 100 m² |\n\n## Kopsavilkuma matrica\n\n| a | b |\n|---|---|\n| x | y |\n");
	assert.equal(o.length, 1);
	assert.equal(o[0].name, "Objekts A");
});
