// IPC for folders, settings, engines and the free-form agent chat.
import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EngineId, RunEvent, Settings, Variant } from "../../shared/types.js";
import { AGENT_OFF, type AppContext } from "../context.js";
import { summarizeFolder } from "../store.js";
import { buildPrompt } from "../engines/index.js";

const running = new Map<string, AbortController>();

export function registerCore(ctx: AppContext): void {
	ipcMain.handle("projects:list", () => ctx.store.projects());
	ipcMain.handle("projects:add", (_e, input: { name?: string; sourceDir: string; outputDir: string; variant?: Variant | null; builders?: string[] }) =>
		ctx.store.addProject(input),
	);
	ipcMain.handle("projects:update", (_e, id: string, patch: { name?: string; variant?: Variant | null; builders?: string[] }) =>
		ctx.store.updateProject(id, patch),
	);
	ipcMain.handle("projects:forget", (_e, id: string) => ctx.store.forgetProject(id));

	ipcMain.handle("folders:pick", async (e, title: string) => {
		const win = BrowserWindow.fromWebContents(e.sender)!;
		const r = await dialog.showOpenDialog(win, { title, properties: ["openDirectory", "createDirectory"] });
		return r.canceled ? null : r.filePaths[0];
	});
	ipcMain.handle("folders:summary", (_e, path: string) => summarizeFolder(path));
	ipcMain.handle("folders:open", (_e, path: string) => shell.openPath(path));

	ipcMain.handle("settings:get", () => ctx.store.settings());
	ipcMain.handle("settings:save", (_e, patch: Partial<Settings>) => ctx.store.saveSettings(patch));
	ipcMain.handle("settings:setClaudeKey", (_e, key: string) => ctx.store.setClaudeKey(key));
	ipcMain.handle("engines:status", () => Promise.all(Object.values(ctx.engines).map((e) => e.status())));
	ipcMain.handle("engines:login", (_e, id: EngineId) => ctx.engines[id].login?.());

	ipcMain.handle("audit:tail", (_e, projectId: string, lines = 200) => {
		const f = join(ctx.project(projectId).outputDir, ".konkurss", "audit.jsonl");
		if (!existsSync(f)) return [];
		return readFileSync(f, "utf8").trim().split("\n").slice(-lines).reverse().map((l) => JSON.parse(l));
	});

	ipcMain.handle("agent:run", async (e, req: { runId: string; projectId: string; engine: EngineId; text: string }) => {
		const project = ctx.project(req.projectId);
		const abort = new AbortController();
		running.set(req.runId, abort);
		const send = (ev: RunEvent) => {
			if (!e.sender.isDestroyed()) e.sender.send("agent:event", req.runId, ev);
		};
		try {
			if (!ctx.agentOn()) send({ type: "error", engine: req.engine, message: AGENT_OFF });
			else await ctx.engines[req.engine].run({ ...ctx.runBase(project, req.engine, abort.signal), prompt: buildPrompt(project, req.text), onEvent: send });
		} finally {
			running.delete(req.runId);
		}
	});
	ipcMain.handle("agent:stop", (_e, runId: string) => running.get(runId)?.abort());
}
