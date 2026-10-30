// Narrow bridge: the renderer can only call these named actions.
import { contextBridge, ipcRenderer } from "electron";

const api = {
	projects: {
		list: () => ipcRenderer.invoke("projects:list"),
		add: (input: unknown) => ipcRenderer.invoke("projects:add", input),
		update: (id: string, patch: unknown) => ipcRenderer.invoke("projects:update", id, patch),
		forget: (id: string) => ipcRenderer.invoke("projects:forget", id),
	},
	folders: {
		pick: (title: string) => ipcRenderer.invoke("folders:pick", title),
		summary: (path: string) => ipcRenderer.invoke("folders:summary", path),
		open: (path: string) => ipcRenderer.invoke("folders:open", path),
	},
	settings: {
		get: () => ipcRenderer.invoke("settings:get"),
		save: (patch: unknown) => ipcRenderer.invoke("settings:save", patch),
		setClaudeKey: (key: string) => ipcRenderer.invoke("settings:setClaudeKey", key),
	},
	engines: {
		status: () => ipcRenderer.invoke("engines:status"),
		login: (id: string) => ipcRenderer.invoke("engines:login", id),
	},
	agent: {
		run: (req: unknown) => ipcRenderer.invoke("agent:run", req),
		stop: (runId: string) => ipcRenderer.invoke("agent:stop", runId),
		onEvent: (cb: (runId: string, ev: unknown) => void) => {
			const listener = (_e: unknown, runId: string, ev: unknown) => cb(runId, ev);
			ipcRenderer.on("agent:event", listener);
			return () => ipcRenderer.removeListener("agent:event", listener);
		},
	},
};

contextBridge.exposeInMainWorld("konkurss", api);
