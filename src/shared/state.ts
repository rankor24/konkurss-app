// Per-tender state, stored in <output>\.konkurss\project.json (prices in finanses.json).
// Shared by main process and renderer. Every model-derived value is a `Cited`.

export type Where = "konkurss" | "piedavajums" | "darba";

export const WHERE_LABELS: Record<Where, string> = {
	konkurss: "Konkursa dokumenti",
	piedavajums: "Mūsu piedāvājums",
	darba: "Darba faili",
};

export const DOC_KINDS = {
	nolikums: "Nolikums",
	grozijumi: "Grozījumi",
	qa: "Komisijas atbilde",
	iub: "IUB paziņojums",
	tehniska_specifikacija: "Tehniskā specifikācija",
	pip: "BIM prasības (PIP)",
	pu: "Projektēšanas uzdevums",
	buvatlauja: "Būvatļauja",
	tehniskie_noteikumi: "Tehniskie noteikumi",
	bip_veidne: "BIP veidne",
	bip_kriteriji: "BIP vērtēšanas kritēriji",
	matrica: "Atbildības matrica",
	paraugmodelu_prasibas: "Paraugmodeļu prasības",
	paraugmodelu_kriteriji: "Paraugmodeļu kritēriji",
	pieteikums: "Pieteikums",
	kvalifikacija: "Kvalifikācijas veidlapa",
	finansu: "Finanšu piedāvājums",
	apliecinajums: "Apliecinājums",
	vertesanas_veidlapa: "Vērtēšanas veidlapa",
	tehniskais_piedavajums: "Tehniskais piedāvājums",
	ligums: "Līguma projekts",
	atsauksme: "Atsauksme",
	energosertifikats: "Energosertifikāts",
	cits: "Cits",
} as const;
export type DocKind = keyof typeof DOC_KINDS;

/** extracted text status */
export type TextStatus = "nav" | "ok" | "tukss" | "kluda" | "neattiecas";

export interface FileEntry {
	/** path relative to its root folder */
	rel: string;
	root: "source" | "output";
	where: Where;
	kind: DocKind;
	kindSetByUser: boolean;
	size: number;
	mtimeMs: number;
	text: TextStatus;
	textNote?: string;
	/** chars of extracted text */
	textChars?: number;
}

/** A verbatim quote from a file, checked in code against the extracted text. */
export interface Citation {
	file: string;
	quote: string;
}

/** model = read by the app with a verified quote · manual = typed by a person · missing = „nav atrasts" */
export interface Cited<T> {
	value: T | null;
	status: "model" | "manual" | "missing";
	cite?: Citation;
	confirmed?: boolean;
	/** second pass (D6) disagreed */
	conflict?: { value: T | null; cite?: Citation };
	note?: string;
}

export type Variant = "V1" | "V2" | "V3";

export interface EditionChange {
	before: string;
	after: string;
	impact: "kriterijs" | "prasiba" | "redakcionala" | null;
	impactBy: "model" | "manual" | null;
	confirmed: boolean;
}

export interface QaItem {
	nr: string;
	question: string;
	answer: string;
	file: string;
	impact: "maina_apjomu" | "maina_kriteriju" | "maina_prasibu" | "skaidro" | null;
	confirmed: boolean;
}

export interface TemplateDiff {
	name: string;
	distributedFile: string;
	embeddedFile: string;
	distributedRows: number;
	embeddedRows: number;
	missingLabels: string[];
	equal: boolean;
}

export interface Versions {
	originalFile?: string;
	amendedFile?: string;
	inForce: "original" | "amended" | null;
	changes: EditionChange[];
	qa: QaItem[];
	templates: TemplateDiff[];
}

export interface Deadline {
	date: Cited<string>;
	time: Cited<string>;
	source: "iub" | "eis" | "manual" | null;
}

export interface RequiredDoc {
	name: Cited<string>;
	mandatory: boolean;
	condition?: string;
}
export interface SpecialistReq {
	field: Cited<string>;
	certificate: Cited<string>;
	mandatory: boolean;
}
export interface Criterion {
	name: Cited<string>;
	points: Cited<number>;
	formula: Cited<string>;
	objectsNeeded: number | null;
}
export interface ExperienceReq {
	text: Cited<string>;
	count: Cited<number>;
	periodYears: Cited<number>;
	objectType: Cited<string>;
}

export type BlockId = "dati" | "dokumenti" | "pieredze" | "specialisti" | "vertesana" | "apaksuznemeji";

export interface Requirements {
	dati: { purchaser: Cited<string>; id: Cited<string>; subject: Cited<string>; contractType: Cited<string> };
	dokumenti: RequiredDoc[];
	pieredze: ExperienceReq[];
	specialisti: SpecialistReq[];
	vertesana: Criterion[];
	apaksuznemeji: { threshold: Cited<number>; espd: Cited<string> };
	confirmed: Partial<Record<BlockId, boolean>>;
	readAt: Partial<Record<BlockId, string>>;
}

export interface ProjectState {
	schema: 1;
	files: FileEntry[];
	scannedAt?: string;
	extractedAt?: string;
	variant: Cited<Variant> | null;
	versions: Versions;
	deadline: Deadline;
	requirements: Requirements;
	/** later phases keep their data under their own keys */
	[extra: string]: unknown;
}

export const emptyCited = <T>(): Cited<T> => ({ value: null, status: "missing" });

export function emptyState(): ProjectState {
	return {
		schema: 1,
		files: [],
		variant: null,
		versions: { inForce: null, changes: [], qa: [], templates: [] },
		deadline: { date: emptyCited(), time: emptyCited(), source: null },
		requirements: {
			dati: { purchaser: emptyCited(), id: emptyCited(), subject: emptyCited(), contractType: emptyCited() },
			dokumenti: [],
			pieredze: [],
			specialisti: [],
			vertesana: [],
			apaksuznemeji: { threshold: emptyCited(), espd: emptyCited() },
			confirmed: {},
			readAt: {},
		},
	};
}

/** The ten work steps of the rail. */
export const STEPS = [
	{ n: 1, id: "dokumenti", label: "Dokumenti" },
	{ n: 2, id: "versija", label: "Kura versija" },
	{ n: 3, id: "prasibas", label: "Ko prasa" },
	{ n: 4, id: "varam", label: "Vai varam" },
	{ n: 5, id: "kas", label: "Kas ko dara" },
	{ n: 6, id: "aizpildit", label: "Aizpildīt" },
	{ n: 7, id: "pieradijumi", label: "Pierādījumi" },
	{ n: 8, id: "parbaude", label: "Pārbaude" },
	{ n: 9, id: "paraksti", label: "Paraksti" },
	{ n: 10, id: "rezultats", label: "Rezultāts" },
] as const;
export type StepId = (typeof STEPS)[number]["id"];
export type StepStatus = "nav" | "proc" | "gatavs" | "problema" | "neattiecas";
export const STEP_ICON: Record<StepStatus, string> = { nav: "○", proc: "◐", gatavs: "●", problema: "⚠", neattiecas: "⊘" };
