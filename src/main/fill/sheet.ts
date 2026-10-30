// The value sheet of a template (decision D5): every slot, its value, and where the value came from.
// Code fills what code can know (our register, the roles tables); the model fills the rest from the
// tender documents with quotes (fill/tasks.ts); a person can overwrite any item. Nothing is invented:
// an item with no source stays `missing` and is written into the document as „[aizpildīt]” in red.
import { randomUUID } from "node:crypto";
import type { Citation, FillSheet, ProjectState, RoleRow, SheetItem, Variant } from "../../shared/state.js";
import type { DocxEdit, Inspected } from "../pytools.js";
import type { Registers } from "../registers/registers.js";
import { templateSlots, type Slot } from "../templates/slots.js";

export function newSheet(templateKey: string, info: Inspected): FillSheet {
	const items: SheetItem[] = templateSlots(info).map((s: Slot): SheetItem => {
		const base = { slotId: s.id, label: s.label, heading: s.heading, value: "", cites: [] as Citation[], by: null as SheetItem["by"] };
		if (s.kind === "cell") return { ...base, kind: "cell", t: s.t, r: s.r, c: s.c, status: "missing" };
		if (s.kind === "delete") return { ...base, kind: "delete", paragraphs: s.paragraphs, instruction: s.instruction, status: "na", note: "Veidnes pamācība tiek izdzēsta." };
		return { ...base, kind: "section", paragraphs: s.paragraphs, instruction: s.instruction, status: "missing" };
	});
	return { template: templateKey, skeleton: info.skeleton, items, inspectedAt: new Date().toISOString(), outputs: {} };
}

/** Keeps what a person typed or a model proved when a template is inspected again. */
export function mergeSheets(fresh: FillSheet, old: FillSheet | undefined): FillSheet {
	if (!old || old.skeleton !== fresh.skeleton) return fresh;
	const prev = new Map(old.items.map((i) => [i.slotId, i]));
	return { ...fresh, filledAt: old.filledAt, outputs: old.outputs, items: fresh.items.map((i) => (prev.get(i.slotId)?.by ? prev.get(i.slotId)! : i)) };
}

// ---------- code-filled cells ----------
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

export interface FillContext {
	variant: Variant | null;
	state: ProjectState;
	registers: Registers;
	/** the builder this copy is for (V2/V3); undefined = the base copy */
	builder?: string;
}

const regField = (reg: Registers, re: RegExp) => reg.company.fields.find((f) => re.test(norm(f.key)))?.value ?? "";

/** Marker for details only the builder can give — kept visible in the document and in the sheet. */
export const BUILDER_MARKER = "BŪVNIEKS";

const BIDDER_FIELDS: { re: RegExp; reg: RegExp; what: string }[] = [
	{ re: /^izpildit.*regist.*numur|^pretendent.*regist.*numur|regist.*numur/, reg: /reg\.? ?nr|registr/, what: "reģistrācijas numurs" },
	{ re: /juridisk.*adrese/, reg: /juridisk.*adrese/, what: "juridiskā adrese" },
	{ re: /biroja adrese|faktisk.*adrese/, reg: /biroja|faktisk/, what: "biroja adrese" },
	{ re: /^izpildit.{0,12}$|^pretendent.{0,10}$/, reg: /^nosaukums$/, what: "nosaukums" },
];

function set(item: SheetItem, p: Partial<SheetItem>) {
	Object.assign(item, p);
}

function bidderCell(item: SheetItem, ctx: FillContext) {
	const label = norm(item.label);
	const rule = BIDDER_FIELDS.find((b) => b.re.test(label));
	if (!rule) return;
	const ours = ctx.variant === "V1" || ctx.variant === null;
	if (ours) {
		const v = regField(ctx.registers, rule.reg);
		if (v) return set(item, { value: v, status: "source", by: "code", cites: [], note: "Avots: uzņēmuma reģistrs." });
		return set(item, { value: "", status: "missing", by: "code", note: `Uzņēmuma reģistrā nav: ${rule.what}.` });
	}
	// V2/V3: the bidder is the builder. Only the name is known from the project setup.
	if (rule.what === "nosaukums" && ctx.builder) return set(item, { value: ctx.builder, status: "source", by: "code", note: "Avots: konkursa iestatījumi (būvnieks)." });
	set(item, { value: BUILDER_MARKER, status: "missing", by: "code", note: `Ievadīt: būvnieka ${rule.what}.` });
}

const ROLE_COLUMNS = ["loma", "buvprojekta dala", "uznemums", "vards uzvards"] as const;

/** A table is a roles table when its header is Loma | Būvprojekta daļa | Uzņēmums | Vārds Uzvārds. */
export function isRolesTable(header: string[]): boolean {
	const h = header.map(norm);
	return ROLE_COLUMNS.every((c, i) => (h[i] ?? "").startsWith(c));
}

function roleValue(row: RoleRow | undefined, col: number): string {
	if (!row) return "";
	return [row.role, row.part, row.company, row.person][col] ?? "";
}

/** Fills the roles tables from the roles screen: design side for the PROJEKTĒŠANA table, builder side for BŪVDARBI. */
function rolesTables(sheet: FillSheet, info: Inspected, ctx: FillContext): number[] {
	const added: Record<string, number> = {};
	const touched: number[] = [];
	for (const tbl of info.tables) {
		if (!isRolesTable(tbl.cells[0] ?? [])) continue;
		const slots = sheet.items.filter((i) => i.kind === "cell" && i.t === tbl.t);
		const heading = slots[0]?.heading ?? "";
		const side: "design" | "build" = /b[uū]vdarb/i.test(heading) ? "build" : "design";
		const rows = side === "design" ? ctx.state.roles.design : ctx.builder ? (ctx.state.roles.build[ctx.builder] ?? []) : [];
		touched.push(tbl.t);
		const templateRows = tbl.cells.length - 1;
		const need = Math.max(rows.length, 1);
		if (side === "build" && !ctx.builder && ctx.variant !== "V1") {
			// base copy of a V2/V3 tender: the builder side is a visible placeholder, not an invented row
			slots.forEach((i) => set(i, { value: i.c === 0 ? "" : BUILDER_MARKER, status: "missing", by: "code", note: "Ievadīt: būvnieka lomu, uzņēmumu un personu." }));
			continue;
		}
		if (need > templateRows) added[String(tbl.t)] = need - templateRows;
		for (let r = 1; r <= need; r++) {
			const row = rows[r - 1];
			for (let c = 0; c < 4; c++) {
				const id = `c:t${tbl.t}:r${r}:c${c}`;
				let item = sheet.items.find((i) => i.slotId === id);
				if (!item) {
					// a row added beyond the template's own
					item = { slotId: id, kind: "cell", label: `${tbl.cells[0][c]} (${r}. rinda)`, heading, t: tbl.t, r, c, value: "", status: "missing", cites: [], by: null };
					sheet.items.push(item);
				}
				let v = roleValue(row, c);
				let note = "Avots: lomu tabula (5. Kas ko dara).";
				if (side === "build" && c === 2 && !v && ctx.builder) {
					v = ctx.builder;
					note = "Avots: konkursa iestatījumi (būvnieks).";
				}
				if (v) set(item, { value: v, status: "source", by: "code", note });
				else set(item, { value: side === "build" ? BUILDER_MARKER : "", status: "missing", by: "code", note: side === "build" ? "Ievadīt: būvnieka personu." : "Lomu tabulā nav šīs ailes vērtības." });
			}
		}
	}
	if (Object.keys(added).length) sheet.addRows = added;
	return touched;
}

/** Pure: returns a new sheet with everything code can know filled in. Person-edited items are never touched. */
export function codeFill(sheet: FillSheet, info: Inspected, ctx: FillContext): FillSheet {
	const next: FillSheet = structuredClone(sheet);
	const locked = new Set(next.items.filter((i) => i.by === "manual").map((i) => i.slotId));
	const before = structuredClone(next.items.filter((i) => locked.has(i.slotId)));
	for (const item of next.items) if (item.kind === "cell" && !locked.has(item.slotId)) bidderCell(item, ctx);
	rolesTables(next, info, ctx);
	for (const b of before) Object.assign(next.items.find((i) => i.slotId === b.slotId)!, b);
	return next;
}

// ---------- document edits ----------
const noteOf = (i: SheetItem): string | undefined => {
	const parts: string[] = [];
	for (const c of i.cites.slice(0, 2)) parts.push(`Avots: ${c.file}: “${c.quote.length > 140 ? c.quote.slice(0, 140) + "…" : c.quote}”`);
	if (i.note) parts.push(i.note);
	return parts.length ? parts.join(" · ") : undefined;
};

/** Builds the edit list for fill-docx. Rows are added first so later cell edits find their cells. */
export function toEdits(sheet: FillSheet): DocxEdit[] {
	const edits: DocxEdit[] = [];
	for (const [t, count] of Object.entries(sheet.addRows ?? {})) edits.push({ kind: "add_rows", t: Number(t), count });
	for (const i of sheet.items) {
		if (i.kind === "cell" && i.t !== undefined) {
			// values our own register/roles supplied need no source line in the document; open ones keep their hint
			const quiet = i.status === "manual" || (i.by === "code" && i.status === "source");
			edits.push({ kind: "cell", t: i.t, r: i.r!, c: i.c!, text: i.value, status: i.status === "manual" ? "manual" : i.status, note: quiet ? undefined : noteOf(i) });
		} else if (i.kind === "section" && i.paragraphs?.length) {
			const [first, ...rest] = i.paragraphs;
			const status = i.status;
			edits.push({ kind: "paragraph", i: first, text: i.value, status: status === "manual" ? "manual" : status, note: status === "manual" ? undefined : noteOf(i) });
			for (const p of rest) edits.push({ kind: "paragraph", i: p, text: "", status: "na", delete: true });
		} else if (i.kind === "delete" && i.paragraphs) {
			for (const p of i.paragraphs) edits.push({ kind: "paragraph", i: p, text: "", status: "na", delete: true });
		}
	}
	return edits;
}

export const LEGEND: [string, string | null][] = [
	["zaļš = nolasīts no dokumenta (avots zem teksta)", "source"],
	["sarkans = trūkst, jāaizpilda", "missing"],
	["pelēks = neattiecas", "na"],
];

/** What is still open, for the report in the chat/summary. */
export function openItems(sheet: FillSheet): SheetItem[] {
	return sheet.items.filter((i) => i.kind !== "delete" && (i.status === "missing" || /^papildin/i.test(i.note ?? "")));
}

export const newRole = (p: Partial<RoleRow> = {}): RoleRow => ({ id: randomUUID(), role: "", part: "", company: "", person: "", ...p });
