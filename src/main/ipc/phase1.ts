// IPC for projects, 1. Dokumenti and the variant task.
import { ipcMain } from "electron";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DocKind, Variant } from "../../shared/state.js";
import { allStepStatuses, checklist, progress } from "../../shared/steps.js";
import type { AppContext } from "../context.js";
import { extractAll, fileWarnings, readCachedText, scanFolders } from "../extract.js";
import { loadState, stateDir, updateState } from "../project-state.js";
import { detectVariant } from "../tasks/variant-run.js";
import { editionCandidates, fileKey, guessEditions } from "../tasks/phase2-run.js";

export function registerPhase1(ctx: AppContext): void {
	ipcMain.handle("projects:summaries", () =>
		ctx.store.projects().map((p) => {
			const s = loadState(p.outputDir);
			const f = join(stateDir(p.outputDir), "project.json");
			return {
				project: p,
				progress: progress(s),
				tenderId: s.requirements.dati.id.value,
				deadline: s.deadline.date.value ? `${s.deadline.date.value} ${s.deadline.time.value ?? ""}`.trim() : null,
				changedAt: existsSync(f) ? statSync(f).mtime.toISOString() : p.createdAt,
				sourceExists: existsSync(p.sourceDir),
			};
		}),
	);

	ipcMain.handle("state:get", (_e, projectId: string) => {
		const s = ctx.state(projectId);
		const items = checklist(s);
		return {
			state: s,
			steps: allStepStatuses(s),
			progress: progress(s),
			checklist: { done: items.filter((i) => i.done).length, total: items.length },
			warnings: fileWarnings(s.files),
			editions: { candidates: editionCandidates(s.files).map(fileKey), guess: guessEditions(s.files) },
		};
	});

	ipcMain.handle("files:scan", (_e, projectId: string) => {
		const p = ctx.project(projectId);
		return updateState(p.outputDir, (s) => {
			s.files = scanFolders(p, s.files);
			s.scannedAt = new Date().toISOString();
		}).files.length;
	});

	ipcMain.handle("files:extract", async (_e, projectId: string) => {
		const p = ctx.project(projectId);
		const s = loadState(p.outputDir);
		const files = await extractAll(p, s, ctx.py, (done, total, rel) => ctx.emit("files:progress", projectId, done, total, rel));
		const after = updateState(p.outputDir, (st) => {
			st.files = files;
			st.extractedAt = new Date().toISOString();
		});
		return {
			read: after.files.filter((f) => f.text === "ok").length,
			readable: after.files.filter((f) => f.text !== "neattiecas").length,
			total: after.files.length,
		};
	});

	ipcMain.handle("files:setKind", (_e, projectId: string, root: "source" | "output", rel: string, kind: DocKind) => {
		const p = ctx.project(projectId);
		updateState(p.outputDir, (s) => {
			const f = s.files.find((x) => x.root === root && x.rel === rel);
			if (f) {
				f.kind = kind;
				f.kindSetByUser = true;
			}
		});
	});

	ipcMain.handle("files:text", (_e, projectId: string, root: "source" | "output", rel: string) =>
		readCachedText(ctx.project(projectId), { root, rel }),
	);

	ipcMain.handle("files:openOne", (_e, projectId: string, root: "source" | "output", rel: string) => {
		const p = ctx.project(projectId);
		return import("electron").then(({ shell }) => shell.openPath(join(root === "source" ? p.sourceDir : p.outputDir, rel)));
	});

	ipcMain.handle("tasks:variant", (_e, projectId: string) => {
		const p = ctx.project(projectId);
		const engine = ctx.taskEngine();
		return detectVariant(p, engine, ctx.runBase(p, engine.id, AbortSignal.timeout(15 * 60_000)));
	});

	ipcMain.handle("tasks:confirmVariant", (_e, projectId: string, value: Variant) => {
		const p = ctx.project(projectId);
		updateState(p.outputDir, (s) => {
			s.variant = s.variant?.value === value ? { ...s.variant, confirmed: true } : { value, status: "manual", confirmed: true };
		});
		return ctx.store.updateProject(projectId, { variant: value });
	});
}
