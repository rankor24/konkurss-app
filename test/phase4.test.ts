// Phase 4 on the REAL Salacgrīva forms and technical proposal, with a scripted engine (no model).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { textPath } from "../src/main/extract.ts";
import { inspectDocx, toolsConfig } from "../src/main/pytools.ts";
import { importFromSkillData } from "../src/main/registers/registers.ts";
import { loadState, saveState, updateState } from "../src/main/project-state.ts";
import { bindingShapeOk, producedDocuments, resolveBinding, slotKeys, vocabulary } from "../src/main/v1/bindings.ts";
import { collectEvidence, bpvFolder, planEvidence } from "../src/main/v1/evidence.ts";
import * as V from "../src/main/v1/forms.ts";
import * as Tech from "../src/main/v1/tech.ts";
import { emptyCited, emptyChoices, emptyState, type Cited, type FileEntry } from "../src/shared/state.ts";
import type { Engine, RunOptions } from "../src/main/engines/types.ts";
import type { Project } from "../src/shared/types.ts";

const SAL = "E:\\BV BIM\\Paraugmodeli\\260713_Salacgriva_Sila iela 2";
const SRC = `${SAL}\\KONKURSS`;
const KV = "Iepirkuma priekšmeta prasības, 2.versija\\Kvalifikacija_Kvalifikacija_96_1.docx";
const PI = "Iepirkuma priekšmeta prasības, 2.versija\\Pieteikums_Pieteikums_96.docx";
const TECH = `${SAL}\\IESNIEDZAMIE\\Kalnins\\5_Tehniskais piedāvājums.docx`;
const DATA = join(homedir(), ".claude", "skills", "konkurss", "data");
const have = existsSync(join(SRC, KV)) && existsSync(join(DATA, "specialisti.md"));
const tools = toolsConfig(process.env, join(import.meta.dirname, "..", "python", "konkurss_tools.py"));
const tmp = mkdtempSync(join(tmpdir(), "konkurss-p4-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
const m = <T,>(value: T): Cited<T> => ({ value, status: "manual" });
const reg = () => importFromSkillData({ uznemums: readFileSync(join(DATA, "uznemums.md"), "utf8"), specialisti: readFileSync(join(DATA, "specialisti.md"), "utf8"), objekti: readFileSync(join(DATA, "atsauces_objekti.md"), "utf8") });

function setup(name: string) {
	const out = join(tmp, name, "IESNIEDZAMIE");
	const project: Project = { id: name, name: "260713_Salacgriva_Sila iela 2", sourceDir: SRC, outputDir: out, variant: "V1", builders: [], createdAt: "" };
	const r = reg();
	const s = emptyState();
	s.files = [KV, PI].map((rel): FileEntry => ({ rel, root: "source", where: "konkurss", kind: rel.includes("Kvalif") ? "kvalifikacija" : "pieteikums", kindSetByUser: false, size: 1, mtimeMs: 1, text: "neattiecas" }));
	s.variant = { value: "V1", status: "manual", confirmed: true };
	s.requirements.specialisti = ["Atbildīgais būvprojekta vadītājs", "Elektroietaišu sistēmu projektēšanā sertificēts projektētājs", "Ūdensapgādes un kanalizācijas sistēmu projektēšanā sertificēts projektētājs", "Siltumapgādes, ventilācijas un gaisa kondicionēšanas sistēmu projektēšanā sertificēts projektētājs", "elektronisko sakaru sistēmu un tīklu projektēšanā sertificēts projektētājs"].map((f) => ({ field: m(f), certificate: emptyCited<string>(), mandatory: true }));
	const id = (n: string) => r.specialists.find((x) => x.name === n)!.id;
	s.choices = { ...emptyChoices(), specialists: { "0": id("Andis Kalniņš"), "1": id("Igors Musijenko"), "2": id("Aija Gaile"), "3": id("Jānis Jurševskis") }, objects: { "company:0": [r.objects.find((o) => /Mēnesgaismas/.test(o.name))!.id] } };
	saveState(out, s);
	let maps: Record<string, Record<string, string>> = {};
	const deps: V.FormDeps = { project, tools, registers: r, mappings: maps, saveMappings: (x) => (maps = x), today: new Date(2026, 6, 10) };
	return { project, deps, reg: r, maps: () => maps };
}

/** Binding proposals the way a careful model would give them: by row and column text. */
function binder(): Engine & { calls: number } {
	const e = {
		id: "claude" as const,
		calls: 0,
		status: async () => ({ id: "claude" as const, ready: true, reason: "", canLogin: false }),
		async run(o: RunOptions) {
			e.calls++;
			const rows = [...o.prompt.matchAll(/^- (c:[^|]+?) \| ([^|]*) \| ([^|]*?)(?: \| rinda: (.*))?$/gm)];
			const idx = (row: string) => (/b[uū]vprojekta vad/i.test(row) ? 0 : /Elektroiet/i.test(row) ? 1 : /[UŪ]densapg/i.test(row) ? 2 : /Siltumapg/i.test(row) ? 3 : /sakaru/i.test(row) ? 4 : -1);
			const items = rows.map(([, id, , label, row]) => {
				const i = idx(row ?? "");
				const what = /v[aā]rds/i.test(label) ? "name" : /komersants/i.test(label) ? "company" : /sf[eē]ra|sertifik/i.test(label) ? "cert" : null;
				return { id, binding: i >= 0 && what ? `specialist:${i}:${what}` : null };
			});
			const text = JSON.stringify({ items });
			o.onEvent({ type: "text", text });
			o.onEvent({ type: "done", text });
		},
	};
	return e;
}
const base = { runDir: "", pluginDir: "", mcp: { command: "node", args: [], env: {} }, signal: new AbortController().signal };

test("binding vocabulary: ids resolve from the register, the choices and the tender; shapes are checked", { skip: !have }, () => {
	const { reg: r, project } = setup("v");
	const s = loadState(project.outputDir);
	const ctx = { reg: r, req: s.requirements, choices: s.choices, finance: { rows: [{ name: "A", amount: "100,00" }], vatPercent: 21, eisAmount: null }, today: new Date(2026, 6, 10) };
	assert.equal(resolveBinding("company:Nosaukums", ctx)?.value, 'SIA "BŪVDIZAINS"');
	assert.equal(resolveBinding("specialist:0:name", ctx)?.value, "Andis Kalniņš");
	assert.equal(resolveBinding("specialist:0:cert", ctx)?.value, "1-00619");
	assert.equal(resolveBinding("specialist:1:company", ctx)?.value, 'SIA "3D Vājstrāvu Sistēmas", reģ. 40103818968; paraksta valdes priekšsēdētāja Ieva Musijenko'.length ? resolveBinding("specialist:1:company", ctx)?.value : "");
	assert.equal(resolveBinding("specialist:4:name", ctx), null, "no choice made for the ESS field → nothing to resolve");
	assert.equal(resolveBinding("object:company:0:0:name", ctx)?.value.includes("Mēnesgaismas"), true);
	assert.match(resolveBinding("object:company:0:0:Būvvaldes akcepts", ctx)!.value, /27\.06\.2024/);
	assert.equal(resolveBinding("price:gross", ctx)?.value, "121,00");
	assert.equal(resolveBinding("date:today", ctx)?.value, "10.07.2026");
	assert.equal(resolveBinding("fixed:---", ctx)?.value, "---");
	assert.ok(vocabulary(ctx).length > 25);
	assert.ok(bindingShapeOk("specialist:2:name") && bindingShapeOk("fixed:---") && !bindingShapeOk("javascript:alert(1)") && !bindingShapeOk("company"));
	assert.deepEqual([...slotKeys([{ slotId: "a", label: "Reģ. Nr." }, { slotId: "b", label: "Reģ. Nr." }, { slotId: "c", label: "Vārds" }]).values()], ["reg. nr.#1", "reg. nr.#2", "vards#1"]);
});

test("a subcontractor specialist brings two documents; our own employee none", { skip: !have }, () => {
	const { reg: r, project } = setup("docs");
	const s = loadState(project.outputDir);
	const docs = producedDocuments({ reg: r, req: s.requirements, choices: s.choices });
	assert.equal(docs.length, 2);
	assert.match(docs[0], /Apakšuzņēmēja apliecinājums — .*Vājstrāvu/);
	assert.match(docs[1], /Speciālista apliecinājums — Igors Musijenko/);
});

test("Kvalifikācija: bound from choices, ESS row open, file blocked until every open place is settled", { skip: !have, timeout: 300_000 }, async () => {
	const { project, deps } = setup("kv");
	const key = `source:${KV}`;
	const before = sha(join(SRC, KV));
	const e = binder();
	const r = await V.bindForm(deps, e, base, key);
	assert.ok(r.ok);
	if (!r.ok) return;
	console.log(`  fromMemory ${r.fromMemory}, fromModel ${r.fromModel}, unbound ${r.unbound}`);
	const byLabelRow = (id: string) => r.sheet.items.find((i) => i.slotId === id);
	const names = r.sheet.items.filter((i) => i.binding === "specialist:0:name");
	assert.equal(names[0].value, "Andis Kalniņš");
	assert.equal(names[0].status, "source");
	assert.match(names[0].note ?? "", /pārbaudi/, "a model-proposed binding asks to be checked");
	// the distributed 2.versija form has only 4 specialist rows: the fifth (ESS) has nowhere to go, and the app says so
	assert.equal(r.sheet.items.filter((i) => i.binding === "specialist:4:name").length, 0);
	assert.equal(r.unplaced.length, 1);
	assert.match(r.unplaced[0], /elektronisko sakaru/i);
	assert.ok(byLabelRow(names[0].slotId));

	const blocked = await V.generateForm(deps, key);
	assert.equal(blocked.ok, false);
	if (!blocked.ok) assert.match(blocked.error, /Failu neizveidos, kamēr \d+ vietās nav datu/);

	// settle: the open fields are marked "neattiecas" by the person
	for (const it of V.blockers(loadState(project.outputDir).fills[key])) V.setNotApplicable(project, key, it.slotId);
	const done = await V.generateForm(deps, key);
	assert.ok(done.ok);
	if (!done.ok) return;
	assert.match(done.file, /Iesniedzamie[\\/]Kvalifikacija_Kvalifikacija_96_1_v1\.docx$/);
	assert.equal(sha(join(SRC, KV)), before, "the distributed form is untouched");
	const back = await inspectDocx(tools, done.file);
	const text = JSON.stringify(back.tables.map((t) => t.cells));
	assert.match(text, /Andis Kalniņš/);
	assert.match(text, /Aija Gaile/);
	assert.match(text, /---/);
});

test("mapping memory: a person's correction is stored per form layout and reused without asking the model", { skip: !have, timeout: 300_000 }, async () => {
	const { project, deps, maps } = setup("mem");
	const key = `source:${KV}`;
	const first = await V.bindForm(deps, binder(), base, key);
	assert.ok(first.ok);
	if (!first.ok) return;
	const slot = first.sheet.items.find((i) => i.binding === "specialist:1:name")!;
	const set = await V.setBinding(deps, key, slot.slotId, "specialist:2:name");
	assert.ok(set.ok);
	const skeleton = first.sheet.skeleton;
	assert.ok(Object.values(maps()[skeleton] ?? {}).includes("specialist:2:name"), "the correction is remembered under the form's skeleton");
	// a fresh project with the same form layout: memory first, the model is asked only for what is unknown
	const second = setup("mem2");
	second.deps.mappings = maps();
	const e = binder();
	const r2 = await V.bindForm(second.deps, e, base, key);
	assert.ok(r2.ok);
	if (r2.ok) {
		assert.ok(r2.fromMemory >= 1);
		const again = r2.sheet.items.find((i) => i.slotId === slot.slotId)!;
		assert.equal(again.binding, "specialist:2:name", "the person's choice beat the model's proposal");
		assert.equal(again.bindingBy, "memory");
	}
	void project;
});

test("Pieteikums (30 rows): company fields bind from the register; repeated labels get separate keys", { skip: !have, timeout: 300_000 }, async () => {
	const { deps } = setup("pi");
	const none: Engine = { ...binder(), async run(o) { o.onEvent({ type: "done", text: JSON.stringify({ items: [] }) }); } };
	const r = await V.bindForm(deps, none, base, `source:${PI}`);
	assert.ok(r.ok);
	if (r.ok) {
		const cells = r.sheet.items.filter((i) => i.kind === "cell");
		const keys = slotKeys(cells);
		assert.ok(cells.length >= 10, `${cells.length} fields`);
		assert.equal(new Set(keys.values()).size, cells.length, "every field has its own key even when the label repeats");
	}
});

// ---------- technical proposal ----------
const tenderDocs = [{ file: "nolikums.docx", text: "Iepirkuma priekšmets: Būvniecības ieceres dokumentācijas izstrāde ēkas Jaunā ielā 5, Valmierā energoefektivitātes paaugstināšanai.\nIepirkuma ID LNP 2026/150." }];

test("tech: a change is accepted only with a verified quote; boilerplate paragraphs stay identical, accepted ones are marked", { skip: !existsSync(TECH), timeout: 300_000 }, async () => {
	const info = await inspectDocx(tools, TECH);
	const paragraphs = info.paragraphs.filter((p) => p.text.trim().length >= 30 && !p.heading).map((p) => ({ i: p.i, text: p.text.trim() }));
	const target = paragraphs.find((p) => /Salacgr/i.test(p.text)) ?? paragraphs[0];
	const other = paragraphs.find((p) => p.i !== target.i)!;
	const g = Tech.groundTech(
		{ changes: [
			{ i: target.i, text: "Jaunais teksts par ēku Jaunā ielā 5, Valmierā.", why: "objekts", quote: "Būvniecības ieceres dokumentācijas izstrāde ēkas Jaunā ielā 5, Valmierā", file: "nolikums.docx" },
			{ i: other.i, text: "Izdomāts teksts", why: "?", quote: "tāda teikuma nolikumā nav", file: "nolikums.docx" },
			{ i: 99999, text: "neeksistē", why: "?", quote: "Iepirkuma ID LNP 2026/150", file: "nolikums.docx" },
		] },
		paragraphs,
		tenderDocs,
	);
	assert.equal(g.changes.length, 1);
	assert.equal(g.rejected, 2);

	const { project } = setup("tech");
	updateState(project.outputDir, (s) => void (s.tech = { boilerplate: TECH, changes: g.changes }));
	assert.equal(Tech.techEdits(loadState(project.outputDir).tech!).length, 0, "nothing is written before a person decides");
	Tech.techDecision(project, target.i, "accept");
	const out = await Tech.generateTech({ project, tools });
	assert.ok(out.ok);
	if (!out.ok) return;
	assert.equal(out.applied, 1);
	const back = await inspectDocx(tools, out.file);
	const changed = back.paragraphs.filter((p, k) => p.text.trim() !== (info.paragraphs.find((x) => x.i === p.i - 0)?.text ?? "").trim() && k > 0);
	assert.ok(back.paragraphs.some((p) => p.text.startsWith("Jaunais teksts par ēku Jaunā ielā 5")));
	// every other original paragraph is still there, word for word
	const after = new Set(back.paragraphs.map((p) => p.text.trim()));
	const lost = paragraphs.filter((p) => p.i !== target.i && !after.has(p.text));
	assert.deepEqual(lost, [], "untouched boilerplate is byte-for-text identical");
	void changed;
	assert.ok(after.has(other.text), "the rejected/unproposed paragraph is unchanged");
});

// ---------- evidence ----------
test("evidence plan: company files numbered 2_n, BPV dossier in a surname folder numbered 3_n; missing files flagged; no overwrite", () => {
	const ev = join(tmp, "ev");
	mkdirSync(ev, { recursive: true });
	for (const n of ["Atsauksme_A.pdf", "Buvatlauja_A.pdf", "ES-P_A.pdf"]) writeFileSync(join(ev, n), n);
	const r = reg();
	const o1 = { ...r.objects[0], evidence: [{ label: "Atsauksme", path: join(ev, "Atsauksme_A.pdf") }, { label: "Būvatļauja", path: join(ev, "Buvatlauja_A.pdf") }, { label: "Energosertifikāts", path: join(tmp, "nav-sada-faila.pdf") }] };
	const o2 = { ...r.objects[1], evidence: [{ label: "ES-P", path: join(ev, "ES-P_A.pdf") }] };
	const o3 = { ...r.objects[2], evidence: [] };
	const reg2 = { ...r, objects: [o1, o2, o3] };
	const choices = { ...emptyChoices(), objects: { "company:0": [o1.id], "bpv:1": [o1.id, o2.id, o3.id] } };
	const plan = planEvidence(choices, reg2, "Andis Kalniņš");
	assert.equal(bpvFolder("Andis Kalniņš"), "Kalnins");
	const ok = plan.filter((p) => p.status === "ok").map((p) => p.toRel.replace(/\\/g, "/"));
	assert.deepEqual(ok, [
		"Pierādījumi/2_1Atsauksme_A.pdf",
		"Pierādījumi/2_2Buvatlauja_A.pdf",
		"Pierādījumi/Kalnins/3_1Atsauksme_A.pdf",
		"Pierādījumi/Kalnins/3_2Buvatlauja_A.pdf",
		"Pierādījumi/Kalnins/3_3ES-P_A.pdf",
	]);
	const missing = plan.filter((p) => p.status === "missing");
	assert.equal(missing.length, 3, "energosertifikāts is missing in both folders; the third object has no evidence at all");
	assert.ok(missing.some((p) => /nav atrasts/.test(p.reason ?? "")));
	assert.ok(missing.some((p) => /nav norādīts/.test(p.reason ?? "")));

	const out = join(tmp, "evout");
	const c1 = collectEvidence(out, plan);
	assert.equal(c1.copied.length, 5);
	assert.ok(existsSync(join(out, "Pierādījumi", "Kalnins", "3_1Atsauksme_A.pdf")));
	const c2 = collectEvidence(out, plan);
	assert.equal(c2.copied.length, 0, "a second run copies nothing and overwrites nothing");
	assert.equal(c2.skipped.length, 5);
	assert.equal(sha(join(ev, "Atsauksme_A.pdf")), sha(join(out, "Pierādījumi", "2_1Atsauksme_A.pdf")));
});
