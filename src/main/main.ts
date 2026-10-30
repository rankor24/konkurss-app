// Electron main process: window + wiring. Handlers live in ./ipc/*.
import { app, BrowserWindow, safeStorage } from "electron";
import { join } from "node:path";
import { Store } from "./store.js";
import { AppContext } from "./context.js";
import { registerCore } from "./ipc/core.js";
import { registerPhase1 } from "./ipc/phase1.js";

const here = import.meta.dirname; // dist/main
const resourcesDir = app.isPackaged ? process.resourcesPath : join(here, "..", "..", "resources");
const pluginDir = join(resourcesDir, "plugin");

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
