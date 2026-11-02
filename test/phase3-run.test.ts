// End-to-end of the fill pipeline on the REAL NVA BIP template + matrica, with a scripted engine (no model).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as F from "../src/main/fill/run.ts";
import { inspectDocx, toolsConfig } from "../src/main/pytools.ts";
import { loadState, saveState, updateState } from "../src/main/project-state.ts";
import { textPath } from "../src/main/extract.ts";
import { emptyRegisters } from "../src/main/registers/registers.ts";
import { emptyState, type FileEntry } from "../src/shared/state.ts";
import type { Engine, RunOptions } from "../src/main/engines/types.ts";
import type { Project } from "../src/shared/types.ts";

const SRC = "E:\\BV BIM\\Paraugmodeli\\260811_NVA_Remonta baze\\KONKURSS";
const BIP = "5.pielikums_Pirms_liguma_BIP.docx";
const MATRICA = "5.A.pielikums_Atbildibas_matrica.xlsx";
const have = existsSync(join(SRC, BIP)) && existsSync(join(SRC, MATRICA));
const tools = toolsConfig(process.env, join(import.meta.dirname, "..", "python", "konkurss_tools.py"));
const tmp = mkdtempSync(join(tmpdir(), "konkurss-p3run-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

const PIP_TEXT = "PIP 5.1. Vienotā datu vide jānodrošina visiem projekta dalībniekiem.\nProjekta nosaukums: Ugunsdzēsības, loģistikas un remonta bāzes komplekss\nPasūtītājs: Nodrošinājuma valsts aģentūra";

function setup(name: string, builders: string[]) {
	const out = join(tmp, name, "IESNIEDZAMIE");
	const project: Project = { id: name, name: "260811_NVA_Remonta baze", sourceDir: SRC, outputDir: out, variant: "V2", builders, createdAt: "" };
	const s = emptyState();
	const mk = (rel: string, kind: FileEntry["kind"], text?: string): FileEntry => {
		const f: FileEntry = { rel, root: "source", where: "konkurss", kind, kindSetByUser: false, size: 1, mtimeMs: 1, text: text ? "ok" : "neattiecas" };
		if (text) {
			mkdirSync(join(textPath(project, f), ".."), { recursive: true });
			writeFileSync(textPath(project, f), text, "utf8");
		}
		return f;
	};
	s.files = [mk(BIP, "bip_veidne"), mk(MATRICA, "matrica"), mk("PIP.docx", "pip", PIP_TEXT), mk("NOLIKUMS.docx", "nolikums", PIP_TEXT)];
	s.variant = { value: "V2", status: "manual", confirmed: true };
	s.versions.inForce = "original";
	s.roles = {
		design: [
			{ id: "1", role: "Projekta informācijas vadītājs / BIM koordinators", part: "", company: "SIA BŪVDIZAINS", person: "Jānis Kreics" },
			{ id: "2", role: "BIM modeļa autors", part: "AR", company: "SIA BŪVDIZAINS", person: "Truševska" },
		],
		build: Object.fromEntries(builders.map((b) => [b, [{ id: b, role: "4D speciālists", part: "", company: `${b} SIA`, person: `Persona ${b}` }]])),
	};
	saveState(out, s);
	return project;
}

/** Answers cell prompts and section prompts the way a good model would: grounded quotes only. */
function scripted(): Engine & { calls: string[] } {
	const calls: string[] = [];
	return {
		id: "claude",
		calls,
		status: async () => ({ id: "claude", ready: true, reason: "", canLogin: false }),
		async run(o: RunOptions) {
			calls.push(o.prompt.includes("LAUKI:") ? "cells" : o.prompt.includes("FRAGMENTI") ? "focused" : "sections");
			let reply: unknown;
			if (o.prompt.includes("LAUKI:")) {
				reply = { items: [
					{ id: "c:t0:r0:c1", value: "Ugunsdzēsības, loģistikas un remonta bāzes komplekss", quote: "Projekta nosaukums: Ugunsdzēsības, loģistikas un remonta bāzes komplekss", file: "PIP.docx" },
					{ id: "c:t0:r1:c1", value: "Nodrošinājuma valsts aģentūra", quote: "Pasūtītājs: Nodrošinājuma valsts aģentūra", file: "PIP.docx" },
				] };
			} else {
				const ids = [...o.prompt.matchAll(/### (s:p\d+)/g)].map((m) => m[1]);
				reply = { items: ids.map((id) => (Number(id.slice(3)) % 3 === 2
					? { id, text: "Izdomāts teksts bez avota", sources: [{ quote: "šī teikuma dokumentā nav", file: "PIP.docx" }], missing: [] }
					: { id, text: "Tiks nodrošināta atbilstība PIP 5.1.", sources: [{ quote: "Vienotā datu vide jānodrošina visiem projekta dalībniekiem", file: "PIP.docx" }], missing: ["izmantotā VDV platforma"] })) };
			}
			const text = JSON.stringify(reply);
			o.onEvent({ type: "text", text });
			o.onEvent({ type: "done", text });
		},
	};
}
const base = { runDir: "", pluginDir: "", mcp: { command: "node", args: [], env: {} }, signal: new AbortController().signal };
const deps = (project: Project, others: Project[] = []): F.RunDeps => ({ project, tools, registers: { ...emptyRegisters(), company: { fields: [{ key: "Nosaukums", value: 'SIA "BŪVDIZAINS"' }], persons: [], answers: [] } }, otherProjects: others, extraForeign: [] });

test("pipeline: inspect → code fill → model fill (grounded) → versioned files → template untouched", { skip: !have, timeout: 400_000 }, async () => {
	const project = setup("a", ["UPB", "Pillar"]);
	const key = `source:${BIP}`;
	const before = sha(join(SRC, BIP));
	const ins = await F.inspectTemplate(deps(project), key);
	assert.ok(ins.ok && ins.sheet.items.length > 80);

	const engine = scripted();
	const filled = await F.fillFromTender(deps(project), engine, base, key);
	assert.ok(filled.ok);
	if (!filled.ok) return;
	assert.ok(engine.calls.includes("cells") && engine.calls.includes("sections"));
	assert.ok(engine.calls.filter((c) => c === "sections").length >= 5, "sections go in batches of 10");
	const cell = (l: string) => filled.sheet.items.find((i) => i.label === l)!;
	assert.equal(cell("Projekta nosaukums").status, "source");
	assert.equal(cell("Projekta nosaukums").cites[0].file, "PIP.docx");
	const sections = filled.sheet.items.filter((i) => i.kind === "section");
	const ok = sections.filter((i) => i.status === "source");
	const rejected = sections.filter((i) => i.status === "missing" && /citāts dokumentos netika atrasts/.test(i.note ?? ""));
	console.log(`  ${sections.length} sections: ${ok.length} grounded, ${rejected.length} rejected (made-up source)`);
	assert.ok(ok.length > 20 && rejected.length > 10);
	assert.ok(filled.rejected >= rejected.length, "a section rejected in the first pass may be asked again in the focused pass, so it can be rejected twice");
	const second = engine.calls.filter((c) => c === "focused").length;
	assert.ok(second <= sections.length - ok.length, "the focused pass asks once per section that was still empty, never for a filled one");
	assert.ok(ok.every((i) => i.cites.length > 0 && /^Papildināt: izmantotā VDV platforma/.test(i.note ?? "")));

	// base copy, then a second one: new version number, the first stays
	const g1 = await F.generate(deps(project), key);
	assert.ok(g1.ok);
	if (!g1.ok) return;
	assert.match(g1.generated.file, /Pirms-liguma BIP[\\/]5\.pielikums_Pirms_liguma_BIP_v1\.docx$/);
	const h1 = sha(g1.generated.file);
	const g2 = await F.generate(deps(project), key);
	assert.ok(g2.ok && /_v2\.docx$/.test(g2.generated.file));
	assert.equal(sha(g1.generated.file), h1, "version 1 untouched by version 2");
	assert.equal(sha(join(SRC, BIP)), before, "template byte-identical");

	const doc = await inspectDocx(tools, g1.generated.file);
	assert.equal(doc.tables[0].cells[0][1].split("\n")[0], "Ugunsdzēsības, loģistikas un remonta bāzes komplekss");
	assert.equal(doc.tables[0].cells[2][1].split("\n")[0], 'SIA "BŪVDIZAINS"'.slice(0, 0) + "BŪVNIEKS", "V2 base copy: the bidder is a builder → marker, not our company");
	assert.ok(doc.paragraphs.some((p) => /^Tiks nodrošināta atbilstība PIP 5\.1\./.test(p.text)));
	assert.ok(doc.paragraphs.some((p) => /Papildināt: izmantotā VDV platforma/.test(p.text)));
	assert.equal(g1.generated.leaks.clean, true);
});

test("builder copies: each builder gets its own folder and people; no other builder's data; a planted leak is caught", { skip: !have, timeout: 400_000 }, async () => {
	const project = setup("b", ["UPB", "Pillar"]);
	const key = `source:${BIP}`;
	await F.inspectTemplate(deps(project), key);
	const r = await F.builderCopies(deps(project), key);
	assert.ok(r.ok);
	if (!r.ok) return;
	assert.equal(r.copies.length, 2);
	const [upb, pillar] = r.copies;
	assert.match(upb.file, /UPB[\\/].*_UPB_v1\.docx$/);
	assert.match(pillar.file, /Pillar[\\/].*_Pillar_v1\.docx$/);
	const dU = await inspectDocx(tools, upb.file);
	const dP = await inspectDocx(tools, pillar.file);
	const text = (d: typeof dU) => JSON.stringify([d.paragraphs.map((p) => p.text), d.tables.map((t) => t.cells)]);
	assert.match(text(dU), /Persona UPB/);
	assert.doesNotMatch(text(dU), /Pillar/, "UPB copy contains nothing of Pillar");
	assert.match(text(dP), /Persona Pillar/);
	assert.doesNotMatch(text(dP), /UPB/, "Pillar copy contains nothing of UPB");
	assert.ok(upb.leaks.clean && pillar.leaks.clean);
	assert.equal(dU.tables[0].cells[2][1].split("\n")[0], "UPB", "bidder = the builder");

	// plant another builder's person into UPB's value sheet → the next UPB copy must be flagged
	updateState(project.outputDir, (s) => {
		const it = s.fills[key].items.find((i) => i.kind === "section")!;
		Object.assign(it, { value: "Saskaņots ar Persona Pillar.", status: "manual", by: "manual", cites: [] });
	});
	const bad = await F.generate(deps(project), key, "UPB");
	assert.ok(bad.ok);
	if (bad.ok) {
		assert.equal(bad.generated.leaks.clean, false);
		assert.ok(bad.generated.leaks.foreign.some((h) => /Persona Pillar|Pillar/.test(h.term ?? "")));
	}
});

test("foreign tender names in a document are reported (copy-paste from an earlier tender)", { skip: !have, timeout: 300_000 }, async () => {
	const project = setup("c", []);
	const other: Project = { id: "other", name: "260713_Salacgriva_Sila iela 2", sourceDir: "", outputDir: join(tmp, "other"), variant: null, builders: [], createdAt: "" };
	const key = `source:${BIP}`;
	await F.inspectTemplate(deps(project, [other]), key);
	F.setItem(project, key, loadState(project.outputDir).fills[key].items.find((i) => i.kind === "section")!.slotId, "Kā Salacgriva Sila iela 2 projektā.");
	const g = await F.generate(deps(project, [other, project]), key);
	assert.ok(g.ok);
	if (g.ok) {
		assert.equal(g.generated.leaks.clean, false);
		assert.deepEqual(g.generated.leaks.foreign.map((h) => h.term), ["Salacgriva Sila iela 2"]);
	}
});

test("matrica pipeline: authors from roles into a NEW versioned xlsx; template LODs kept; other builder's author never appears", { skip: !have, timeout: 300_000 }, async () => {
	const project = setup("d", ["UPB", "Pillar"]);
	const key = `source:${MATRICA}`;
	const before = sha(join(SRC, MATRICA));
	const r = await F.fillMatrica(deps(project), null, null, key, "UPB");
	assert.ok(r.ok);
	if (!r.ok) return;
	console.log(`  authors filled ${r.result.filledAuthors}, missing ${r.result.missingAuthors}, kept ${r.result.keptCells}`);
	assert.match(r.result.file, /UPB[\\/].*_UPB_v1\.xlsx$/);
	assert.equal(sha(join(SRC, MATRICA)), before);
	assert.ok(r.result.filledAuthors >= 1 && r.result.missingAuthors > 10);
	assert.ok(r.result.keptCells >= 7, "the combined-model author cells were already filled in the template");
	const r2 = await F.fillMatrica(deps(project), null, null, key, "UPB");
	assert.ok(r2.ok && /_v2\.xlsx$/.test(r2.result.file));
});

test("nextVersionPath numbers files per stem and never reuses a number", () => {
	const dir = join(tmp, "versions");
	mkdirSync(dir, { recursive: true });
	assert.match(F.nextVersionPath(dir, "BIP", ".docx"), /BIP_v1\.docx$/);
	writeFileSync(join(dir, "BIP_v1.docx"), "x");
	writeFileSync(join(dir, "BIP_v3.docx"), "x");
	writeFileSync(join(dir, "OTHER_v9.docx"), "x");
	assert.match(F.nextVersionPath(dir, "BIP", ".docx"), /BIP_v4\.docx$/);
	assert.equal(F.safeName('Pirms: "BIP"?'), "Pirms BIP");
});

test("a provider error half-way keeps the batches already done, shows the raw message, and a retry asks only for what is left", { skip: !have, timeout: 400_000 }, async () => {
	const project = setup("e", ["UPB"]);
	const key = `source:${BIP}`;
	await F.inspectTemplate(deps(project), key);
	const good = scripted();
	let calls = 0;
	const flaky: Engine = {
		...good,
		async run(o: RunOptions) {
			calls++;
			if (calls === 4) {
				o.onEvent({ type: "error", engine: "claude", message: "Your workspace is out of credits. Ask your workspace owner to refill in order to continue." });
				return;
			}
			return good.run(o);
		},
	};
	const r = await F.fillFromTender(deps(project), flaky, base, key);
	assert.equal(r.ok, false);
	if (r.ok) return;
	assert.match(r.error, /^Your workspace is out of credits\./, "the provider's own words come first, unrewritten");
	assert.match(r.error, /Jau saglabāts: \d+/);
	const mid = loadState(project.outputDir).fills[key];
	const done = mid.items.filter((i) => i.kind === "section" && i.by === "model" && i.status === "source").length;
	console.log(`  after the failure ${done} sections are kept`);
	assert.ok(done >= 10, "the first batches survived");

	const retry = scripted();
	const r2 = await F.fillFromTender(deps(project), retry, base, key);
	assert.ok(r2.ok);
	const before = retry.calls.filter((c) => c === "sections").length;
	const allSections = loadState(project.outputDir).fills[key].items.filter((i) => i.kind === "section").length;
	assert.ok(before < Math.ceil(allSections / 10), `the retry made ${before} section calls, fewer than a full run`);
});
