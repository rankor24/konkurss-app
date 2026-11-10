// Phase 9 exact check: every company in a document must carry its own registration number, and a builder's copy
// must not name another builder. Real case that motivated it: a submitted apakšuzņēmēja apliecinājums paired the
// pretendents SIA “FF” with BŪVDIZAINS's reg. Nr. Code only, on the documents' text.
import { readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import type { Finding } from "../../shared/checks.js";
import type { Registers } from "../../shared/registers.js";
import { builderKey, companyMentions, type CompanyMention } from "../library/harvest.js";
import { docxPlainText, readDocx } from "../office.js";

export interface IdentityDoc {
	file: string;
	/** "" = base / our own copy; else the builder whose copy this is */
	builder: string;
	text: string;
}
export interface IdentityProblem {
	file: string;
	kind: "two_numbers" | "our_number" | "our_name_spelling" | "register_number" | "other_builder";
	detail: string;
	quote: string;
}

export function ourIdentity(reg: Registers): { key: string; regNr: string } {
	const name = reg.company.fields.find((f) => /^nosaukums$/i.test(f.key.trim()))?.value ?? "";
	const regNr = reg.company.fields.find((f) => /re[gģ]/i.test(f.key))?.value.match(/\d{11}/)?.[0] ?? "";
	return { key: builderKey(name.replace(/[„“”"]/g, "")), regNr };
}

const sameKey = (a: string, b: string) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));

/** Edit distance, for telling a misspelt name ("BŪVDZIAINS") from a different company. */
export function distance(a: string, b: string): number {
	const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
	for (let j = 1; j <= b.length; j++) d[0][j] = j;
	for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
	return d[a.length][b.length];
}

export function identityProblems(docs: IdentityDoc[], reg: Registers, projectBuilders: string[]): IdentityProblem[] {
	const us = ourIdentity(reg);
	const known = (reg.builders ?? []).filter((b) => /^\d{11}$/.test(b.regNr)).map((b) => ({ key: builderKey(b.name), regNr: b.regNr, name: b.name }));
	const out: IdentityProblem[] = [];
	for (const d of docs) {
		const ms: CompanyMention[] = companyMentions(d.text);
		// 1. one company, two numbers
		const byKey = new Map<string, CompanyMention[]>();
		for (const m of ms) byKey.set(m.key, [...(byKey.get(m.key) ?? []), m]);
		for (const [, list] of byKey) {
			const nums = [...new Set(list.map((m) => m.regNr))];
			if (nums.length > 1) out.push({ file: d.file, kind: "two_numbers", detail: `${list[0].name} norādīts ar ${nums.length} dažādiem reģ. Nr.: ${nums.join(", ")}`, quote: list.map((m) => m.quote).join(" … ") });
		}
		for (const m of ms) {
			// 2. our number on someone else
			if (us.regNr && m.regNr === us.regNr && !sameKey(m.key, us.key)) {
				const typo = us.key.length >= 5 && distance(m.key, us.key) <= 2;
				out.push(typo
					? { file: d.file, kind: "our_name_spelling", detail: `mūsu nosaukums uzrakstīts kļūdaini: ${m.name}`, quote: m.quote }
					: { file: d.file, kind: "our_number", detail: `${m.name} norādīts ar mūsu reģ. Nr. ${us.regNr}`, quote: m.quote });
			}
			// 3. a registered builder with a number that is not its own
			const k = known.find((b) => sameKey(b.key, m.key));
			if (k && k.regNr !== m.regNr && m.regNr !== us.regNr) out.push({ file: d.file, kind: "register_number", detail: `${m.name}: dokumentā ${m.regNr}, būvnieku reģistrā ${k.regNr}`, quote: m.quote });
		}
		// 4. a builder's copy that names another builder of this tender
		if (d.builder) {
			const own = builderKey(d.builder);
			for (const other of projectBuilders.filter((b) => !sameKey(builderKey(b), own))) {
				const ok = builderKey(other);
				const hit = ms.find((m) => sameKey(m.key, ok));
				if (hit) out.push({ file: d.file, kind: "other_builder", detail: `„${d.builder}” kopijā minēts cits būvnieks: ${hit.name}`, quote: hit.quote });
			}
		}
	}
	// the same mistake caught by two rules is one problem for a person
	const seen = new Set<string>();
	return out.filter((p) => {
		const k = `${p.file}|${p.quote}`;
		if (seen.has(k)) return false;
		seen.add(k);
		return true;
	});
}

export function identityFinding(problems: IdentityProblem[], checked: number): Finding {
	if (checked === 0) return { id: "identity", kind: "precīza", status: "na", title: "Uzņēmumu reģ. Nr. pareizība", detail: "Nav neviena Word dokumenta, ko pārbaudīt.", where: [] };
	if (problems.length === 0) return { id: "identity", kind: "precīza", status: "ok", title: "Uzņēmumu reģ. Nr. pareizība", detail: `Pārbaudīti ${checked} dokumenti: katram uzņēmumam ir savs reģ. Nr., būvnieku kopijās citu būvnieku nav.`, where: [] };
	return {
		id: "identity",
		kind: "precīza",
		status: "fail",
		title: "Uzņēmumu reģ. Nr. pareizība",
		detail: `Komisija šādu piedāvājumu var noraidīt vai prasīt precizējumu: ${problems.map((p) => p.detail).join("; ")}.`,
		where: [...new Set(problems.map((p) => p.file))],
		step: "aizpildit",
		fix: "Izlabo veidlapā (vai būvnieku reģistrā) un izveido failu no jauna.",
		cites: problems.slice(0, 6).map((p) => ({ file: p.file, quote: p.quote })),
	};
}

/** The identity check over a folder of Word files (a pack made by hand, or an old submission). Read only. */
export function identityInFolder(dir: string, reg: Registers, projectBuilders: string[], isBuilder: (folder: string) => boolean): { problems: IdentityProblem[]; checked: number } {
	const docs: IdentityDoc[] = [];
	const walk = (d: string, depth: number) => {
		for (const e of readdirSync(d, { withFileTypes: true })) {
			const p = join(d, e.name);
			if (e.isDirectory()) {
				if (depth < 3) walk(p, depth + 1);
				continue;
			}
			if (extname(e.name).toLowerCase() !== ".docx" || e.name.startsWith("~$")) continue;
			try {
				const first = relative(dir, p).split(/[\\/]/);
				docs.push({ file: p, builder: first.length > 1 && isBuilder(first[0]) ? first[0] : "", text: docxPlainText(readDocx(p)) });
			} catch {
				/* unreadable files are not this check's business */
			}
		}
	};
	walk(dir, 0);
	return { problems: identityProblems(docs, reg, projectBuilders), checked: docs.length };
}
