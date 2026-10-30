// Engine safety settings, checked without calling any model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLAUDE_ALLOWED, CLAUDE_DISALLOWED, claudeOptions, denyUnlisted } from "../src/main/engines/claude.ts";
import { codexConfig, codexThreadOptions } from "../src/main/engines/codex.ts";
import { GROK_DISALLOWED, grokArgs, writeGrokRunConfig } from "../src/main/engines/grok.ts";
import { buildPrompt, mcpLaunch } from "../src/main/engines/index.ts";
import type { RunOptions } from "../src/main/engines/types.ts";
import type { Project } from "../src/shared/types.ts";

const project: Project = {
	id: "p1",
	name: "260811_NVA_Remonta baze",
	sourceDir: "E:\\BV BIM\\Paraugmodeli\\260811_NVA_Remonta baze\\KONKURSS",
	outputDir: "E:\\BV BIM\\Paraugmodeli\\260811_NVA_Remonta baze\\IESNIEDZAMIE",
	variant: "V2",
	builders: ["SB", "Pillar", "UPB"],
	createdAt: "2026-10-30T00:00:00Z",
};

function opts(runDir = "C:\\run"): RunOptions {
	return {
		prompt: buildPrompt(project, "Kas ir šajā konkursā?"),
		runDir,
		pluginDir: "C:\\app\\resources\\plugin",
		mcp: mcpLaunch({ serverJs: "C:\\app\\dist\\mcp\\server.js", project, skillsDir: "C:\\skills", auditFile: "C:\\a.jsonl", engine: "claude" }),
		signal: new AbortController().signal,
		onEvent: () => {},
	};
}

test("mcp launch passes the folders and runs on the app's own Node", () => {
	const m = opts().mcp;
	assert.equal(m.command, process.execPath);
	assert.equal(m.env.ELECTRON_RUN_AS_NODE, "1");
	assert.equal(m.env.KONKURSS_READ_DIRS, project.sourceDir);
	assert.equal(m.env.KONKURSS_WRITE_DIR, project.outputDir);
});

test("claude: no shell, no direct file tools, no personal settings, key only in env", () => {
	const o = claudeOptions(opts(), "sk-ant-test", new AbortController());
	for (const t of ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebFetch", "WebSearch"]) assert.ok(CLAUDE_DISALLOWED.includes(t), t);
	assert.deepEqual(o.disallowedTools, CLAUDE_DISALLOWED);
	assert.deepEqual(o.settingSources, []);
	assert.equal(o.permissionMode, "dontAsk");
	assert.equal(o.env?.ANTHROPIC_API_KEY, "sk-ant-test");
	assert.equal(o.cwd, "C:\\run");
	assert.ok(o.mcpServers && "konkurss" in o.mcpServers);
	assert.ok(CLAUDE_ALLOWED.includes("mcp__konkurss__read_doc"));
});

test("claude hook denies anything off the allow list", async () => {
	const base = { session_id: "s", transcript_path: "", cwd: "", tool_use_id: "t" };
	const signal = { signal: new AbortController().signal };
	const bash = await denyUnlisted({ ...base, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "del /s *" } } as never, "t", signal);
	assert.equal((bash as { hookSpecificOutput?: { permissionDecision?: string } }).hookSpecificOutput?.permissionDecision, "deny");
	const ok = await denyUnlisted({ ...base, hook_event_name: "PreToolUse", tool_name: "mcp__konkurss__read_doc", tool_input: {} } as never, "t", signal);
	assert.deepEqual(ok, {});
});

test("codex: read-only sandbox, no approvals, no network, konkurss MCP configured", () => {
	const t = codexThreadOptions(opts());
	assert.equal(t.sandboxMode, "read-only");
	assert.equal(t.approvalPolicy, "never");
	assert.equal(t.networkAccessEnabled, false);
	assert.equal(t.webSearchMode, "disabled");
	assert.equal(t.workingDirectory, "C:\\run");
	const server = codexConfig(opts()).mcp_servers.konkurss;
	assert.equal(server.command, process.execPath);
	assert.equal(server.default_tools_approval_mode, "approve");
	assert.deepEqual(server.enabled_tools, ["list_files", "read_doc", "get_skill", "write_text"]);
});

test("grok: shell, edits, reads and web removed; only konkurss MCP allowed", () => {
	const a = grokArgs(opts());
	const disallowed = a[a.indexOf("--disallowed-tools") + 1].split(",");
	const mustBlock = ["run_terminal_command", "run_terminal_cmd", "monitor", "execute", "task", "scheduler_create", "search_replace", "hashline_edit", "write", "write_file", "Delete", "read_file", "web_search", "web_fetch", "spawn_subagent"];
	for (const t of mustBlock) {
		assert.ok(disallowed.includes(t), t);
	}
	assert.deepEqual(disallowed, GROK_DISALLOWED);
	assert.equal(a[a.indexOf("--output-format") + 1], "streaming-json");
	assert.equal(a[a.indexOf("--allow") + 1], "MCPTool(konkurss__*)");
	assert.ok(a.includes("--disable-web-search"));
	assert.ok(a.includes("--trust"), "run-folder policy is ignored without --trust");
	assert.ok(!a.includes("--no-memory"), "removed in grok 1.0");
});

test("grok run folder gets MCP config and deny-by-default policy", () => {
	const dir = mkdtempSync(join(tmpdir(), "grok-run-"));
	try {
		writeGrokRunConfig(opts(dir));
		const toml = readFileSync(join(dir, ".grok", "config.toml"), "utf8");
		assert.match(toml, /\[mcp_servers\.konkurss\]/);
		assert.match(toml, /KONKURSS_WRITE_DIR = ".*IESNIEDZAMIE"/);
		const settings = JSON.parse(readFileSync(join(dir, ".claude", "settings.json"), "utf8"));
		assert.equal(settings.permissions.defaultMode, "dontAsk");
		assert.deepEqual(settings.permissions.allow, ["MCPTool(konkurss__*)"]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("prompt carries folders, builders and the citation rule", () => {
	const p = buildPrompt(project, "X");
	assert.match(p, /IESNIEDZAMIE/);
	assert.match(p, /SB, Pillar, UPB/);
	assert.match(p, /citāts/);
	assert.match(p, /kludu_katalogs/);
});
