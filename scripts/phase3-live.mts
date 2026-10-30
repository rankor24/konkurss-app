// Live phase 3 run: fill the real NVA BIP through a real engine, write base + builder copies, run the leak checks.
//   node --import tsx scripts/phase3-live.mts <codex|grok|claude>
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createEngines, mcpLaunch } from "../src/main/engines/index.ts";
import { extractAll, scanFolders } from "../src/main/extract.ts";
import * as F from "../src/main/fill/run.ts";
import { loadState, saveState, updateState } from "../src/main/project-state.ts";
import { toolsConfig } from "../src/main/pytools.ts";
import { pyConfigFromEnv } from "../src/mcp/python.ts";
import { emptyRegisters } from "../src/main/registers/registers.ts";
import type { EngineId, Project } from "../src/shared/types.ts";

const engineId = process.argv[2] as EngineId;
const SRC = "E:\\BV BIM\\Paraugmodeli\\260811_NVA_Remonta baze\\KONKURSS";
const appRoot = resolve(import.meta.dirname, "..");
const skillsDir = join(appRoot, "resources", "plugin", "skills");
const out = join(mkdtempSync(join(tmpdir(), "phase3-live-")), "IESNIEDZAMIE");
const project: Project = { id: "live", name: "260811_NVA_Remonta baze", sourceDir: SRC, outputDir: out, variant: "V2", builders: ["SB", "Pillar", "UPB"], createdAt: "" };
const tools = toolsConfig(process.env, join(appRoot, "python", "konkurss_tools.py"));
const engine = createEngines(() => process.env.ANTHROPIC_API_KEY ?? null)[engineId];
const base = {
	runDir: join(out, "run"),
	pluginDir: join(appRoot, "resources", "plugin"),
	mcp: mcpLaunch({ serverJs: join(appRoot, "dist", "mcp", "server.js"), project, skillsDir, auditFile: join(out, "audit.jsonl"), engine: engineId }),
	signal: AbortSignal.timeout(60 * 60_000),
};
const t0 = Date.now();
const log = (m: string) => console.log(`[${Math.round((Date.now() - t0) / 1000)} s] ${m}`);

const s0 = loadState(out);
s0.files = scanFolders(project, []);
s0.scannedAt = "t";
s0.files = await extractAll(project, s0, { ...pyConfigFromEnv(process.env), skillsDir }, () => {});
s0.extractedAt = "t";
s0.variant = { value: "V2", status: "manual", confirmed: true };
s0.versions.inForce = "original";
s0.roles = {
	design: [{ id: "1", role: "Projekta informācijas vadītājs / BIM koordinators", part: "", company: "SIA BŪVDIZAINS", person: "Jānis Kreics" }],
	build: { SB: [], Pillar: [], UPB: [] },
};
saveState(out, s0);
const key = F.templateCandidates(s0).find((c) => c.kind === "bip_veidne")!.key;
log(`${s0.files.filter((f) => f.text === "ok").length} files read; template ${key}`);

const deps: F.RunDeps = { project, tools, registers: emptyRegisters(), otherProjects: [], extraForeign: ["Salacgriva", "Duntes 8", "Remontbāze"] };
const ins = await F.inspectTemplate(deps, key);
log(`inspect: ${ins.ok ? ins.sheet.items.length + " items" : ins.error}`);
const f = await F.fillFromTender(deps, engine, base, key, (m) => log(m));
if (!f.ok) {
	log("ERROR " + f.error);
	process.exit(1);
}
const items = f.sheet.items;
const grp = (k: SheetKind) => items.filter((i) => i.kind === k);
type SheetKind = "cell" | "section";
log(`cells: ${grp("cell").filter((i) => i.status === "source" && i.by === "model").length} from tender docs; sections: ${grp("section").filter((i) => i.status === "source").length}/${grp("section").length} grounded; rejected ${f.rejected}`);
for (const i of items.filter((x) => x.by === "model" && x.kind === "cell")) console.log(`  CELL ${i.label}: ${i.value}  ←  “${i.cites[0]?.quote.slice(0, 80)}” (${i.cites[0]?.file})`);
for (const i of grp("section").filter((x) => x.status === "source").slice(0, 6)) console.log(`  SEC ${i.heading.split(" › ").pop()}: ${i.value.slice(0, 160).replace(/\n/g, " ")}…\n      ← “${i.cites[0]?.quote.slice(0, 90)}”  | ${i.note ?? ""}`);
console.log("  SECTIONS LEFT OPEN:", grp("section").filter((x) => x.status !== "source").map((x) => x.label).slice(0, 12).join(" | "));

const base1 = await F.generate(deps, key);
log(base1.ok ? `base copy → ${base1.generated.file}  open=${base1.generated.open}  leaks clean=${base1.generated.leaks.clean}` : "ERROR " + base1.error);
const copies = await F.builderCopies(deps, key);
if (copies.ok) for (const c of copies.copies) log(`copy ${c.builder} → ${c.file}  clean=${c.leaks.clean} ${c.leaks.foreign.map((h) => h.term).join(",")}`);
else log("ERROR " + copies.error);
console.log("OUTPUT FOLDER:", out);
updateState(out, () => {});
