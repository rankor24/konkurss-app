// IPC for library v2 (phase 7): harvesting earlier submissions, accepting proposals, builders, subcontractors and
// the tender tracker. Reads from the tenders folder (B:\01_Konkursi) only; writes only the registers file.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ipcMain } from "electron";
import type { Builder } from "../../shared/library.js";
import type { AppContext } from "../context.js";
import { acceptAsNew, carryDecisions, ignoreProposal, mergeBuilders, mergeInto } from "../library/accept.js";
import { harvest } from "../library/harvest.js";
import { parseSubcontractors, parseTracker, trackerStats } from "../library/imports.js";
import { readXlsx } from "../office.js";

export const TRACKER_FILE = "02_Iepirkumi_BD_jauns.xlsx";
export const SUBS_FILE = "00_Specialistu un apaksuznemeju reg..xlsx";
export const ARCHIVE_DIR = "07_IESNIEGTI";

type Outcome<T> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof Error ? e.message : String(e) });

export function registerLibrary(ctx: AppContext): void {
	const view = () => {
		const reg = ctx.store.registers();
		const root = ctx.store.tendersRoot();
		return {
			tendersRoot: root,
			libraryDir: ctx.store.libraryDir(),
			harvest: reg.harvest ?? null,
			builders: reg.builders ?? [],
			subcontractors: reg.subcontractors ?? [],
			trackerStats: trackerStats(reg.tracker ?? []),
			trackerRows: (reg.tracker ?? []).length,
			files: { tracker: root && existsSync(join(root, TRACKER_FILE)) ? join(root, TRACKER_FILE) : null, subcontractors: root && existsSync(join(root, SUBS_FILE)) ? join(root, SUBS_FILE) : null },
		};
	};
	ipcMain.handle("library:get", () => view());

	ipcMain.handle("library:harvest", async (e): Promise<Outcome<{ proposals: number; builders: number }>> => {
		const root = ctx.store.tendersRoot();
		if (!root) return { ok: false, error: "Konkursu mape nav iestatīta un B:\\01_Konkursi nav pieejama. Iestatījumos norādi konkursu mapi." };
		try {
			const reg = ctx.store.registers();
			const run = await harvest({ roots: [root, join(root, ARCHIVE_DIR)], objects: reg.objects }, (msg) => e.sender.send("task:text", "library", msg));
			run.proposals = carryDecisions(reg.harvest?.proposals, run.proposals);
			const fresh = ctx.store.registers();
			fresh.harvest = run;
			fresh.builders = mergeBuilders(fresh.builders, run.builders);
			ctx.store.saveRegisters(fresh);
			return { ok: true, proposals: run.proposals.length, builders: run.builders.length };
		} catch (err) {
			return fail(err);
		}
	});

	const withProposal = (key: string, change: (reg: ReturnType<typeof ctx.store.registers>) => void) => {
		const reg = ctx.store.registers();
		if (!reg.harvest?.proposals.some((p) => p.key === key)) throw new Error("Ieteikums vairs nav sarakstā — palaid meklēšanu vēlreiz.");
		change(reg);
		ctx.store.saveRegisters(reg);
		return view();
	};
	ipcMain.handle("library:accept", (_e, key: string, name: string) =>
		withProposal(key, (reg) => void acceptAsNew(reg, reg.harvest!.proposals.find((p) => p.key === key)!, name)),
	);
	ipcMain.handle("library:merge", (_e, key: string, objectId: string) =>
		withProposal(key, (reg) => void mergeInto(reg, reg.harvest!.proposals.find((p) => p.key === key)!, objectId)),
	);
	ipcMain.handle("library:ignore", (_e, key: string) => withProposal(key, (reg) => ignoreProposal(reg, key)));

	ipcMain.handle("library:saveBuilders", (_e, builders: Builder[]) => {
		const reg = ctx.store.registers();
		reg.builders = builders;
		ctx.store.saveRegisters(reg);
		return view();
	});

	ipcMain.handle("library:importSubcontractors", (_e, path?: string): Outcome<{ count: number }> => {
		const f = path ?? view().files.subcontractors;
		if (!f) return { ok: false, error: `Fails „${SUBS_FILE}” konkursu mapē nav atrasts.` };
		try {
			const sheet = readXlsx(f)[0];
			const subs = sheet ? parseSubcontractors(sheet) : [];
			const reg = ctx.store.registers();
			reg.subcontractors = subs;
			ctx.store.saveRegisters(reg);
			return { ok: true, count: subs.length };
		} catch (err) {
			return fail(err);
		}
	});

	ipcMain.handle("library:importTracker", (_e, path?: string): Outcome<{ count: number }> => {
		const f = path ?? view().files.tracker;
		if (!f) return { ok: false, error: `Fails „${TRACKER_FILE}” konkursu mapē nav atrasts.` };
		try {
			const rows = parseTracker(readXlsx(f));
			const reg = ctx.store.registers();
			reg.tracker = rows;
			ctx.store.saveRegisters(reg);
			return { ok: true, count: rows.length };
		} catch (err) {
			return fail(err);
		}
	});
}
