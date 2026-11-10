// Underscore blanks inside a form's sentences, filled per builder copy. Tender forms name each blank in brackets —
// "________ (norāda pretendenta nosaukumu)", "(norāda pretendenta reģistrācijas numuru)", "(norāda apakšuzņēmēja
// nosaukumu, reģistrācijas numuru un adresi)" — or by the label before it ("Pretendents ____", then "Reģ. Nr. ____").
// A blank is filled only by what its own words ask for; any other blank is left as it is and reported.
import type { DocxEdit } from "../pytools.js";

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export interface BlankValues {
	builderName: string;
	builderRegNr: string;
	/** our company: name, reg. Nr., address — as the register has them */
	ourName: string;
	ourRegNr: string;
	ourAddress: string;
}

export interface BlankResult {
	edits: DocxEdit[];
	/** "p12: pretendenta reģistrācijas numurs → 40103198971" */
	filled: string[];
	/** blanks whose words the code does not fill (left for a person) */
	left: string[];
	/** a blank asks for a value the register does not have */
	missing: string[];
}

type Want = "builderName" | "builderRegNr" | "ourFull" | "ourName" | "ourRegNr" | null;

/** What a bracket hint asks for. */
export function wantOf(hint: string): Want {
	const h = fold(hint);
	const pret = /pretendent/.test(h);
	const sub = /apaksuznemej/.test(h);
	const name = /nosaukum/.test(h);
	const reg = /registracijas numur|reg\.?\s*nr/.test(h);
	if (pret && name && !reg) return "builderName";
	if (pret && reg && !name) return "builderRegNr";
	if (sub && name && reg) return "ourFull";
	if (sub && name) return "ourName";
	if (sub && reg) return "ourRegNr";
	return null;
}

const LABEL_WANT: Record<NonNullable<Want>, string> = { builderName: "pretendenta nosaukums", builderRegNr: "pretendenta reģ. Nr.", ourFull: "apakšuzņēmēja nosaukums, reģ. Nr., adrese", ourName: "apakšuzņēmēja nosaukums", ourRegNr: "apakšuzņēmēja reģ. Nr." };

function valueOf(w: NonNullable<Want>, v: BlankValues): string | null {
	switch (w) {
		case "builderName":
			return v.builderName || null;
		case "builderRegNr":
			return v.builderRegNr || null;
		case "ourName":
			return v.ourName || null;
		case "ourRegNr":
			return v.ourRegNr || null;
		case "ourFull":
			return v.ourName && v.ourRegNr && v.ourAddress ? `${v.ourName}, reģ. nr. ${v.ourRegNr}, ${v.ourAddress}` : null;
	}
}

export function blankEdits(paragraphs: { i: number; text: string }[], v: BlankValues): BlankResult {
	const edits: DocxEdit[] = [];
	const filled: string[] = [];
	const left: string[] = [];
	const missing: string[] = [];
	let afterPretendent = false;
	for (const p of paragraphs) {
		const text = p.text;
		if (!/_{3,}/.test(text)) {
			if (text.trim()) afterPretendent = false;
			continue;
		}
		let out = text;
		let changed = false;
		const need = (w: NonNullable<Want>): string | null => {
			const val = valueOf(w, v);
			if (val === null) missing.push(`p${p.i}: ${LABEL_WANT[w]}`);
			return val;
		};
		// labelled lines: "Pretendents ____", and the "Reģ. Nr. ____" right after it
		const lab = out.match(/^(\s*)(Pretendent\w*)\s+_{3,}\s*$/i);
		const reg = out.match(/^(\s*)(Re[gģ]\.?\s*(?:Nr\.?|numurs))\s*_{3,}\s*$/i);
		if (lab) {
			const val = need("builderName");
			if (val) (out = `${lab[1]}${lab[2]} ${val}`), (changed = true), filled.push(`p${p.i}: pretendenta nosaukums → ${val}`);
			afterPretendent = true;
		} else if (reg && afterPretendent) {
			const val = need("builderRegNr");
			if (val) (out = `${reg[1]}${reg[2]} ${val}`), (changed = true), filled.push(`p${p.i}: pretendenta reģ. Nr. → ${val}`);
			afterPretendent = false;
		} else {
			afterPretendent = false;
			// blanks named by their bracket hint
			out = out.replace(/_{3,}\s*\((?:norāda|norādīt|norada)\s+([^)]*)\)/gi, (m, hint: string) => {
				const w = wantOf(hint);
				if (!w) {
					left.push(`p${p.i}: (${hint.trim()})`);
					return m;
				}
				const val = need(w);
				if (!val) return m;
				changed = true;
				filled.push(`p${p.i}: ${LABEL_WANT[w]} → ${val}`);
				return val;
			});
			if (/_{3,}/.test(out) && !changed) left.push(`p${p.i}: ${text.trim().slice(0, 60)}`);
		}
		if (changed) edits.push({ kind: "paragraph", i: p.i, text: out, status: "source" });
	}
	return { edits, filled, left, missing };
}
