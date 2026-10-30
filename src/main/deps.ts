// 6.2 Dependency status: what this computer has and what is missing, with a plain-Latvian fix for each.
// IO is injected so the logic is testable without Grok or Python installed.
import { existsSync } from "node:fs";
import { execFile, spawn } from "node:child_process";
import type { DepItem, DepState } from "../shared/deps.js";
import { runTool, type ToolsConfig } from "./pytools.js";

export type { DepItem, DepState };

/** Lowest Grok CLI the app was proven against. A 426 from the server is the authoritative sign of "too old". */
export const GROK_MIN = [1, 0, 70] as const;

export const parseVersion = (text: string): number[] | null => {
	const m = text.match(/(\d+)\.(\d+)\.(\d+)/);
	return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};
export function versionLess(a: readonly number[], b: readonly number[]): boolean {
	for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
	return false;
}

export interface DepsIO {
	tools: ToolsConfig;
	hasClaudeKey: boolean;
	codexPath: string;
	grokBin: string | null;
	exists: (p: string) => boolean;
	/** runs a program, returns exit code and combined output; rejects when it cannot start */
	run: (bin: string, args: string[]) => Promise<{ code: number; out: string }>;
	selfcheck: (cfg: ToolsConfig) => Promise<{ python?: string; frozen?: boolean; docx?: boolean; openpyxl?: boolean }>;
}

export async function dependencyStatus(io: DepsIO): Promise<DepItem[]> {
	const items: DepItem[] = [];

	// document tools
	try {
		const s = await io.selfcheck(io.tools);
		const missing = [s.docx === false ? "Word (python-docx)" : "", s.openpyxl === false ? "Excel (openpyxl)" : ""].filter(Boolean);
		items.push(
			missing.length
				? { id: "tools", label: "Dokumentu rīki", state: "missing", detail: `Trūkst: ${missing.join(", ")}.`, fix: "Pārinstalē Konkursu App ar jaunāko uzstādīšanas failu — tajā rīki ir iekļauti." }
				: { id: "tools", label: "Dokumentu rīki", state: "ok", detail: s.frozen ? "Iebūvētie rīki darbojas." : "Rīki darbojas (izstrādes režīms ar Python).", fix: "" },
		);
	} catch (e) {
		items.push({ id: "tools", label: "Dokumentu rīki", state: "missing", detail: `Rīki neatbild: ${(e as Error).message.slice(0, 200)}`, fix: "Pārinstalē Konkursu App ar jaunāko uzstādīšanas failu." });
	}

	// Claude
	items.push(
		io.hasClaudeKey
			? { id: "claude", label: "Claude", state: "ok", detail: "API atslēga ir saglabāta šajā datorā.", fix: "" }
			: { id: "claude", label: "Claude", state: "missing", detail: "Nav API atslēgas.", fix: "Atslēgu iedod Boriss; ievadi to Iestatījumos. Ja nelieto Claude, šo var neņemt vērā." },
	);

	// Codex (ships inside the app)
	items.push(
		io.codexPath !== "codex" && io.exists(io.codexPath)
			? { id: "codex", label: "Codex", state: "ok", detail: "Iebūvētā programma atrasta.", fix: "" }
			: { id: "codex", label: "Codex", state: "missing", detail: "Iebūvētā Codex programma nav atrasta.", fix: "Pārinstalē Konkursu App ar jaunāko uzstādīšanas failu." },
	);

	// Grok (installed separately by the person)
	if (!io.grokBin) {
		items.push({ id: "grok", label: "Grok", state: "missing", detail: "Grok programma nav uzstādīta šajā datorā.", fix: "Uzstādi Grok no x.ai (SuperGrok abonements), tad atver Iestatījumi un pieslēdzies. Ja nelieto Grok, šo var neņemt vērā." });
	} else {
		let version: number[] | null = null;
		try {
			version = parseVersion((await io.run(io.grokBin, ["--version"])).out);
		} catch {
			version = null;
		}
		const min = GROK_MIN.join(".");
		if (!version) items.push({ id: "grok", label: "Grok", state: "warn", detail: "Grok ir uzstādīts, bet versiju nevar nolasīt.", fix: "Spied „Atjaunināt Grok”.", action: "update-grok" });
		else if (versionLess(version, GROK_MIN)) items.push({ id: "grok", label: "Grok", state: "old", detail: `Uzstādīta versija ${version.join(".")}, vecāka par ${min}.`, fix: "Spied „Atjaunināt Grok” — vecā versija var neatbildēt (kļūda 426).", action: "update-grok" });
		else items.push({ id: "grok", label: "Grok", state: "ok", detail: `Versija ${version.join(".")}.`, fix: "", action: "update-grok" });
	}
	return items;
}

// ---- real IO ----
export const realRun: DepsIO["run"] = (bin, args) =>
	new Promise((resolve, reject) => {
		execFile(bin, args, { timeout: 30_000, windowsHide: true }, (err, stdout, stderr) => {
			if (err && (err as NodeJS.ErrnoException).code === "ENOENT") return reject(err);
			resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, out: `${stdout}${stderr}` });
		});
	});
export const realSelfcheck: DepsIO["selfcheck"] = (cfg) => runTool(cfg, "selfcheck", "x", 60_000);
export const realExists = existsSync;

/** `grok update` — the person pressed the button. Returns what Grok printed. */
export function updateGrok(bin: string): Promise<{ ok: boolean; out: string }> {
	return new Promise((resolve) => {
		const child = spawn(bin, ["update"], { windowsHide: true });
		let out = "";
		child.stdout.on("data", (d: Buffer) => (out += d.toString()));
		child.stderr.on("data", (d: Buffer) => (out += d.toString()));
		child.on("error", (e) => resolve({ ok: false, out: e.message }));
		child.on("close", (code) => resolve({ ok: code === 0, out: out.trim().slice(-1500) }));
		setTimeout(() => child.kill(), 180_000);
	});
}
