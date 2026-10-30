import type { EngineId, Project } from "../../shared/types.js";
import type { Engine, McpLaunch } from "./types.js";
import { createClaudeEngine } from "./claude.js";
import { createCodexEngine } from "./codex.js";
import { createGrokEngine } from "./grok.js";

export function createEngines(getClaudeKey: () => string | null): Record<EngineId, Engine> {
	return { claude: createClaudeEngine(getClaudeKey), codex: createCodexEngine(), grok: createGrokEngine() };
}

/**
 * The tool server runs on the same Node that runs the app: in Electron via
 * ELECTRON_RUN_AS_NODE, in tests via plain node. No separate runtime to install.
 */
export function mcpLaunch(p: {
	serverJs: string;
	project: Project;
	skillsDir: string;
	auditFile: string;
	engine: EngineId;
	python?: string;
	toolsExe?: string;
}): McpLaunch {
	const env: Record<string, string> = {
		ELECTRON_RUN_AS_NODE: "1",
		KONKURSS_READ_DIRS: p.project.sourceDir,
		KONKURSS_WRITE_DIR: p.project.outputDir,
		KONKURSS_SKILLS_DIR: p.skillsDir,
		KONKURSS_AUDIT: p.auditFile,
		KONKURSS_ENGINE: p.engine,
	};
	if (p.python) env.KONKURSS_PY = p.python;
	if (p.toolsExe) env.KONKURSS_TOOLS_EXE = p.toolsExe;
	return { command: process.execPath, args: [p.serverJs], env };
}

/** Shared framing so all three engines get the same rules (mistake catalogue A1–A3, A10). */
export function buildPrompt(project: Project, userText: string): string {
	return [
		"Tu strādā SIA \"BŪVDIZAINS\" konkursu app. Atbildi latviski.",
		`Konkurss: ${project.name}`,
		`Izejas dati (tikai lasīt): ${project.sourceDir}`,
		`Izvades mape (jaunās versijas, piezīmes): ${project.outputDir}`,
		project.variant ? `Variants: ${project.variant}` : "Variants: vēl nav noteikts.",
		project.builders.length ? `Būvnieki: ${project.builders.join(", ")}` : "",
		"",
		"Noteikumi:",
		"- Failus lasi un raksti TIKAI ar konkurss rīkiem: list_files, read_doc, get_skill, write_text.",
		"- Darba gaitu ņem no get_skill (konkurss, paraugmodeli, konkurss-checklist, lv-doc-tables) un konkurss/references/kludu_katalogs.md.",
		"- Katrai vērtībai citāts + fails + punkts. Nav avota → \"dokumentos nav, meklēts: …\". Neizdomā.",
		"- Oriģinālus nekad nemaini. .edoc neveido.",
		"",
		"Uzdevums:",
		userText,
	]
		.filter((l) => l !== undefined)
		.join("\n");
}
