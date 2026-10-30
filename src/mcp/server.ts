// konkurss-tools — stdio MCP server shared by every engine (Claude, Codex, Grok).
// Configured entirely through environment variables set by the main process:
//   KONKURSS_READ_DIRS   izejas dati folders, separated by path.delimiter (read-only)
//   KONKURSS_WRITE_DIR   output folder (the only place anything is written)
//   KONKURSS_SKILLS_DIR  resources/plugin/skills
//   KONKURSS_AUDIT       audit.jsonl path
//   KONKURSS_ENGINE      which engine launched this server (for the audit log)
//   KONKURSS_PY          python command for the extract scripts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, delimiter, dirname, extname, join, relative } from "node:path";
import { checkRead, checkWrite, type GuardConfig } from "./guard.js";
import { audit } from "./audit.js";
import { pyConfigFromEnv, readerFor, runPython } from "./python.js";

const env = process.env;
const guard: GuardConfig = {
	readDirs: (env.KONKURSS_READ_DIRS ?? "").split(delimiter).filter(Boolean),
	writeDir: env.KONKURSS_WRITE_DIR ?? "",
};
const auditFile = env.KONKURSS_AUDIT;
const engine = env.KONKURSS_ENGINE;
const py = pyConfigFromEnv(env);
const SKILLS = ["konkurss", "konkurss-checklist", "paraugmodeli", "lv-doc-tables"];
const TEXT_WRITE_EXT = new Set([".md", ".txt", ".json", ".html", ".csv"]);
const SKIP_DIRS = new Set(["node_modules", ".git", ".konkurss"]);

type ToolText = { content: { type: "text"; text: string }[]; isError?: boolean };
const ok = (text: string): ToolText => ({ content: [{ type: "text", text }] });
const fail = (text: string): ToolText => ({ content: [{ type: "text", text }], isError: true });

function walk(dir: string, out: string[], limit = 5000): void {
	if (out.length >= limit) return;
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const e of entries) {
		const p = join(dir, e.name);
		if (e.isDirectory()) {
			if (!SKIP_DIRS.has(e.name)) walk(p, out, limit);
		} else out.push(p);
		if (out.length >= limit) return;
	}
}

const server = new McpServer({ name: "konkurss-tools", version: "0.1.0" });

server.registerTool(
	"list_files",
	{
		title: "Konkursa failu saraksts",
		description:
			"List every file in the tender's source folders (izejas dati) and output folder, with sizes. Use this first; read 100% of the files before planning (mistake catalogue A1).",
		inputSchema: { folder: z.string().optional().describe("Absolute path inside a tender folder. Omit for all folders.") },
	},
	async ({ folder }) => {
		const roots = folder ? [folder] : [...guard.readDirs, guard.writeDir];
		const lines: string[] = [];
		for (const root of roots) {
			const g = checkRead(guard, root);
			if (!g.ok) {
				audit(auditFile, { tool: "list_files", path: root, ok: false, reason: g.reason, engine });
				return fail(g.reason);
			}
			if (!existsSync(g.path)) {
				lines.push(`# ${g.path}\n(mape neeksistē)`);
				continue;
			}
			const files: string[] = [];
			walk(g.path, files);
			lines.push(`# ${g.path} — ${files.length} faili`);
			for (const f of files) lines.push(`${relative(g.path, f)}\t${statSync(f).size}`);
		}
		audit(auditFile, { tool: "list_files", path: folder, ok: true, engine });
		return ok(lines.join("\n"));
	},
);

server.registerTool(
	"read_doc",
	{
		title: "Nolasīt dokumentu",
		description:
			"Return the text of a tender document (.docx, .edoc, .pdf, .xlsx, .txt, .md). Word tables keep cell boundaries as ' | '. .edoc returns signers and inner documents. Quote from this text when citing.",
		inputSchema: { path: z.string().describe("Absolute path of the file.") },
	},
	async ({ path }) => {
		const g = checkRead(guard, path);
		if (!g.ok) {
			audit(auditFile, { tool: "read_doc", path, ok: false, reason: g.reason, engine });
			return fail(g.reason);
		}
		const ext = extname(g.path).toLowerCase();
		try {
			let text: string;
			if ([".txt", ".md", ".csv", ".json"].includes(ext)) text = readFileSync(g.path, "utf8");
			else {
				const reader = readerFor(py.skillsDir, g.path);
				if (!reader) return fail(`Šo formātu (${ext}) app vēl nelasa: ${basename(g.path)}`);
				text = await runPython(py, reader.script, reader.args);
			}
			audit(auditFile, { tool: "read_doc", path: g.path, ok: true, engine });
			return ok(text.trim() ? text : `(${basename(g.path)}: teksta nav — iespējams skenēts attēls, vajag OCR)`);
		} catch (e) {
			audit(auditFile, { tool: "read_doc", path: g.path, ok: false, reason: String(e), engine });
			return fail(`Neizdevās nolasīt ${basename(g.path)}: ${(e as Error).message}`);
		}
	},
);

server.registerTool(
	"get_skill",
	{
		title: "Darba instrukcija",
		description:
			"Return a BŪVDIZAINS konkurss skill (workflow instructions) or one of its reference files. Skills: konkurss, konkurss-checklist, paraugmodeli, lv-doc-tables. Read konkurss/references/kludu_katalogs.md before filling anything.",
		inputSchema: {
			skill: z.enum(SKILLS as [string, ...string[]]),
			file: z.string().optional().describe("Relative file inside the skill, e.g. references/kludu_katalogs.md. Default SKILL.md."),
		},
	},
	async ({ skill, file }) => {
		const base = join(py.skillsDir, skill);
		const target = join(base, file ?? "SKILL.md");
		if (relative(base, target).startsWith("..")) return fail("Ceļš ārpus skill mapes.");
		if (!existsSync(target)) return fail(`Nav faila: ${skill}/${file ?? "SKILL.md"}`);
		return ok(readFileSync(target, "utf8"));
	},
);

server.registerTool(
	"write_text",
	{
		title: "Saglabāt piezīmes",
		description:
			"Write a text file (.md, .txt, .json, .html, .csv) inside the output folder — reports, checklists, value sheets. Never writes in the source folder and never .edoc. If the file exists, a backup copy is made first.",
		inputSchema: {
			path: z.string().describe("Absolute path inside the output folder."),
			content: z.string(),
		},
	},
	async ({ path, content }) => {
		const g = checkWrite(guard, path);
		if (!g.ok) {
			audit(auditFile, { tool: "write_text", path, ok: false, reason: g.reason, engine });
			return fail(g.reason);
		}
		const ext = extname(g.path).toLowerCase();
		if (!TEXT_WRITE_EXT.has(ext)) {
			const reason = `write_text raksta tikai ${[...TEXT_WRITE_EXT].join(", ")}; Word/Excel aizpilde ir atsevišķs rīks.`;
			audit(auditFile, { tool: "write_text", path: g.path, ok: false, reason, engine });
			return fail(reason);
		}
		let backup: string | undefined;
		if (existsSync(g.path)) {
			const stamp = new Date().toISOString().replace(/[:.]/g, "-");
			backup = join(guard.writeDir, ".konkurss", "backup", stamp, relative(guard.writeDir, g.path));
			mkdirSync(dirname(backup), { recursive: true });
			copyFileSync(g.path, backup);
		}
		mkdirSync(dirname(g.path), { recursive: true });
		writeFileSync(g.path, content, "utf8");
		audit(auditFile, { tool: "write_text", path: g.path, ok: true, engine, reason: backup ? `backup ${backup}` : undefined });
		return ok(`Saglabāts: ${g.path}${backup ? `\nIepriekšējā versija: ${backup}` : ""}`);
	},
);

await server.connect(new StdioServerTransport());
