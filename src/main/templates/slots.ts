// Finds what a template asks to be filled in, from its inspected structure alone (no model).
//  - cell slots: empty cells of label tables ("Projekta nosaukums: | ") and of row tables (header + empty rows)
//  - section slots: italic instruction paragraphs under a heading ("Izpildītājam jāapraksta …")
// A tender-specific template changes nothing in this code: it only reads shapes and flags.
import type { Inspected } from "../pytools.js";

export type Slot =
	| { id: string; kind: "cell"; t: number; r: number; c: number; label: string; heading: string; shape: "label" | "row"; rowLabel?: string }
	| { id: string; kind: "section"; paragraphs: number[]; label: string; heading: string; instruction: string }
	| { id: string; kind: "delete"; paragraphs: number[]; label: string; heading: string; instruction: string };

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const isInstruction = (p: { italic: number; text: string }) => p.italic > 0.6 && clean(p.text).length >= 40;

/** Generic leading note that tells the bidder to delete all italic text — removed, not filled. */
const DELETE_NOTE = /sl[iī]pr[aā]kst[aā] nor[aā]d[iī]t[aā] inform[aā]cija ir j[aā]izdz[eē]š/i;

export function headingPath(paragraphs: Inspected["paragraphs"], upTo: number): string {
	const path: string[] = [];
	for (const p of paragraphs) {
		if (p.i >= upTo) break;
		if (p.heading > 0 && p.text.trim()) {
			path.length = Math.max(0, p.heading - 1);
			path[p.heading - 1] = clean(p.text);
		}
	}
	return path.filter(Boolean).join(" › ");
}

export function templateSlots(info: Inspected): Slot[] {
	const slots: Slot[] = [];

	info.tables.forEach((tbl) => {
		const rows = tbl.cells;
		if (rows.length === 0) return;
		const twoCol = tbl.cols <= 2;
		if (twoCol) {
			rows.forEach((row, r) => {
				const label = clean(row[0] ?? "").replace(/:$/, "");
				row.forEach((cell, c) => {
					if (c === 0 || cell.trim() !== "" || !label) return;
					slots.push({ id: `c:t${tbl.t}:r${r}:c${c}`, kind: "cell", t: tbl.t, r, c, label, heading: headingPath(info.paragraphs, tbl.after_p + 1), shape: "label" });
				});
			});
			return;
		}
		const header = rows[0].map(clean);
		const headerLooksLikeHeader = header.filter(Boolean).length >= Math.ceil(header.length / 2);
		if (!headerLooksLikeHeader) return;
		for (let r = 1; r < rows.length; r++) {
			const rowLabel = rows[r].map(clean).find(Boolean);
			rows[r].forEach((cell, c) => {
				if (cell.trim() !== "" || !header[c]) return;
				slots.push({ id: `c:t${tbl.t}:r${r}:c${c}`, kind: "cell", t: tbl.t, r, c, label: `${header[c]} (${r}. rinda)`, heading: headingPath(info.paragraphs, tbl.after_p + 1), shape: "row", rowLabel });
			});
		}
	});

	// italic instruction paragraphs; consecutive ones under one heading form a single slot
	const ps = info.paragraphs;
	let group: number[] = [];
	const flush = () => {
		if (group.length === 0) return;
		const first = ps.find((p) => p.i === group[0])!;
		const heading = headingPath(ps, first.i);
		const instruction = group.map((i) => clean(ps.find((p) => p.i === i)!.text)).join("\n");
		const label = heading.split(" › ").pop() ?? heading;
		if (DELETE_NOTE.test(instruction)) slots.push({ id: `d:p${group[0]}`, kind: "delete", paragraphs: [...group], label: "Pamācība veidnes sākumā", heading, instruction });
		else slots.push({ id: `s:p${group[0]}`, kind: "section", paragraphs: [...group], label, heading, instruction });
		group = [];
	};
	for (const p of ps) {
		if (isInstruction(p)) {
			const prev = group.length ? ps.find((x) => x.i === group[group.length - 1])! : null;
			const sameBlock = prev && ps.slice(prev.i + 1, p.i).every((m) => !m.text.trim());
			if (group.length && !sameBlock) flush();
			group.push(p.i);
		} else if (p.text.trim()) flush();
	}
	flush();

	return slots;
}

/** Slots a person or model must decide (the delete note is handled without asking anyone). */
export const fillableSlots = (slots: Slot[]) => slots.filter((s) => s.kind !== "delete");
