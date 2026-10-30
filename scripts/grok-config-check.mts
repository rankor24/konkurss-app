// Dev helper: writes a Grok run folder exactly like the app does, so `grok mcp list`
// can be run inside it. Usage: node --import tsx scripts/grok-config-check.mts <runDir> <sourceDir>
import { join, resolve } from "node:path";
import { writeGrokRunConfig } from "../src/main/engines/grok.ts";
import { mcpLaunch } from "../src/main/engines/index.ts";

const [runDir, sourceDir] = process.argv.slice(2).map((p) => resolve(p));
const appRoot = resolve(import.meta.dirname, "..");
const project = { id: "check", name: "check", sourceDir, outputDir: join(runDir, "out"), variant: null, builders: [], createdAt: "" };
const mcp = mcpLaunch({
	serverJs: join(appRoot, "dist", "mcp", "server.js"),
	project,
	skillsDir: join(appRoot, "resources", "plugin", "skills"),
	auditFile: join(runDir, "audit.jsonl"),
	engine: "grok",
});
writeGrokRunConfig({ prompt: "", runDir, pluginDir: "", mcp, signal: new AbortController().signal, onEvent: () => {} });
console.log(`Grok run folder written: ${runDir}`);
