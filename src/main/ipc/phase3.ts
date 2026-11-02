// IPC for Reģistri, 5. Kas ko dara (V2/V3 roles) and 6. Aizpildīt (BIP, matrica, builder copies).
import { ipcMain } from "electron";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Roles } from "../../shared/state.js";
import type { AppContext } from "../context.js";
import * as F from "../fill/run.js";
import { loadState, updateState } from "../project-state.js";
import { toolsConfig } from "../pytools.js";
import { decideRole, suggestRoles } from "../tasks/roles-run.js";
import { emptyRegisters, expiring, importFromSkillData, type Registers } from "../registers/registers.js";

export function registerPhase3(ctx: AppContext, toolsScript: string): void {
	const tools = toolsConfig(process.env, toolsScript);
	const deps = (projectId: string): F.RunDeps => ({
		project: ctx.project(projectId),
		tools,
		registers: ctx.store.registers(),
		otherProjects: ctx.store.projects(),
		extraForeign: ctx.store.settings().foreignTerms ?? [],
	});
	const taskBase = (projectId: string) => {
		const engine = ctx.taskEngine();
		return { engine, base: ctx.runBase(ctx.project(projectId), engine.id, AbortSignal.timeout(40 * 60_000)) };
	};

	// ----- registers (app-wide) -----
	ipcMain.handle("registers:get", () => {
		const registers = ctx.store.registers();
		return { registers, expiring: expiring(registers.specialists), hasData: ctx.store.hasRegisters() };
	});
	ipcMain.handle("registers:save", (_e, registers: Registers) => {
		ctx.store.saveRegisters({ ...emptyRegisters(), ...registers });
		return { registers: ctx.store.registers(), expiring: expiring(ctx.store.registers().specialists) };
	});
	/** Seeds the registers from the konkurss skill's data files. Refuses to replace existing data unless asked. */
	ipcMain.handle("registers:import", (_e, replace: boolean) => {
		const dir = join(ctx.paths.skillsDir, "konkurss", "data");
		const files = { uznemums: "uznemums.md", specialisti: "specialisti.md", objekti: "atsauces_objekti.md" };
		for (const f of Object.values(files)) if (!existsSync(join(dir, f))) return { ok: false as const, error: `Nav atrasts fails: ${f}` };
		const hasData = ctx.store.hasRegisters() && ctx.store.registers().specialists.length > 0;
		if (hasData && !replace) return { ok: false as const, error: "Reģistros jau ir dati. Importēšana tos aizvietotu — apstiprini to atsevišķi." };
		const r = importFromSkillData({
			uznemums: readFileSync(join(dir, files.uznemums), "utf8"),
			specialisti: readFileSync(join(dir, files.specialisti), "utf8"),
			objekti: readFileSync(join(dir, files.objekti), "utf8"),
		});
		ctx.store.saveRegisters(r);
		return { ok: true as const, specialists: r.specialists.length, objects: r.objects.length, fields: r.company.fields.length };
	});

	// ----- roles (per tender) -----
	ipcMain.handle("roles:get", (_e, projectId: string) => ctx.state(projectId).roles);
	ipcMain.handle("roles:save", (_e, projectId: string, roles: Roles) => {
		updateState(ctx.project(projectId).outputDir, (s) => void (s.roles = roles));
		return ctx.state(projectId).roles;
	});
	// roles the tender asks for, with quotes: suggestions only, the table is filled by a person
	ipcMain.handle("roles:suggest", (_e, projectId: string) => {
		const { engine, base } = taskBase(projectId);
		return suggestRoles(ctx.project(projectId), engine, base);
	});
	ipcMain.handle("roles:decide", (_e, projectId: string, id: string, decision: "added" | "rejected" | null) => decideRole(ctx.project(projectId), id, decision));

	// ----- fill -----
	ipcMain.handle("fill:templates", (_e, projectId: string) => F.templateCandidates(ctx.state(projectId)));
	ipcMain.handle("fill:valueSheet", (_e, projectId: string, key: string) => ctx.state(projectId).fills[key] ?? null);
	ipcMain.handle("fill:preview", (_e, projectId: string, key: string) => F.previewTemplate(deps(projectId), key));
	ipcMain.handle("fill:inspect", (_e, projectId: string, key: string) => F.inspectTemplate(deps(projectId), key));
	ipcMain.handle("fill:codeFill", (_e, projectId: string, key: string) => F.fillFromCode(deps(projectId), key));
	ipcMain.handle("fill:bip", async (e, projectId: string, key: string) => {
		const { engine, base } = taskBase(projectId);
		const d = deps(projectId);
		const code = await F.fillFromCode(d, key);
		if (!code.ok) return code;
		// agent switched off: only what the registers and the roles table know is filled
		if (!ctx.agentOn()) return { ok: true as const, rejected: 0, items: code.sheet.items.length };
		const r = await F.fillFromTender(d, engine, base, key, (msg) => e.sender.send("task:text", projectId, msg));
		return r.ok ? { ok: true as const, rejected: r.rejected, items: r.sheet.items.length } : r;
	});
	ipcMain.handle("fill:setItem", (_e, projectId: string, key: string, slotId: string, value: string | null) => F.setItem(ctx.project(projectId), key, slotId, value));
	ipcMain.handle("fill:generate", (_e, projectId: string, key: string, builder?: string) => F.generate(deps(projectId), key, builder));
	ipcMain.handle("fill:builderCopies", (_e, projectId: string, key: string) => F.builderCopies(deps(projectId), key));
	ipcMain.handle("fill:matrica", (_e, projectId: string, key: string, builder?: string) => {
		const { engine, base } = taskBase(projectId);
		return F.fillMatrica(deps(projectId), engine, base, key, builder);
	});
	ipcMain.handle("fill:leaks", async (_e, projectId: string, file: string) => {
		const d = deps(projectId);
		const s = loadState(d.project.outputDir);
		const { checkDocument, foreignTerms } = await import("../fill/leaks.js");
		return checkDocument(tools, file, foreignTerms({ project: d.project, state: s }, d.otherProjects, d.extraForeign));
	});
}
