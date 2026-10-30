// Electron main process: window, IPC surface, engine runs.
import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from "electron";
import { join } from "node:path";
import type { EngineId, RunEvent, Settings, Variant } from "../shared/types.js";
import { Store, summarizeFolder } from "./store.js";
import { buildPrompt, createEngines, mcpLaunch } from "./engines/index.js";

const here = import.meta.dirname; // dist/main
const resourcesDir = app.isPackaged ? process.resourcesPath : join(here, "..", "..", "resources");
const pluginDir = join(resourcesDir, "plugin");
const skillsDir = join(pluginDir, "skills");
const serverJs = join(here, "..", "mcp", "server.js");

const store = new Store(join(app.getPath("userData"), "data"), {
	available: () => safeStorage.isEncryptionAvailable(),
	encrypt: (s) => safeStorage.encryptString(s),
	decrypt: (b) => safeStorage.decryptString(b),
});
const engines = createEngines(() => store.claudeKey());
const running = new Map<string, AbortController>();

let win: BrowserWindow | null = null;

function createWindow(): void {
	win = new BrowserWindow({
		width: 1280,
		height: 860,
		title: "Konkursu App",
		webPreferences: {
			preload: join(here, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});
	win.setMenuBarVisibility(false);
	win.loadFile(join(here, "..", "renderer", "index.html"));
}

ipcMain.handle("projects:list", () => store.projects());
ipcMain.handle("projects:add", (_e, input: { name?: string; sourceDir: string; outputDir: string; variant?: Variant | null; builders?: string[] }) =>
	store.addProject(input),
);
ipcMain.handle("projects:update", (_e, id: string, patch: { name?: string; variant?: Variant | null; builders?: string[] }) =>
	store.updateProject(id, patch),
);
ipcMain.handle("projects:forget", (_e, id: string) => store.forgetProject(id));
ipcMain.handle("folders:pick", async (_e, title: string) => {
	const r = await dialog.showOpenDialog(win!, { title, properties: ["openDirectory", "createDirectory"] });
	return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle("folders:summary", (_e, path: string) => summarizeFolder(path));
ipcMain.handle("folders:open", (_e, path: string) => shell.openPath(path));

ipcMain.handle("settings:get", () => store.settings());
ipcMain.handle("settings:save", (_e, patch: Partial<Settings>) => store.saveSettings(patch));
ipcMain.handle("settings:setClaudeKey", (_e, key: string) => store.setClaudeKey(key));
ipcMain.handle("engines:status", () => Promise.all(Object.values(engines).map((e) => e.status())));
ipcMain.handle("engines:login", (_e, id: EngineId) => engines[id].login?.());

ipcMain.handle("agent:run", async (e, req: { runId: string; projectId: string; engine: EngineId; text: string }) => {
	const project = store.projects().find((p) => p.id === req.projectId);
	if (!project) throw new Error("Konkurss nav atrasts.");
	const engine = engines[req.engine];
	const abort = new AbortController();
	running.set(req.runId, abort);
	const send = (ev: RunEvent) => {
		if (!e.sender.isDestroyed()) e.sender.send("agent:event", req.runId, ev);
	};
	const settings = store.settings();
	try {
		await engine.run({
			prompt: buildPrompt(project, req.text),
			runDir: store.runDir(project.id),
			pluginDir,
			mcp: mcpLaunch({
				serverJs,
				project,
				skillsDir,
				auditFile: join(project.outputDir, ".konkurss", "audit.jsonl"),
				engine: req.engine,
			}),
			model: settings.models[req.engine],
			signal: abort.signal,
			onEvent: send,
		});
	} finally {
		running.delete(req.runId);
	}
});
ipcMain.handle("agent:stop", (_e, runId: string) => running.get(runId)?.abort());

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
