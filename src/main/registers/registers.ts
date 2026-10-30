// Permanent company data used in every tender: company, specialists, earlier objects.
// Seeded once from the konkurss skill's data/*.md (the existing single source of truth), then edited as forms.
import { randomUUID } from "node:crypto";

export type { Company, Evidence, Expiry, KV, RegObject, Registers, Specialist } from "../../shared/registers.js";
import type { Company, Expiry, KV, RegObject, Registers, Specialist } from "../../shared/registers.js";

export const emptyRegisters = (): Registers => ({ company: { fields: [], persons: [], answers: [] }, specialists: [], gaps: [], objects: [] });

const strip = (s: string) =>
	s
		.replace(/\*\*/g, "")
		.replace(/`/g, "")
		.replace(/\s+/g, " ")
		.trim();

interface Section {
	title: string;
	rows: string[][];
}

/** Splits a markdown document into `## sections`, each with its table body rows (header and separator dropped). */
export function mdSections(md: string): Section[] {
	const sections: Section[] = [];
	let cur: Section | null = null;
	let headerSeen = false;
	for (const raw of md.split(/\r?\n/)) {
		const h = raw.match(/^##\s+(.*)$/);
		if (h) {
			cur = { title: strip(h[1]), rows: [] };
			sections.push(cur);
			headerSeen = false;
			continue;
		}
		if (!cur || !raw.trim().startsWith("|")) {
			if (cur && !raw.trim().startsWith("|")) headerSeen = false;
			continue;
		}
		const cells = raw.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(strip);
		if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "")) {
			headerSeen = true;
			continue;
		}
		if (!headerSeen) {
			// the first row of a table is its header
			cur.rows.push(["#header", ...cells]);
			continue;
		}
		cur.rows.push(cells);
	}
	return sections;
}

const body = (s: Section) => s.rows.filter((r) => r[0] !== "#header");

export function parseCompany(md: string): Company {
	const company: Company = { fields: [], persons: [], answers: [] };
	for (const s of mdSections(md)) {
		const rows = body(s);
		if (/rekviz/i.test(s.title)) company.fields = rows.filter((r) => r.length >= 2 && r[0]).map((r) => ({ key: r[0], value: r[1] }));
		else if (/personas/i.test(s.title)) company.persons = rows.map((r) => ({ role: r[0] ?? "", person: r[1] ?? "", note: r[2] ?? "" }));
		else if (/standarta atbildes/i.test(s.title)) company.answers = rows.filter((r) => r[0]).map((r) => ({ key: r[0], value: r[1] ?? "" }));
	}
	return company;
}

export function parseSpecialists(md: string): { specialists: Specialist[]; gaps: Registers["gaps"] } {
	const specialists: Specialist[] = [];
	const gaps: Registers["gaps"] = [];
	for (const s of mdSections(md)) {
		const rows = body(s);
		if (/tips A/i.test(s.title) || /tips B/i.test(s.title)) {
			const type = /tips B/i.test(s.title) ? "B" : "A";
			for (const r of rows) {
				if (!r[0]) continue;
				specialists.push({ id: randomUUID(), name: r[0], field: r[1] ?? "", certificate: r[2] ?? "", type, via: type === "B" ? (r[3] ?? "") : "", note: type === "A" ? (r[3] ?? "") : "", validUntil: "" });
			}
		} else if (/robi/i.test(s.title)) {
			for (const r of rows) if (r[0]) gaps.push({ field: r[0], note: [r[1], r[2]].filter(Boolean).join(" — ") });
		}
	}
	return { specialists, gaps };
}

export function parseObjects(md: string): RegObject[] {
	const objects: RegObject[] = [];
	for (const s of mdSections(md)) {
		const m = s.title.match(/^\d+\.\s*(.*)$/);
		if (!m) continue;
		const fields = body(s).filter((r) => r.length >= 2 && r[0]).map((r) => ({ key: r[0], value: r[1] }));
		if (fields.length === 0) continue;
		objects.push({ id: randomUUID(), name: m[1], fields, evidence: [] });
	}
	return objects;
}

export function importFromSkillData(files: { uznemums: string; specialisti: string; objekti: string }): Registers {
	const sp = parseSpecialists(files.specialisti);
	return { company: parseCompany(files.uznemums), specialists: sp.specialists, gaps: sp.gaps, objects: parseObjects(files.objekti) };
}

// ---------- checks ----------
/** Certificates ending within `months` months (default 3) or already ended. Blank dates are not guessed. */
export function expiring(specialists: Specialist[], now: Date = new Date(), months = 3): Expiry[] {
	const out: Expiry[] = [];
	const limit = new Date(now);
	limit.setMonth(limit.getMonth() + months);
	for (const s of specialists) {
		const m = s.validUntil.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
		if (!m) continue;
		// "2027-03" means the end of that month
		const end = m[3] ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59) : new Date(Number(m[1]), Number(m[2]), 0, 23, 59);
		const days = Math.floor((end.getTime() - now.getTime()) / 86_400_000);
		if (end < now) out.push({ id: s.id, name: s.name, validUntil: s.validUntil, status: "expired", days });
		else if (end <= limit) out.push({ id: s.id, name: s.name, validUntil: s.validUntil, status: "soon", days });
	}
	return out;
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
/** Words that appear in almost every specialist field and say nothing about which field it is. */
const GENERIC = new Set(["projektesanas", "projektesana", "projektetajs", "projektesanaa", "sertificets", "sertifikats", "sistemu", "sistemas", "specialists", "darbibas", "sfera", "jomas", "attieciga", "attiecigas", "ieskaitot", "ar", "un", "vai", "kas", "kuram", "esoss", "speka"]);

export function stems(s: string): Set<string> {
	const out = new Set<string>();
	for (const w of norm(s).split(/[^a-z0-9]+/)) {
		if (w.length < 5 || GENERIC.has(w)) continue;
		out.add(w.slice(0, 9));
	}
	return out;
}

/** True when at least 60 % of the required field's distinctive words occur in the specialist's field. */
export function covers(requiredField: string, specialistField: string): boolean {
	const need = stems(requiredField);
	if (need.size === 0) return false;
	const have = stems(specialistField);
	let hit = 0;
	for (const n of need) if (have.has(n)) hit++;
	return hit / need.size >= 0.6;
}

export interface Coverage {
	required: string;
	covered: boolean;
	by: Specialist[];
}

/** For each field a tender requires: which of our people cover it. Subcontractors count; the caller sees `type`. */
export function coverage(required: string[], specialists: Specialist[]): Coverage[] {
	return required.map((req) => {
		const by = specialists.filter((s) => covers(req, s.field));
		return { required: req, covered: by.length > 0, by };
	});
}
