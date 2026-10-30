// Extra grounding checks: a date or a number counts only if it really appears in the quote.
import { normalizeForMatch } from "./grounding.js";

const MONTH_STEMS = ["janvār", "februār", "mart", "aprīl", "maij", "jūnij", "jūlij", "august", "septembr", "oktobr", "novembr", "decembr"];

/** True when the quote contains the date d.m.yyyy in numeric or Latvian-text form ("2026. gada 13. jūlijā"). */
export function dateInQuote(quote: string, y: number, m: number, d: number): boolean {
	const q = normalizeForMatch(quote);
	const dd = String(d).padStart(2, "0");
	const mm = String(m).padStart(2, "0");
	const numeric = [`${d}.${m}.${y}`, `${dd}.${mm}.${y}`, `${y}-${mm}-${dd}`, `${d}.${mm}.${y}`, `${dd}.${m}.${y}`];
	if (numeric.some((n) => new RegExp(`(?<![\\d])${n.replace(/\./g, "\\.")}(?![\\d])`).test(q))) return true;
	const stem = MONTH_STEMS[m - 1];
	const textual = new RegExp(`(?<![\\d])${d}\\.?\\s*${stem}`).test(q) && new RegExp(`(?<![\\d])${y}(?![\\d])`).test(q);
	return textual;
}

/** True when the quote contains the time hh:mm ("10:00", "10.00", "plkst. 10:00"). */
export function timeInQuote(quote: string, hh: number, mm: number): boolean {
	const q = normalizeForMatch(quote);
	const h2 = String(hh).padStart(2, "0");
	const m2 = String(mm).padStart(2, "0");
	return [`${hh}:${m2}`, `${h2}:${m2}`, `${hh}.${m2}`, `${h2}.${m2}`].some((t) => new RegExp(`(?<![\\d])${t.replace(/\./g, "\\.")}(?![\\d])`).test(q));
}

/** True when the number appears in the quote, tolerating "10 000", "10000", "65,00" and "65.0". */
export function numberInQuote(n: number, quote: string): boolean {
	const q = normalizeForMatch(quote).replace(/(\d)[\s ](?=\d{3}(?!\d))/g, "$1");
	const forms = new Set<string>([String(n), n.toFixed(2).replace(".", ","), n.toFixed(2), n.toFixed(1).replace(".", ","), n.toFixed(1)]);
	for (const f of forms) {
		const esc = f.replace(/[.,]/g, (c) => `\\${c}`);
		if (new RegExp(`(?<![\\d.,])${esc}(?![\\d]|[.,]\\d)`).test(q)) return true;
	}
	return false;
}
