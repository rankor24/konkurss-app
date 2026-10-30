// Codex engine — official @openai/codex-sdk, signed in with the person's own
// `codex login` (ChatGPT subscription). The app never touches the Codex token.
import { Codex, type ThreadOptions } from "@openai/codex-sdk";
import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Engine, RunOptions } from "./types.js";
import { KONKURSS_TOOLS, MCP_SERVER_NAME } from "./types.js";

const PLATFORM: Record<string, { pkg: string; triple: string }> = {
	"win32-x64": { pkg: "@openai/codex-win32-x64", triple: "x86_64-pc-windows-msvc" },
	"win32-arm64": { pkg: "@openai/codex-win32-arm64", triple: "aarch64-pc-windows-msvc" },
};

/**
 * The codex.exe that ships inside the app (dependency of @openai/codex-sdk), so
 * colleagues need no separate install. In a packaged build the binary lives in
 * app.asar.unpacked (see electron-builder asarUnpack). Falls back to PATH.
 */
export function bundledCodexPath(): string {
	const p = PLATFORM[`${process.platform}-${process.arch}`];
	if (!p) return "codex";
	try {
		const req = createRequire(import.meta.url);
		const codexPkg = req.resolve("@openai/codex/package.json");
		const platformPkg = createRequire(codexPkg).resolve(`${p.pkg}/package.json`);
		const exe = join(dirname(platformPkg), "vendor", p.triple, "bin", "codex.exe").replace(`app.asar${"\\"}`, `app.asar.unpacked${"\\"}`);
		return existsSync(exe) ? exe : "codex";
	} catch {
		return "codex";
	}
}

export function codexThreadOptions(o: RunOptions): ThreadOptions {
	return {
		model: o.model,
		workingDirectory: o.runDir,
		skipGitRepoCheck: true,
		// Codex may run read-only shell commands in its sandbox; all writes go through konkurss-tools.
		sandboxMode: "read-only",
		approvalPolicy: "never",
		networkAccessEnabled: false,
		webSearchMode: "disabled",
	};
}

export function codexConfig(o: RunOptions) {
	return {
		mcp_servers: {
			[MCP_SERVER_NAME]: {
				command: o.mcp.command,
				args: o.mcp.args,
				env: o.mcp.env,
				// approval_policy "never" would otherwise block every MCP call. The path guard
				// inside konkurss-tools is the real gate, so these four tools run unprompted.
				default_tools_approval_mode: "approve",
				enabled_tools: [...KONKURSS_TOOLS],
			},
		},
	};
}

function codexCli(args: string[]): Promise<{ code: number; out: string }> {
	return new Promise((res) => {
		execFile(bundledCodexPath(), args, { windowsHide: true, timeout: 15_000 }, (err, stdout, stderr) =>
			res({ code: err ? 1 : 0, out: `${stdout}${stderr}${err && !stdout && !stderr ? err.message : ""}`.trim() }),
		);
	});
}

export function createCodexEngine(): Engine {
	return {
		id: "codex",
		async status() {
			const r = await codexCli(["login", "status"]);
			if (r.code === 0 && /logged in/i.test(r.out)) return { id: "codex", ready: true, reason: r.out.split("\n")[0], canLogin: true };
			if (/not recognized|not found|ENOENT/i.test(r.out)) return { id: "codex", ready: false, reason: "Codex programma nav atrasta datorā.", canLogin: false };
			return { id: "codex", ready: false, reason: "Nav pieslēgts. Spied „Pieslēgties” un ienāc ar ChatGPT kontu.", canLogin: true };
		},
		async login() {
			// Opens a visible window; `codex login` launches the browser sign-in itself.
			spawn("cmd.exe", ["/c", "start", "Codex pieslēgšanās", "cmd", "/k", bundledCodexPath(), "login"], { detached: true, stdio: "ignore" }).unref();
		},
		async run(o) {
			try {
				mkdirSync(o.runDir, { recursive: true });
				const exe = bundledCodexPath();
				const codex = new Codex({ config: codexConfig(o), ...(exe !== "codex" ? { codexPathOverride: exe } : {}) });
				const thread = codex.startThread(codexThreadOptions(o));
				const { events } = await thread.runStreamed(o.prompt, { signal: o.signal });
				let last = "";
				for await (const ev of events) {
					if (ev.type === "item.started" && ev.item.type === "mcp_tool_call") {
						o.onEvent({ type: "tool", name: ev.item.tool, detail: JSON.stringify(ev.item.arguments).slice(0, 300) });
					} else if (ev.type === "item.completed") {
						const it = ev.item;
						if (it.type === "agent_message") {
							last = it.text;
							o.onEvent({ type: "text", text: it.text });
						} else if (it.type === "mcp_tool_call") {
							o.onEvent({ type: "tool_result", name: it.tool, ok: it.status === "completed", detail: it.error?.message });
						} else if (it.type === "command_execution") {
							o.onEvent({ type: "tool", name: "shell (tikai lasīšana)", detail: it.command.slice(0, 300) });
						} else if (it.type === "error") {
							o.onEvent({ type: "error", engine: "codex", message: it.message });
						}
					} else if (ev.type === "turn.failed") {
						o.onEvent({ type: "error", engine: "codex", message: ev.error.message });
						return;
					} else if (ev.type === "error") {
						o.onEvent({ type: "error", engine: "codex", message: ev.message });
						return;
					}
				}
				o.onEvent({ type: "done", text: last });
			} catch (e) {
				o.onEvent({ type: "error", engine: "codex", message: (e as Error).message });
			}
		},
	};
}
