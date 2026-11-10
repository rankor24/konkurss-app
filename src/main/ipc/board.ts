// IPC for phase 10: the portfolio board. Reads the tenders folder and the tracker; writes only the app's own
// board.json (statuses a person sets) and its deadline cache.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ipcMain } from "electron";
import type { AppContext } from "../context.js";
import { discover, type BoardStatus, type Deadline } from "../board/discover.js";
import { trackerStats } from "../library/imports.js";

export function registerBoard(ctx: AppContext): void {
	ipcMain.handle("board:get", async (e) => {
		const root = ctx.store.tendersRoot();
		if (!root) return { ok: false, error: "Konkursu mape nav iestatīta un B:\\01_Konkursi nav pieejama. Iestatījumos norādi konkursu mapi." };
		const reg = ctx.store.registers();
		const cache = ctx.store.boardCache<{ sig: string; deadline: Deadline | null }>();
		const rows = await discover({
			root,
			projects: ctx.store.projects(),
			tracker: reg.tracker ?? [],
			manual: ctx.store.boardStatuses(),
			cache,
			onProgress: (done, total) => e.sender.send("task:text", "board", `Lasa konkursu mapes: ${done} no ${total}`),
		});
		ctx.store.saveBoardCache(cache);
		return { ok: true, root, rows, trackerLoaded: (reg.tracker ?? []).length > 0, stats: trackerStats(reg.tracker ?? []), today: new Date().toISOString().slice(0, 10) };
	});

	ipcMain.handle("board:setStatus", (_e, folder: string, status: BoardStatus | null, note: string) => {
		const m = ctx.store.boardStatuses();
		if (status === null) delete m[folder];
		else m[folder] = { status, note, at: new Date().toISOString() };
		ctx.store.saveBoardStatuses(m);
		return m;
	});

	/**
	 * The folders a new app project for this tender would use: the tender's documents (its KONKURSS subfolder when there
	 * is one) to read, and a work folder on this PC — never the tender folder: people move the finished pack there.
	 */
	ipcMain.handle("board:projectFolders", (_e, folderPath: string) => {
		const konkurss = ["KONKURSS", "Konkurss"].map((n) => join(folderPath, n)).find((p) => existsSync(p));
		return { sourceDir: konkurss ?? folderPath, outputDir: ctx.store.workFolderFor(folderPath) };
	});
	/** For the new-tender wizard and the screens that explain where files are. */
	ipcMain.handle("folders:defaults", (_e, sourceDir?: string) => ({ workRoot: ctx.store.workRoot(), tendersRoot: ctx.store.tendersRoot(), workFolder: sourceDir ? ctx.store.workFolderFor(sourceDir) : null }));
}
