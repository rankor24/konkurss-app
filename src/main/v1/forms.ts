// V1 forms (Pieteikums, Kvalifikācija, Finanšu piedāvājums, Apliecinājums, Saimnieciski izdevīgākā piedāvājuma veidlapa).
// Value sheet per form: every empty cell has a binding; code resolves it; missing data blocks file creation.
import { z } from "zod";
import { basename, extname, join } from "node:path";
import type { FillSheet, SheetItem } from "../../shared/state.js";
import type { Project } from "../../shared/types.js";
import type { Engine, RunOptions } from "../engines/types.js";
import { LEGEND, mergeSheets, newSheet, toEdits } from "../fill/sheet.js";
import { nextVersionPath, safeName, type Outcome } from "../fill/run.js";
import { loadState, updateState } from "../project-state.js";
import { fillDocx, inspectDocx, type ToolsConfig } from "../pytools.js";
import { runModelTask } from "../tasks/runner.js";
import { bindingShapeOk, isManual, producedDocuments, resolveBinding, slotKeys, vocabulary, type BindCtx } from "./bindings.js";
import { loadFinance } from "./finance.js";
import type { Registers } from "../../shared/registers.js";
import { covers } from "../registers/registers.js";

type Base = Omit<RunOptions, "prompt" | "onEvent">;
export const FORM_KINDS = ["pieteikums", "kvalifikacija", "finansu", "apliecinajums", "vertesanas_veidlapa"] as const;

export interface FormDeps {
	project: Project;
	tools: ToolsConfig;
	registers: Registers;
	mappings: Record<string, Record<string, string>>;
	saveMappings: (m: Record<string, Record<string, string>>) => void;
	today?: Date;
}

/** Documents the current choices bring along (subcontractor and specialist declarations). */
export function producedDocs(s: ReturnType<typeof loadState>, reg: Registers): string[] {
	return producedDocuments({ reg, req: s.requirements, choices: s.choices });
}

export function bindCtx(d: FormDeps): BindCtx {
	const s = loadState(d.project.outputDir);
	return { reg: d.registers, req: s.requirements, choices: s.choices, finance: loadFinance(d.project.outputDir), today: d.today ?? new Date() };
}

/** Applies bindings to a sheet: resolves each in code. Person-typed values and settled choices are kept. */
export function applyBindings(sheet: FillSheet, picks: Record<string, { binding: string; by: "memory" | "model" | "manual" }>, ctx: BindCtx): FillSheet {
	const next = structuredClone(sheet);
	for (const it of next.items) {
		const pick = picks[it.slotId];
		if (!pick || it.kind !== "cell" || it.by === "manual") continue;
		it.binding = pick.binding;
		it.bindingBy = pick.by;
		if (isManual(pick.binding)) {
			Object.assign(it, { value: "", status: "missing", by: "code", cites: [], note: "Ievadīt pašai — šādu datu mūsu reģistros nav." });
			continue;
		}
		const r = resolveBinding(pick.binding, ctx);
		if (!r) {
			Object.assign(it, { value: "", status: "missing", by: "code", cites: [], note: `Piesaistei „${pick.binding}” vēl nav datu — izvēlies speciālistu/objektu/cenas 5. solī.` });
			continue;
		}
		const na = pick.binding.startsWith("fixed:");
		Object.assign(it, { value: r.value, status: na ? "na" : "source", by: "code", cites: [], note: `${r.note}${pick.by === "model" && !it.bindingOk ? " · piesaisti piedāvāja aģents — pārbaudi" : ""}` });
	}
	return next;
}

// ---------- model proposes bindings for labels it has not seen ----------
export const bindSchema = z.object({ items: z.array(z.object({ id: z.string(), binding: z.string().nullable(), why: z.string().optional() })) });
export const BIND_HINT = `{"items": [{"id": "c:t1:r2:c1", "binding": "specialist:2:name", "why": "rinda ‘Ūdensapgāde…’, kolonna ‘Vārds, Uzvārds’"}]}`;

export function bindInstructions(ctx: BindCtx): string {
	const lines = vocabulary(ctx).map((v) => `${v.id}  —  ${v.label}`);
	return [
		"Zemāk ir veidlapas lauki (id, virsraksts, nosaukums, rindas nosaukums). Katram laukam izvēlies VIENU piesaisti no šī slēgtā saraksta — kur app ņems vērtību. Neizdomā jaunas piesaistes.",
		"- Speciālistu tabulās: rinda (piem. ‘Atbildīgais būvprojekta vadītājs’) nosaka, kuru no prasītajiem speciālistiem tā ir (specialist:<i>), kolonna nosaka, ko ņemt (name/company/cert/field).",
		"- Ja lauks attiecas uz citu personu, apvienību vai apakšuzņēmēju un parasti netiek aizpildīts — izvēlies fixed:---.",
		"- Ja saraksta nav piemērotas piesaistes (piem. brīvs teksts, paraksts, datums, kas nav šodiena) — izvēlies manual. Ja nezini — null.",
		"",
		"PRASĪTIE SPECIĀLISTI (indekss: joma):",
		...ctx.req.specialisti.map((s, i) => `${i}: ${s.field.value ?? "?"}`),
		"",
		"PIESAISTES:",
		...lines,
	].join("\n");
}

export function bindPrompt(items: SheetItem[], rowLabels: Map<string, string | undefined>): string {
	return items.map((i) => `- ${i.slotId} | ${i.heading || "—"} | ${i.label}${rowLabels.get(i.slotId) ? ` | rinda: ${rowLabels.get(i.slotId)}` : ""}`).join("\n");
}

/** Binds a form: memory first, then the model for what is left; resolves everything in code and stores the sheet. */
/**
 * Required specialists for whom this form has no row (mistake catalogue B2: the distributed Kvalifikācija had 4 rows,
 * the nolikums 5). Only forms that list specialists at all are checked.
 */
export function unplacedSpecialists(required: string[], rowLabels: string[]): string[] {
	const looksLikeList = rowLabels.some((l) => /speci[aā]list|projekt[eē]t[aā]j|vad[iī]t[aā]j/i.test(l));
	if (!looksLikeList) return [];
	return required.filter((r) => !rowLabels.some((l) => covers(r, l) || covers(l, r)));
}

export async function bindForm(d: FormDeps, engine: Engine | null, base: Base | null, key: string): Promise<Outcome<{ sheet: FillSheet; fromMemory: number; fromModel: number; unbound: number; unplaced: string[] }>> {
	const s = loadState(d.project.outputDir);
	const f = s.files.find((x) => `${x.root}:${x.rel}` === key);
	if (!f) return { ok: false, error: "Veidnes fails nav atrasts." };
	const path = join(f.root === "source" ? d.project.sourceDir : d.project.outputDir, f.rel);
	const info = await inspectDocx(d.tools, path);
	const sheet0 = mergeSheets(newSheet(key, info), s.fills[key]);
	const ctx = bindCtx(d);
	const keys = slotKeys(sheet0.items.filter((i) => i.kind === "cell"));
	const memory = d.mappings[sheet0.skeleton] ?? {};
	const picks: Record<string, { binding: string; by: "memory" | "model" | "manual" }> = {};
	// settled choices (a person's earlier pick) stay
	for (const it of sheet0.items) if (it.binding && it.bindingBy === "manual") picks[it.slotId] = { binding: it.binding, by: "manual" };
	let fromMemory = 0;
	for (const it of sheet0.items) {
		if (it.kind !== "cell" || picks[it.slotId]) continue;
		const m = memory[keys.get(it.slotId)!];
		if (m && bindingShapeOk(m)) {
			picks[it.slotId] = { binding: m, by: "memory" };
			fromMemory++;
		}
	}
	const todo = sheet0.items.filter((i) => i.kind === "cell" && !picks[i.slotId] && i.by !== "manual");
	let fromModel = 0;
	if (todo.length && engine && base) {
		const rowLabels = new Map(todo.map((i) => [i.slotId, info.tables.find((t) => t.t === i.t)?.cells[i.r!]?.map((c) => c.trim()).find(Boolean)]));
		const r = await runModelTask({
			engine,
			base,
			instructions: `${bindInstructions(ctx)}\n\nLAUKI:\n${bindPrompt(todo, rowLabels)}`,
			schemaHint: BIND_HINT,
			schema: bindSchema,
			docs: [{ file: "veidlapa.txt", text: `Veidlapa: ${basename(path)}` }],
		});
		if (!r.ok) return r;
		for (const it of r.data.items) {
			if (it.binding && bindingShapeOk(it.binding) && todo.some((t) => t.slotId === it.id)) {
				picks[it.id] = { binding: it.binding, by: "model" };
				fromModel++;
			}
		}
	}
	const sheet = { ...applyBindings(sheet0, picks, ctx), filledAt: new Date().toISOString() };
	updateState(d.project.outputDir, (st) => void (st.fills[key] = sheet));
	const rowLabels = info.tables.flatMap((t) => t.cells.map((row) => row[0]?.trim() ?? "")).filter(Boolean);
	const required = s.requirements.specialisti.filter((x) => x.mandatory && x.field.value).map((x) => x.field.value as string);
	return { ok: true, sheet, fromMemory, fromModel, unbound: sheet.items.filter((i) => i.kind === "cell" && !i.binding && i.by !== "manual").length, unplaced: unplacedSpecialists(required, rowLabels) };
}

/** A person changes a binding: applies it, and remembers it for the next form with this layout. */
export async function setBinding(d: FormDeps, key: string, slotId: string, binding: string): Promise<Outcome<{ sheet: FillSheet }>> {
	if (!bindingShapeOk(binding)) return { ok: false, error: "Nederīga piesaiste." };
	const s = loadState(d.project.outputDir);
	const sheet0 = s.fills[key];
	if (!sheet0) return { ok: false, error: "Vispirms pārskati veidni." };
	const ctx = bindCtx(d);
	const sheet = applyBindings(sheet0, { [slotId]: { binding, by: "manual" } }, ctx);
	const it = sheet.items.find((i) => i.slotId === slotId);
	if (it) it.bindingOk = true;
	const skKey = slotKeys(sheet.items.filter((i) => i.kind === "cell")).get(slotId);
	if (skKey) {
		const m = { ...d.mappings, [sheet.skeleton]: { ...(d.mappings[sheet.skeleton] ?? {}), [skKey]: binding } };
		d.saveMappings(m);
		d.mappings = m;
	}
	updateState(d.project.outputDir, (st) => void (st.fills[key] = sheet));
	return { ok: true, sheet };
}

export function confirmBinding(p: Project, key: string, slotId: string): void {
	updateState(p.outputDir, (s) => {
		const it = s.fills[key]?.items.find((i) => i.slotId === slotId);
		if (it) it.bindingOk = true;
	});
}

/** Marks a field as not applicable: the form shows „---”. */
export function setNotApplicable(p: Project, key: string, slotId: string): void {
	updateState(p.outputDir, (s) => {
		const it = s.fills[key]?.items.find((i) => i.slotId === slotId);
		if (it) Object.assign(it, { value: "---", status: "na", by: "manual", binding: "fixed:---", bindingBy: "manual", bindingOk: true, note: "Neattiecas (atzīmēts ar roku)." });
	});
}

/** Missing data blocks file creation (decision D5): the list says exactly what is open. */
export function blockers(sheet: FillSheet): SheetItem[] {
	return sheet.items.filter((i) => i.kind === "cell" && i.status === "missing");
}

export async function generateForm(d: FormDeps, key: string): Promise<Outcome<{ file: string }>> {
	const s = loadState(d.project.outputDir);
	const sheet = s.fills[key];
	if (!sheet) return { ok: false, error: "Vispirms pārskati un piesaisti veidlapu." };
	const open = blockers(sheet);
	if (open.length) {
		return { ok: false, error: `Failu neizveidos, kamēr ${open.length} vietās nav datu: ${open.slice(0, 6).map((i) => i.label + (i.heading ? ` (${i.heading.split(" › ").pop()})` : "")).join("; ")}${open.length > 6 ? "…" : ""}. Piesaisti datus, ievadi pati vai atzīmē „neattiecas”.` };
	}
	const f = s.files.find((x) => `${x.root}:${x.rel}` === key)!;
	const src = join(f.root === "source" ? d.project.sourceDir : d.project.outputDir, f.rel);
	const stem = safeName(basename(src, extname(src)));
	const dst = nextVersionPath(join(d.project.outputDir, "Iesniedzamie"), stem, extname(src));
	await fillDocx(d.tools, { src, dst, edits: toEdits(sheet), legend: LEGEND });
	updateState(d.project.outputDir, (st) => void (st.fills[key] && (st.fills[key].outputs[""] = dst)));
	return { ok: true, file: dst };
}
