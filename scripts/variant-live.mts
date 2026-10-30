// Live check of the variant task: scan + extract a real tender into a temp output, then run detectVariant
// through a real engine. Usage: node --import tsx scripts/variant-live.mts <codex|grok|claude> <sourceDir>
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createEngines, mcpLaunch } from "../src/main/engines/index.ts";
import { extractAll, scanFolders } from "../src/main/extract.ts";
import { loadState, saveState } from "../src/main/project-state.ts";
import { detectVariant } from "../src/main/tasks/variant-run.ts";
import { pyConfigFromEnv } from "../src/mcp/python.ts";
import type { EngineId, Project } from "../src/shared/types.ts";

const [engineId, sourceDir] = process.argv.slice(2) as [EngineId, string];
const appRoot = resolve(import.meta.dirname, "..");
const skillsDir = join(appRoot, "resources", "plugin", "skills");
const out = mkdtempSync(join(tmpdir(), "variant-live-"));
const project: Project = { id: "live", name: "live", sourceDir, outputDir: out, variant: null, builders: [], createdAt: "" };
const py = { ...pyConfigFromEnv(process.env), skillsDir };

try {
	const state = loadState(out);
	state.files = scanFolders(project, []);
	state.scannedAt = "t";
	state.files = await extractAll(project, state, py, () => {});
	state.extractedAt = "t";
	saveState(out, state);
	console.log(`${sourceDir}\n  ${state.files.filter((f) => f.text === "ok").length} files read`);

	const engine = createEngines(() => process.env.ANTHROPIC_API_KEY ?? null)[engineId];
	const base = {
		runDir: join(out, "run"),
		pluginDir: join(appRoot, "resources", "plugin"),
		mcp: mcpLaunch({ serverJs: join(appRoot, "dist", "mcp", "server.js"), project, skillsDir, auditFile: join(out, "audit.jsonl"), engine: engineId }),
		signal: AbortSignal.timeout(600_000),
	};
	const t0 = Date.now();
	const r = await detectVariant(project, engine, base);
	console.log(`  engine ${engineId}, ${Math.round((Date.now() - t0) / 1000)} s`);
	console.log(JSON.stringify(r, null, 2));
	console.log("  saved to state:", JSON.stringify(loadState(out).variant)?.slice(0, 300));
} finally {
	rmSync(out, { recursive: true, force: true });
}
