// Turns an inspected template and its value sheet into the blocks the preview draws.
// A section field replaces the template's italic instruction paragraphs, exactly as in the file that gets written;
// the "delete this note" paragraph is not shown because the written file does not contain it.
import type { PreviewBlock, PreviewCell } from "../../shared/preview.js";
import type { FillSheet } from "../../shared/state.js";
import type { Inspected } from "../pytools.js";

export function buildPreview(info: Inspected, sheet: FillSheet): PreviewBlock[] {
	const firstOf = new Map<number, string>();
	const hidden = new Set<number>();
	for (const it of sheet.items) {
		if (!it.paragraphs?.length) continue;
		if (it.kind === "section") {
			firstOf.set(it.paragraphs[0], it.slotId);
			for (const p of it.paragraphs.slice(1)) hidden.add(p);
		} else if (it.kind === "delete") for (const p of it.paragraphs) hidden.add(p);
	}

	const cellSlot = new Map<string, string>();
	const lastRow = new Map<number, number>();
	for (const it of sheet.items) {
		if (it.kind !== "cell" || it.t === undefined || it.r === undefined || it.c === undefined) continue;
		cellSlot.set(`${it.t}:${it.r}:${it.c}`, it.slotId);
		lastRow.set(it.t, Math.max(lastRow.get(it.t) ?? 0, it.r));
	}

	const tableBlock = (t: Inspected["tables"][number]): PreviewBlock => {
		const rows: PreviewCell[][] = [];
		for (let r = 0; r < Math.max(t.cells.length, (lastRow.get(t.t) ?? -1) + 1); r++) {
			rows.push(Array.from({ length: t.cols }, (_, c) => ({ text: (t.cells[r]?.[c] ?? "").trim(), slotId: cellSlot.get(`${t.t}:${r}:${c}`) })));
		}
		return { kind: "table", t: t.t, rows };
	};

	const after = new Map<number, Inspected["tables"]>();
	for (const t of info.tables) after.set(t.after_p, [...(after.get(t.after_p) ?? []), t]);

	const out: PreviewBlock[] = (after.get(-1) ?? []).map(tableBlock);
	for (const p of info.paragraphs) {
		const slot = firstOf.get(p.i);
		if (slot) out.push({ kind: "slot", slotId: slot });
		else if (!hidden.has(p.i) && p.text.trim()) out.push({ kind: "text", text: p.text.trim(), level: p.heading });
		for (const t of after.get(p.i) ?? []) out.push(tableBlock(t));
	}
	return out;
}
