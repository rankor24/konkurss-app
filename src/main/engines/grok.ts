// Grok engine — official `grok` CLI in headless mode, signed in with the person's
// own `grok login` (SuperGrok / X Premium). There is no npm SDK, so the app runs
// the CLI and reads its streaming-json output (~/.grok/docs/user-guide/14-headless-mode.md).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Engine, RunOptions } from "./types.js";
import { MCP_SERVER_NAME } from "./types.js";

/**
 * Built-in Grok tools removed for app runs: anything that runs commands, edits or reads files
 * directly, browses, schedules or spawns agents. Both the tool ID and the name shown to the
 * model are listed where they differ (grok 1.0.70, 14-headless-mode.md). Found by a live test:
 * with the shell removed, Grok tried `monitor` to run `dir` — so every command runner is here.
 * The run folder's `dontAsk` policy is the second lock behind this list.
 */
export const GROK_DISALLOWED = [
	// commands and background work
	"run_terminal_cmd",
	"run_terminal_command",
	"monitor",
	"execute",
	"task",
	"spawn_subagent",
	"get_task_output",
	"wait_tasks",
	"kill_task",
	"scheduler_create",
	"scheduler_delete",
	"scheduler_list",
	"Agent",
	"Task",
	// direct file access (all goes through konkurss-tools instead)
	"read_file",
	"hashline_read",
	"grep",
	"hashline_grep",
	"list_dir",
	"search_replace",
	"hashline_edit",
	"write",
	"write_file",
	"Delete",
	"lsp",
	// web and media
	"web_search",
	"web_fetch",
	"image_gen",
];

export function findGrok(): string | null {
	const candidates = [
		process.env.GROK_PATH,
		join(homedir(), ".grok", "bin", process.platform === "win32" ? "grok.exe" : "grok"),
		join(homedir(), ".grok", "bin", "grok"),
	].filter(Boolean) as string[];
	return candidates.find((p) => existsSync(p)) ?? null;
}

function tomlString(s: string): string {
	return JSON.stringify(s); // JSON string escaping is valid TOML basic-string escaping
}

/**
 * Grok `-p` runs have no per-run plugin flag, so the run folder carries the policy:
 *  - .grok/config.toml  → the konkurss-tools MCP server
 *  - .claude/settings.json → deny-by-default (`dontAsk`) + allow only konkurss tools
 */
export function writeGrokRunConfig(o: RunOptions): void {
	mkdirSync(join(o.runDir, ".grok"), { recursive: true });
	mkdirSync(join(o.runDir, ".claude"), { recursive: true });
	const envLines = Object.entries(o.mcp.env).map(([k, v]) => `${k} = ${tomlString(v)}`);
	const toml = [
		`[mcp_servers.${MCP_SERVER_NAME}]`,
		`command = ${tomlString(o.mcp.command)}`,
		`args = [${o.mcp.args.map(tomlString).join(", ")}]`,
		`env = { ${envLines.join(", ")} }`,
		"",
	].join("\n");
	writeFileSync(join(o.runDir, ".grok", "config.toml"), toml, "utf8");
	writeFileSync(
		join(o.runDir, ".claude", "settings.json"),
		JSON.stringify({ permissions: { defaultMode: "dontAsk", allow: [`MCPTool(${MCP_SERVER_NAME}__*)`] } }, null, 2),
		"utf8",
	);
}

/** Prompts carry whole documents; Windows caps a command line at ~32k chars, so they go through a file. */
export function promptFile(o: RunOptions): string {
	return join(o.runDir, "prompt.txt");
}

export function grokArgs(o: RunOptions): string[] {
	const args = [
		"--prompt-file",
		promptFile(o),
		"--output-format",
		"streaming-json",
		"--cwd",
		o.runDir,
		"--disallowed-tools",
		GROK_DISALLOWED.join(","),
		"--disable-web-search",
		"--allow",
		`MCPTool(${MCP_SERVER_NAME}__*)`,
		"--no-subagents",
		// The run folder is app-owned. Without trust, headless Grok silently ignores its
		// .grok/config.toml and .claude/settings.json (22-permissions-and-safety.md).
		"--trust",
		"--max-turns",
		"60",
	];
	if (o.model) args.push("--model", o.model);
	return args;
}

export function createGrokEngine(): Engine {
	return {
		id: "grok",
		async status() {
			const bin = findGrok();
			if (!bin) return { id: "grok", ready: false, reason: "Grok programma nav uzstādīta šajā datorā.", canLogin: false };
			// No status command exists; a non-empty credential file means signed in. The file is never read.
			const auth = join(homedir(), ".grok", "auth.json");
			const signedIn = existsSync(auth) && statSync(auth).size > 2;
			return signedIn
				? { id: "grok", ready: true, reason: "Pieslēgts (Grok konts).", canLogin: true }
				: { id: "grok", ready: false, reason: "Nav pieslēgts. Spied „Pieslēgties” un ienāc ar SuperGrok kontu.", canLogin: true };
		},
		async login() {
			const bin = findGrok();
			if (!bin) return;
			spawn("cmd.exe", ["/c", "start", "Grok pieslēgšanās", "cmd", "/k", bin, "login"], { detached: true, stdio: "ignore" }).unref();
		},
		run(o) {
			return new Promise((resolve) => {
				const bin = findGrok();
				if (!bin) {
					o.onEvent({ type: "error", engine: "grok", message: "Grok programma nav atrasta." });
					return resolve();
				}
				writeGrokRunConfig(o);
				writeFileSync(promptFile(o), o.prompt, "utf8");
				// GROK_WORKFLOWS=0 removes the workflow `execute` tool on every route.
				const child = spawn(bin, grokArgs(o), { cwd: o.runDir, windowsHide: true, env: { ...process.env, GROK_WORKFLOWS: "0" } });
				o.signal.addEventListener("abort", () => child.kill(), { once: true });
				let buffer = "";
				let text = "";
				let stderr = "";
				let finished = false;
				const toolNames = new Map<string, string>();
				const handle = (line: string) => {
					if (!line.trim()) return;
					let ev: { type?: string; data?: string; message?: string; toolName?: string; title?: string; status?: string; rawInput?: unknown; toolCallId?: string };
					try {
						ev = JSON.parse(line);
					} catch {
						return; // non-JSON noise
					}
					if (ev.type === "text" && ev.data) {
						text += ev.data;
						o.onEvent({ type: "text", text: ev.data });
					} else if (ev.type === "tool_call") {
						const name = ev.toolName ?? ev.title ?? "rīks";
						toolNames.set(ev.toolCallId ?? "", name);
						o.onEvent({ type: "tool", name, detail: ev.rawInput ? JSON.stringify(ev.rawInput).slice(0, 300) : undefined });
					} else if (ev.type === "tool_call_update" && (ev.status === "completed" || ev.status === "failed")) {
						const name = toolNames.get(ev.toolCallId ?? "") ?? "rīks";
						o.onEvent({ type: "tool_result", name, ok: ev.status === "completed" });
					} else if (ev.type === "error") {
						finished = true;
						o.onEvent({ type: "error", engine: "grok", message: ev.message ?? line });
					} else if (ev.type === "end") {
						finished = true;
						o.onEvent({ type: "done", text });
					} else if (ev.type === "max_turns_reached") {
						o.onEvent({ type: "error", engine: "grok", message: "Sasniegts maksimālais soļu skaits (max_turns_reached)." });
					}
				};
				child.stdout.setEncoding("utf8");
				child.stdout.on("data", (chunk: string) => {
					buffer += chunk;
					const lines = buffer.split("\n");
					buffer = lines.pop() ?? "";
					lines.forEach(handle);
				});
				child.stderr.setEncoding("utf8");
				child.stderr.on("data", (c: string) => (stderr += c));
				child.on("close", (code) => {
					handle(buffer);
					if (!finished) {
						o.onEvent(
							code === 0
								? { type: "done", text }
								: { type: "error", engine: "grok", message: `grok exit ${code}: ${stderr.trim().slice(-2000)}` },
						);
					}
					resolve();
				});
			});
		},
	};
}
