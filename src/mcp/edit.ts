// What the chat agent may change in a tender. Every change goes through these functions, so the rules hold no matter
// which engine asks: a value needs a quote that is really in a tender document, a person's own entries are never
// overwritten, and nothing is deleted. The MCP server only wires them to tools.
import { randomUUID } from "node:crypto";
import { DOC_KINDS, type DocKind, type FillSheet, type ProjectState, type SheetItem } from "../shared/state.js";
import { allStepStatuses } from "../shared/steps.js";
import type { Project } from "../shared/types.js";
import { loadState, updateState } from "../main/project-state.js";
import { docsByKind } from "../main/tasks/docs.js";
import { locateQuote } from "../main/tasks/grounding.js";

export type Result = { ok: true; text: string } | { ok: false; reason: string };
const yes = (text: string): Result => ({ ok: true, text });
const no = (reason: string): Result => ({ ok: false, reason });

const ALL_KINDS = Object.keys(DOC_KINDS) as DocKind[];
const tenderDocs = (p: Project, s: ProjectState) => docsByKind(p, s, ALL_KINDS, { where: ["konkurss"] });

export const projectFor = (sourceDir: string, outputDir: string): Project => ({ id: "chat", name: "", sourceDir, outputDir, variant: null, builders: [], createdAt: "" });

const isOpen = (i: SheetItem) => !i.value && (i.kind === "cell" || i.kind === "section") && (i.by === null || i.by === "model");

/** The state of the tender in a few lines: where each step stands and which forms still have open fields. */
export function overview(p: Project): Result {
	const s = loadState(p.outputDir);
	const steps = allStepStatuses(s);
	const lines = [
		`Konkursa veids: ${s.variant?.value ?? "vēl nav noteikts"}`,
		`Termiņš: ${s.deadline.date.value ?? "nav zināms"} ${s.deadline.time.value ?? ""}`.trim(),
		`Soļu statuss: ${Object.entries(steps).map(([k, v]) => `${k}=${v}`).join(", ")}`,
		`Dokumenti nolasīti: ${s.files.filter((f) => f.text === "ok").length} no ${s.files.length}`,
		"",
		"Veidlapas ar vērtību lapām (template atslēga → atvērtie lauki / kopā):",
	];
	for (const [key, sh] of Object.entries(s.fills)) {
		const fields = sh.items.filter((i) => i.kind === "cell" || i.kind === "section");
		lines.push(`- ${key} → ${fields.filter(isOpen).length} / ${fields.length}`);
	}
	if (Object.keys(s.fills).length === 0) lines.push("(nav — veidnes vēl nav pārskatītas 6. solī)");
	return yes(lines.join("\n"));
}

/** Fields the agent may fill: empty, and not typed by a person. */
export function listOpenFields(p: Project, template?: string, limit = 60): Result {
	const s = loadState(p.outputDir);
	const sheets = Object.entries(s.fills).filter(([k]) => !template || k === template);
	if (template && sheets.length === 0) return no(`Nav veidnes „${template}”. Atslēgas: ${Object.keys(s.fills).join(", ") || "(nav)"}`);
	const lines: string[] = [];
	for (const [key, sh] of sheets) {
		const open = sh.items.filter(isOpen);
		lines.push(`# ${key} — ${open.length} atvērti`);
		for (const i of open.slice(0, limit)) lines.push(`${i.slotId}\t${i.kind}\t${(i.heading || i.label).slice(0, 100)}${i.instruction ? `\t(pamācība: ${i.instruction.slice(0, 160).replace(/\s+/g, " ")})` : ""}`);
		if (open.length > limit) lines.push(`… vēl ${open.length - limit}`);
	}
	return yes(lines.join("\n") || "Atvērtu lauku nav.");
}

function patchSheet(p: Project, template: string, slotId: string, patch: (i: SheetItem, sh: FillSheet) => void): void {
	updateState(p.outputDir, (s) => {
		const sh = s.fills[template];
		const i = sh?.items.find((x) => x.slotId === slotId);
		if (sh && i) patch(i, sh);
	});
}

/** Sets one field of a form. Needs a quote that is verbatim in a tender document; a person's own entry is never replaced. */
export function setField(p: Project, a: { template: string; slotId: string; value: string; quote: string; file?: string }): Result {
	const s = loadState(p.outputDir);
	const sh = s.fills[a.template];
	if (!sh) return no(`Nav veidnes „${a.template}”. Atslēgas: ${Object.keys(s.fills).join(", ") || "(nav)"}`);
	const item = sh.items.find((i) => i.slotId === a.slotId);
	if (!item || (item.kind !== "cell" && item.kind !== "section")) return no(`Veidnē nav lauka ${a.slotId}.`);
	if (item.by === "manual") return no("Šo lauku ir ierakstījis cilvēks — to neaizstāju. Pasaki lietotājam, ja domā, ka vērtība jāmaina.");
	if (item.by === "code") return no("Šī vērtība nāk no uzņēmuma reģistra vai lomu tabulas — to maina tur, nevis šeit.");
	if (!a.value.trim()) return no("Vērtība ir tukša.");
	const cite = locateQuote(a.quote, tenderDocs(p, s), a.file);
	if (!cite) return no("Citāts konkursa dokumentos netika atrasts burtiski. Nolasi dokumentu ar read_doc un citē tieši, kā tur rakstīts (10–300 zīmes), vai atstāj lauku tukšu.");
	patchSheet(p, a.template, a.slotId, (i) => {
		Object.assign(i, { value: a.value.trim(), status: "source", by: "model", cites: [cite], note: undefined });
	});
	return yes(`Ierakstīts: ${(item.heading || item.label).slice(0, 80)} ← ${cite.file}`);
}

/** Submission deadline (step 2). The date must appear in the quote. */
export function setDeadline(p: Project, a: { date: string; time?: string; quote: string; file?: string }): Result {
	const s = loadState(p.outputDir);
	if (!/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(a.date)) return no("Datums jāraksta DD.MM.GGGG.");
	const cite = locateQuote(a.quote, tenderDocs(p, s), a.file);
	if (!cite) return no("Citāts konkursa dokumentos netika atrasts burtiski.");
	const compact = (x: string) => x.replace(/\s+/g, "");
	if (!compact(cite.quote).includes(compact(a.date)) && !compact(cite.quote).includes(compact(a.date.replace(/^0/, "")))) return no("Datums nav redzams norādītajā citātā.");
	updateState(p.outputDir, (st) => {
		st.deadline.date = { value: a.date, status: "model", cite, confirmed: false };
		if (a.time) st.deadline.time = { value: a.time, status: "model", cite, confirmed: false };
		st.deadline.source = "nolikums";
	});
	return yes(`Termiņš ierakstīts: ${a.date}${a.time ? ` ${a.time}` : ""} ← ${cite.file}`);
}

/** Roles of 5. Kas ko dara. Information comes from the user's own words or a tender document; nothing is invented. */
export function setRole(p: Project, a: { side: string; role: string; part?: string; company?: string; person?: string }): Result {
	const s = loadState(p.outputDir);
	if (a.side !== "design" && !(a.side in s.roles.build)) return no(`Nezināma puse „${a.side}”. Derīgas: design, ${Object.keys(s.roles.build).join(", ") || "(būvnieku nav)"}`);
	if (!a.role.trim()) return no("Loma ir tukša.");
	const norm = (x: string | undefined) => (x ?? "").trim().toLowerCase();
	updateState(p.outputDir, (st) => {
		const rows = a.side === "design" ? st.roles.design : st.roles.build[a.side];
		const same = rows.find((r) => norm(r.role) === norm(a.role) && norm(r.part) === norm(a.part));
		if (same) Object.assign(same, { company: a.company ?? same.company, person: a.person ?? same.person });
		else rows.push({ id: randomUUID(), role: a.role.trim(), part: (a.part ?? "").trim(), company: (a.company ?? "").trim(), person: (a.person ?? "").trim() });
	});
	return yes(`Loma saglabāta: ${a.role}${a.part ? ` (${a.part})` : ""} — ${a.person ?? "—"}`);
}
