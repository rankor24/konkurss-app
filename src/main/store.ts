// App-level data in %APPDATA%\KonkursuApp: project list, settings, encrypted Claude key.
// Kept free of Electron imports so it can be unit-tested with plain Node; the
// encryption functions are injected (Electron safeStorage in the app).
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { FolderSummary, Project, Settings, Variant } from "../shared/types.js";

export interface Crypto {
	available(): boolean;
	encrypt(plain: string): Buffer;
	decrypt(data: Buffer): string;
}

const DEFAULT_SETTINGS: Settings = { engineForTasks: "claude", models: {}, hasClaudeKey: false };

export class Store {
	constructor(
		private dir: string,
		private crypto: Crypto,
	) {
		mkdirSync(dir, { recursive: true });
	}

	private read<T>(name: string, fallback: T): T {
		const f = join(this.dir, name);
		if (!existsSync(f)) return fallback;
		try {
			return JSON.parse(readFileSync(f, "utf8")) as T;
		} catch {
			return fallback;
		}
	}
	private write(name: string, data: unknown): void {
		writeFileSync(join(this.dir, name), JSON.stringify(data, null, 2), "utf8");
	}

	projects(): Project[] {
		return this.read<Project[]>("projects.json", []);
	}

	addProject(input: { name?: string; sourceDir: string; outputDir: string; variant?: Variant | null; builders?: string[] }): Project {
		const sourceDir = resolve(input.sourceDir);
		const outputDir = resolve(input.outputDir);
		const err = validateFolders(sourceDir, outputDir);
		if (err) throw new Error(err);
		const project: Project = {
			id: randomUUID(),
			name: input.name?.trim() || defaultName(sourceDir),
			sourceDir,
			outputDir,
			variant: input.variant ?? null,
			builders: (input.builders ?? []).map((b) => b.trim()).filter(Boolean),
			createdAt: new Date().toISOString(),
		};
		this.write("projects.json", [...this.projects(), project]);
		return project;
	}

	updateProject(id: string, patch: Partial<Pick<Project, "name" | "variant" | "builders">>): Project {
		const list = this.projects();
		const i = list.findIndex((p) => p.id === id);
		if (i < 0) throw new Error("Konkurss nav atrasts.");
		list[i] = { ...list[i], ...patch };
		this.write("projects.json", list);
		return list[i];
	}

	/** Removes the project from the list only. Folders on disk are never touched. */
	forgetProject(id: string): void {
		this.write("projects.json", this.projects().filter((p) => p.id !== id));
	}

	settings(): Settings {
		const s = this.read<Settings>("settings.json", DEFAULT_SETTINGS);
		return { ...DEFAULT_SETTINGS, ...s, hasClaudeKey: existsSync(join(this.dir, "claude.key")) };
	}

	saveSettings(patch: Partial<Settings>): Settings {
		const { hasClaudeKey: _ignored, ...rest } = { ...this.settings(), ...patch };
		this.write("settings.json", rest);
		return this.settings();
	}

	setClaudeKey(key: string): void {
		const k = key.trim();
		if (!k.startsWith("sk-ant-")) throw new Error("Tā neizskatās pēc Claude API atslēgas (sākas ar sk-ant-).");
		if (!this.crypto.available()) throw new Error("Windows šifrēšana nav pieejama — atslēgu nevar droši saglabāt.");
		writeFileSync(join(this.dir, "claude.key"), this.crypto.encrypt(k));
	}

	claudeKey(): string | null {
		const f = join(this.dir, "claude.key");
		if (!existsSync(f) || !this.crypto.available()) return null;
		try {
			return this.crypto.decrypt(readFileSync(f));
		} catch {
			return null;
		}
	}

	runDir(projectId: string): string {
		const d = join(this.dir, "runs", projectId);
		mkdirSync(d, { recursive: true });
		return d;
	}
}

export function defaultName(sourceDir: string): string {
	// E:\BV BIM\Paraugmodeli\260811_NVA_Remonta baze\KONKURSS → "260811_NVA_Remonta baze"
	const b = basename(sourceDir);
	return /^konkurss$/i.test(b) ? basename(resolve(sourceDir, "..")) : b;
}

/** Plain-Latvian reason when the folder pair is unsafe, or null when fine. */
export function validateFolders(sourceDir: string, outputDir: string): string | null {
	if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) return "Izejas datu mape neeksistē.";
	if (resolve(sourceDir).toLowerCase() === resolve(outputDir).toLowerCase()) return "Izejas dati un izvades mape nedrīkst būt viena un tā pati mape.";
	// Output inside the source root, or source inside the output root, are both fine:
	// the tool server's guard keeps the source folder read-only either way.
	return null;
}

export function summarizeFolder(path: string, limit = 20000): FolderSummary {
	const summary: FolderSummary = { path, exists: existsSync(path), total: 0, byExt: {} };
	if (!summary.exists) return summary;
	const stack = [path];
	while (stack.length && summary.total < limit) {
		const dir = stack.pop()!;
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const e of entries) {
			if (e.isDirectory()) {
				if (e.name !== ".konkurss" && e.name !== "node_modules") stack.push(join(dir, e.name));
			} else {
				const ext = extname(e.name).toLowerCase() || "(bez paplašinājuma)";
				summary.byExt[ext] = (summary.byExt[ext] ?? 0) + 1;
				summary.total++;
			}
		}
	}
	return summary;
}
