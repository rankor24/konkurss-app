// Reads and writes <output>\.konkurss\project.json.
// Writes are atomic (temp file + rename) and the previous version is kept, so a
// crash or a failed model task can never leave a half-written state (D11).
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { emptyState, type ProjectState } from "../shared/state.js";

export const stateDir = (outputDir: string) => join(outputDir, ".konkurss");
const stateFile = (outputDir: string) => join(stateDir(outputDir), "project.json");

export function loadState(outputDir: string): ProjectState {
	const f = stateFile(outputDir);
	if (!existsSync(f)) return emptyState();
	try {
		const loaded = JSON.parse(readFileSync(f, "utf8")) as Partial<ProjectState>;
		// Fill keys added in newer versions without losing anything already saved.
		const base = emptyState();
		return {
			...base,
			...loaded,
			versions: { ...base.versions, ...loaded.versions },
			deadline: { ...base.deadline, ...loaded.deadline },
			requirements: { ...base.requirements, ...loaded.requirements },
		} as ProjectState;
	} catch {
		throw new Error(`Konkursa stāvokļa fails ir bojāts: ${f}. Iepriekšējā versija: project.prev.json`);
	}
}

export function saveState(outputDir: string, state: ProjectState): void {
	const dir = stateDir(outputDir);
	mkdirSync(dir, { recursive: true });
	const f = stateFile(outputDir);
	const tmp = `${f}.tmp`;
	writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
	if (existsSync(f)) copyFileSync(f, join(dir, "project.prev.json"));
	renameSync(tmp, f);
}

/** Load, change, save — the only way main-process code mutates project state. */
export function updateState(outputDir: string, change: (s: ProjectState) => void): ProjectState {
	const s = loadState(outputDir);
	change(s);
	saveState(outputDir, s);
	return s;
}
