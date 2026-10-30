// Electron main process: window + wiring. Handlers live in ./ipc/*.
import { app, BrowserWindow, safeStorage } from "electron";
import { join } from "node:path";
import { Store } from "./store.js";
import { AppContext } from "./context.js";
import { registerCore } from "./ipc/core.js";
import { registerPhase1 } from "./ipc/phase1.js";
import { registerPhase2 } from "./ipc/phase2.js";
import { registerPhase3 } from "./ipc/phase3.js";
import { registerPhase4 } from "./ipc/phase4.js";
import { registerPhase5 } from "./ipc/phase5.js";
import { registerPhase6 } from "./ipc/phase6.js";
import { existsSync } from "node:fs";

const here = import.meta.dirname; // dist/main
const resourcesDir = app.isPackaged ? process.resourcesPath : join(here, "..", "..", "resources");
const pluginDir = join(resourcesDir, "plugin");

// the packaged app carries a frozen copy of the document tools; it is preferred over any Python on the PC
const frozenTools = join(process.resourcesPath ?? "", "tools", "konkurss-tools", "konkurss-tools.exe");
if (app.isPackaged && !process.env.KONKURSS_TOOLS_EXE && existsSync(frozenTools)) process.env.KONKURSS_TOOLS_EXE = frozenTools;

let win: BrowserWindow | null = null;

const store = new Store(join(app.getPath("userData"), "data"), {
	available: () => safeStorage.isEncryptionAvailable(),
	encrypt: (s) => safeStorage.encryptString(s),
	decrypt: (b) => safeStorage.decryptString(b),
});
const ctx = new AppContext(
	store,
	{ pluginDir, skillsDir: join(pluginDir, "skills"), serverJs: join(here, "..", "mcp", "server.js") },
	(channel, ...args) => win?.webContents.send(channel, ...args),
);

registerCore(ctx);
registerPhase1(ctx);
registerPhase2(ctx);
const toolsScript = app.isPackaged ? join(process.resourcesPath, "python", "konkurss_tools.py") : join(here, "..", "..", "python", "konkurss_tools.py");
registerPhase3(ctx, toolsScript);
registerPhase4(ctx, toolsScript);
registerPhase5(ctx, toolsScript);
registerPhase6(ctx, toolsScript);

function createWindow(): void {
	win = new BrowserWindow({
		width: 1360,
		height: 880,
		minWidth: 1280,
		minHeight: 800,
		title: "Konkursu App",
		webPreferences: { preload: join(here, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
	});
	win.setMenuBarVisibility(false);
	win.loadFile(join(here, "..", "renderer", "index.html"));
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
