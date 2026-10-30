// Paragraph-level diff between two editions of a document (nolikums original vs grozījumu redakcija).
// Done in code: the model only classifies the changes afterwards, it never decides what changed.
import { normalizeForMatch } from "../tasks/grounding.js";

export interface TextChange {
	before: string;
	after: string;
}

const MAX_CELLS = 16_000_000;

function lines(text: string): string[] {
	return text
		.split(/\r?\n/)
		.map((l) => l.replace(/\s+/g, " ").trim())
		.filter((l) => l.length > 0);
}

/**
 * Changes between two texts, in document order. A run of removed lines followed by added lines is one
 * change (before → after); pure additions have an empty `before`, pure removals an empty `after`.
 * Whitespace and quote-style differences do not count as changes.
 */
export function diffParagraphs(a: string, b: string): TextChange[] {
	const A = lines(a);
	const B = lines(b);
	const na = A.map(normalizeForMatch);
	const nb = B.map(normalizeForMatch);

	let start = 0;
	while (start < na.length && start < nb.length && na[start] === nb[start]) start++;
	let endA = na.length;
	let endB = nb.length;
	while (endA > start && endB > start && na[endA - 1] === nb[endB - 1]) {
		endA--;
		endB--;
	}
	const ma = endA - start;
	const mb = endB - start;
	if (ma === 0 && mb === 0) return [];

	// ops over the middle part: ' ' keep, '-' remove (from A), '+' add (from B)
	const ops: { op: " " | "-" | "+"; i?: number; j?: number }[] = [];
	if (ma * mb <= MAX_CELLS) {
		const w = mb + 1;
		const dp = new Uint32Array((ma + 1) * w);
		for (let i = ma - 1; i >= 0; i--) {
			for (let j = mb - 1; j >= 0; j--) {
				dp[i * w + j] = na[start + i] === nb[start + j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
			}
		}
		let i = 0;
		let j = 0;
		while (i < ma && j < mb) {
			if (na[start + i] === nb[start + j]) {
				ops.push({ op: " " });
				i++;
				j++;
			} else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) ops.push({ op: "-", i: start + i++ });
			else ops.push({ op: "+", j: start + j++ });
		}
		while (i < ma) ops.push({ op: "-", i: start + i++ });
		while (j < mb) ops.push({ op: "+", j: start + j++ });
	} else {
		// Very large documents: compare as sets, losing order but never missing a line.
		const inB = new Set(nb.slice(start, endB));
		const inA = new Set(na.slice(start, endA));
		for (let i = start; i < endA; i++) if (!inB.has(na[i])) ops.push({ op: "-", i });
		for (let j = start; j < endB; j++) if (!inA.has(nb[j])) ops.push({ op: "+", j });
	}

	const changes: TextChange[] = [];
	let del: string[] = [];
	let add: string[] = [];
	const flush = () => {
		if (del.length || add.length) changes.push({ before: del.join("\n"), after: add.join("\n") });
		del = [];
		add = [];
	};
	for (const o of ops) {
		if (o.op === " ") flush();
		else if (o.op === "-") del.push(A[o.i!]);
		else add.push(B[o.j!]);
	}
	flush();
	return changes;
}

/** Shortest readable part of a long changed paragraph: the words that actually differ, with context. */
export function changedWords(before: string, after: string, context = 6): { before: string; after: string } {
	const a = before.split(/\s+/).filter(Boolean);
	const b = after.split(/\s+/).filter(Boolean);
	let s = 0;
	while (s < a.length && s < b.length && a[s] === b[s]) s++;
	let ea = a.length;
	let eb = b.length;
	while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) {
		ea--;
		eb--;
	}
	const from = Math.max(0, s - context);
	const cut = (arr: string[], end: number) => `${from > 0 ? "… " : ""}${arr.slice(from, Math.min(arr.length, end + context)).join(" ")}${end + context < arr.length ? " …" : ""}`;
	return { before: before ? cut(a, ea) : "", after: after ? cut(b, eb) : "" };
}
