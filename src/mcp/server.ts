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
import * as edit from "./edit.js";

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

// ---- editing the tender's own data (see edit.ts for the rules) ----
const project = edit.projectFor(guard.readDirs[0] ?? "", guard.writeDir);
const reply = (tool: string, r: edit.Result, path?: string): ToolText => {
	audit(auditFile, { tool, path, ok: r.ok, reason: r.ok ? undefined : r.reason, engine });
	return r.ok ? ok(r.text) : fail(r.reason);
};

server.registerTool(
	"project_overview",
	{ title: "Konkursa pārskats", description: "Where the tender stands: variant, deadline, status of the ten steps, and the forms (value sheets) with their number of open fields. Call this first when asked to fill something." },
	async () => reply("project_overview", edit.overview(project)),
);

server.registerTool(
	"list_open_fields",
	{
		title: "Atvērtie lauki",
		description: "Fields of the forms that are still empty and may be filled (slot id, kind, heading, template's own instruction). Omit template to list all forms.",
		inputSchema: { template: z.string().optional().describe("Template key from project_overview, e.g. source:4.pielikums_Pirms_liguma_BIP.docx") },
	},
	async ({ template }) => reply("list_open_fields", edit.listOpenFields(project, template), template),
);

server.registerTool(
	"set_field",
	{
		title: "Aizpildīt lauku",
		description:
			"Fill ONE open field of a form with a value found in the tender documents. Requires a verbatim quote (10–300 chars) from a tender document, checked by the app; a wrong quote is refused. Never overwrites what a person typed. Only write true information from the documents — if the documents do not say it, leave the field empty and tell the user.",
		inputSchema: {
			template: z.string().describe("Template key from project_overview"),
			slot_id: z.string().describe("Field id from list_open_fields"),
			value: z.string().describe("The text to put in the field, in Latvian"),
			quote: z.string().describe("Verbatim quote from a tender document that supports the value"),
			file: z.string().optional().describe("File name of the document the quote is from"),
		},
	},
	async ({ template, slot_id, value, quote, file }) => reply("set_field", edit.setField(project, { template, slotId: slot_id, value, quote, file }), slot_id),
);

server.registerTool(
	"set_deadline",
	{
		title: "Iesniegšanas termiņš",
		description: "Set the submission deadline (step 2) with a verbatim quote from a tender document that contains the date.",
		inputSchema: { date: z.string().describe("DD.MM.YYYY"), time: z.string().optional().describe("HH:MM"), quote: z.string(), file: z.string().optional() },
	},
	async ({ date, time, quote, file }) => reply("set_deadline", edit.setDeadline(project, { date, time, quote, file })),
);

server.registerTool(
	"set_role",
	{
		title: "Loma",
		description: "Add or update one row of 5. Kas ko dara: who does which role. Use only what the user told you or a tender document states — never guess people.",
		inputSchema: {
			side: z.string().describe("'design' for our design side, or the name of the builder"),
			role: z.string(),
			part: z.string().optional().describe("Model/part codes, e.g. AR, IN"),
			company: z.string().optional(),
			person: z.string().optional(),
		},
	},
	async ({ side, role, part, company, person }) => reply("set_role", edit.setRole(project, { side, role, part, company, person })),
);

await server.connect(new StdioServerTransport());
