// End-to-end of 8. Pārbaude on files the pipeline really wrote from the REAL NVA templates (no model).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runChecks } from "../src/main/checks/run.ts";
import * as F from "../src/main/fill/run.ts";
import { loadState, saveState, updateState } from "../src/main/project-state.ts";
import { toolsConfig } from "../src/main/pytools.ts";
import { emptyRegisters } from "../src/main/registers/registers.ts";
import { emptyState, type FileEntry } from "../src/shared/state.ts";
import type { CheckRun } from "../src/shared/checks.ts";
import type { Project } from "../src/shared/types.ts";

const SRC = "E:\\BV BIM\\Paraugmodeli\\260811_NVA_Remonta baze\\KONKURSS";
const BIP = "5.pielikums_Pirms_liguma_BIP.docx";
const MATRICA = "5.A.pielikums_Atbildibas_matrica.xlsx";
const have = existsSync(join(SRC, BIP)) && existsSync(join(SRC, MATRICA));
const tools = toolsConfig(process.env, join(import.meta.dirname, "..", "python", "konkurss_tools.py"));
const tmp = mkdtempSync(join(tmpdir(), "konkurss-p5run-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const reg = () => ({ ...emptyRegisters(), company: { fields: [{ key: "Nosaukums", value: 'SIA "BŪVDIZAINS"' }], persons: [], answers: [] } });

test("runChecks on written BIP + matrica copies: real findings with consequence; clean builder copies pass the leak rule; a planted leak fails it", { skip: !have, timeout: 600_000 }, async () => {
	const out = join(tmp, "IESNIEDZAMIE");
	const project: Project = { id: "n", name: "260811_NVA_Remonta baze", sourceDir: SRC, outputDir: out, variant: "V2", builders: ["UPB", "Pillar"], createdAt: "" };
	const s = emptyState();
	const mk = (rel: string, kind: FileEntry["kind"]): FileEntry => ({ rel, root: "source", where: "konkurss", kind, kindSetByUser: false, size: 1, mtimeMs: 1, text: "neattiecas" });
	s.files = [mk(BIP, "bip_veidne"), mk(MATRICA, "matrica")];
	s.variant = { value: "V2", status: "manual", confirmed: true };
	s.roles = {
		design: [
			{ id: "1", role: "Projekta informācijas vadītājs / BIM koordinators", part: "", company: "SIA BŪVDIZAINS", person: "Jānis Kreics" },
			{ id: "2", role: "BIM modeļa autors", part: "AR", company: "SIA BŪVDIZAINS", person: "Truševska" },
		],
		build: { UPB: [{ id: "u", role: "4D speciālists", part: "", company: "UPB SIA", person: "Persona UPB" }], Pillar: [{ id: "p", role: "4D speciālists", part: "", company: "Pillar SIA", person: "Persona Pillar" }] },
	};
	saveState(out, s);
	const deps = (): F.RunDeps => ({ project, tools, registers: reg(), otherProjects: [], extraForeign: [] });
	const bipKey = `source:${BIP}`;
	const matKey = `source:${MATRICA}`;
	await F.inspectTemplate(deps(), bipKey);
	const copies = await F.builderCopies(deps(), bipKey);
	assert.ok(copies.ok);
	for (const b of project.builders) assert.ok((await F.fillMatrica(deps(), null, null, matKey, b)).ok);
	assert.deepEqual(Object.keys((loadState(out).matrica as { outputs: object }).outputs).sort(), ["Pillar", "UPB"], "matrica copies are remembered for the checks");

	const run = await runChecks({ ...deps(), today: new Date("2026-09-01") });
	const by = Object.fromEntries(run.findings.map((f) => [f.id, f]));
	console.log("  " + run.findings.map((f) => `${f.id}=${f.status}`).join(" "));

	assert.equal(by["builder-leaks"].status, "ok", "UPB and Pillar copies contain only their own data");
	assert.equal(by["leaks"].status, "ok");
	assert.equal(by["leftover-italics"].status, "ok", "unfilled sections are replaced by the red marker, not left as template instructions");
	assert.equal(by["markers"].status, "warn");
	assert.ok(by["markers"].detail.includes("77 × [aizpildīt]"), "counts per document are reported");
	assert.equal(by["lod-author"].status, "fail", "template LODs exist but most authors are not set");
	assert.match(by["lod-author"].detail, /izslēgšanas kritērijs/);
	assert.equal(by["deadline-left"].status, "warn", "no deadline in the state");
	assert.equal(by["bpv"].status, "na");
	// the NVA template itself ships "Boriss Varlamovs" as combined-model author in every phase and the pipeline keeps
	// filled cells — this is exactly the commission's B12 finding, now caught by the check on a real pipeline run
	assert.equal(by["coordinator"].status, "fail");
	assert.match(by["coordinator"].detail, /Jānis Kreics/);
	assert.match(by["coordinator"].detail, /Boriss Varlamovs/);
	assert.equal(run.findings[0].status, "fail", "failures first");
	const stored = loadState(out).checks as CheckRun;
	assert.equal(stored.findings.length, run.findings.length, "result stored in the project state");

	// another builder's person planted into UPB's copy → caught by the exact check on the next run
	updateState(out, (st) => {
		const it = st.fills[bipKey].items.find((i) => i.kind === "section")!;
		Object.assign(it, { value: "Saskaņots ar Persona Pillar.", status: "manual", by: "manual", cites: [] });
	});
	assert.ok((await F.generate(deps(), bipKey, "UPB")).ok);
	const again = await runChecks({ ...deps(), today: new Date("2026-09-01") });
	const leak = again.findings.find((f) => f.id === "builder-leaks")!;
	assert.equal(leak.status, "fail");
	assert.match(leak.detail, /Persona Pillar/);
});
