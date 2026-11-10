// Library v2 types (phase 7): builders, subcontractors, the tender tracker, harvesting proposals, standard statements.
// Shared by main process and renderer. Everything here is read from real office files; nothing is invented.

/** What an evidence file proves. "cits" when the file name does not say. */
export const EVIDENCE_KINDS = {
	atsauksme: "Atsauksme",
	buvatlauja: "Būvatļauja",
	pn_atzime: "Atzīme par projektēšanas nosacījumu izpildi",
	ekspluatacija: "Ekspluatācijas akts",
	izzina: "Izziņa",
	generalplans: "Ģenerālplāns / rasējums",
	energosertifikats: "Energosertifikāts",
	paskaidrojums: "Paskaidrojuma raksts / apliecinājuma karte",
	lemums: "Lēmums",
	pilnvara: "Pilnvara",
	cits: "Cits",
} as const;
export type EvidenceKind = keyof typeof EVIDENCE_KINDS;

/** A company we design for (V2: the pretendents) — the builders of "projektē un būvē" tenders. */
export interface Builder {
	id: string;
	name: string;
	regNr: string;
	address: string;
	/** paraksttiesīgā persona and their title */
	signatory: string;
	signatoryTitle: string;
	contact: string;
	/** submission folders it appears in (harvested), newest first */
	seenIn: string[];
	/** where name/regNr were read from, verbatim */
	cites: { file: string; quote: string }[];
}

/** A design subcontractor (one row group of 00_Specialistu un apaksuznemeju reg..xlsx). */
export interface Subcontractor {
	id: string;
	company: string;
	person: string;
	phone: string;
	email: string;
	/** projekta sadaļas codes or names: "UK", "AVK", "Būvakustika" */
	parts: string[];
	/** the register's +/- marks */
	price: string;
	quality: string;
	terms: string;
	note: string;
	/** "xlsx:<row>" when imported */
	source: string;
}

export type TrackerResult = "uzvara" | "zaudejums" | "parstraukts" | "gaida" | "nav";
export type TrackerDecision = "liekam" | "neinteresē" | "interesē_nav_pieredzes" | "pārtraukts" | "";

/** One row of the office tender tracker (02_Iepirkumi_BD_jauns.xlsx), kept verbatim plus parsed helpers. */
export interface TrackerRow {
	sheet: string;
	row: number;
	title: string;
	work: string;
	purchaser: string;
	/** builders named after the purchaser ("Tukuma novada pašvaldība/BILDBERG/KUUM") */
	builders: string[];
	/** BD summa as written */
	ourAmount: string;
	ourCents: number | null;
	deadline: string | null;
	procedure: string;
	subject: string;
	decision: TrackerDecision;
	submitted: boolean | null;
	result: TrackerResult;
	/** "Cēlonis, komentārs …" and the result column, verbatim */
	comment: string;
	/** winner and their price when the comment names them */
	winner: string | null;
	winnerCents: number | null;
	eisUrl: string | null;
}

/** A group of evidence files from earlier submissions that seem to belong to one object. */
export interface HarvestFile {
	path: string;
	kind: EvidenceKind;
	mtimeMs: number;
	size: number;
}
export interface HarvestFact {
	key: string;
	value: string;
	cite: { file: string; quote: string };
}
export interface HarvestProposal {
	/** normalised object key, stable across runs */
	key: string;
	/** best human name, from the most frequent file stem */
	label: string;
	/** distinct submissions the object's files were used in */
	uses: number;
	tenders: string[];
	/** newest version of each distinct file */
	files: HarvestFile[];
	/** values lifted verbatim from experience-table rows of submitted forms */
	facts: HarvestFact[];
	/** register object this most likely is, by name tokens */
	match: { id: string; name: string } | null;
	decision: "accepted" | "merged" | "ignored" | null;
}

export interface HarvestRun {
	ranAt: string;
	roots: string[];
	submissions: number;
	files: number;
	/** evidence files whose name says nothing about the object (left for a person) */
	unnamed: number;
	proposals: HarvestProposal[];
	builders: Builder[];
}

/** An office standard statement, used only when the tender gives no form of its own. */
export interface StatementTemplate {
	id: string;
	kind: "specialista_apliecinajums" | "apaksuznemeja_apliecinajums" | "ip_neizpausana" | "sankcijas" | "cits";
	title: string;
	/** paragraphs; {{binding}} placeholders use the closed binding vocabulary, plus {{who:…}} for the person or firm */
	paragraphs: string[];
	/** the submitted file the wording was taken from */
	source: string;
}
