// IPC for 2. Kura versija spēkā and 3. Ko konkurss prasa.
import { ipcMain } from "electron";
import type { BlockId, QaItem } from "../../shared/state.js";
import type { AppContext } from "../context.js";
import { updateState } from "../project-state.js";
import * as R from "../tasks/phase2-run.js";

const taskBase = (ctx: AppContext, projectId: string) => {
	const p = ctx.project(projectId);
	const engine = ctx.taskEngine();
	return { p, engine, base: ctx.runBase(p, engine.id, AbortSignal.timeout(20 * 60_000)) };
};

export function registerPhase2(ctx: AppContext): void {
	ipcMain.handle("versions:setEditions", (_e, projectId: string, original?: string, amended?: string) => R.setEditions(ctx.project(projectId), original, amended));
	ipcMain.handle("versions:compare", (_e, projectId: string) => R.diffEditions(ctx.project(projectId)));
	ipcMain.handle("versions:classify", (_e, projectId: string) => {
		const { p, engine, base } = taskBase(ctx, projectId);
		return R.classifyChanges(p, engine, base);
	});
	ipcMain.handle("versions:confirmChange", (_e, projectId: string, index: number, impact: "kriterijs" | "prasiba" | "redakcionala" | null) => {
		updateState(ctx.project(projectId).outputDir, (s) => {
			const c = s.versions.changes[index];
			if (!c) return;
			// confirming without an impact keeps the model's proposal; choosing one makes it the person's
			if (impact) {
				c.impact = impact;
				c.impactBy = "manual";
			}
			c.confirmed = c.impact !== null;
		});
	});
	ipcMain.handle("versions:setInForce", (_e, projectId: string, which: "original" | "amended") => R.setInForce(ctx.project(projectId), which));

	ipcMain.handle("versions:readQa", (_e, projectId: string) => {
		const { p, engine, base } = taskBase(ctx, projectId);
		return R.readQa(p, engine, base);
	});
	ipcMain.handle("versions:setQaImpact", (_e, projectId: string, index: number, impact: QaItem["impact"]) => {
		updateState(ctx.project(projectId).outputDir, (s) => {
			const q = s.versions.qa[index];
			if (q) {
				q.impact = impact;
				q.confirmed = true;
			}
		});
	});
	ipcMain.handle("versions:confirmQa", (_e, projectId: string, index: number, value: boolean) => {
		updateState(ctx.project(projectId).outputDir, (s) => {
			const q = s.versions.qa[index];
			if (q && q.impact) q.confirmed = value;
		});
	});
	ipcMain.handle("versions:compareTemplates", (_e, projectId: string) => R.compareForms(ctx.project(projectId)));

	ipcMain.handle("versions:readDeadline", async (_e, projectId: string) => {
		const { p, engine, base } = taskBase(ctx, projectId);
		const r = await R.readDeadline(p, engine, base, 1);
		if (r.ok) R.storeDeadline(p, r.deadline);
		return r.ok ? { ok: true as const, deadline: r.deadline } : r;
	});
	ipcMain.handle("versions:setDeadline", (_e, projectId: string, date: string, time: string, source: "iub" | "eis" | "nolikums" | "manual") =>
		R.setManualDeadline(ctx.project(projectId), date, time, source),
	);

	ipcMain.handle("req:read", async (_e, projectId: string, block: BlockId) => {
		const { p, engine, base } = taskBase(ctx, projectId);
		const r = await R.readBlock(p, engine, base, block, 1);
		if (!r.ok) return r;
		R.storeBlock(p, block, r.patch);
		return { ok: true as const, rejected: r.rejected };
	});
	ipcMain.handle("req:confirm", (_e, projectId: string, block: BlockId, value: boolean) => R.confirmBlock(ctx.project(projectId), block, value));
	ipcMain.handle("req:edit", (_e, projectId: string, block: BlockId, data: unknown) => R.editBlock(ctx.project(projectId), block, data));
	ipcMain.handle("req:secondPass", (_e, projectId: string) => {
		const { p, engine, base } = taskBase(ctx, projectId);
		return R.secondPass(p, engine, base);
	});
}
