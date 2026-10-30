// Grounding (decision D6): a model value counts only if its quote is really in the source text.
// This is checked in code — asking the model to be honest is not enough.
import type { Cited, Citation } from "../../shared/state.js";

export interface DocInput {
	/** shown to the model and stored in the citation, e.g. "NOLIKUMS_14_07_2026.docx" */
	file: string;
	text: string;
}

/** Normalises quotes, dashes, whitespace and table separators so a faithful quote matches. */
export function normalizeForMatch(s: string): string {
	return s
		.normalize("NFC")
		.replace(/­/g, "")
		.replace(/[„“”«»″"]/g, '"')
		.replace(/[‘’‚′`]/g, "'")
		.replace(/[–—−‑]/g, "-")
		.replace(/\s*\|\s*/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase();
}

const MIN_QUOTE = 8;

/** True when the quote (or each part of a quote shortened with "…") appears in order in the text. */
export function quoteFound(quote: string, text: string): boolean {
	const q = normalizeForMatch(quote);
	if (q.length < MIN_QUOTE) return false;
	const t = normalizeForMatch(text);
	const parts = q
		.split(/\.\.\.|…/)
		.map((p) => p.trim())
		.filter((p) => p.length > 0);
	if (parts.some((p) => p.length < MIN_QUOTE)) return t.includes(q);
	let from = 0;
	for (const part of parts) {
		const at = t.indexOf(part, from);
		if (at < 0) return false;
		from = at + part.length;
	}
	return true;
}

/** Finds which document actually contains the quote; prefers the file the model named. */
export function locateQuote(quote: string, docs: DocInput[], claimedFile?: string): Citation | null {
	const claimed = docs.find((d) => d.file === claimedFile);
	if (claimed && quoteFound(quote, claimed.text)) return { file: claimed.file, quote };
	const other = docs.find((d) => quoteFound(quote, d.text));
	return other ? { file: other.file, quote } : null;
}

/** What the model returns for one cited value. */
export interface RawCited<T> {
	value: T | null;
	quote?: string | null;
	file?: string | null;
}

export const NOT_FOUND_NOTE = "nav atrasts dokumentos — jāaizpilda pašam";
export const UNGROUNDED_NOTE = "app šo vērtību dokumentā neatrada — citāts neatbilst tekstam";

export function toCited<T>(raw: RawCited<T> | null | undefined, docs: DocInput[]): Cited<T> {
	if (!raw || raw.value === null || raw.value === undefined || raw.value === "") {
		return { value: null, status: "missing", note: NOT_FOUND_NOTE };
	}
	if (!raw.quote) return { value: null, status: "missing", note: UNGROUNDED_NOTE };
	const cite = locateQuote(raw.quote, docs, raw.file ?? undefined);
	if (!cite) return { value: null, status: "missing", note: UNGROUNDED_NOTE };
	return { value: raw.value, status: "model", cite };
}

/** D6 second pass: keep the first reading, attach the second one as a conflict when they disagree. */
export function mergeSecondPass<T>(first: Cited<T>, second: Cited<T>, same: (a: T, b: T) => boolean = (a, b) => a === b): Cited<T> {
	if (first.status === "manual") return first;
	if (first.value === null && second.value !== null) return { ...second, conflict: { value: null } };
	if (first.value !== null && second.value === null) return first;
	if (first.value !== null && second.value !== null && !same(first.value, second.value)) {
		return { ...first, conflict: { value: second.value, cite: second.cite } };
	}
	return first;
}
