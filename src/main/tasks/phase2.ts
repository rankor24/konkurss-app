// Schemas, instructions and grounding for phase 2 model tasks. Pure functions — no engine calls here.
import { z } from "zod";
import type { Cited, Criterion, Deadline, EditionChange, ExperienceReq, QaItem, RequiredDoc, Requirements, SpecialistReq } from "../../shared/state.js";
import { parseDeadline } from "../../shared/format.js";
import { dateInQuote, numberInQuote, timeInQuote } from "./grounding-extra.js";
import { locateQuote, NOT_FOUND_NOTE, toCited, UNGROUNDED_NOTE, type DocInput } from "./grounding.js";
import { changedWords } from "../versions/diff.js";

const q = z.string().nullable();
/** One value as the model returns it. */
const cs = z.object({ value: z.string().nullable(), quote: q, file: q });
const cn = z.object({ value: z.number().nullable(), quote: q, file: q });

export const QUOTE_RULES = [
	"Katram atradumam pievieno burtisku citātu no dokumenta (rindu vai teikumu, kur tas rakstīts). Ja vērtība ir skaitlis vai datums, tam jābūt iekļautam pašā citātā.",
	"Tabulās citē visu rindu — šūnas ir atdalītas ar \" | \".",
].join("\n");

// ---------- classify edition changes ----------
export const classifySchema = z.object({ items: z.array(z.object({ i: z.number(), impact: z.enum(["kriterijs", "prasiba", "redakcionala"]) })) });
export const CLASSIFY_HINT = `{"items": [{"i": 1, "impact": "kriterijs" | "prasiba" | "redakcionala"}]}`;
export const CLASSIFY_INSTRUCTIONS = [
	"Zemāk ir numurētas izmaiņas starp nolikuma sākotnējo un grozīto redakciju (BIJA → KĻUVA).",
	"Katrai izmaiņai nosaki ietekmi:",
	'- "kriterijs" — maina piedāvājumu vērtēšanas kritēriju, punktus vai to aprēķinu;',
	'- "prasiba" — maina prasību pretendentam (speciālisti, pieredze, dokumenti, summas, termiņi, veidlapu saturs);',
	'- "redakcionala" — tikai redakcionāls labojums, datuma/protokola atzīme vai formulējums bez satura maiņas.',
	"Atbildi par katru numuru.",
].join("\n");

export function classifyPrompt(changes: { before: string; after: string }[]): string {
	// Long table rows differ in a few words at the end; show those words (with context), not the row's start.
	const view = (c: { before: string; after: string }) => (c.before.length > 400 || c.after.length > 400 ? changedWords(c.before, c.after, 14) : c);
	return changes
		.map((c, n) => {
			const v = view(c);
			return `### ${n + 1}\nBIJA: ${v.before.slice(0, 900) || "(nebija)"}\nKĻUVA: ${v.after.slice(0, 900) || "(izņemts)"}`;
		})
		.join("\n\n");
}

export function applyClassification(changes: EditionChange[], res: z.infer<typeof classifySchema>): EditionChange[] {
	const by = new Map(res.items.map((it) => [it.i, it.impact]));
	return changes.map((c, n) => {
		const impact = by.get(n + 1);
		// a person's confirmed choice is never overwritten
		if (c.confirmed && c.impactBy === "manual") return c;
		return impact ? { ...c, impact, impactBy: "model", confirmed: false } : c;
	});
}

// ---------- Q&A ----------
export const qaSchema = z.object({
	items: z.array(
		z.object({
			nr: z.string(),
			question_quote: q,
			answer_quote: q,
			file: q,
			impact: z.enum(["maina_apjomu", "maina_kriteriju", "maina_prasibu", "skaidro"]),
		}),
	),
});
export const QA_HINT = `{"items": [{"nr": "1", "question_quote": "burtisks citāts no jautājuma", "answer_quote": "burtisks citāts no atbildes", "file": "faila nosaukums", "impact": "maina_apjomu" | "maina_kriteriju" | "maina_prasibu" | "skaidro"}]}`;
export const QA_INSTRUCTIONS = [
	"Dokumentos ir komisijas atbildes uz ieinteresēto piegādātāju jautājumiem. Izraksti katru jautājumu–atbildi pāri.",
	'"nr" ir jautājuma numurs dokumentā (ja nav numura — kārtas numurs).',
	"Ietekme: maina_apjomu (maina darba apjomu), maina_kriteriju (maina vērtēšanas kritērijus), maina_prasibu (maina prasību pretendentam), skaidro (tikai paskaidro, nemaina).",
	"Citātiem jābūt burtiskiem fragmentiem (10–300 zīmes) no jautājuma un no atbildes.",
].join("\n");

export function groundQa(res: z.infer<typeof qaSchema>, docs: DocInput[]): { items: QaItem[]; rejected: number } {
	const items: QaItem[] = [];
	let rejected = 0;
	for (const it of res.items) {
		const cq = it.question_quote ? locateQuote(it.question_quote, docs, it.file ?? undefined) : null;
		if (!cq) {
			rejected++;
			continue;
		}
		const ca = it.answer_quote ? locateQuote(it.answer_quote, docs, cq.file) : null;
		items.push({ nr: it.nr, question: cq.quote, answer: ca?.quote ?? "", file: cq.file, impact: it.impact, confirmed: false });
	}
	return { items, rejected };
}

// ---------- deadline ----------
export const deadlineSchema = z.object({ date: cs, time: cs, source: z.enum(["iub", "eis", "nolikums"]).nullable() });
export const DEADLINE_HINT = `{"date": {"value": "DD.MM.GGGG", "quote": "…", "file": "…"}, "time": {"value": "HH:MM", "quote": "…", "file": "…"}, "source": "iub" | "eis" | "nolikums" | null}`;
export const DEADLINE_INSTRUCTIONS = [
	"Atrodi piedāvājumu iesniegšanas termiņu (pēdējo datumu un laiku, līdz kuram jāiesniedz piedāvājums).",
	'"date" formātā DD.MM.GGGG, "time" formātā HH:MM. Ja laika nav, "time": null.',
	'"source": "iub" ja termiņš ir IUB paziņojumā par līgumu, "eis" ja EIS kartītē, "nolikums" ja nolikumā.',
	"Nejauc ar citiem datumiem (jautājumu iesniegšanas termiņu, atbilžu termiņu, līguma slēgšanas termiņu).",
	"Ja termiņš dokumentos nav minēts, atbildi ar null — nemini datumu pēc atmiņas.",
].join("\n");
export const DEADLINE_INSTRUCTIONS_2 = [
	"Meklē tikai vienu faktu: līdz kuram brīdim (datums un pulksten) pretendentam jāiesniedz piedāvājums EIS.",
	'Atbildi ar "date" (DD.MM.GGGG) un "time" (HH:MM), katram ar burtisku citātu no dokumenta. Citus datumus ignorē.',
	'"source": iub / eis / nolikums — kur termiņš rakstīts. Ja nav rakstīts nekur, liec null vērtības.',
].join("\n");

export function groundDeadline(res: z.infer<typeof deadlineSchema>, docs: DocInput[]): Deadline {
	const ground = (raw: z.infer<typeof cs>, check: (v: string, quote: string) => boolean): Cited<string> => {
		const c = toCited<string>(raw, docs);
		if (c.status === "model" && c.value && !check(c.value, c.cite!.quote)) {
			return { value: null, status: "missing", note: "datums/laiks nav citātā — citāts neatbilst vērtībai" };
		}
		return c;
	};
	const date = ground(res.date, (v, quote) => {
		const d = parseDeadline(v);
		return !!d && dateInQuote(quote, d.getFullYear(), d.getMonth() + 1, d.getDate());
	});
	const time = ground(res.time, (v, quote) => {
		const m = v.match(/^(\d{1,2})[:.](\d{2})$/);
		return !!m && timeInQuote(quote, Number(m[1]), Number(m[2]));
	});
	return { date, time, source: date.value ? res.source : null };
}

// ---------- requirements ----------
const itemCite = { quote: q, file: q };

export const datiSchema = z.object({ purchaser: cs, id: cs, subject: cs, contractType: cs });
export const DATI_HINT = `{"purchaser": {"value": "…", "quote": "…", "file": "…"}, "id": {…}, "subject": {…}, "contractType": {…}}`;
export const DATI_INSTRUCTIONS = [
	"Izraksti konkursa pamatdatus: pasūtītājs (iepirkuma komisijas izveidotājs), iepirkuma identifikācijas numurs, iepirkuma priekšmets, līguma veids (piem. projektēšana un autoruzraudzība / projektē un būvē).",
	QUOTE_RULES,
].join("\n");

export const dokumentiSchema = z.object({ items: z.array(z.object({ name: z.string(), mandatory: z.boolean(), condition: q, ...itemCite })) });
export const DOKUMENTI_HINT = `{"items": [{"name": "Pieteikums dalībai", "mandatory": true, "condition": "ja … (vai null)", "quote": "…", "file": "…"}]}`;
export const DOKUMENTI_INSTRUCTIONS = [
	"Izraksti visus dokumentus, kas pretendentam jāiesniedz kopā ar piedāvājumu (pieteikums, kvalifikācijas dokumenti, finanšu piedāvājums, tehniskais piedāvājums, apliecinājumi, veidlapas u.c.).",
	'"mandatory": true, ja obligāts visiem; false, ja iesniedzams tikai noteiktos gadījumos — tad "condition" apraksta nosacījumu.',
	QUOTE_RULES,
].join("\n");

export const pieredzeSchema = z.object({ items: z.array(z.object({ text: z.string(), count: z.number().nullable(), periodYears: z.number().nullable(), objectType: q, ...itemCite })) });
export const PIEREDZE_HINT = `{"items": [{"text": "īss prasības apraksts", "count": 1, "periodYears": 3, "objectType": "…", "quote": "…", "file": "…"}]}`;
export const PIEREDZE_INSTRUCTIONS = [
	"Izraksti prasības par PRETENDENTA (uzņēmuma) pieredzi kvalifikācijai: cik objektu, kāds periods (gadi), kāda veida objekti. Speciālistu pieredzi un vērtēšanas kritērijus šeit neiekļauj.",
	"Ja skaitļa vai perioda nav — null.",
	QUOTE_RULES,
].join("\n");

export const specialistiSchema = z.object({ items: z.array(z.object({ field: z.string(), certificate: q, mandatory: z.boolean(), ...itemCite })) });
export const SPECIALISTI_HINT = `{"items": [{"field": "Atbildīgais būvprojekta vadītājs", "certificate": "kāds sertifikāts vajadzīgs", "mandatory": true, "quote": "…", "file": "…"}]}`;
export const SPECIALISTI_INSTRUCTIONS = [
	"Izraksti visus speciālistus, kas pretendentam jāpiesaista (joma / amats un prasītais sertifikāts). Katru jomu kā atsevišķu rindu — arī tad, ja tās uzskaitītas vienā teikumā.",
	"Pārbaudi arī nolikuma veidlapas (kvalifikācijas tabulu): ja tur ir vairāk jomu nekā pamatprasībās, iekļauj visas.",
	QUOTE_RULES,
].join("\n");

export const vertesanaSchema = z.object({ items: z.array(z.object({ name: z.string(), points: z.number().nullable(), formula: q, objectsNeeded: z.number().nullable(), ...itemCite })) });
export const VERTESANA_HINT = `{"items": [{"name": "Piedāvājuma cena", "points": 65, "formula": "kā aprēķina punktus", "objectsNeeded": null, "quote": "visa tabulas rinda ar punktu skaitu", "file": "…"}]}`;
export const VERTESANA_INSTRUCTIONS = [
	"Izraksti saimnieciski izdevīgākā piedāvājuma vērtēšanas kritērijus: nosaukums, maksimālais punktu skaits, kā punktus aprēķina, un cik objektu (pieredzes vienību) vajag, ja kritērijs to prasa.",
	"Ņem vērā grozījumu redakciju un komisijas atbildes, ja tās maina kritērijus.",
	"Citātam jābūt visai kritērija rindai tā, lai tajā redzams punktu skaits.",
	QUOTE_RULES,
].join("\n");
export const VERTESANA_INSTRUCTIONS_2 = [
	"Atrodi nolikumā tabulu vai sarakstu, kur noteikti piedāvājumu vērtēšanas kritēriji ar punktiem. Katram kritērijam: nosaukums, maksimālie punkti, aprēķina kārtība, nepieciešamais objektu skaits (ja ir).",
	"Pārbaudi grozījumus un komisijas atbildes. Citē visu kritērija rindu, kur redzami punkti.",
].join("\n");

export const apaksSchema = z.object({ threshold: cn, espd: cs });
export const APAKS_HINT = `{"threshold": {"value": 10000, "quote": "…", "file": "…"}, "espd": {"value": "ko prasa par ESPD/EVIPD", "quote": "…", "file": "…"}}`;
export const APAKS_INSTRUCTIONS = [
	"Atrodi: (1) apakšuzņēmēju slieksni — no kādas darbu vērtības (EUR) pretendentam jānorāda apakšuzņēmēji un jāiesniedz to apliecinājumi; (2) ko nolikums prasa par ESPD / EVIPD.",
	"Slieksni dod kā skaitli EUR bez atstarpēm. Ja dokumentos sliekšņa nav — null.",
	QUOTE_RULES,
].join("\n");
export const APAKS_INSTRUCTIONS_2 = [
	"Meklē vārdus „apakšuzņēmēj” un „ESPD”/„EVIPD”. Kāda ir darbu vērtība (EUR), no kuras jānorāda apakšuzņēmēji? Ko prasa par ESPD?",
	"Ja slieksnis nav minēts — null. Atbildi ar burtisku citātu.",
].join("\n");

// ----- grounding of lists: one verified quote per item, shared by its fields -----
export interface Grounded<T> {
	items: T[];
	rejected: number;
}

function itemCiteOf(quote: string | null, file: string | null, docs: DocInput[]) {
	return quote ? locateQuote(quote, docs, file ?? undefined) : null;
}
const field = <T>(value: T | null, cite: { file: string; quote: string }): Cited<T> =>
	value === null || value === undefined || (value as unknown) === "" ? { value: null, status: "missing", note: NOT_FOUND_NOTE } : { value, status: "model", cite };
const numField = (value: number | null, cite: { file: string; quote: string }): Cited<number> =>
	value === null ? { value: null, status: "missing", note: NOT_FOUND_NOTE } : numberInQuote(value, cite.quote) ? { value, status: "model", cite } : { value: null, status: "missing", note: "skaitlis nav citātā — jāaizpilda pašam" };

export function groundDati(res: z.infer<typeof datiSchema>, docs: DocInput[]): Requirements["dati"] {
	return { purchaser: toCited(res.purchaser, docs), id: toCited(res.id, docs), subject: toCited(res.subject, docs), contractType: toCited(res.contractType, docs) };
}

export function groundDokumenti(res: z.infer<typeof dokumentiSchema>, docs: DocInput[]): Grounded<RequiredDoc> {
	const items: RequiredDoc[] = [];
	let rejected = 0;
	for (const it of res.items) {
		const c = itemCiteOf(it.quote, it.file, docs);
		if (!c) rejected++;
		else items.push({ name: field(it.name, c), mandatory: it.mandatory, condition: it.condition ?? undefined });
	}
	return { items, rejected };
}

export function groundPieredze(res: z.infer<typeof pieredzeSchema>, docs: DocInput[]): Grounded<ExperienceReq> {
	const items: ExperienceReq[] = [];
	let rejected = 0;
	for (const it of res.items) {
		const c = itemCiteOf(it.quote, it.file, docs);
		if (!c) rejected++;
		else items.push({ text: field(it.text, c), count: numField(it.count, c), periodYears: numField(it.periodYears, c), objectType: field(it.objectType, c) });
	}
	return { items, rejected };
}

export function groundSpecialisti(res: z.infer<typeof specialistiSchema>, docs: DocInput[]): Grounded<SpecialistReq> {
	const items: SpecialistReq[] = [];
	let rejected = 0;
	for (const it of res.items) {
		const c = itemCiteOf(it.quote, it.file, docs);
		if (!c) rejected++;
		else items.push({ field: field(it.field, c), certificate: field(it.certificate, c), mandatory: it.mandatory });
	}
	return { items, rejected };
}

export function groundVertesana(res: z.infer<typeof vertesanaSchema>, docs: DocInput[]): Grounded<Criterion> {
	const items: Criterion[] = [];
	let rejected = 0;
	for (const it of res.items) {
		const c = itemCiteOf(it.quote, it.file, docs);
		if (!c) rejected++;
		else items.push({ name: field(it.name, c), points: numField(it.points, c), formula: field(it.formula, c), objectsNeeded: it.objectsNeeded });
	}
	return { items, rejected };
}

export function groundApaks(res: z.infer<typeof apaksSchema>, docs: DocInput[]): Requirements["apaksuznemeji"] {
	const thr = toCited<number>(res.threshold, docs);
	const checked = thr.status === "model" && thr.value !== null && !numberInQuote(thr.value, thr.cite!.quote) ? ({ value: null, status: "missing", note: "skaitlis nav citātā — jāaizpilda pašam" } as Cited<number>) : thr;
	return { threshold: checked, espd: toCited(res.espd, docs) };
}

export { UNGROUNDED_NOTE };

// ----- code-only checks -----
/** Sum of criterion points; null when any points value is unknown. */
export function criteriaSum(items: Criterion[]): { sum: number; complete: boolean } {
	let sum = 0;
	let complete = items.length > 0;
	for (const c of items) {
		if (c.points.value === null) complete = false;
		else sum += c.points.value;
	}
	return { sum, complete };
}

const normName = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/** D6: compare two independent readings of the criteria list; mark disagreements on the first reading. */
export function mergeCriteria(first: Criterion[], second: Criterion[]): Criterion[] {
	return first.map((c) => {
		const mate = second.find((s) => normName(s.name.value ?? "") === normName(c.name.value ?? ""));
		if (!mate) return { ...c, name: { ...c.name, conflict: { value: null, cite: undefined } } };
		if (c.points.value !== null && mate.points.value !== null && c.points.value !== mate.points.value) {
			return { ...c, points: { ...c.points, conflict: { value: mate.points.value, cite: mate.points.cite } } };
		}
		if (c.points.value === null && mate.points.value !== null) return { ...c, points: { ...mate.points, conflict: { value: null } } };
		return c;
	});
}
