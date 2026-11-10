// Phase 8: the tender profile, read in code from the documents' extracted text. Every value is the sentence a rule
// found, so its quote is a real substring of the text; a person confirms. No model is involved.
import type { Cited } from "../shared/state.js";
import { PROCEDURES, type Lot, type OurRole, type Procedure, type Subject, type SubmissionChannel, type TenderProfile } from "../shared/profile.js";

export interface TextDoc {
	file: string;
	text: string;
	/** nolikums / uzaicinājums first: their wording decides */
	priority: number;
}

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** The sentence around a match, trimmed to something a person can read in one line. */
export function sentenceAt(text: string, index: number, max = 260): string {
	const before = text.lastIndexOf("\n", index);
	let start = Math.max(before + 1, 0);
	const dot = text.slice(start, index).search(/[.!?;]\s+(?=[A-ZĀČĒĢĪĶĻŅŠŪŽ„“"])[^.!?;]*$/);
	if (dot >= 0) start += dot + 2;
	let end = text.indexOf("\n", index);
	if (end < 0) end = text.length;
	let s = text.slice(start, end).trim();
	if (s.length > max) {
		const off = Math.max(0, index - start - 80);
		s = s.slice(off, off + max).trim();
	}
	return s.replace(/\s+/g, " ");
}

interface Rule<T> {
	re: RegExp;
	value: T;
}
/**
 * In the highest-priority document that has a match: "earliest" takes the first match in the text (a procedure is
 * named in the title), "rule" takes the first rule that matches anywhere (specific subjects before generic ones).
 */
function firstMatch<T>(docs: TextDoc[], rules: Rule<T>[], mode: "earliest" | "rule" = "earliest"): Cited<T> {
	for (const d of [...docs].sort((a, b) => a.priority - b.priority)) {
		const folded = fold(d.text);
		let best: { at: number; value: T } | null = null;
		for (const r of rules) {
			const m = r.re.exec(folded);
			if (!m) continue;
			if (mode === "rule") {
				best = { at: m.index, value: r.value };
				break;
			}
			if (!best || m.index < best.at) best = { at: m.index, value: r.value };
		}
		if (best) return { value: best.value, status: "model", cite: { file: d.file, quote: sentenceAt(d.text, best.at) }, confirmed: false };
	}
	return { value: null, status: "missing" };
}

const PROC_RULES: Rule<Procedure>[] = [
	// not the regulation "Iepirkuma procedūru un metu konkursu norises kārtība"
	{ re: /(?<!proceduru un )metu konkurs/, value: "Mets" },
	{ re: /visparig(a|as|o) vienosan|partneribas ligum/, value: "Vispārīgā vienošanās" },
	{ re: /sarunu procedur/, value: "Sarunu procedūra" },
	{ re: /slegt(s|a|u) konkurs/, value: "Slēgts konkurss" },
	{ re: /konkursa procedur(a|u) ar sarunam|apspried/, value: "Apspriede" },
	{ re: /atklat(s|a|u) konkurs/, value: "Atklāts konkurss" },
	{ re: /cenu aptauj/, value: "Cenu aptauja" },
	{ re: /tirgus izpet/, value: "Tirgus izpēte" },
	{ re: /(publisko iepirkumu likuma|pil)\s*9\.\s*pant/, value: "9.pants" },
	{ re: /cenu piedavajum\w* pieprasijum|ludzam iesniegt cenu piedavajum/, value: "Neregulēts iepirkums" },
];
const SUBJECT_RULES: Rule<Subject>[] = [
	{ re: /(?<!proceduru un )metu konkurs/, value: "Mets" },
	// "izstrāde, autoruzraudzība un būvdarbi", "izstrāde, būvdarbu veikšana", "izstrāde un būvdarbi" — but not
	// "izstrāde un autoruzraudzība būvdarbu laikā", which every design-only tender says
	{ re: /projekte(t|sana\w*)? un buve|(izstrade|projektesana)(,? (un )?autoruzraudziba)?,? (un )?(buvdarb(?!u laik|u veiksanas laik)|buvniecib(a|as darbi)(?! laik))/, value: "Projektē/Būvē" },
	{ re: /tehniskas apsekosanas atzinum|tehniska apsekosana/, value: "TAA" },
	{ re: /ekspertiz/, value: "Ekspertīze" },
	{ re: /bim (dala|konsultant|informacijas modelesanas pakalpojum)/, value: "BIM daļa" },
	{ re: /projektesan|buvprojekt|buvniecibas ieceres dokumentacij|autoruzraudz/, value: "Projektēšana/Autoruzraudzība" },
];
const SUBMISSION_RULES: Rule<SubmissionChannel>[] = [
	{ re: /deviz/, value: "anonīms" },
	// the offer itself goes by e-mail — not questions, not the key to an encrypted file
	// dates inside the sentence have dots ("2026. gada 11. novembrim plkst. 12.00"), so the window is by length
	{ re: /piedavajum\w*(?:(?!atsleg|parol|jautajum)[^\n]){0,60}(jaiesniedz|iesniedz\w*|iesniegt\w*|nosut\w*)(?:(?!atsleg|parol|jautajum)[^\n]){0,120}(e-pasta adres|e-pastu [\w.+-]+@)/, value: "e-pasts" },
	{ re: /aploksn/, value: "papīrs" },
	{ re: /elektronisko iepirkumu sistem|e-konkursu apaksistem|\beis\b/, value: "EIS" },
];

/** "Iepirkuma priekšmeta 2.daļas prasības, 1.versija" (EIS folder names) → 2. */
export function lotsFromFolders(names: string[]): Lot[] {
	const seen = new Map<number, string>();
	for (const n of names) {
		// EIS: "Iepirkuma priekšmeta 2.daļas prasības, 1.versija"; by hand: "1.dala", "2. daļa"
		const m = fold(n).match(/prieksmeta\s+(\d+)\.\s*dalas\s+prasibas/) ?? fold(n).trim().match(/^(\d+)\.\s*dala$/);
		if (m && !seen.has(Number(m[1]))) seen.set(Number(m[1]), n);
	}
	return [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([n, folder]) => ({ n, name: { value: `${n}. daļa`, status: "model", cite: { file: folder, quote: folder } }, apply: true }));
}

/** Lot names in the nolikums: "1. daļa – Liepājas Centra sākumskola" (with the quote). */
export function lotNames(docs: TextDoc[], lots: Lot[]): Lot[] {
	return lots.map((l) => {
		for (const d of [...docs].sort((a, b) => a.priority - b.priority)) {
			const re = new RegExp(`(?:^|\\n|\\s)${l.n}\\.\\s*(?:iepirkuma\\s+)?daļa\\s*[:–—-]\\s*[„“"]?([^\\n”"]{5,140})`, "i");
			const m = re.exec(d.text);
			if (m) return { ...l, name: { value: `${l.n}. daļa — ${m[1].trim().replace(/[.;,]$/, "")}`, status: "model", cite: { file: d.file, quote: m[0].trim() } } };
		}
		return l;
	});
}

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;

export function proposeProfile(docs: TextDoc[], folderNames: string[], builders: string[], now = new Date()): TenderProfile {
	const procedure = firstMatch(docs, PROC_RULES);
	const subject = firstMatch(docs, SUBJECT_RULES, "rule");
	const submission = firstMatch(docs, SUBMISSION_RULES, "rule");
	let email: Cited<string> = { value: null, status: "missing" };
	if (submission.value === "e-pasts" && submission.cite) {
		const m = submission.cite.quote.match(EMAIL);
		if (m) email = { value: m[0], status: "model", cite: submission.cite, confirmed: false };
	}
	const role: OurRole = subject.value === "Projektē/Būvē" || builders.length > 0 ? "apaksuznemejs" : "pretendents";
	const ourRole: Cited<OurRole> = subject.value === "Projektē/Būvē" && subject.cite
		? { value: role, status: "model", cite: subject.cite, confirmed: false, note: "Projektē un būvē: parasti projektējam būvniekiem. Ja pretendents esam mēs paši, izvēlies to." }
		: builders.length
			? { value: role, status: "manual", note: `Konkursam pievienoti būvnieki: ${builders.join(", ")}.` }
			: { value: role, status: "manual", note: "Dokumentos nav projektē un būvē pazīmju — pieņemts, ka pretendents esam mēs." };
	const lots = lotNames(docs, lotsFromFolders(folderNames));
	return { procedure, subject, ourRole, lots, submission, email, readAt: now.toISOString(), confirmed: false };
}

export const isProcedure = (v: string): v is Procedure => (PROCEDURES as readonly string[]).includes(v);
