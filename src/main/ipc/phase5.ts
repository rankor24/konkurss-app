// IPC for 8. Pārbaude, 9. Paraksti and 10. Rezultāts (incl. the clarification draft).
import { BrowserWindow, dialog, ipcMain } from "electron";
import type { Closeout, Finding } from "../../shared/checks.js";
import type { AppContext } from "../context.js";
import { draftClarification } from "../checks/clarify.js";
import { addObjectToRegister, getCloseout, readPostWin, saveCloseout } from "../checks/closeout.js";
import { runChecks, setProjectCode } from "../checks/run.js";
import { buildRows, saveSignature, verdict } from "../checks/signatures.js";
import { checkAtsauksmes, checkTechAnswers } from "../checks/substance.js";
import { eisTicks } from "../checks/submission.js";
import { summary } from "../checks/rules.js";
import { loadState, updateState } from "../project-state.js";
import { toolsConfig } from "../pytools.js";
import { planEvidence } from "../v1/evidence.js";
import { loadFinance, totals } from "../v1/finance.js";
import { bpvName } from "../checks/signatures.js";

export function registerPhase5(ctx: AppContext, toolsScript: string): void {
	const tools = toolsConfig(process.env, toolsScript);
	const checkDeps = (projectId: string) => ({
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

	// ----- 8. Pārbaude -----
	ipcMain.handle("checks:run", async (_e, projectId: string) => {
		const r = await runChecks(checkDeps(projectId));
		return { ranAt: r.ranAt, findings: r.findings, summary: r.summary, unreadable: r.unreadable };
	});
	ipcMain.handle("checks:code", (_e, projectId: string, code: string | null) => setProjectCode(ctx.project(projectId), code));
	ipcMain.handle("checks:ack", (_e, projectId: string, id: string, on: boolean) => {
		updateState(ctx.project(projectId).outputDir, (s) => {
			const ack = (s.checkAck as Record<string, true> | undefined) ?? {};
			if (on) ack[id] = true;
			else delete ack[id];
			s.checkAck = ack;
		});
	});
	/** Both substance checks; a failed one reports its raw error and leaves the other's result alone. */
	ipcMain.handle("checks:substance", async (_e, projectId: string) => {
		const p = ctx.project(projectId);
		const { engine, base } = taskBase(projectId);
		const s = ctx.state(projectId);
		const reg = ctx.store.registers();
		const bpv = bpvName(s, reg);
		const plan = planEvidence(s.choices, reg, bpv ?? undefined);
		const errors: string[] = [];
		const findings: Finding[] = [];
		const tech = await checkTechAnswers({ project: p, tools }, engine, base);
		if (tech.ok) findings.push(tech.finding);
		else errors.push(tech.error);
		const proofs = await checkAtsauksmes({ project: p, py: ctx.py }, engine, base, plan, reg.objects);
		if (proofs.ok) findings.push(proofs.finding);
		else errors.push(proofs.error);
		if (findings.length) {
			updateState(p.outputDir, (st) => {
				const cur = (st.checks as { ranAt: string; findings: Finding[] } | undefined) ?? { ranAt: new Date().toISOString(), findings: [] };
				const ids = new Set(findings.map((f) => f.id));
				st.checks = { ranAt: cur.ranAt, findings: [...cur.findings.filter((f) => !ids.has(f.id)), ...findings] };
			});
		}
		return { ok: errors.length === 0, errors, findings, summary: summary(findings) };
	});

	// ----- 9. Paraksti -----
	const signaturesView = async (projectId: string) => {
		const p = ctx.project(projectId);
		const reg = ctx.store.registers();
		const rows = await buildRows(p, tools, reg);
		const verdicts = Object.fromEntries(rows.map((r) => [r.id, verdict(r)]));
		const s = loadState(p.outputDir);
		const fin = totals(loadFinance(p.outputDir));
		const ticks = eisTicks(s, fin.net > 0 && fin.eis !== null ? fin.eis / 100 : null);
		const done = verdictsDone(Object.values(verdicts));
		updateState(p.outputDir, (st) => void (st.signaturesSummary = { total: rows.length, ok: done.ok, wrong: done.wrong }));
		return { rows, verdicts, ticks, ticked: (s.eisDone as Record<string, true> | undefined) ?? {}, deadline: s.deadline };
	};
	ipcMain.handle("signatures:get", (_e, projectId: string) => signaturesView(projectId));
	ipcMain.handle("signatures:save", async (_e, projectId: string, id: string, change: { file?: string | null; manual?: { name: string; at: string } | null }) => {
		saveSignature(ctx.project(projectId), id, change);
		return signaturesView(projectId);
	});
	ipcMain.handle("signatures:pick", async (e) => {
		const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender)!, { title: "Izvēlies parakstīto failu", properties: ["openFile"], filters: [{ name: "Parakstīts (.edoc)", extensions: ["edoc"] }] });
		return r.canceled ? null : r.filePaths[0];
	});
	ipcMain.handle("eis:tick", (_e, projectId: string, id: string, on: boolean) => {
		updateState(ctx.project(projectId).outputDir, (s) => {
			const done = (s.eisDone as Record<string, true> | undefined) ?? {};
			if (on) done[id] = true;
			else delete done[id];
			s.eisDone = done;
		});
	});

	// ----- 10. Rezultāts -----
	ipcMain.handle("closeout:get", (_e, projectId: string) => getCloseout(ctx.project(projectId)));
	ipcMain.handle("closeout:save", (_e, projectId: string, patch: Partial<Closeout>) => saveCloseout(ctx.project(projectId), patch));
	ipcMain.handle("closeout:addObject", (_e, projectId: string) => {
		const r = addObjectToRegister(ctx.project(projectId), ctx.store.registers());
		if (!r.ok) return r;
		ctx.store.saveRegisters(r.registers);
		return { ok: true as const, object: r.object };
	});
	ipcMain.handle("closeout:postwin", (_e, projectId: string) => {
		const { engine, base } = taskBase(projectId);
		return readPostWin(ctx.project(projectId), engine, base);
	});
	ipcMain.handle("clarify:draft", (_e, projectId: string, request: string, secret: boolean) => {
		const { engine, base } = taskBase(projectId);
		return draftClarification({ project: ctx.project(projectId), tools }, engine, base, request, secret);
	});
}

function verdictsDone(v: string[]): { ok: number; wrong: number } {
	return { ok: v.filter((x) => x === "ok" || x === "eis" || x === "manual").length, wrong: v.filter((x) => x === "wrong").length };
}
