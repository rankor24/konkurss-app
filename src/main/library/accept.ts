// Turning harvest proposals into register objects — only on a person's decision, never automatically.
// Facts land on the register's own field keys (the ones v1/objects.ts reads), each keeping its source cell.
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { EVIDENCE_KINDS, type Builder, type HarvestFact, type HarvestProposal } from "../../shared/library.js";
import type { Evidence, KV, RegObject, Registers } from "../../shared/registers.js";
import { readableStem } from "./harvest.js";

/** Experience-table column → register field key (as in konkurss/data/atsauces_objekti.md). */
const FIELD_OF: Record<string, string> = {
	"Pieredzes raksturojums": "Pilns nosaukums veidlapai",
	Pasūtītājs: "Klients",
	"Līguma izpildes laiks": "Līguma periods",
	"Būvvaldes atzīmes datums": "Būvvaldes akcepts",
	"Nodots ekspluatācijā": "Nodots ekspluatācijā",
	Līgumcena: "Līgumsumma",
	Platība: "Platība",
};

type Cite = { file: string; quote: string };

/**
 * Register fields from the facts. "Būvniecības veids" and "Platība / kods / grupa" are derived only from words that
 * stand in the description cell itself ("Jaunbūve", "Būves kods – 1211", "Publiska ēka – III grupa").
 */
export function factsToFields(facts: HarvestFact[]): { fields: KV[]; cites: Record<string, Cite> } {
	const fields: KV[] = [];
	const cites: Record<string, Cite> = {};
	const put = (key: string, value: string, cite: Cite) => {
		if (!value || fields.some((f) => f.key === key)) return;
		fields.push({ key, value });
		cites[key] = cite;
	};
	for (const f of facts) {
		const key = FIELD_OF[f.key];
		if (key && key !== "Platība") put(key, f.value, f.cite);
	}
	const desc = facts.find((f) => f.key === "Pieredzes raksturojums");
	if (desc) {
		const kind = desc.value.match(/\b(Jaunbūve|Pārbūve|Atjaunošana|Restaurācija|Vienkāršota atjaunošana)\b/i)?.[1];
		if (kind) put("Būvniecības veids", kind[0].toUpperCase() + kind.slice(1).toLowerCase(), desc.cite);
		const code = desc.value.match(/kods\s*[–—-]?\s*(\d{4})/i)?.[1];
		const group = desc.value.match(/(publiska\s+ēka\s*[–—-]?\s*)?\b(III|II|I)\.?\s*grupa/i);
		const area = facts.find((f) => f.key === "Platība")?.value.match(/[\d\s]+(?:[.,]\d+)?\s*m²/)?.[0] ?? desc.value.match(/[\d\s]+(?:[.,]\d+)?\s*m²/)?.[0];
		if (code || group || area) {
			const groupText = group ? `${group[1] ? "Publiska ēka " : ""}${group[2].toUpperCase()} grupa` : "—";
			put("Platība / kods / grupa", `${area?.trim() ?? "—"} / ${code ?? "—"} / ${groupText}`, desc.cite);
		}
	} else {
		const area = facts.find((f) => f.key === "Platība");
		if (area) put("Platība / kods / grupa", `${area.value} / — / —`, area.cite);
	}
	return { fields, cites };
}

export function filesToEvidence(p: HarvestProposal): Evidence[] {
	return p.files.map((f) => ({ label: `${EVIDENCE_KINDS[f.kind]} — ${readableStem(basename(f.path))}`, path: f.path, kind: f.kind }));
}

function decide(reg: Registers, key: string, decision: HarvestProposal["decision"]): void {
	const p = reg.harvest?.proposals.find((x) => x.key === key);
	if (p) p.decision = decision;
}

/** A new register object from a proposal. The name is the person's; facts and files come from the proposal. */
export function acceptAsNew(reg: Registers, p: HarvestProposal, name: string, id: string = randomUUID()): RegObject {
	const { fields, cites } = factsToFields(p.facts);
	const o: RegObject = { id, name: name.trim() || p.label, fields, evidence: filesToEvidence(p), cites, harvestKeys: [p.key] };
	reg.objects.push(o);
	decide(reg, p.key, "accepted");
	return o;
}

/** Adds the proposal's files and any missing fields to an existing object. Existing values are never replaced. */
export function mergeInto(reg: Registers, p: HarvestProposal, objectId: string): RegObject {
	const o = reg.objects.find((x) => x.id === objectId);
	if (!o) throw new Error("Reģistra objekts nav atrasts.");
	const { fields, cites } = factsToFields(p.facts);
	for (const f of fields) {
		if (o.fields.some((x) => x.key === f.key)) continue;
		o.fields.push(f);
		o.cites = { ...o.cites, [f.key]: cites[f.key] };
	}
	const have = new Set(o.evidence.map((e) => e.path.toLowerCase()));
	for (const e of filesToEvidence(p)) if (!have.has(e.path.toLowerCase())) o.evidence.push(e);
	o.harvestKeys = [...new Set([...(o.harvestKeys ?? []), p.key])];
	decide(reg, p.key, "merged");
	return o;
}

export function ignoreProposal(reg: Registers, key: string): void {
	decide(reg, key, "ignored");
}

/** A new harvest run keeps earlier decisions, so ignored and accepted proposals do not come back. */
export function carryDecisions(prev: HarvestProposal[] | undefined, next: HarvestProposal[]): HarvestProposal[] {
	const old = new Map((prev ?? []).map((p) => [p.key, p.decision]));
	return next.map((p) => ({ ...p, decision: old.get(p.key) ?? p.decision }));
}

/**
 * Builders from a harvest, merged into the register by reg. Nr. (or folder key when the number is unknown).
 * Fields a person typed are kept; empty ones are filled.
 */
export function mergeBuilders(existing: Builder[] | undefined, found: Builder[]): Builder[] {
	const out = (existing ?? []).map((b) => ({ ...b, seenIn: [...b.seenIn], cites: [...b.cites] }));
	for (const f of found) {
		const same = out.find((b) => (f.regNr && b.regNr === f.regNr) || b.id === f.id);
		if (!same) {
			out.push(f);
			continue;
		}
		if (!same.regNr && f.regNr) same.regNr = f.regNr;
		if (/^(SIA|AS)\s/.test(f.name) && !/^(SIA|AS)\s/.test(same.name)) same.name = f.name;
		for (const t of f.seenIn) if (!same.seenIn.includes(t)) same.seenIn.push(t);
		for (const c of f.cites) if (!same.cites.some((x) => x.file === c.file)) same.cites.push(c);
	}
	return out.sort((a, b) => b.seenIn.length - a.seenIn.length);
}
