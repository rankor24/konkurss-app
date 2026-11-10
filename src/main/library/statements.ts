// Phase 9: the office's standard statements (specialista / apakšuzņēmēja apliecinājums …), used only when a tender
// gives no form of its own. Wording is taken from a statement the office already submitted, read at run time —
// tender-specific values become placeholders; anything personal the code cannot place is reported, never kept quietly.
import { randomUUID } from "node:crypto";
import type { StatementTemplate } from "../../shared/library.js";
import type { Registers, Specialist } from "../../shared/registers.js";
import type { Requirements } from "../../shared/state.js";
import type { Builder } from "../../shared/library.js";
import { clean } from "../office.js";
import { builderKey, companyMentions, fold } from "./harvest.js";
import { ourIdentity } from "../checks/identity.js";

const MONTHS = ["janvāris", "februāris", "marts", "aprīlis", "maijs", "jūnijs", "jūlijs", "augusts", "septembris", "oktobris", "novembris", "decembris"];
export const longDate = (d: Date) => `${d.getFullYear()}. gada ${d.getDate()}. ${MONTHS[d.getMonth()]}`;
const dmy = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;

/** The text between a quote mark at `start` and its matching close, honouring nested „“…” quotes. */
export function balancedQuote(s: string, start: number): { end: number; inner: string } | null {
	const open = s[start];
	if (!"„“\"".includes(open)) return null;
	let depth = 0;
	for (let i = start; i < s.length; i++) {
		const ch = s[i];
		if (ch === "„" || ch === "“") depth++;
		else if (ch === "”") depth--;
		else if (ch === '"') depth += i === start || /[\s(„“]/.test(s[i - 1] ?? " ") ? 1 : -1;
		if (depth === 0) return { end: i, inner: s.slice(start + 1, i) };
	}
	return null;
}

export interface Extracted {
	template: StatementTemplate;
	/** names, numbers and quoted titles still in the text that look tender- or person-specific */
	residue: string[];
}

/**
 * A template from a submitted statement. `paragraphs` are the document's paragraphs (office.ts readDocx).
 * Our company → {{company:…}}, the other company → {{builder:…}}, ID / subject → {{tender:…}},
 * "Es, Vārds Uzvārds," → {{who:name}}, certificate → {{who:cert}}, "… izpildē kā <loma>" → {{who:role}}, dates → {{date:…}}.
 */
export function templateFromDocument(paragraphs: string[], kind: StatementTemplate["kind"], source: string, reg: Registers, id: string = randomUUID()): Extracted {
	const us = ourIdentity(reg);
	const nameKey = reg.company.fields.find((f) => /^nosaukums$/i.test(f.key.trim()))?.key ?? "Nosaukums";
	const regKey = reg.company.fields.find((f) => /re[gģ]/i.test(f.key))?.key ?? "Reģ. Nr.";
	const joined = paragraphs.join(" ");
	const mentions = companyMentions(joined);
	const ours = (key: string, nr: string) => nr === us.regNr || key === us.key;
	// companies named without a number ("ja pretendentam SIA “FF” tiks …") are the pretendents too, unless it is us
	const bare = [...joined.matchAll(/\b(SIA|AS|PS|VSIA)\s*[„“"]([^„“"”\n]{2,60}?)[”"]/g)].filter((m) => builderKey(m[2]) !== us.key).map((m) => m[0]);
	const otherNames = [...new Set([...mentions.filter((m) => !ours(m.key, m.regNr)).map((m) => m.name), ...bare])].sort((a, b) => b.length - a.length);
	const otherNumbers = [...new Set(mentions.filter((m) => !ours(m.key, m.regNr)).map((m) => m.regNr))];
	const people: string[] = [];
	// the subject: the quoted title after a procedure word, or a paragraph that is only a quoted title
	let subjectText: string | null = null;
	for (const raw of paragraphs) {
		const p = clean(raw);
		const at = p.search(/(konkurs|iepirkum|procedūr)\w*\s*[„“"]/i);
		const q = at >= 0 ? p.slice(at).search(/[„“"]/) + at : /^[„“"]/.test(p) ? 0 : -1;
		const b = q >= 0 ? balancedQuote(p, q) : null;
		if (b && b.inner.length >= 15) {
			subjectText = b.inner;
			break;
		}
	}

	const out = paragraphs.filter((raw, i) => !(i < 3 && /^\d+\.\s*pielikums\.?$/i.test(clean(raw)))).map((raw) => {
		let p = clean(raw);
		// companies with their numbers, in any wording
		p = p.replace(/\b(SIA|AS|PS|VSIA|IK)\s*[„“"”']([^„“"”'\n]{2,60}?)[”"“']\s*,?\s*\(?\s*(re[gģ](?:istrācijas)?\.?\s*(?:nr|numurs)\.?)\s*[:\s_]*(\d{11})/gi, (_m, _f, name: string, label: string, nr: string) =>
			ours(builderKey(name), nr) ? `{{company:${nameKey}}}, ${label} {{company:${regKey}}}` : `{{builder:name}}, ${label} {{builder:regNr}}`,
		);
		for (const n of otherNames) p = p.split(n).join("{{builder:name}}");
		for (const n of otherNumbers) p = p.split(n).join("{{builder:regNr}}");
		if (us.regNr) p = p.split(us.regNr).join(`{{company:${regKey}}}`);
		// tender ID and subject
		p = p.replace(/((?:identifikācijas|ID|iepirkuma)\s+(?:Nr\.|numurs)\s*)([A-ZĀ-Ža-zā-ž]+(?:\s+[A-ZĀ-Ža-zā-ž]+)?\s+\d{4}\s*\/\s*[\w/.-]+)/gi, "$1{{tender:id}}");
		if (subjectText) p = p.split(subjectText).join("{{tender:subject}}");
		// the person ("Es, …" or "…, es, …")
		p = p.replace(/\b([Ee]s,\s+)([A-ZĀ-Ž][\p{L}-]+(?:\s+[A-ZĀ-Ž][\p{L}-]+)+)(\s*,)/u, (_m, a: string, name: string, c: string) => {
			people.push(name);
			return `${a}{{who:name}}${c}`;
		});
		p = p.replace(/(sertifikāta\s+(?:nr\.?|numurs)\s*)([\d]+-[\d]+)/gi, "$1{{who:cert}}");
		// the form's own blank mark ("kā _būvprojekta vadītājs") is not part of the role
		p = p.replace(/(līguma izpildē kā\s+)_*([^,{}]+?)(?=,|\s+atbilstoši|\s+gadījumā)/i, "$1{{who:role}}");
		// dates
		p = p.replace(/\b\d{4}\.\s*gada\s+\d{1,2}\.\s*[a-zāčēģīķļņšūž]+/gi, "{{date:long}}").replace(/\b\d{2}\.\d{2}\.\d{4}\b/g, "{{date:today}}");
		return p;
	});
	// a paragraph that is only the person's or the signatory's name (under "Vārds, uzvārds:")
	const signers = reg.company.persons.map((x) => x.person.trim()).filter(Boolean);
	const final = out.map((p) => {
		const f = fold(p);
		if (people.some((n) => fold(n) === f)) return "{{who:name}}";
		const s = reg.company.persons.find((x) => fold(x.person.trim()) === f);
		if (s) return `{{person:${s.role}}}`;
		return p;
	});
	// what still looks specific: register people in any declension (first 4 letters of name and surname), 11-digit numbers, long quotes
	const residue: string[] = [];
	const names = [...reg.specialists.map((x) => x.name), ...signers, ...people];
	for (const p of final) {
		for (const n of names) {
			const [a, ...rest] = n.split(/\s+/);
			const b = rest.at(-1);
			if (!a || !b) continue;
			const re = new RegExp(`\\b${a.slice(0, 4)}\\p{L}*\\s+${b.slice(0, 4)}\\p{L}*`, "iu");
			const m = p.match(re);
			if (m) residue.push(m[0]);
		}
		for (const m of p.matchAll(/\b\d{11}\b/g)) residue.push(m[0]);
		// inflected tender wording a template cannot carry over
		for (const m of p.matchAll(/\b(atklāt\w*\s+konkurs\w*|cenu aptauj\w*|sarunu procedūr\w*|\d\.(?:,\s*\d\.)*\s*(?:un\s+\d\.\s*)?daļ\w*|sert\.\s*nr\.\s*[\d-]+)/gi)) residue.push(m[0]);
	}
	return { template: { id, kind, title: final[0] ?? "", paragraphs: final, source }, residue: [...new Set(residue)] };
}

export interface FillContext {
	reg: Registers;
	req: Requirements;
	builder?: Builder;
	who?: { specialist?: Specialist; name?: string; cert?: string; role?: string };
	today: Date;
}

/** Placeholders → values. Anything that cannot be filled is returned, and no paragraph is produced half-filled. */
export function fillTemplate(t: StatementTemplate, c: FillContext): { paragraphs: string[]; missing: string[] } {
	const missing = new Set<string>();
	const value = (ph: string): string | null => {
		const [kind, ...rest] = ph.split(":");
		const arg = rest.join(":");
		switch (kind) {
			case "company":
				return c.reg.company.fields.find((f) => f.key === arg)?.value ?? null;
			case "person":
				return c.reg.company.persons.find((p) => p.role === arg)?.person ?? null;
			case "builder":
				return c.builder ? (((c.builder as unknown as Record<string, string>)[arg] ?? "").trim() || null) : null;
			case "tender":
				return (c.req.dati as Record<string, { value: string | null }>)[arg]?.value ?? null;
			case "who":
				return arg === "name" ? (c.who?.name ?? c.who?.specialist?.name ?? null) : arg === "cert" ? (c.who?.cert ?? c.who?.specialist?.certificate ?? null) : arg === "role" ? (c.who?.role ?? c.who?.specialist?.field ?? null) : null;
			case "date":
				return arg === "long" ? longDate(c.today) : dmy(c.today);
			default:
				return null;
		}
	};
	const paragraphs = t.paragraphs.map((p) =>
		p.replace(/\{\{([^}]+)\}\}/g, (_m, ph: string) => {
			const v = value(ph);
			if (v === null || v === "") {
				missing.add(ph);
				return `‹${ph}›`;
			}
			return v;
		}),
	);
	return { paragraphs, missing: [...missing] };
}

/** Blocks for write-docx: the first upper-case lines are the title (bold), the rest plain paragraphs. */
export function statementBlocks(paragraphs: string[]): { text: string; bold?: boolean }[] {
	let title = true;
	return paragraphs.map((text) => {
		const upper = text.length > 0 && text === text.toUpperCase() && /\p{L}/u.test(text);
		if (!upper) title = false;
		return title && upper ? { text, bold: true } : { text };
	});
}
