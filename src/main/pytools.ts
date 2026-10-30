// Calls python/konkurss_tools.py (or the frozen konkurss-tools.exe in the packaged app).
// Specs go through a JSON file so no document text ever sits on a command line.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface ToolsConfig {
	/** "py -3.14" in development; ignored when `exe` is set */
	python: string[];
	script: string;
	/** frozen exe (phase 6); preferred when present */
	exe?: string;
}

export function toolsConfig(env: NodeJS.ProcessEnv, script: string): ToolsConfig {
	const raw = env.KONKURSS_PY ?? (process.platform === "win32" ? "py -3.14" : "python3");
	const exe = env.KONKURSS_TOOLS_EXE && existsSync(env.KONKURSS_TOOLS_EXE) ? env.KONKURSS_TOOLS_EXE : undefined;
	return { python: raw.split(" ").filter(Boolean), script, exe };
}

export function runTool<T = Record<string, unknown>>(cfg: ToolsConfig, cmd: string, arg: string, timeoutMs = 180_000): Promise<T> {
	const [bin, ...pre] = cfg.exe ? [cfg.exe] : cfg.python;
	const args = cfg.exe ? [cmd, arg] : [...pre, cfg.script, cmd, arg];
	return new Promise((resolve, reject) => {
		execFile(bin, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } }, (err, stdout, stderr) => {
			const line = stdout.trim().split("\n").filter(Boolean).pop();
			let parsed: { ok?: boolean; error?: string } | null = null;
			try {
				parsed = line ? JSON.parse(line) : null;
			} catch {
				/* handled below */
			}
			if (parsed && parsed.ok === false) return reject(new Error(parsed.error ?? "Rīks neizdevās."));
			if (err && !parsed) return reject(new Error(`${err.message}\n${stderr}`.trim().slice(0, 800)));
			resolve((parsed ?? {}) as T);
		});
	});
}

/** Writes a spec to a temp JSON file, runs the command on it, removes the file. */
export async function runToolSpec<T = Record<string, unknown>>(cfg: ToolsConfig, cmd: string, spec: unknown): Promise<T> {
	const dir = mkdtempSync(join(tmpdir(), "konkurss-spec-"));
	const file = join(dir, "spec.json");
	try {
		mkdirSync(dir, { recursive: true });
		writeFileSync(file, JSON.stringify(spec), "utf8");
		return await runTool<T>(cfg, cmd, file);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// ---- typed results ----
export interface InspectedParagraph {
	i: number;
	text: string;
	style: string;
	heading: number;
	italic: number;
}
export interface InspectedTable {
	t: number;
	rows: number;
	cols: number;
	cells: string[][];
	/** index of the paragraph just before the table; -1 if the table opens the document */
	after_p: number;
}
export interface Inspected {
	ok: true;
	paragraphs: InspectedParagraph[];
	tables: InspectedTable[];
	skeleton: string;
}
export const inspectDocx = (cfg: ToolsConfig, path: string) => runTool<Inspected>(cfg, "inspect-docx", path);

export type EditStatus = "source" | "missing" | "na" | "added" | "manual";
export type DocxEdit =
	| { kind: "cell"; t: number; r: number; c: number; text: string; status: EditStatus; note?: string }
	| { kind: "paragraph"; i: number; text: string; status: EditStatus; note?: string; delete?: boolean }
	| { kind: "add_rows"; t: number; count: number };
export const fillDocx = (cfg: ToolsConfig, spec: { src: string; dst: string; edits: DocxEdit[]; legend?: [string, string | null][] }) => runToolSpec<{ ok: true; dst: string; edits: number }>(cfg, "fill-docx", spec);

export interface XlsxEdit {
	sheet?: string;
	ref: string;
	value: string | number | null;
	status: EditStatus;
	note?: string;
}
export const fillXlsx = (cfg: ToolsConfig, spec: { src: string; dst: string; edits: XlsxEdit[] }) => runToolSpec<{ ok: true; dst: string; edits: number }>(cfg, "fill-xlsx", spec);

import type { TermHit } from "../shared/leaks.js";
export type { TermHit };
export const grepTerms = (cfg: ToolsConfig, spec: { files: string[]; terms?: string[]; patterns?: string[] }) => runToolSpec<{ ok: true; scanned: number; hits: TermHit[] }>(cfg, "grep-terms", spec);

export interface InspectedSheet {
	name: string;
	cells: Record<string, string>;
	merged: string[];
}
export const inspectXlsx = (cfg: ToolsConfig, path: string) => runTool<{ ok: true; sheets: InspectedSheet[] }>(cfg, "inspect-xlsx", path);

export const readEdoc = (cfg: ToolsConfig, path: string) => runTool<{ ok: true; signers: { name: string; time: string | null; file: string }[]; files: string[] }>(cfg, "read-edoc", path);
export type DocBlock = { heading: string; level?: number } | { text: string; bold?: boolean } | { table: string[][] };
export const writeDocx = (cfg: ToolsConfig, spec: { dst: string; blocks: DocBlock[] }) => runToolSpec<{ ok: true; dst: string }>(cfg, "write-docx", spec);
