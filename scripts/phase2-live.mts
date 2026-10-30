// Live phase 2 run on a real tender through a real engine. Usage:
//   node --import tsx scripts/phase2-live.mts <codex|grok|claude> <sourceDir>
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createEngines, mcpLaunch } from "../src/main/engines/index.ts";
import { extractAll, scanFolders } from "../src/main/extract.ts";
import { loadState, saveState } from "../src/main/project-state.ts";
import * as R from "../src/main/tasks/phase2-run.ts";
import { criteriaSum } from "../src/main/tasks/phase2.ts";
import { pyConfigFromEnv } from "../src/mcp/python.ts";
import type { BlockId } from "../src/shared/state.ts";
import type { EngineId, Project } from "../src/shared/types.ts";

const [engineId, sourceDir] = process.argv.slice(2) as [EngineId, string];
const appRoot = resolve(import.meta.dirname, "..");
const skillsDir = join(appRoot, "resources", "plugin", "skills");
const out = mkdtempSync(join(tmpdir(), "phase2-live-"));
const project: Project = { id: "live", name: "live", sourceDir, outputDir: out, variant: null, builders: [], createdAt: "" };
const engine = createEngines(() => process.env.ANTHROPIC_API_KEY ?? null)[engineId];
const base = {
	runDir: join(out, "run"),
	pluginDir: join(appRoot, "resources", "plugin"),
	mcp: mcpLaunch({ serverJs: join(appRoot, "dist", "mcp", "server.js"), project, skillsDir, auditFile: join(out, "audit.jsonl"), engine: engineId }),
	signal: AbortSignal.timeout(40 * 60_000),
};
const t = (label: string) => {
	const t0 = Date.now();
	return (extra = "") => console.log(`[${Math.round((Date.now() - t0) / 1000)} s] ${label} ${extra}`);
};
const q = (c: { value: unknown; status: string; cite?: { file: string; quote: string } }) => `${JSON.stringify(c.value)} [${c.status}${c.cite ? `: “${c.cite.quote.slice(0, 90)}…” ← ${c.cite.file}` : ""}]`;

try {
	const s0 = loadState(out);
	s0.files = scanFolders(project, []);
	s0.scannedAt = "t";
	s0.files = await extractAll(project, s0, { ...pyConfigFromEnv(process.env), skillsDir }, () => {});
	s0.extractedAt = "t";
	saveState(out, s0);
	console.log(`${s0.files.filter((f) => f.text === "ok").length} files read; editions:`, JSON.stringify(R.guessEditions(s0.files)));

	const g = R.guessEditions(s0.files);
	R.setEditions(project, g.original, g.amended);
	console.log("diff:", JSON.stringify(R.diffEditions(project)));
	let done = t("classify changes");
	const cl = await R.classifyChanges(project, engine, base);
	done(JSON.stringify(cl));
	for (const c of loadState(out).versions.changes) console.log(`  [${c.impact}] ${c.before.slice(0, 70).replace(/\n/g, " ")} → ${c.after.slice(0, 90).replace(/\n/g, " ")}`);

	R.setInForce(project, "amended");
	console.log("forms:", JSON.stringify(R.compareForms(project)));
	for (const d of loadState(out).versions.templates) console.log(`  ${d.equal ? "=" : "≠"} ${d.distributedFile}: ${d.distributedRows} vs ${d.embeddedRows}${d.missingLabels.length ? " missing: " + d.missingLabels.join("; ") : ""}`);

	done = t("Q&A");
	const qa = await R.readQa(project, engine, base);
	done(JSON.stringify(qa));
	for (const x of loadState(out).versions.qa) console.log(`  #${x.nr} [${x.impact}] ${x.question.slice(0, 100)}`);

	done = t("deadline");
	const dl = await R.readDeadline(project, engine, base, 1);
	done(dl.ok ? `${q(dl.deadline.date)} ${q(dl.deadline.time)} source=${dl.deadline.source}` : dl.error);
	if (dl.ok) R.storeDeadline(project, dl.deadline);

	for (const block of ["dati", "dokumenti", "pieredze", "specialisti", "vertesana", "apaksuznemeji"] as BlockId[]) {
		done = t(`block ${block}`);
		const r = await R.readBlock(project, engine, base, block, 1);
		if (!r.ok) {
			done(`ERROR ${r.error}`);
			continue;
		}
		R.storeBlock(project, block, r.patch);
		done(`rejected ${r.rejected}`);
	}
	const st = loadState(out);
	const rq = st.requirements;
	console.log("\n--- dati");
	for (const k of ["purchaser", "id", "subject", "contractType"] as const) console.log(`  ${k}: ${q(rq.dati[k])}`);
	console.log(`--- dokumenti (${rq.dokumenti.length})`);
	for (const d of rq.dokumenti) console.log(`  ${d.mandatory ? "●" : "○"} ${d.name.value}`);
	console.log(`--- pieredze (${rq.pieredze.length})`);
	for (const p of rq.pieredze) console.log(`  ${p.text.value} | n=${p.count.value} | years=${p.periodYears.value} | ${p.objectType.value}`);
	console.log(`--- specialisti (${rq.specialisti.length})`);
	for (const sp of rq.specialisti) console.log(`  ${sp.field.value} | ${sp.certificate.value}`);
	console.log(`--- vertesana (${rq.vertesana.length}) sum=${JSON.stringify(criteriaSum(rq.vertesana))}`);
	for (const c of rq.vertesana) console.log(`  ${c.name.value} | ${q(c.points)} | objects=${c.objectsNeeded}`);
	console.log(`--- apakšuzņēmēji threshold: ${q(rq.apaksuznemeji.threshold)}\n    espd: ${q(rq.apaksuznemeji.espd)}`);

	done = t("second pass");
	const sp = await R.secondPass(project, engine, base);
	done(JSON.stringify(sp));
	const after = loadState(out);
	console.log("conflicts:", {
		date: after.deadline.date.conflict?.value,
		time: after.deadline.time.conflict?.value,
		criteria: after.requirements.vertesana.filter((c) => c.points.conflict || c.name.conflict).map((c) => c.name.value),
		threshold: after.requirements.apaksuznemeji.threshold.conflict?.value,
	});
} finally {
	rmSync(out, { recursive: true, force: true });
}
