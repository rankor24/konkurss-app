// Per-tender state, stored in <output>\.konkurss\project.json (prices in finanses.json).
// Shared by main process and renderer. Every model-derived value is a `Cited`.

import type { ExtraSource, SourcePage } from "./sources.js";

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
	/** rows only in the distributed form */
	extraLabels?: string[];
	equal: boolean;
}

export interface Versions {
	/** files chosen as the two editions, as "root:rel" */
	originalFile?: string;
	amendedFile?: string;
	diffedAt?: string;
	qaReadAt?: string;
	templatesComparedAt?: string;
	inForce: "original" | "amended" | null;
	changes: EditionChange[];
	qa: QaItem[];
	templates: TemplateDiff[];
}

export interface Deadline {
	date: Cited<string>;
	time: Cited<string>;
	source: "iub" | "eis" | "nolikums" | "manual" | null;
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
	/** what experience the tender asks of this specialist (older saved states have none) */
	experience?: Cited<string>;
	count?: Cited<number>;
	periodYears?: Cited<number>;
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

export type BlockId = "dati" | "dokumenti" | "pieredze" | "specialisti" | "vertesana" | "apaksuznemeji" | "apsekosana" | "nodrosinajums" | "izpilde" | "finanses" | "tehnisks" | "apliecinajumi";

/** The eight things that must be clear before documents are made, in the order they are shown. The rest of the blocks are background. */
export const KEY_BLOCKS = ["pieredze", "specialisti", "apsekosana", "nodrosinajums", "izpilde", "finanses", "tehnisks", "apliecinajumi"] as const;
export const BLOCK_LABELS: Record<BlockId, string> = {
	dati: "Konkursa dati",
	dokumenti: "Kas jāiesniedz",
	pieredze: "Pretendenta pieredze",
	specialisti: "Speciālisti un viņu pieredze",
	vertesana: "Vērtēšana",
	apaksuznemeji: "Apakšuzņēmēji",
	apsekosana: "Apsekošana",
	nodrosinajums: "Nodrošinājums",
	izpilde: "Izpildes termiņš",
	finanses: "Finanšu piedāvājums",
	tehnisks: "Tehniskais piedāvājums",
	apliecinajumi: "Apliecinājumi",
};

export interface Requirements {
	dati: { purchaser: Cited<string>; id: Cited<string>; subject: Cited<string>; contractType: Cited<string> };
	dokumenti: RequiredDoc[];
	pieredze: ExperienceReq[];
	specialisti: SpecialistReq[];
	vertesana: Criterion[];
	apaksuznemeji: { threshold: Cited<number> };
	/** site visit: "Obligāta" / "Nav obligāta" / "Nav paredzēta", and when, where, how to register */
	apsekosana: { status: Cited<string>; details: Cited<string> };
	/** bid security and performance security: amount or %, form, validity */
	nodrosinajums: { offer: Cited<string>; contract: Cited<string> };
	/** how long the work may take, as the tender states it (per stage when it has stages) */
	izpilde: { term: Cited<string> };
	/** which form the price goes into (Word template, Excel estimate …) and what it must contain */
	finanses: { form: Cited<string>; notes: Cited<string> };
	/** parts the technical proposal must contain: apliecinājums, specification answer, time schedule … */
	tehnisks: RequiredDoc[];
	/** apliecinājumi (statements) the tender asks the bidder to sign or attach */
	apliecinajumi: RequiredDoc[];
	confirmed: Partial<Record<BlockId, boolean>>;
	readAt: Partial<Record<BlockId, string>>;
}

/** One line of a roles table (BIP): who does what, for which part. */
export interface RoleRow {
	id: string;
	role: string;
	part: string;
	company: string;
	person: string;
}
/** Design side is ours and shared; the construction side belongs to each builder (V2/V3). */
export interface Roles {
	design: RoleRow[];
	build: Record<string, RoleRow[]>;
}

/** A role the tender asks for, read from the documents with its quote, and the company and person when the document names them. Nobody is suggested from memory or from the register. */
export interface RoleSuggestion {
	id: string;
	role: string;
	/** būvprojekta daļu kodi, only when the quote itself names them */
	part: string;
	/** company and person the document itself names for this role, only when both stand in the quote; otherwise empty */
	company: string;
	person: string;
	/** where the document puts the role; "nav_skaidrs" leaves the choice to the person */
	side: "projektesana" | "buvdarbi" | "nav_skaidrs";
	cite: Citation;
	/** "added" = copied into the roles table, "rejected" = dismissed; both stay dismissed on the next reading */
	decision: "added" | "rejected" | null;
}
export interface RolePicks {
	items: RoleSuggestion[];
	readAt: string;
	/** roles the documents ask for that were already in the table, and quotes the app could not find in the text */
	already: number;
	rejected: number;
}

export type SheetStatus = "source" | "missing" | "na" | "manual";
export interface SheetItem {
	slotId: string;
	kind: "cell" | "section" | "delete";
	label: string;
	heading: string;
	/** where in the template: table cell, or paragraph indexes */
	t?: number;
	r?: number;
	c?: number;
	paragraphs?: number[];
	/** the template's own instruction text, shown next to the proposed value */
	instruction?: string;
	value: string;
	status: SheetStatus;
	cites: Citation[];
	note?: string;
	/** how the value was produced: from code (register/roles), from the tender documents (model), or typed */
	by: "code" | "model" | "manual" | null;
	/** V1 forms: where the value comes from (see v1/bindings.ts) and who chose it */
	binding?: string;
	bindingBy?: "memory" | "model" | "manual";
	/** the person confirmed a model-proposed binding */
	bindingOk?: boolean;
}
/** The value sheet of one document (D5): every slot, its value, where the value came from. */
export interface FillSheet {
	template: string;
	skeleton: string;
	items: SheetItem[];
	inspectedAt: string;
	filledAt?: string;
	/** latest written file per builder ("" = the base copy) */
	outputs: Record<string, string>;
	/** rows to append per table index, when a roles table needs more rows than the template has */
	addRows?: Record<string, number>;
}

/** V1: what the person chose on screens 4 and 5. Ids refer to the registers. */
export interface Choices {
	/** required-specialist index → register specialist id */
	specialists: Record<string, string>;
	/** experience slot id ("company:0", "bpv:1", "energy:2") → register object ids, in order */
	objects: Record<string, string[]>;
	decision: { apply: "yes" | "no" | null; reason: string };
}
export const emptyChoices = (): Choices => ({ specialists: {}, objects: {}, decision: { apply: null, reason: "" } });

/** D9: the technical proposal is the previous successful text; only tender-specific paragraphs are proposed for change. */
export interface TechChange {
	i: number;
	before: string;
	after: string;
	why: string;
	cites: Citation[];
	decision: "accept" | "reject" | null;
}
export interface TechState {
	/** the boilerplate: an earlier submitted technical proposal, as "root:rel" or an absolute path */
	boilerplate: string;
	changes: TechChange[];
	readAt?: string;
	output?: string;
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
	roles: Roles;
	choices: Choices;
	tech?: TechState;
	proofs?: { collectedAt: string; copied: number; missing: number };
	/** files and folders a person added for the agent of a page */
	sources?: Partial<Record<SourcePage, ExtraSource[]>>;
	/** roles the agent suggested on step 5 */
	rolePicks?: RolePicks;
	/** value sheets by template key ("root:rel") */
	fills: Record<string, FillSheet>;
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
		roles: { design: [], build: {} },
		choices: emptyChoices(),
		fills: {},
		requirements: {
			dati: { purchaser: emptyCited(), id: emptyCited(), subject: emptyCited(), contractType: emptyCited() },
			dokumenti: [],
			pieredze: [],
			specialisti: [],
			vertesana: [],
			apaksuznemeji: { threshold: emptyCited() },
			apsekosana: { status: emptyCited(), details: emptyCited() },
			nodrosinajums: { offer: emptyCited(), contract: emptyCited() },
			izpilde: { term: emptyCited() },
			finanses: { form: emptyCited(), notes: emptyCited() },
			tehnisks: [],
			apliecinajumi: [],
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
