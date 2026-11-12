// Codex engine — official @openai/codex-sdk, signed in with the person's own
// `codex login` (ChatGPT subscription). The app never touches the Codex token.
import { Codex, type ThreadEvent, type ThreadOptions } from "@openai/codex-sdk";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { RunEvent } from "../../shared/types.js";
import type { Engine, RunOptions } from "./types.js";
import { KONKURSS_TOOLS, MCP_SERVER_NAME } from "./types.js";
import { shellKind } from "../../shared/activity.js";
import { openLoginWindow } from "./login-window.js";

/** How much of a tool's output the side panel keeps. */
const OUTPUT_MAX = 2000;

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

/** State the mapper needs between events. */
export interface CodexState {
	turns: number;
	/** the last thing the agent said, which is the answer once the run ends */
	last: string;
}

/** One Codex event as the events the side panel and the runner understand. Pure, so it can be tested on recorded events. */
export function codexEvents(ev: ThreadEvent, st: CodexState): RunEvent[] {
	const out: RunEvent[] = [];
	const emit = (e: RunEvent) => void out.push(e);
	if (ev.type === "turn.started") emit({ type: "turn", n: ++st.turns });
	else if (ev.type === "item.started") {
		const it = ev.item;
		if (it.type === "mcp_tool_call") emit({ type: "tool", name: it.tool, id: it.id, detail: JSON.stringify(it.arguments).slice(0, 600) });
		else if (it.type === "command_execution") emit({ type: "tool", name: "shell", id: it.id, kind: shellKind(it.command), detail: it.command.slice(0, 600) });
		else if (it.type === "web_search") emit({ type: "tool", name: "web_search", id: it.id, kind: "web", detail: it.query });
	} else if (ev.type === "item.completed") {
		const it = ev.item;
		if (it.type === "agent_message") {
			st.last = it.text;
			emit({ type: "text", text: it.text });
		} else if (it.type === "reasoning") {
			if (it.text.trim()) emit({ type: "thinking", text: it.text });
		} else if (it.type === "mcp_tool_call") {
			const text = (it.result?.content ?? []).map((b) => (b.type === "text" ? b.text : "")).join("\n");
			emit({ type: "tool_result", name: it.tool, id: it.id, ok: it.status === "completed", detail: it.error?.message, output: text.slice(0, OUTPUT_MAX) });
		} else if (it.type === "command_execution") {
			const failed = it.status === "failed" || (it.exit_code !== undefined && it.exit_code !== 0);
			emit({ type: "tool_result", name: "shell", id: it.id, ok: !failed, detail: failed ? `exit ${it.exit_code ?? "?"}` : undefined, output: it.aggregated_output.slice(0, OUTPUT_MAX) });
		} else if (it.type === "web_search") {
			emit({ type: "tool_result", name: "web_search", id: it.id, ok: true });
		} else if (it.type === "file_change") {
			const list = it.changes.map((x) => `${x.kind} ${x.path}`).join("\n");
			emit({ type: "tool", name: "file_change", id: it.id, kind: "edit", detail: list });
			emit({ type: "tool_result", name: "file_change", id: it.id, ok: it.status === "completed" });
		} else if (it.type === "todo_list") {
			emit({ type: "tool", name: "plan", id: it.id, kind: "plan", detail: it.items.map((x) => `${x.completed ? "[x]" : "[ ]"} ${x.text}`).join("\n") });
			emit({ type: "tool_result", name: "plan", id: it.id, ok: true });
		} else if (it.type === "error") {
			emit({ type: "error", engine: "codex", message: it.message });
		}
	} else if (ev.type === "turn.failed") {
		emit({ type: "error", engine: "codex", message: ev.error.message });
		return out;
	} else if (ev.type === "error") {
		emit({ type: "error", engine: "codex", message: ev.message });
		return out;
	}
	return out;
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
			openLoginWindow("Codex pieslēgšanās", bundledCodexPath(), ["login"]);
		},
		async run(o) {
			try {
				mkdirSync(o.runDir, { recursive: true });
				const exe = bundledCodexPath();
				const codex = new Codex({ config: codexConfig(o), ...(exe !== "codex" ? { codexPathOverride: exe } : {}) });
				const thread = codex.startThread(codexThreadOptions(o));
				const { events } = await thread.runStreamed(o.prompt, { signal: o.signal });
				const st: CodexState = { turns: 0, last: "" };
				for await (const ev of events) {
					for (const r of codexEvents(ev, st)) o.onEvent(r);
					// a failed turn or a stream error ends the run; the mapper has already reported it
					if (ev.type === "turn.failed" || ev.type === "error") return;
				}
				o.onEvent({ type: "done", text: st.last });
			} catch (e) {
				o.onEvent({ type: "error", engine: "codex", message: (e as Error).message });
			}
		},
	};
}
