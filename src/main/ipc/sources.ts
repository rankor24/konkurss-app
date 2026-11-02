// IPC for the extra sources a person adds on a page.
import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import { READABLE } from "../../shared/classify.js";
import { isSourcePage, type SourcePage } from "../../shared/sources.js";
import type { AppContext } from "../context.js";
import { addSource, refreshSource, removeSource, setSourceNote } from "../tasks/extras.js";

const page = (x: unknown): SourcePage => {
	if (!isSourcePage(x)) throw new Error("Šajā lapā papildu avotus pievienot nevar.");
	return x;
};

export function registerSources(ctx: AppContext): void {
	// files may be several at once; a folder is one source
	ipcMain.handle("sources:pick", async (e, kind: "file" | "folder") => {
		const win = BrowserWindow.fromWebContents(e.sender)!;
		const r =
			kind === "folder"
				? await dialog.showOpenDialog(win, { title: "Izvēlies mapi, kur aģentam meklēt", properties: ["openDirectory"] })
				: await dialog.showOpenDialog(win, {
						title: "Izvēlies failus, kur aģentam meklēt",
						properties: ["openFile", "multiSelections"],
						filters: [{ name: "Dokumenti", extensions: [...READABLE].map((x) => x.slice(1)) }],
					});
		return r.canceled ? null : r.filePaths;
	});

	ipcMain.handle("sources:add", (_e, projectId: string, p: unknown, path: string, note: string) => addSource(ctx.project(projectId), ctx.py, page(p), path, note ?? ""));
	ipcMain.handle("sources:refresh", (_e, projectId: string, p: unknown, id: string) => refreshSource(ctx.project(projectId), ctx.py, page(p), id));
	ipcMain.handle("sources:remove", (_e, projectId: string, p: unknown, id: string) => removeSource(ctx.project(projectId), page(p), id));
	ipcMain.handle("sources:note", (_e, projectId: string, p: unknown, id: string, note: string) => setSourceNote(ctx.project(projectId), page(p), id, note ?? ""));
	// only a path that is in the page's list is opened
	ipcMain.handle("sources:open", (_e, projectId: string, p: unknown, id: string) => {
		const src = ctx.state(projectId).sources?.[page(p)]?.find((x) => x.id === id);
		if (!src) throw new Error("Avots nav atrasts.");
		return shell.openPath(src.path);
	});
}
