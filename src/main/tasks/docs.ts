// Picks documents for a model task by kind, from the text cache.
import type { DocKind, FileEntry, ProjectState } from "../../shared/state.js";
import type { Project } from "../../shared/types.js";
import { readCachedText } from "../extract.js";
import type { DocInput } from "./grounding.js";

/** Label the model sees and citations store: the file name, or the relative path when names repeat. */
export function docLabel(f: FileEntry, all: FileEntry[]): string {
	const name = f.rel.split(/[\\/]/).pop()!;
	const dup = all.filter((o) => o.rel.split(/[\\/]/).pop() === name).length > 1;
	return dup ? f.rel : name;
}

export function docsByKind(p: Project, s: ProjectState, kinds: DocKind[], opts: { where?: FileEntry["where"][] } = {}): DocInput[] {
	const wanted = s.files.filter(
		(f) => kinds.includes(f.kind) && f.text === "ok" && (opts.where ? opts.where.includes(f.where) : f.where !== "darba"),
	);
	// Keep the order of `kinds`, so the most important documents are first within the budget.
	wanted.sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind) || a.rel.localeCompare(b.rel));
	const out: DocInput[] = [];
	for (const f of wanted) {
		const text = readCachedText(p, f);
		if (text) out.push({ file: docLabel(f, s.files), text });
	}
	return out;
}

/**
 * Shrinks a document to the lines that matter for one question: its first lines (title, subject)
 * plus every line matching `re` with `ctx` lines around it. Keeps whole lines verbatim, so quotes
 * taken from the excerpt are still found in the full text when grounding.
 */
export function excerpt(doc: DocInput, re: RegExp, opts: { head?: number; ctx?: number; maxChars?: number } = {}): DocInput {
	const { head = 40, ctx = 1, maxChars = 30_000 } = opts;
	const lines = doc.text.split("\n");
	const keep = new Set<number>();
	for (let i = 0; i < Math.min(head, lines.length); i++) keep.add(i);
	lines.forEach((l, i) => {
		if (re.test(l)) for (let j = Math.max(0, i - ctx); j <= Math.min(lines.length - 1, i + ctx); j++) keep.add(j);
	});
	const out: string[] = [];
	let size = 0;
	let prev = -2;
	for (const i of [...keep].sort((a, b) => a - b)) {
		if (size + lines[i].length > maxChars) {
			out.push("[… saīsināts]");
			break;
		}
		if (i !== prev + 1 && out.length) out.push("[…]");
		out.push(lines[i]);
		size += lines[i].length + 1;
		prev = i;
	}
	return { file: doc.file, text: out.join("\n") };
}

/** Turns a citation's file label back into the file entry (for "jump to source"). */
export function fileForLabel(s: ProjectState, label: string): FileEntry | undefined {
	return s.files.find((f) => docLabel(f, s.files) === label);
}
