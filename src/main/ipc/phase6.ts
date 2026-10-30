// IPC for the dependency screen and the Grok update button (phase 6).
import { ipcMain } from "electron";
import type { AppContext } from "../context.js";
import { bundledCodexPath } from "../engines/codex.js";
import { findGrok } from "../engines/grok.js";
import { dependencyStatus, realExists, realRun, realSelfcheck, updateGrok } from "../deps.js";
import { toolsConfig } from "../pytools.js";

export function registerPhase6(ctx: AppContext, toolsScript: string): void {
	ipcMain.handle("deps:status", () =>
		dependencyStatus({
			tools: toolsConfig(process.env, toolsScript),
			hasClaudeKey: ctx.store.settings().hasClaudeKey,
			codexPath: bundledCodexPath(),
			grokBin: findGrok(),
			exists: realExists,
			run: realRun,
			selfcheck: realSelfcheck,
		}),
	);
	ipcMain.handle("grok:update", async () => {
		const bin = findGrok();
		if (!bin) return { ok: false, out: "Grok programma nav uzstādīta." };
		return updateGrok(bin);
	});
}
