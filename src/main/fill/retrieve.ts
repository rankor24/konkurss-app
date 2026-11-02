// Picks, for ONE template section, the few passages of the tender documents that talk about its topic.
// A model that gets 1.4 million characters answers "nothing found" for the hard sections; the same model given
// fifteen thousand characters about "Garantijas laiks" finds the clause. Lines stay verbatim, so a quote taken from
// a passage is still found in the full document when it is grounded.
import type { DocInput } from "../tasks/grounding.js";

export type RankedDoc = DocInput & {
	/** how much a hit in this document counts: the client's BIM requirements (PIP) outrank a Q&A letter */
	weight?: number;
};

/** Words are compared by their first six letters: Latvian endings change (garantija, garantijas, garantijai). */
const STEM = 6;
const stem = (w: string) => (w.length > STEM ? w.slice(0, STEM) : w);
const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** A section heading found in a document counts like many ordinary hits, and the lines after it are its text. */
const HEADING_BONUS = 60;
const HEADING_BODY = 14;

/** A contents line: text, then a tab or dots and a page number at the end. */
const CONTENTS_LINE = /(\t|\.{3,}|\s{3,})\d{1,3}\s*$/;

/** A heading or instruction word worth searching for: a real word, or an acronym such as E57, VDV, AIM. */
const isTopicWord = (raw: string) => (raw.length >= 5 && /\p{L}{4}/u.test(raw)) || (raw.length >= 3 && /^[\p{Lu}\p{N}]+$/u.test(raw) && /\p{Lu}/u.test(raw));

/** Stems of the section's own topic, heading words counting three times as much as instruction words. */
export function queryOf(item: { heading: string; label: string; instruction?: string }): Map<string, number> {
	const q = new Map<string, number>();
	const add = (text: string, weight: number) => {
		for (const raw of text.match(/[\p{L}\p{N}]+/gu) ?? []) if (isTopicWord(raw)) q.set(stem(raw.toLowerCase()), Math.max(q.get(stem(raw.toLowerCase())) ?? 0, weight));
	};
	add((item.heading || item.label).split("›").pop() ?? "", 3);
	add((item.instruction ?? "").slice(0, 700), 1);
	return q;
}

export interface Retrieval {
	docs: DocInput[];
	/** how many passages (merged line ranges) were chosen */
	passages: number;
}

export interface RetrieveOptions {
	/** lines kept around each best line */
	ctx?: number;
	/** best lines considered */
	top?: number;
	/** characters allowed per document and in total */
	perDoc?: number;
	total?: number;
}

/** Index the documents once, then ask for the passages of one section after another. */
export function makeRetriever(docs: RankedDoc[], opts: RetrieveOptions = {}) {
	const { ctx = 3, top = 24, perDoc = 6_000, total = 18_000 } = opts;
	const lines = docs.map((d) => d.text.split("\n"));
	const stems = lines.map((ls) => ls.map((l) => new Set(words(l).map(stem))));
	const df = new Map<string, number>();
	let n = 0;
	for (const doc of stems) {
		for (const s of doc) {
			n++;
			for (const t of s) df.set(t, (df.get(t) ?? 0) + 1);
		}
	}
	// in a real tender a stem found in more than one line out of twenty says nothing about a topic ("izpildītājam", "jāapraksta")
	const idf = (t: string) => {
		const f = df.get(t) ?? 0;
		return f === 0 || (n >= 200 && f / n > 0.05) ? 0 : Math.log(1 + n / f);
	};

	return (item: { heading: string; label: string; instruction?: string }): Retrieval => {
		const q = queryOf(item);
		const forward = new Map<string, number>();
		type Hit = { d: number; l: number; score: number };
		const hits: Hit[] = [];
		const headStems = [...q].filter(([, w]) => w === 3).map(([t]) => t);
		stems.forEach((doc, d) => {
			const w = docs[d].weight ?? 1;
			doc.forEach((s, l) => {
				const line = lines[d][l];
				let score = 0;
				for (const [t, tw] of q) if (s.has(t)) score += idf(t) * tw;
				if (score === 0) return;
				const contents = CONTENTS_LINE.test(line);
				// the section's own heading in the document: a short line holding every word of the heading
				if (!contents && headStems.length > 0 && line.length <= 120 && headStems.every((t) => s.has(t))) {
					score += HEADING_BONUS;
					forward.set(`${d}:${l}`, HEADING_BODY);
				}
				// long table rows hold many words and would win on count alone
				score /= Math.sqrt(1 + line.length / 300);
				// a line of the table of contents ("9.2. Garantijas laiks   45") names the topic but says nothing about it
				if (contents) score *= 0.2;
				hits.push({ d, l, score: score * w });
			});
		});
		hits.sort((a, b) => b.score - a.score);

		// Fill the budget best-first, so a long document cannot use it up on its first pages; show the result in reading order.
		const chosen = new Map<number, Set<number>>();
		const size = new Map<number, number>();
		let used = 0;
		let spent = 0;
		for (const h of hits.slice(0, top)) {
			const set = chosen.get(h.d) ?? new Set<number>();
			const add: number[] = [];
			for (let j = Math.max(0, h.l - ctx); j <= Math.min(lines[h.d].length - 1, h.l + (forward.get(`${h.d}:${h.l}`) ?? ctx * 2)); j++) if (!set.has(j) && lines[h.d][j].trim()) add.push(j);
			const cost = add.reduce((n, j) => n + lines[h.d][j].length + 1, 0);
			if ((size.get(h.d) ?? 0) + cost > perDoc || used + cost > total) continue;
			for (const j of add) set.add(j);
			chosen.set(h.d, set);
			size.set(h.d, (size.get(h.d) ?? 0) + cost);
			used += cost;
			spent++;
		}

		const best = new Map<number, number>();
		for (const h of hits.slice(0, top)) best.set(h.d, Math.max(best.get(h.d) ?? 0, h.score));
		const out: DocInput[] = [];
		let passages = 0;
		for (const d of [...chosen.keys()].sort((a, b) => (best.get(b) ?? 0) - (best.get(a) ?? 0))) {
			const picked: string[] = [];
			let prev = -2;
			for (const l of [...chosen.get(d)!].sort((a, b) => a - b)) {
				if (l !== prev + 1 && !(l === prev + 2 && l > 0 && !lines[d][l - 1].trim())) {
					if (picked.length) picked.push("[…]");
					passages++;
				}
				picked.push(lines[d][l]);
				prev = l;
			}
			out.push({ file: docs[d].file, text: picked.join("\n") });
		}
		return { docs: out, passages: passages || spent };
	};
}
