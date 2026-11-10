// App-level data in %APPDATA%\KonkursuApp: project list, settings, encrypted Claude key.
// Kept free of Electron imports so it can be unit-tested with plain Node; the
// encryption functions are injected (Electron safeStorage in the app).
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import type { FolderSummary, Project, Settings, Variant } from "../shared/types.js";
import { emptyRegisters, type Registers } from "./registers/registers.js";

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
		/** this Windows user's My Documents (Electron's app.getPath("documents")); tests leave it out */
		private documentsDir?: string,
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
		const err = validateFolders(sourceDir, outputDir, this.tendersRoot());
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

	/** A file in the app's data folder, for modules that keep their own data (the pi sign-in tokens). */
	filePath(name: string): string {
		return join(this.dir, name);
	}

	/** The operating system encryption this store uses for the Claude key. */
	seal(): Crypto {
		return this.crypto;
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

	/** Where registers.json lives: the shared library folder when one is set, else this PC's app folder. */
	libraryDir(): string {
		const shared = this.settings().libraryDir?.trim();
		return shared ? shared : this.dir;
	}

	registers(): Registers {
		const f = join(this.libraryDir(), "registers.json");
		if (!existsSync(f)) return emptyRegisters();
		try {
			return { ...emptyRegisters(), ...(JSON.parse(readFileSync(f, "utf8")) as Partial<Registers>) };
		} catch {
			throw new Error(`Reģistru fails ir bojāts: ${f}. Iepriekšējā versija ir tajā pašā mapē — faila nosaukumā ir „prev”.`);
		}
	}

	/**
	 * Replaces the registers; the previous file is kept as registers.prev.json. In a shared library folder every
	 * save also keeps a dated copy in backups\ and holds a short lock, so two people cannot overwrite each other.
	 */
	saveRegisters(r: Registers, who = "šis dators", now = new Date()): void {
		const dir = this.libraryDir();
		mkdirSync(dir, { recursive: true });
		const f = join(dir, "registers.json");
		const shared = dir !== this.dir;
		const lock = join(dir, "registers.lock");
		if (shared && existsSync(lock)) {
			const held = this.lockInfo(lock);
			if (held && held.who !== who && now.getTime() - held.at < 120_000) throw new Error(`Reģistrus šobrīd saglabā ${held.who}. Pamēģini pēc minūtes.`);
		}
		if (shared) writeFileSync(lock, JSON.stringify({ who, at: now.getTime() }), "utf8");
		try {
			if (existsSync(f)) {
				copyFileSync(f, join(dir, "registers.prev.json"));
				if (shared) {
					mkdirSync(join(dir, "backups"), { recursive: true });
					copyFileSync(f, join(dir, "backups", `registers-${now.toISOString().replace(/[:.]/g, "-")}.json`));
				}
			}
			const tmp = `${f}.tmp`;
			writeFileSync(tmp, JSON.stringify(r, null, 2), "utf8");
			copyFileSync(tmp, f);
			rmSync(tmp, { force: true });
		} finally {
			if (shared) rmSync(lock, { force: true });
		}
	}

	private lockInfo(lock: string): { who: string; at: number } | null {
		try {
			return JSON.parse(readFileSync(lock, "utf8")) as { who: string; at: number };
		} catch {
			return null;
		}
	}

	/** Board (phase 10): statuses a person set per tender folder, and the deadline cache. */
	boardStatuses(): Record<string, { status: "jauns" | "izverte" | "gatavo" | "iesniegts" | "atteikts"; note: string; at: string }> {
		return this.read("board.json", {});
	}
	saveBoardStatuses(m: ReturnType<Store["boardStatuses"]>): void {
		this.write("board.json", m);
	}
	boardCache<T>(): Record<string, T> {
		return this.read("board-cache.json", {});
	}
	saveBoardCache(c: unknown): void {
		this.write("board-cache.json", c);
	}

	/** Where tenders' work files go: the setting, else "Konkursi" in this Windows user's own My Documents. */
	workRoot(): string {
		const s = this.settings().workRoot?.trim();
		return s ? s : join(this.documentsDir ?? join(homedir(), "Documents"), "Konkursi");
	}

	/** The work folder for one tender folder: <work root>\<tender folder name>; a KONKURSS subfolder names its parent. */
	workFolderFor(sourceDir: string): string {
		const parts = resolve(sourceDir).split(/[\\/]+/).filter(Boolean);
		const name = /^konkurss$/i.test(parts.at(-1) ?? "") && parts.length > 1 ? parts.at(-2)! : (parts.at(-1) ?? "konkurss");
		return join(this.workRoot(), name);
	}

	/** The tenders folder: the setting, else B:\01_Konkursi when it exists, else null. */
	tendersRoot(): string | null {
		const s = this.settings().tendersRoot?.trim();
		if (s) return s;
		const def = "B:\\01_Konkursi";
		return existsSync(def) ? def : null;
	}

	/** Mapping memory: form layout (skeleton) → "label#n" → binding. Learned from people's corrections. */
	mappings(): Record<string, Record<string, string>> {
		return this.read("mappings.json", {});
	}

	saveMappings(m: Record<string, Record<string, string>>): void {
		this.write("mappings.json", m);
	}

	hasRegisters(): boolean {
		return existsSync(join(this.libraryDir(), "registers.json"));
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
const inside = (child: string, parent: string) => {
	const c = resolve(child).toLowerCase();
	const p = resolve(parent).toLowerCase().replace(/[\\/]+$/, "");
	return c === p || c.startsWith(p + "\\") || c.startsWith(p + "/");
};

export function validateFolders(sourceDir: string, outputDir: string, tendersRoot?: string | null): string | null {
	if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) return "Izejas datu mape neeksistē.";
	if (resolve(sourceDir).toLowerCase() === resolve(outputDir).toLowerCase()) return "Izejas dati un izvades mape nedrīkst būt viena un tā pati mape.";
	// the tenders folder is the office's record: the app only reads it, people move finished packs there themselves
	if (tendersRoot && inside(outputDir, tendersRoot)) return `Darba mape nedrīkst būt konkursu mapē (${tendersRoot}) — tur app neko neraksta. Izvēlies mapi šajā datorā; gatavo paku uz konkursa mapi pārvieto pats.`;
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
