// Extra sources: files or folders a person adds on a page so the agent of that page can look there too.
import type { TextStatus } from "./state.js";

/** The pages that have an agent task reading documents. Each page keeps its own list. */
export type SourcePage = "versija" | "prasibas" | "kas" | "aizpildit" | "parbaude" | "rezultats";

export const SOURCE_PAGES: SourcePage[] = ["versija", "prasibas", "kas", "aizpildit", "parbaude", "rezultats"];

/** What the agent of each page does with the sources, in the words shown above the list. */
export const SOURCE_USE: Record<SourcePage, string> = {
	versija: "Komisijas atbilžu un iesniegšanas termiņa nolasīšanā aģents meklē arī šajos failos.",
	prasibas: "Prasību nolasīšanā (dati, dokumenti, pieredze, speciālisti, vērtēšana) aģents meklē arī šajos failos.",
	kas: "Lomu ieteikumos („Ieteikt lomas no konkursa”) aģents meklē arī šajos failos — piemēram, kolēģa lomu sarakstā vai iepriekšējā projektā.",
	aizpildit: "BIP sadaļu, projekta datu, atbildības matricas LOD un tehniskā piedāvājuma pielāgojumu meklēšanā aģents lasa arī šos failus — piemēram, mūsu iepriekšējo BIP.",
	parbaude: "Tehniskā piedāvājuma salīdzināšanā ar specifikāciju aģents šos failus ņem kā papildu prasību avotu.",
	rezultats: "Pēc uzvaras veicamo darbību meklēšanā aģents lasa arī šos failus.",
};

export const isSourcePage = (x: unknown): x is SourcePage => typeof x === "string" && (SOURCE_PAGES as string[]).includes(x);

export interface SourceFile {
	/** absolute path */
	abs: string;
	/** name shown to the agent and in citations; for a folder, relative to the folder */
	rel: string;
	size: number;
	mtimeMs: number;
	text: TextStatus;
	textNote?: string;
	textChars?: number;
}

export interface ExtraSource {
	id: string;
	/** the file or folder the person chose */
	path: string;
	kind: "file" | "folder";
	/** one line for the agent: what this source is and what to use it for */
	note: string;
	addedAt: string;
	files: SourceFile[];
	/** a folder with more readable files than the app reads */
	truncated?: boolean;
}

/** Most readable files taken from one folder, so a whole archive cannot be chosen by accident. */
export const MAX_SOURCE_FILES = 60;
