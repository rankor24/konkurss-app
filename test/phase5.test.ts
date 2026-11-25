import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clarifyBlocks, clarifySchema, groundClarify, NO_CHANGE_LINE, SECRET_LINE } from "../src/main/checks/clarify.ts";
import { addObjectToRegister, getCloseout, objectFromTender, saveCloseout } from "../src/main/checks/closeout.ts";
import { deadlineFinding, eisTicks, parseDeadline } from "../src/main/checks/submission.ts";
import { groundProof, groundSpec, proofFinding, proofSchema, specFinding, specSchema } from "../src/main/checks/substance.ts";
import { loadState, updateState } from "../src/main/project-state.ts";
import { inspectDocx, toolsConfig, writeDocx } from "../src/main/pytools.ts";
import { emptyRegisters } from "../src/main/registers/registers.ts";
import { emptyState, type Cited } from "../src/shared/state.ts";
import { stepStatus } from "../src/shared/steps.ts";
import type { Project } from "../src/shared/types.ts";

const cfg = toolsConfig(process.env, join(import.meta.dirname, "..", "python", "konkurss_tools.py"));
const tmp = mkdtempSync(join(tmpdir(), "konkurss-p5-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const project = (name = "Salacgrīva"): Project => ({ id: "p", name, sourceDir: join(tmp, "src"), outputDir: join(tmp, name), variant: "V1", builders: [], createdAt: "" });
const cited = <T,>(value: T): Cited<T> => ({ value, status: "manual" });

// ---------- substance: both sides verified ----------
test("technical proposal vs spec: an answer counts only when its quote is really in OUR proposal; an invented requirement is dropped", () => {
	const tender = [{ file: "TS.docx", text: "Izpildītājam jānodrošina koordinācija ar visām inženierbūvju daļām.\nProjektēšanas termiņš ir 60 dienas." }];
	const ours = { file: "MŪSU PIEDĀVĀJUMS", text: "Mēs nodrošinām koordināciju ar visām inženierbūvju daļām ik nedēļu." };
	const res = specSchema.parse({
		items: [
			{ requirement_quote: "jānodrošina koordinācija ar visām inženierbūvju daļām", file: "TS.docx", status: "atbildets", answer_quote: "nodrošinām koordināciju ar visām inženierbūvju daļām", note: null },
			{ requirement_quote: "Projektēšanas termiņš ir 60 dienas", file: "TS.docx", status: "atbildets", answer_quote: "termiņš 60 dienas ir garantēts", note: null },
			{ requirement_quote: "Jāizmanto drons visiem jumtiem", file: "TS.docx", status: "neatbildets", answer_quote: null, note: null },
		],
	});
	const g = groundSpec(res, tender, ours);
	assert.equal(g.rejected, 1, "the invented requirement is dropped");
	assert.equal(g.items[0].status, "atbildets");
	assert.equal(g.items[1].status, "nepārbaudīts", "claimed answer whose quote is not in our proposal is not trusted");
	const f = specFinding(g.items, g.rejected);
	assert.equal(f.status, "warn");
	assert.equal(f.kind, "satura");
	assert.match(f.detail, /60 dienas/);
	assert.match(f.detail, /atbildi piedāvājumā neatrada/);
	assert.equal(f.cites?.[0].file, "TS.docx", "the requirement side is always cited");
	assert.equal(specFinding([], 0).status, "na");
	const ok = specFinding([g.items[0]], 0);
	assert.equal(ok.status, "ok");
	assert.deepEqual(ok.cites?.map((c) => c.file), ["TS.docx", "MŪSU PIEDĀVĀJUMS"], "an answered requirement cites both sides");
});

test("atsauksme vs claim: 'apstiprina' needs the proof quote in the atsauksme; contradiction is reported; unreadable atsauksme is said, not skipped", () => {
	const claims = [{ file: "REĢISTRS: Skola", text: "Skola\nPlatība: 4200 m2\nVeids: pamatskola" }];
	const proofs = [{ file: "ATSAUKSME: Skola", text: "Projektēta pamatskolas ēka ar platību 3100 m2." }];
	const res = proofSchema.parse({
		items: [
			{ object: "Skola", claim_quote: "Platība: 4200 m2", proof_quote: "ar platību 3100 m2", verdict: "pretruna", note: "platība atšķiras" },
			{ object: "Bibliotēka", claim_quote: "nav tāda teksta", proof_quote: null, verdict: "apstiprina", note: null },
		],
	});
	const items = groundProof(res, claims, proofs);
	assert.equal(items[0].verdict, "pretruna");
	assert.ok(items[0].claim && items[0].proof);
	assert.equal(items[1].verdict, "nepārbaudīts");
	const f = proofFinding(items, ["Slimnīca"]);
	assert.equal(f.status, "warn");
	assert.match(f.detail, /Skola: atsauksme runā pretī/);
	assert.match(f.detail, /Slimnīca: atsauksmes teksts nav nolasāms/);
	assert.equal(proofFinding([], []).status, "na");
});

// ---------- deadline + EIS ticks ----------
test("deadline: passed → fail, under 3 days → warn, later → ok, unknown/odd format → warn that says why", () => {
	const s = emptyState();
	const at = (date: string | null, time: string | null) => {
		s.deadline.date = date ? cited(date) : { value: null, status: "missing" };
		s.deadline.time = time ? cited(time) : { value: null, status: "missing" };
		return deadlineFinding(s, new Date(2026, 8, 18, 12, 0));
	};
	assert.equal(at("17.09.2026", "10:00").status, "fail");
	assert.equal(at("19.09.2026", "10:00").status, "warn");
	assert.equal(at("30.09.2026", "10:00").status, "ok");
	assert.match(at("30.09.2026", null).detail, /laiks nav zināms/);
	assert.equal(at(null, null).status, "warn");
	assert.equal(at("septembrī", null).status, "warn");
	assert.equal(parseDeadline("5.9.2026", "09:05")?.getHours(), 9);
	assert.equal(parseDeadline("nav", null), null);
});

test("EIS ticks: amount comes from the prices, mandatory documents from the requirements; the app never ticks by itself", () => {
	const s = emptyState();
	s.requirements.apaksuznemeji.threshold = cited(10000);
	s.requirements.dokumenti = [{ name: cited("Pieteikums dalībai"), mandatory: true }, { name: cited("Nav obligāts"), mandatory: false }];
	const t = eisTicks(s, 12345.6);
	assert.match(t.find((x) => x.id === "eis-amount")!.text, /12\s?345,60 EUR/);
	assert.ok(t.some((x) => x.text.includes("Pieteikums dalībai")));
	assert.ok(!t.some((x) => x.text.includes("Nav obligāts")));
	assert.match(eisTicks(emptyState(), null).find((x) => x.id === "eis-amount")!.source, /nav ievadītas/);
});

// ---------- closeout ----------
test("closeout: stored per project; the register object is added once, only with facts the app has", () => {
	const p = project();
	updateState(p.outputDir, (s) => {
		s.requirements.dati.subject = cited("Sila iela 2 ēkas projektēšana");
		s.requirements.dati.purchaser = cited("Salacgrīvas novada dome");
		s.requirements.dati.id = cited("LNP 2026/96");
	});
	assert.equal(getCloseout(p).result, null);
	saveCloseout(p, { result: "uzvara", lessons: "BPV bija jāsakrīt" });
	assert.equal(getCloseout(p).result, "uzvara");
	assert.equal(getCloseout(p).lessons, "BPV bija jāsakrīt", "a later partial save keeps the rest");
	const o = objectFromTender(p, "o1");
	assert.equal(o.name, "Sila iela 2 ēkas projektēšana");
	assert.deepEqual(o.fields.filter((f) => f.key !== "Piezīme").map((f) => f.key), ["Pasūtītājs", "Iepirkuma ID"], "contract type was not read, so it is not invented");
	assert.ok(o.fields.some((f) => /papildināt|jāpapildina/i.test(f.value)), "says what is left for the person");
	const reg = emptyRegisters();
	const r1 = addObjectToRegister(p, reg);
	assert.ok(r1.ok);
	assert.equal(r1.ok && r1.registers.objects.length, 1);
	const r2 = addObjectToRegister(p, r1.ok ? r1.registers : reg);
	assert.equal(r2.ok, false, "second call refused — no duplicate from one tender");
	assert.equal(reg.objects.length, 0, "the input register is not mutated");
});

test("step statuses 8–10 follow the state", () => {
	const s = emptyState();
	assert.equal(stepStatus(s, "parbaude"), "nav");
	s.checks = { ranAt: "t", findings: [{ id: "a", status: "fail" }, { id: "b", status: "warn" }] };
	assert.equal(stepStatus(s, "parbaude"), "problema");
	s.checkAck = { a: true };
	assert.equal(stepStatus(s, "parbaude"), "proc", "an acknowledged fail does not block, but the warning is still open");
	s.checkAck = { a: true, b: true };
	assert.equal(stepStatus(s, "parbaude"), "gatavs");
	assert.equal(stepStatus(s, "paraksti"), "nav");
	s.signaturesSummary = { total: 3, ok: 2, wrong: 0 };
	assert.equal(stepStatus(s, "paraksti"), "proc");
	s.signaturesSummary = { total: 3, ok: 2, wrong: 1 };
	assert.equal(stepStatus(s, "paraksti"), "problema");
	s.signaturesSummary = { total: 3, ok: 3, wrong: 0 };
	assert.equal(stepStatus(s, "paraksti"), "gatavs");
	assert.equal(stepStatus(s, "rezultats"), "nav");
	s.closeout = { submittedAt: "2026-09-18", result: null };
	assert.equal(stepStatus(s, "rezultats"), "proc");
	s.closeout = { submittedAt: "2026-09-18", result: "uzvara" };
	assert.equal(stepStatus(s, "rezultats"), "gatavs");
});

// ---------- clarification ----------
test("clarification: answers need a quote from OUR submitted documents; unsupported questions are left for the person; fixed lines present", () => {
	const submitted = [{ file: "Kvalifikacija_v1.docx", text: "BIM koordinators ir Jānis Kreics, SIA BŪVDIZAINS darbinieks." }];
	const res = clarifySchema.parse({
		answers: [
			{ question: "Kas ir BIM koordinators?", answer: "BIM koordinators ir Jānis Kreics.", quote: "BIM koordinators ir Jānis Kreics", file: "Kvalifikacija_v1.docx" },
			{ question: "Kāda programmatūra tiek izmantota?", answer: "", quote: null, file: null },
			{ question: "Cik ilgi?", answer: "Seši mēneši.", quote: "seši mēneši", file: "Kvalifikacija_v1.docx" },
		],
	});
	const d = groundClarify(res, submitted);
	assert.equal(d.answered.length, 1);
	assert.equal(d.unsupported.length, 2);
	assert.match(d.unsupported[1].why, /citātu/);
	const blocks = clarifyBlocks({ project: "Sila iela 2", draft: d, secret: true, today: "18.09.2026" });
	const text = blocks.map((b) => ("text" in b ? b.text : "heading" in b ? b.heading : "")).join("\n");
	assert.match(text, /Kas ir BIM koordinators\?/);
	assert.match(text, /Pamatojums iesniegtajā dokumentā \(Kvalifikacija_v1\.docx\)/);
	assert.match(text, /\[aizpildīt\]/, "unsupported question stays a red-marker gap, not an invented answer");
	assert.ok(text.includes(NO_CHANGE_LINE));
	assert.ok(text.includes(SECRET_LINE));
	const noSecret = clarifyBlocks({ project: "x", draft: d, secret: false, today: "d" }).map((b) => ("text" in b ? b.text : "")).join("\n");
	assert.ok(!noSecret.includes(SECRET_LINE));
});

test("write-docx makes one new document with headings, text and the answers; refuses to overwrite", { timeout: 120_000 }, async () => {
	const dst = join(tmp, "out", "Precizejums.docx");
	const blocks = clarifyBlocks({ project: "Sila iela 2", draft: { answered: [{ question: "Jautājums?", answer: "Atbilde.", cite: { file: "a.docx", quote: "citāts" } }], unsupported: [] }, secret: false, today: "18.09.2026" });
	await writeDocx(cfg, { dst, blocks });
	assert.ok(existsSync(dst));
	const back = await inspectDocx(cfg, dst);
	const all = back.paragraphs.map((p) => p.text).join("\n");
	assert.match(all, /Atbilde uz iepirkuma komisijas pieprasījumu/);
	assert.match(all, /Atbilde\./);
	assert.match(all, /negrozot piedāvājuma saturu/);
	await assert.rejects(() => writeDocx(cfg, { dst, blocks }), /jau pastāv/);
	assert.ok(readFileSync(dst).length > 1000);
	assert.equal(loadState(project().outputDir).schema, 1);
});
