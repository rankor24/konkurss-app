// Distributed form vs the form embedded in the nolikums (mistake catalogue B2): compare in code,
// by table structure and row labels. The model is not involved — this is an exact check.
import type { TemplateDiff } from "../../shared/state.js";
import { normalizeForMatch } from "../tasks/grounding.js";

export interface TableBlock {
	rows: string[][];
	/** non-empty first-cell labels, normalised */
	labels: string[];
	header: string;
}

const clean = (s: string) => normalizeForMatch(s).replace(/[;:*]/g, " ").replace(/\s+/g, " ").trim();

/** Consecutive lines containing " | " form one table (the extractor writes rows as lines, cells split by " | "). */
export function tableBlocks(text: string): TableBlock[] {
	const blocks: TableBlock[] = [];
	let cur: string[][] = [];
	const flush = () => {
		if (cur.length >= 2) {
			const labels = cur.map((r) => clean(r[0] ?? "")).filter((l) => l.length > 0);
			blocks.push({ rows: cur, labels, header: clean(cur[0].join(" ")) });
		}
		cur = [];
	};
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (line.includes(" | ") || (line.startsWith("|") && line.length > 1)) {
			cur.push(line.replace(/^\|\s*/, "").split(/\s*\|\s*/).map((c) => c.trim()));
		} else if (line === "") {
			// blank lines inside a table block are allowed only between rows of the same table
			continue;
		} else flush();
	}
	flush();
	return blocks;
}

const tokens = (s: string) => new Set(s.split(" ").filter((t) => t.length > 2));
function jaccard(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 || b.size === 0) return 0;
	let inter = 0;
	for (const x of a) if (b.has(x)) inter++;
	return inter / (a.size + b.size - inter);
}

/** Two labels are the same row when they are equal or nearly so (a word added or dropped). */
export function sameLabel(a: string, b: string): boolean {
	return a === b || jaccard(tokens(a), tokens(b)) >= 0.8;
}

function matchBlock(block: TableBlock, candidates: TableBlock[]): TableBlock | null {
	// the header row is the strongest signal; fall back to overall label overlap
	let best: { b: TableBlock; score: number } | null = null;
	for (const c of candidates) {
		const score = c.header === block.header ? 2 : jaccard(tokens(c.labels.join(" ")), tokens(block.labels.join(" ")));
		if (!best || score > best.score) best = { b: c, score };
	}
	return best && best.score >= 0.5 ? best.b : null;
}

export interface FormInput {
	file: string;
	text: string;
}

/**
 * For each distributed form, find the matching tables in the nolikums and compare labelled rows.
 * Forms with no counterpart in the nolikums are reported as `embeddedFile: ""` with equal = true,
 * because there is nothing to disagree with.
 */
export function compareTemplates(forms: FormInput[], nolikums: FormInput): TemplateDiff[] {
	const embedded = tableBlocks(nolikums.text).filter((b) => b.labels.length >= 2);
	const out: TemplateDiff[] = [];
	for (const form of forms) {
		const blocks = tableBlocks(form.text).filter((b) => b.labels.length >= 2);
		let distributedRows = 0;
		let embeddedRows = 0;
		const missing: string[] = [];
		const extra: string[] = [];
		let matched = 0;
		for (const block of blocks) {
			const other = matchBlock(block, embedded);
			if (!other) continue;
			matched++;
			distributedRows += block.labels.length;
			embeddedRows += other.labels.length;
			const originalLabels = (rows: string[][], labels: string[]) => labels.map((l) => rows.map((r) => r[0]).find((r) => clean(r ?? "") === l) ?? l);
			const embeddedOriginal = originalLabels(other.rows, other.labels);
			const distributedOriginal = originalLabels(block.rows, block.labels);
			other.labels.forEach((l, i) => {
				if (!block.labels.some((x) => sameLabel(x, l))) missing.push(embeddedOriginal[i]);
			});
			block.labels.forEach((l, i) => {
				if (!other.labels.some((x) => sameLabel(x, l))) extra.push(distributedOriginal[i]);
			});
		}
		out.push({
			name: form.file.replace(/\.[^.]+$/, ""),
			distributedFile: form.file,
			embeddedFile: matched > 0 ? nolikums.file : "",
			distributedRows,
			embeddedRows,
			missingLabels: missing.map((m) => m.replace(/\s+/g, " ").trim()),
			extraLabels: extra.map((m) => m.replace(/\s+/g, " ").trim()),
			equal: missing.length === 0 && extra.length === 0 && distributedRows === embeddedRows,
		});
	}
	return out;
}
