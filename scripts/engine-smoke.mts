// Dev helper: one real engine run through konkurss-tools, printing normalised events.
// pi: PI_PROVIDER (anthropic|openai-codex|xai, default anthropic), PI_MODEL (optional), PI_CREDENTIALS (plain JSON token file, e.g. BIM Crew's data/credentials.json;
// the app itself keeps its tokens encrypted, which only the app can read). The Claude key comes from ANTHROPIC_API_KEY.
// Usage: node --import tsx scripts/engine-smoke.mts <claude|codex|grok|pi> <sourceDir> "<prompt>"
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildPrompt, createEngines, mcpLaunch } from "../src/main/engines/index.ts";
import type { EngineId, Project } from "../src/shared/types.ts";

const [engineId, sourceDir, task] = process.argv.slice(2) as [EngineId, string, string];
const appRoot = resolve(import.meta.dirname, "..");
const work = mkdtempSync(join(tmpdir(), `smoke-${engineId}-`));
const project: Project = {
	id: "smoke",
	name: "smoke",
	sourceDir: resolve(sourceDir),
	outputDir: join(work, "out"),
	variant: null,
	builders: [],
	createdAt: new Date().toISOString(),
};
import { createPiRuntime, isPiProvider } from "../src/agent-pi/index.ts";
const piRuntime = createPiRuntime({
	path: process.env.PI_CREDENTIALS ?? join(work, "pi-credentials.json"),
	apiKey: (p) => (p === "anthropic" ? (process.env.ANTHROPIC_API_KEY ?? null) : null),
	identity: { name: "Konkursu App", url: "https://buvdizains.lv" },
});
const piProvider = isPiProvider(process.env.PI_PROVIDER) ? process.env.PI_PROVIDER : "anthropic";
const engines = createEngines(() => process.env.ANTHROPIC_API_KEY ?? null, { runtime: async () => piRuntime, selection: () => ({ provider: piProvider, model: process.env.PI_MODEL || undefined }) });
const engine = engines[engineId];
console.log("status:", await engine.status());
const started = Date.now();
await engine.run({
	prompt: buildPrompt(project, task),
	runDir: join(work, "run"),
	pluginDir: join(appRoot, "resources", "plugin"),
	mcp: mcpLaunch({
		serverJs: join(appRoot, "dist", "mcp", "server.js"),
		project,
		skillsDir: join(appRoot, "resources", "plugin", "skills"),
		auditFile: join(work, "audit.jsonl"),
		engine: engineId,
	}),
	signal: AbortSignal.timeout(240_000),
	onEvent: (e) => console.log(JSON.stringify(e).slice(0, 400)),
});
console.log(`done in ${Math.round((Date.now() - started) / 1000)} s; audit: ${join(work, "audit.jsonl")}`);
