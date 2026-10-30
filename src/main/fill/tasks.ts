// Model tasks that propose values for template slots from the tender documents.
// A value stands only with a verified quote; nothing else is ever written as a source-backed fact.
import { z } from "zod";
import type { Citation, SheetItem } from "../../shared/state.js";
import { locateQuote, type DocInput } from "../tasks/grounding.js";

const q = z.string().nullable();

// ---------- cells (project name, purchaser, …) ----------
export const cellsSchema = z.object({ items: z.array(z.object({ id: z.string(), value: q, quote: q, file: q })) });
export const CELLS_HINT = `{"items": [{"id": "c:t0:r0:c1", "value": "…", "quote": "burtisks citāts", "file": "faila nosaukums"}]}`;
export const CELLS_INSTRUCTIONS = [
	"Zemāk ir veidnes lauki (id, nosaukums). Katram laukam atrodi vērtību konkursa dokumentos (nolikums, tehniskā specifikācija, projektēšanas uzdevums, BIM prasības).",
	'Vērtība — tieši tā, kā rakstīts dokumentā (piem., projekta pilns nosaukums, pasūtītāja nosaukums). Pievieno burtisku citātu un faila nosaukumu.',
	'Ja vērtības dokumentos nav, liec "value": null un "quote": null. Neizdomā un neminē pretendenta (izpildītāja) datus — tie nāk no citurienes.',
].join("\n");

export function cellsPrompt(items: SheetItem[]): string {
	return items.map((i) => `- ${i.slotId}: ${i.label}`).join("\n");
}

export function applyCells(items: SheetItem[], res: z.infer<typeof cellsSchema>, docs: DocInput[]): { items: SheetItem[]; rejected: number } {
	const by = new Map(res.items.map((r) => [r.id, r]));
	let rejected = 0;
	const out = items.map((it): SheetItem => {
		const r = by.get(it.slotId);
		if (!r || !r.value) return it;
		const cite = r.quote ? locateQuote(r.quote, docs, r.file ?? undefined) : null;
		if (!cite) {
			rejected++;
			return it;
		}
		return { ...it, value: r.value, status: "source", by: "model", cites: [cite], note: undefined };
	});
	return { items: out, rejected };
}

// ---------- sections (instruction paragraphs) ----------
export const sectionsSchema = z.object({
	items: z.array(z.object({ id: z.string(), text: q, sources: z.array(z.object({ quote: z.string(), file: q })), missing: z.array(z.string()).optional() })),
});
export const SECTIONS_HINT = `{"items": [{"id": "s:p57", "text": "teksts, ko ierakstīt sadaļā", "sources": [{"quote": "burtisks citāts no dokumenta", "file": "faila nosaukums"}], "missing": ["ko pretendentam jāpapildina"]}]}`;
export const SECTIONS_INSTRUCTIONS = [
	"Zemāk ir BIM īstenošanas plāna sadaļas. Katrai: virsraksts un veidnes pamācība (kas jāapraksta).",
	"Sagatavo īsu tekstu (2–6 teikumi vai īss punktu saraksts), kas atbild uz pamācību TIKAI ar informāciju no konkursa dokumentiem (BIM prasības/PIP, tehniskā specifikācija, projektēšanas uzdevums, paraugmodeļu prasības, komisijas atbildes): kas ir prasīts, kādi punkti, skaitļi, formāti, termiņi.",
	"Raksti kā pretendenta apņemšanos ievērot šo prasību (piem. „Tiks nodrošināta atbilstība PIP 5.1. punktam: …”). NEIZDOMĀ pretendenta konkrētos risinājumus, programmatūras nosaukumus, cilvēku vārdus, datumus vai skaitļus, kas dokumentos nav.",
	'Ja pamācība prasa pretendenta specifisku informāciju, kuras dokumentos nav, ieraksti to sarakstā "missing" (īsi: „izmantotā programmatūra un versija”). Ja par sadaļu dokumentos nav nekā — "text": null.',
	'Katram tekstam vismaz viens burtisks citāts "sources" (10–300 zīmes) no dokumenta, uz kuru teksts balstīts, ar faila nosaukumu.',
].join("\n");

// ---------- second pass: sections the first pass left empty ----------
export const FOCUSED_INSTRUCTIONS = [
	SECTIONS_INSTRUCTIONS,
	"ŠĪS SADAĻAS iepriekšējā reizē palika tukšas. Zemāk doti dokumentu FRAGMENTI, kuros minēta katras sadaļas tēma — tie ir atlasīti tieši šīm sadaļām.",
	'Atrodi tajos attiecīgās prasības un uzraksti apņemšanos tās ievērot, atsaucoties uz dokumenta punktu (piem. „Tiks nodrošināta atbilstība PIP 7.3. punktam: …”). "text": null liec TIKAI tad, ja fragmentos par šo tēmu tiešām nav nekā.',
].join("\n");

/** Words of the section's own heading (last path element) that identify its topic: the two longest, as 8-letter stems. */
export function topicStems(item: Pick<SheetItem, "heading" | "label">): string[] {
	const last = (item.heading || item.label).split("›").pop() ?? "";
	const words = last.toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length >= 6);
	return [...new Set(words.sort((a, b) => b.length - a.length).slice(0, 2).map((w) => w.slice(0, 8)))];
}

/** The passages of each document around the topics of these sections, so the model reads a few thousand characters, not a million. */
export function focusedDocs(items: Pick<SheetItem, "heading" | "label">[], docs: DocInput[], excerptFn: (doc: DocInput, re: RegExp) => DocInput): DocInput[] {
	const stems = [...new Set(items.flatMap(topicStems))];
	if (stems.length === 0) return docs;
	const re = new RegExp(stems.join("|"), "i");
	return docs.map((d) => excerptFn(d, re)).filter((d) => d.text.trim().length > 0);
}

export function sectionsPrompt(items: SheetItem[]): string {
	return items.map((i) => `### ${i.slotId}\nVirsraksts: ${i.heading || i.label}\nPamācība: ${(i.instruction ?? "").slice(0, 600)}`).join("\n\n");
}

export function applySections(items: SheetItem[], res: z.infer<typeof sectionsSchema>, docs: DocInput[]): { items: SheetItem[]; rejected: number } {
	const by = new Map(res.items.map((r) => [r.id, r]));
	let rejected = 0;
	const out = items.map((it): SheetItem => {
		const r = by.get(it.slotId);
		if (!r || !r.text) return it;
		const cites: Citation[] = [];
		for (const s of r.sources) {
			const c = locateQuote(s.quote, docs, s.file ?? undefined);
			if (c && !cites.some((x) => x.quote === c.quote)) cites.push(c);
		}
		if (cites.length === 0) {
			rejected++;
			return { ...it, note: "Aģents piedāvāja tekstu, bet citāts dokumentos netika atrasts — teksts nav pieņemts." };
		}
		const missing = (r.missing ?? []).filter(Boolean);
		return { ...it, value: r.text.trim(), status: "source", by: "model", cites, note: missing.length ? `Papildināt: ${missing.join("; ")}.` : undefined };
	});
	return { items: out, rejected };
}

export const chunk = <T>(arr: T[], n: number): T[][] => {
	const out: T[][] = [];
	for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
	return out;
};
