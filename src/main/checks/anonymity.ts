// Phase 12 exact check for design competitions (mets): outside the inner envelope (devīzes atšifrējums, pieteikums,
// CV / qualification) nothing may show who we are — no company name, reg. Nr., e-mail domain or people's names —
// and every document carries one and the same devīze. Code only, on the documents' text. Read only.
import { readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import type { Finding } from "../../shared/checks.js";
import type { Registers } from "../../shared/registers.js";
import { fold } from "../library/harvest.js";
import { docxPlainText, readDocx } from "../office.js";

export interface AnonDoc {
	file: string;
	text: string;
}
export interface AnonProblem {
	file: string;
	kind: "identity" | "devize";
	detail: string;
	quote: string;
}

/** Documents that belong in the inner envelope and may name us. */
export const mayIdentify = (file: string) => /deviz\w*[\s_-]*atsifr|pieteikum|(^|[\s_-])cv([\s_.-]|$)|kvalifik|apliecin|iekseja|iekšēj/i.test(fold(file.split(/[\\/]/).pop() ?? file));

/** What gives us away: our names (with and without diacritics), reg. Nr., web/e-mail domain, people (name + surname stems). */
export function identityTerms(reg: Registers): { label: string; re: RegExp }[] {
	const out: { label: string; re: RegExp }[] = [];
	const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const name = reg.company.fields.find((f) => /^nosaukums$/i.test(f.key.trim()))?.value.replace(/^(SIA|AS)\s*/i, "").replace(/[„“”"]/g, "").trim();
	if (name && name.length >= 4) out.push({ label: name, re: new RegExp(esc(fold(name)), "i") });
	const regNr = reg.company.fields.find((f) => /re[gģ]/i.test(f.key))?.value.match(/\d{11}/)?.[0];
	if (regNr) out.push({ label: regNr, re: new RegExp(regNr) });
	for (const f of reg.company.fields) {
		const d = f.value.match(/@([\w-]+\.[a-z]{2,})/i)?.[1] ?? f.value.match(/\bwww\.([\w-]+\.[a-z]{2,})/i)?.[1];
		if (d) out.push({ label: d, re: new RegExp(esc(fold(d)), "i") });
	}
	const people = [...reg.specialists.map((s) => s.name), ...reg.company.persons.map((p) => p.person)].filter((n) => n.trim().split(/\s+/).length >= 2);
	for (const n of new Set(people)) {
		const parts = fold(n).split(/\s+/);
		// "Andis Kalniņš", "Andi Kalniņu", "A. Kalniņš" — first letters of the name, stem of the surname
		const sur = parts.at(-1)!.slice(0, Math.max(4, parts.at(-1)!.length - 2));
		out.push({ label: n, re: new RegExp(`\\b${esc(parts[0].slice(0, 1))}[a-z]*\\.?\\s+${esc(sur)}[a-z]*\\b`, "i") });
	}
	return out;
}

const DEVIZE = /dev[iī]z\w*[^\n„“"A-Z0-9]{0,12}[„“"]?([A-Z0-9]{3,12})[”"]?|([A-Z0-9]{3,12})\s*\/\s*dev[iī]ze/gi;

export function devizesIn(text: string): string[] {
	const out: string[] = [];
	for (const m of text.matchAll(DEVIZE)) {
		const code = m[1] ?? m[2];
		if (code && /\d/.test(code) && /[A-Z]/i.test(code)) out.push(code.toUpperCase());
	}
	return [...new Set(out)];
}

export function anonymityProblems(docs: AnonDoc[], reg: Registers): { problems: AnonProblem[]; devize: string | null } {
	const terms = identityTerms(reg);
	const problems: AnonProblem[] = [];
	// the devīze: as the atšifrējums (or, failing that, most documents) give it
	const fromKey = docs.filter((d) => /deviz\w*[\s_-]*atsifr/i.test(fold(d.file))).flatMap((d) => devizesIn(d.text));
	const all = docs.flatMap((d) => devizesIn(d.text));
	const counts = new Map<string, number>();
	for (const c of all) counts.set(c, (counts.get(c) ?? 0) + 1);
	const devize = fromKey[0] ?? [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
	for (const d of docs) {
		if (!mayIdentify(d.file)) {
			const f = fold(d.text);
			// one place in the text is one problem, even when two terms match it ("info@buvdizains.lv")
			const spans: [number, number][] = [];
			for (const t of terms) {
				const m = f.match(t.re);
				if (m) {
					const at = m.index ?? 0;
					const end = at + m[0].length;
					if (spans.some(([a, b]) => at < b && end > a)) continue;
					spans.push([at, end]);
					problems.push({ file: d.file, kind: "identity", detail: `anonīmajā daļā redzams: ${t.label}`, quote: d.text.slice(Math.max(0, at - 30), at + m[0].length + 30).replace(/\s+/g, " ").trim() });
				}
			}
		}
		if (devize) for (const c of devizesIn(d.text)) if (c !== devize) problems.push({ file: d.file, kind: "devize", detail: `cita devīze „${c}” (pārējos dokumentos „${devize}”)`, quote: c });
	}
	return { problems, devize };
}

export function anonymityFinding(r: { problems: AnonProblem[]; devize: string | null }, checked: number, unread: string[]): Finding {
	const base = { id: "anonymity", kind: "precīza" as const, title: "Meta anonimitāte un devīze" };
	if (checked === 0) return { ...base, status: "na", detail: "Nav neviena Word dokumenta, ko pārbaudīt.", where: [] };
	if (r.problems.length === 0) return { ...base, status: unread.length ? "warn" : "ok", detail: `Pārbaudīti ${checked} dokumenti; devīze „${r.devize ?? "—"}” visur vienāda, anonīmajā daļā mūs nevar atpazīt.${unread.length ? ` Nav pārbaudīti (nav Word): ${unread.join(", ")} — pārbaudi pati.` : ""}`, where: unread };
	return { ...base, status: "fail", detail: `Žūrija metu var izslēgt, ja autors atpazīstams: ${r.problems.map((p) => p.detail).join("; ")}.`, where: [...new Set(r.problems.map((p) => p.file))], fix: "Izņem mūsu nosaukumu, personas un rekvizītus no visa, kas nav iekšējā aploksnē; devīzei jābūt vienādai.", cites: r.problems.slice(0, 6).map((p) => ({ file: p.file, quote: p.quote })) };
}

/** Over a folder (the pack, or a hand-made IESNIEDZAMIE). Non-Word files are listed as not checked. */
export function anonymityInFolder(dir: string, reg: Registers): { problems: AnonProblem[]; devize: string | null; checked: number; unread: string[] } {
	const docs: AnonDoc[] = [];
	const unread: string[] = [];
	const walk = (d: string, depth: number) => {
		for (const e of readdirSync(d, { withFileTypes: true })) {
			const p = join(d, e.name);
			if (e.isDirectory()) {
				if (depth < 3) walk(p, depth + 1);
				continue;
			}
			if (e.name.startsWith("~$")) continue;
			const rel = relative(dir, p);
			if (extname(e.name).toLowerCase() !== ".docx") {
				if (!mayIdentify(rel)) unread.push(rel);
				continue;
			}
			try {
				docs.push({ file: rel, text: docxPlainText(readDocx(p)) });
			} catch {
				unread.push(rel);
			}
		}
	};
	walk(dir, 0);
	return { ...anonymityProblems(docs, reg), checked: docs.length, unread };
}
