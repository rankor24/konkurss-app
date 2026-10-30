// IPC for 4. Vai varam, 5. Kas ko dara (V1), prices, V1 forms, technical proposal and 7. Pierādījumi.
import { BrowserWindow, dialog, ipcMain } from "electron";
import type { Choices } from "../../shared/state.js";
import type { AppContext } from "../context.js";
import { loadState, updateState } from "../project-state.js";
import { toolsConfig } from "../pytools.js";
import * as V from "../v1/forms.js";
import { vocabulary } from "../v1/bindings.js";
import { collectEvidence, planEvidence } from "../v1/evidence.js";
import { bpvConsistency, feasibility } from "../v1/feasibility.js";
import { deadlineOf, experienceSlots, qualify } from "../v1/objects.js";
import { loadFinance, saveFinance, totals, type Finance } from "../v1/finance.js";
import * as Tech from "../v1/tech.js";

export function registerPhase4(ctx: AppContext, toolsScript: string): void {
	const tools = toolsConfig(process.env, toolsScript);
	const formDeps = (projectId: string): V.FormDeps => ({
		project: ctx.project(projectId),
		tools,
		registers: ctx.store.registers(),
		mappings: ctx.store.mappings(),
		saveMappings: (m) => ctx.store.saveMappings(m),
	});
	const taskBase = (projectId: string) => {
		const engine = ctx.taskEngine();
		return { engine, base: ctx.runBase(ctx.project(projectId), engine.id, AbortSignal.timeout(40 * 60_000)) };
	};

	// ----- 4. Vai varam / 5. Kas ko dara (V1) -----
	ipcMain.handle("feasibility:get", (_e, projectId: string) => {
		const p = ctx.project(projectId);
		const s = loadState(p.outputDir);
		const reg = ctx.store.registers();
		const deadline = deadlineOf(s);
		const f = feasibility(s.requirements, reg, deadline);
		const slots = experienceSlots(s.requirements);
		// per slot and register object: fits or not, with the reason — the greyed entries of the object dropdowns
		const options = Object.fromEntries(slots.map((slot) => [slot.id, reg.objects.map((o) => ({ id: o.id, name: o.name, ...qualify(o, slot, deadline) }))]));
		const bpvIdx = s.requirements.specialisti.findIndex((x) => /b[uū]vprojekta vad[iī]t[aā]j/i.test(x.field.value ?? ""));
		const bpvId = bpvIdx >= 0 ? s.choices.specialists[String(bpvIdx)] : undefined;
		const bpvObjects = slots.filter((x) => x.kind === "bpv").flatMap((x) => (s.choices.objects[x.id] ?? []).map((id) => reg.objects.find((o) => o.id === id)).filter((o): o is NonNullable<typeof o> => !!o));
		const bpvPoints = slots.find((x) => x.kind === "bpv")?.points ?? null;
		const bpv = bpvObjects.length ? bpvConsistency({ chosen: reg.specialists.find((x) => x.id === bpvId), objects: bpvObjects, points: bpvPoints }) : [];
		return { feasibility: f, slots, options, choices: s.choices, requirements: s.requirements.specialisti.map((x) => ({ field: x.field.value, mandatory: x.mandatory })), bpv, produced: V.producedDocs(s, reg) };
	});
	ipcMain.handle("feasibility:save", (_e, projectId: string, decision: Choices["decision"]) => {
		updateState(ctx.project(projectId).outputDir, (s) => void (s.choices.decision = decision));
	});
	ipcMain.handle("mapping:get", (_e, projectId: string) => ctx.state(projectId).choices);
	ipcMain.handle("mapping:save", (_e, projectId: string, choices: Choices) => {
		updateState(ctx.project(projectId).outputDir, (s) => void (s.choices = choices));
	});

	// ----- prices 🔒 -----
	const financeView = (projectId: string) => {
		const fin = loadFinance(ctx.project(projectId).outputDir);
		return { finance: fin, totals: totals(fin) };
	};
	ipcMain.handle("finance:get", (_e, projectId: string) => financeView(projectId));
	ipcMain.handle("finance:save", (_e, projectId: string, fin: Finance) => {
		saveFinance(ctx.project(projectId).outputDir, fin);
		return financeView(projectId);
	});

	// ----- V1 forms -----
	ipcMain.handle("fill:forms", (_e, projectId: string) => {
		const s = ctx.state(projectId);
		return s.files.filter((f) => f.root === "source" && f.where !== "darba" && (V.FORM_KINDS as readonly string[]).includes(f.kind) && f.rel.toLowerCase().endsWith(".docx")).map((f) => ({ key: `${f.root}:${f.rel}`, rel: f.rel, kind: f.kind }));
	});
	ipcMain.handle("fill:vocabulary", (_e, projectId: string) => vocabulary(V.bindCtx(formDeps(projectId))));
	ipcMain.handle("fill:bindForm", (_e, projectId: string, key: string) => {
		const { engine, base } = taskBase(projectId);
		return V.bindForm(formDeps(projectId), engine, base, key);
	});
	ipcMain.handle("fill:setBinding", (_e, projectId: string, key: string, slotId: string, binding: string) => V.setBinding(formDeps(projectId), key, slotId, binding));
	ipcMain.handle("fill:confirmBinding", (_e, projectId: string, key: string, slotId: string) => V.confirmBinding(ctx.project(projectId), key, slotId));
	ipcMain.handle("fill:notApplicable", (_e, projectId: string, key: string, slotId: string) => V.setNotApplicable(ctx.project(projectId), key, slotId));
	ipcMain.handle("fill:generateForm", (_e, projectId: string, key: string) => V.generateForm(formDeps(projectId), key));

	// ----- technical proposal -----
	ipcMain.handle("folders:pickFile", async (e, title: string) => {
		const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender)!, { title, properties: ["openFile"], filters: [{ name: "Word", extensions: ["docx"] }] });
		return r.canceled ? null : r.filePaths[0];
	});
	ipcMain.handle("fill:techProposal", (_e, projectId: string, boilerplate: string) => {
		const { engine, base } = taskBase(projectId);
		return Tech.proposeTech({ project: ctx.project(projectId), tools }, engine, base, boilerplate);
	});
	ipcMain.handle("fill:techDecision", (_e, projectId: string, i: number, decision: "accept" | "reject" | null) => Tech.techDecision(ctx.project(projectId), i, decision));
	ipcMain.handle("fill:techEdit", (_e, projectId: string, i: number, text: string) => Tech.editTechText(ctx.project(projectId), i, text));
	ipcMain.handle("fill:techGenerate", (_e, projectId: string) => Tech.generateTech({ project: ctx.project(projectId), tools }));

	// ----- 7. Pierādījumi -----
	const evidencePlan = (projectId: string) => {
		const s = ctx.state(projectId);
		const reg = ctx.store.registers();
		const bpvIdx = s.requirements.specialisti.findIndex((x) => /b[uū]vprojekta vad[iī]t[aā]j/i.test(x.field.value ?? ""));
		const bpv = reg.specialists.find((x) => x.id === s.choices.specialists[String(bpvIdx)]);
		return planEvidence(s.choices, reg, bpv?.name);
	};
	ipcMain.handle("proofs:plan", (_e, projectId: string) => evidencePlan(projectId));
	ipcMain.handle("proofs:collect", (_e, projectId: string) => {
		const p = ctx.project(projectId);
		const plan = evidencePlan(projectId);
		const r = collectEvidence(p.outputDir, plan);
		updateState(p.outputDir, (s) => void (s.proofs = { collectedAt: new Date().toISOString(), copied: r.copied.length, missing: plan.filter((x) => x.status === "missing").length }));
		return r;
	});
}
