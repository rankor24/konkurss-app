// 1. Dokumenti: scan both folders, classify, extract text into a cache.
// Text cache: <output>\.konkurss\text\<id>.txt — never written next to the originals.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { guessKind, guessWhere, READABLE } from "../shared/classify.js";
import type { FileEntry, ProjectState } from "../shared/state.js";
import type { Project } from "../shared/types.js";
import { readerFor, runPython, type PyConfig } from "../mcp/python.js";
import { stateDir } from "./project-state.js";

const SKIP_DIRS = new Set([".konkurss", "node_modules", ".git"]);
const MAX_FILES = 20000;

function walk(root: string, dir: string, out: string[]): void {
	if (out.length >= MAX_FILES) return;
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const e of entries) {
		const p = join(dir, e.name);
		if (e.isDirectory()) {
			if (!SKIP_DIRS.has(e.name)) walk(root, p, out);
		} else out.push(relative(root, p));
	}
}

export const rootDir = (p: Project, f: Pick<FileEntry, "root">) => (f.root === "source" ? p.sourceDir : p.outputDir);
export const fileId = (f: Pick<FileEntry, "root" | "rel">) => createHash("sha1").update(`${f.root}:${f.rel.toLowerCase()}`).digest("hex").slice(0, 16);
export const textPath = (p: Project, f: Pick<FileEntry, "root" | "rel">) => join(stateDir(p.outputDir), "text", `${fileId(f)}.txt`);

/** Rebuilds the file list. Keeps a person's kind corrections and existing text for unchanged files. */
export function scanFolders(p: Project, previous: FileEntry[]): FileEntry[] {
	const prev = new Map(previous.map((f) => [`${f.root}:${f.rel}`, f]));
	const out: FileEntry[] = [];
	for (const root of ["source", "output"] as const) {
		const base = root === "source" ? p.sourceDir : p.outputDir;
		if (!existsSync(base)) continue;
		const rels: string[] = [];
		walk(base, base, rels);
		for (const rel of rels) {
			const st = statSync(join(base, rel));
			const old = prev.get(`${root}:${rel}`);
			const unchanged = old && old.size === st.size && old.mtimeMs === st.mtimeMs;
			const readable = READABLE.has(extname(rel).toLowerCase());
			out.push({
				rel,
				root,
				where: guessWhere(rel, root),
				kind: old?.kindSetByUser ? old.kind : guessKind(rel),
				kindSetByUser: old?.kindSetByUser ?? false,
				size: st.size,
				mtimeMs: st.mtimeMs,
				text: !readable ? "neattiecas" : unchanged ? old.text : "nav",
				textNote: unchanged ? old.textNote : undefined,
				textChars: unchanged ? old.textChars : undefined,
			});
		}
	}
	return out.sort((a, b) => a.root.localeCompare(b.root) || a.rel.localeCompare(b.rel));
}

const MEANINGFUL = /[\p{L}\p{N}]/gu;

/** Reads one file's text; returns the updated entry. Never throws. */
export async function extractOne(p: Project, f: FileEntry, py: PyConfig): Promise<FileEntry> {
	const full = join(rootDir(p, f), f.rel);
	const ext = extname(f.rel).toLowerCase();
	try {
		let text: string;
		if ([".txt", ".md", ".csv"].includes(ext)) text = readFileSync(full, "utf8");
		else {
			const reader = readerFor(py.skillsDir, full);
			if (!reader) return { ...f, text: "neattiecas" };
			text = await runPython(py, reader.script, reader.args);
		}
		text = text.replace(/\r\n?/g, "\n"); // Python on Windows writes CRLF; the cache and citations use \n
		const meaningful = (text.match(MEANINGFUL) ?? []).length;
		const target = textPath(p, f);
		mkdirSync(join(target, ".."), { recursive: true });
		writeFileSync(target, text, "utf8");
		if (meaningful < 40) {
			return {
				...f,
				text: "tukss",
				textChars: text.length,
				textNote: ext === ".pdf" ? "Skenēts attēls — tekstu nolasīt nevar, pārbaudi ar aci." : "Teksta gandrīz nav.",
			};
		}
		return { ...f, text: "ok", textChars: text.length, textNote: undefined };
	} catch (e) {
		const msg = (e as Error).message.split("\n").slice(-3).join(" ").slice(0, 300);
		const note =
			ext === ".edoc"
				? "Parakstīto failu nevar atvērt. Lūdz lasāmu kopiju (PDF vai DOCX) vai ievadi parakstītāju ar roku."
				: `Neizdevās nolasīt: ${msg}`;
		return { ...f, text: "kluda", textNote: note };
	}
}

/** Extracts every readable file not yet read. Runs a few at a time; reports progress. */
export async function extractAll(
	p: Project,
	state: ProjectState,
	py: PyConfig,
	onProgress: (done: number, total: number, rel: string) => void,
	concurrency = 4,
): Promise<FileEntry[]> {
	const files = [...state.files];
	const todo = files.map((f, i) => ({ f, i })).filter(({ f }) => f.text === "nav" || (f.text === "ok" && !existsSync(textPath(p, f))));
	let done = 0;
	let next = 0;
	const worker = async () => {
		while (next < todo.length) {
			const { f, i } = todo[next++];
			files[i] = await extractOne(p, f, py);
			onProgress(++done, todo.length, f.rel);
		}
	};
	await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
	return files;
}

export function readCachedText(p: Project, f: Pick<FileEntry, "root" | "rel">): string | null {
	const t = textPath(p, f);
	return existsSync(t) ? readFileSync(t, "utf8") : null;
}

/** Plain-Latvian warnings for the strip under the file table. */
export function fileWarnings(files: FileEntry[]): string[] {
	const out: string[] = [];
	const scanned = files.filter((f) => f.text === "tukss" && f.rel.toLowerCase().endsWith(".pdf"));
	const edoc = files.filter((f) => f.text === "kluda" && f.rel.toLowerCase().endsWith(".edoc"));
	const other = files.filter((f) => f.text === "kluda" && !f.rel.toLowerCase().endsWith(".edoc"));
	if (scanned.length) out.push(`${scanned.length} PDF ir skenēti attēli — tekstu nolasīt nevar. Pārbaudi tos ar aci.`);
	if (edoc.length) out.push(`${edoc.length} parakstītus .edoc failus nevar atvērt. Lūdz lasāmu kopiju vai ievadi parakstītāju ar roku.`);
	if (other.length) out.push(`${other.length} failus neizdevās nolasīt.`);
	return out;
}
