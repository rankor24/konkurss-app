// Bindings: where a form field's value comes from. A closed vocabulary resolved entirely in code —
// the model may only choose among these ids (it never supplies a value), a person can change any of them,
// and the correction is remembered per form layout (mapping memory, decision D-mapping).
//
//   company:<key>          our register, e.g. company:Nosaukums
//   answer:<key>           a standard answer from the register
//   person:<role>          a company person by role, e.g. person:Paraksttiesīgais
//   tender:<field>         purchaser | id | subject | contractType (confirmed in step 3)
//   specialist:<i>:<what>  the specialist chosen for required field i: name | company | cert | field
//   object:<slot>:<n>:<k>  n-th object chosen for an experience slot; k = "name" or a register field key
//   price:<what>           net | vat | gross | eis | row:<i>
//   date:today
//   fixed:---              the form's "does not apply" mark
//   manual                 nobody can know this from our data
import type { Choices, Requirements } from "../../shared/state.js";
import type { Registers } from "../../shared/registers.js";
import type { Builder } from "../../shared/library.js";
import { formatCents, totals, type Finance } from "./finance.js";

export interface BindCtx {
	reg: Registers;
	req: Requirements;
	choices: Choices;
	finance: Finance;
	today: Date;
	/** phase 9: the builder whose copy is being made; absent for the base sheet */
	builder?: Builder;
}

export const BUILDER_FIELDS = { name: "nosaukums", regNr: "reģ. Nr.", address: "adrese", signatory: "paraksttiesīgā persona", signatoryTitle: "amats" } as const;
export type BuilderField = keyof typeof BUILDER_FIELDS;
export const isBuilderBinding = (id: string | undefined) => !!id && id.startsWith("builder:");

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const strip = (s: string) => s.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
const dmy = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;

export interface Resolved {
	value: string;
	/** short source line for the value sheet */
	note: string;
}

export function resolveBinding(id: string, ctx: BindCtx): Resolved | null {
	const [kind, ...rest] = id.split(":");
	const arg = rest.join(":");
	switch (kind) {
		case "company": {
			const f = ctx.reg.company.fields.find((x) => norm(x.key) === norm(arg));
			return f ? { value: strip(f.value), note: `uzņēmuma reģistrs: ${f.key}` } : null;
		}
		case "answer": {
			const a = ctx.reg.company.answers.find((x) => norm(x.key) === norm(arg));
			return a ? { value: strip(a.value), note: `standarta atbilde: ${a.key}` } : null;
		}
		case "person": {
			const p = ctx.reg.company.persons.find((x) => norm(x.role).startsWith(norm(arg)));
			return p ? { value: strip(p.person), note: `uzņēmuma reģistrs: ${p.role}` } : null;
		}
		case "tender": {
			const d = ctx.req.dati as Record<string, { value: string | null }>;
			const v = d[arg]?.value;
			return v ? { value: v, note: `konkursa dati (3. solis): ${arg}` } : null;
		}
		case "specialist": {
			const [i, what] = rest;
			const spId = ctx.choices.specialists[i];
			const sp = ctx.reg.specialists.find((s) => s.id === spId);
			if (!sp) return null;
			const company = sp.type === "A" ? (ctx.reg.company.fields.find((f) => norm(f.key) === "nosaukums")?.value ?? "") : sp.via;
			const val = { name: sp.name, company: strip(company), cert: sp.certificate, field: sp.field }[what];
			return val ? { value: val, note: `speciālists: ${sp.name}` } : null;
		}
		case "object": {
			const slot = `${rest[0]}:${rest[1]}`;
			const n = Number(rest[2]);
			const key = rest.slice(3).join(":");
			const o = ctx.reg.objects.find((x) => x.id === ctx.choices.objects[slot]?.[n]);
			if (!o) return null;
			if (key === "name") return { value: o.name, note: `objekts: ${o.name}` };
			const f = o.fields.find((x) => norm(x.key) === norm(key));
			return f ? { value: strip(f.value), note: `objekts „${o.name}”: ${f.key}` } : null;
		}
		case "price": {
			const t = totals(ctx.finance);
			if (ctx.finance.rows.length === 0) return null;
			const map: Record<string, number | null> = { net: t.net, vat: t.vat, gross: t.gross, eis: t.eis };
			if (arg.startsWith("row:")) {
				const r = t.rows[Number(arg.slice(4))];
				return r?.net != null ? { value: formatCents(r.net), note: `cena: ${r.name}` } : null;
			}
			const c = map[arg];
			return c != null ? { value: formatCents(c), note: `cenas (${arg})` } : null;
		}
		case "builder": {
			const field = arg as BuilderField;
			if (!(field in BUILDER_FIELDS)) return null;
			// the base sheet holds a marker; each builder's copy gets that builder's own data
			if (!ctx.builder) return { value: `‹būvnieks: ${BUILDER_FIELDS[field]}›`, note: "katrā būvnieka kopijā — attiecīgā būvnieka dati" };
			const v = strip(ctx.builder[field] ?? "");
			return v ? { value: v, note: `būvnieku reģistrs: ${ctx.builder.name}, ${BUILDER_FIELDS[field]}` } : null;
		}
		case "date":
			return arg === "today" ? { value: dmy(ctx.today), note: "šodienas datums" } : null;
		case "fixed":
			return arg ? { value: arg, note: "neattiecas" } : null;
		default:
			return null;
	}
}

export const isManual = (id: string) => id === "manual";

/** The ids a person can pick from for one slot, with readable labels. Concrete (resolvable) ids only. */
export function vocabulary(ctx: BindCtx): { id: string; label: string }[] {
	const out: { id: string; label: string }[] = [{ id: "manual", label: "Ievadīšu pati" }, { id: "fixed:---", label: "Neattiecas („---”)" }, { id: "date:today", label: "Šodienas datums" }];
	for (const f of ctx.reg.company.fields) out.push({ id: `company:${f.key}`, label: `Uzņēmums — ${f.key}` });
	for (const a of ctx.reg.company.answers) out.push({ id: `answer:${a.key}`, label: `Standarta atbilde — ${a.key}` });
	for (const p of ctx.reg.company.persons) out.push({ id: `person:${p.role}`, label: `Persona — ${p.role}` });
	for (const [k, l] of Object.entries(BUILDER_FIELDS)) out.push({ id: `builder:${k}`, label: `Būvnieks (pretendents) — ${l}` });
	for (const k of ["purchaser", "id", "subject", "contractType"] as const) out.push({ id: `tender:${k}`, label: `Konkurss — ${{ purchaser: "pasūtītājs", id: "ID", subject: "priekšmets", contractType: "līguma veids" }[k]}` });
	ctx.req.specialisti.forEach((s, i) => {
		for (const [w, l] of [["name", "vārds, uzvārds"], ["company", "komersants"], ["cert", "sertifikāta Nr."], ["field", "darbības sfēra"]] as const) out.push({ id: `specialist:${i}:${w}`, label: `Speciālists „${s.field.value ?? i + 1}” — ${l}` });
	});
	for (const [slot, ids] of Object.entries(ctx.choices.objects)) {
		ids.forEach((oid, n) => {
			const o = ctx.reg.objects.find((x) => x.id === oid);
			if (!o) return;
			out.push({ id: `object:${slot}:${n}:name`, label: `Objekts ${slot} #${n + 1} — nosaukums` });
			for (const f of o.fields) out.push({ id: `object:${slot}:${n}:${f.key}`, label: `Objekts ${slot} #${n + 1} — ${f.key}` });
		});
	}
	for (const w of ["net", "vat", "gross", "eis"]) out.push({ id: `price:${w}`, label: `Cena — ${{ net: "kopā bez PVN", vat: "PVN", gross: "kopā ar PVN", eis: "summa EIS laukam" }[w]}` });
	ctx.finance.rows.forEach((r, i) => out.push({ id: `price:row:${i}`, label: `Cena — ${r.name}` }));
	return out;
}

/** True when the id has the right shape (it may still resolve to nothing if the choice was not made yet). */
export function bindingShapeOk(id: string): boolean {
	return /^(manual|fixed:.+|date:today|company:.+|answer:.+|person:.+|builder:(name|regNr|address|signatory|signatoryTitle)|tender:(purchaser|id|subject|contractType)|specialist:\d+:(name|company|cert|field)|object:[a-z]+:\d+:\d+:.+|price:(net|vat|gross|eis|row:\d+))$/.test(id);
}

/** Registered fields keyed by "label#occurrence" — a stable identity for a repeated label in one form. */
export function slotKeys(items: { slotId: string; label: string }[]): Map<string, string> {
	const seen = new Map<string, number>();
	const out = new Map<string, string>();
	for (const i of items) {
		const base = norm(i.label);
		const n = (seen.get(base) ?? 0) + 1;
		seen.set(base, n);
		out.set(i.slotId, `${base}#${n}`);
	}
	return out;
}

/** Produces the value-sheet text for the people choosing: which specialists/objects/docs they imply. */
export function producedDocuments(ctx: Pick<BindCtx, "reg" | "req" | "choices">): string[] {
	const docs: string[] = [];
	ctx.req.specialisti.forEach((s, i) => {
		const sp = ctx.reg.specialists.find((x) => x.id === ctx.choices.specialists[String(i)]);
		if (!sp || sp.type === "A") return;
		if (sp.type === "B") docs.push(`Apakšuzņēmēja apliecinājums — ${sp.via || "apakšuzņēmējs"} (${s.field.value ?? ""})`);
		docs.push(`Speciālista apliecinājums — ${sp.name}`);
	});
	return docs;
}

export type { Requirements };
