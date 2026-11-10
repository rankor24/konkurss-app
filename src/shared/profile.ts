// Tender profile (phase 8): replaces the single V1/V2/V3 variant with the axes the office actually uses.
// Vocabulary = the columns of 02_Iepirkumi_BD_jauns.xlsx sheet 2026 ("Iepirkuma veids", "Darbu veids").
import type { Cited, StepId, Variant } from "./state.js";

export const PROCEDURES = [
	"Atklāts konkurss",
	"Apspriede",
	"9.pants",
	"Cenu aptauja",
	"Tirgus izpēte",
	"Slēgts konkurss",
	"Sarunu procedūra",
	"Neregulēts iepirkums",
	"Mets",
	"Vispārīgā vienošanās",
] as const;
export type Procedure = (typeof PROCEDURES)[number];

export const SUBJECTS = ["Projektēšana/Autoruzraudzība", "Projektē/Būvē", "BIM daļa", "Ekspertīze", "TAA", "Mets"] as const;
export type Subject = (typeof SUBJECTS)[number];

export const OUR_ROLES = { pretendents: "Mēs esam pretendents", apaksuznemejs: "Projektējam būvniekiem (apakšuzņēmējs)", balstas: "Pretendents balstās uz mūsu spējām" } as const;
export type OurRole = keyof typeof OUR_ROLES;

export const SUBMISSIONS = { EIS: "EIS e-konkursos", "e-pasts": "Pa e-pastu", "papīrs": "Papīra formā / aploksnēs", "anonīms": "Anonīmi ar devīzi (mets)" } as const;
export type SubmissionChannel = keyof typeof SUBMISSIONS;

export interface Lot {
	n: number;
	name: Cited<string>;
	/** do we bid on this daļa */
	apply: boolean;
}

export interface TenderProfile {
	procedure: Cited<Procedure>;
	subject: Cited<Subject>;
	ourRole: Cited<OurRole>;
	lots: Lot[];
	submission: Cited<SubmissionChannel>;
	/** the address the offer is e-mailed to, when the documents say so */
	email: Cited<string>;
	readAt: string;
	confirmed: boolean;
}

/** The old variant, for code that still reads it (BIP, roles). */
export function variantFor(p: Pick<TenderProfile, "subject" | "ourRole">): Variant {
	if (p.subject.value === "BIM daļa") return "V3";
	if (p.subject.value === "Projektē/Būvē" || p.ourRole.value === "apaksuznemejs") return "V2";
	return "V1";
}

/** Steps a profile makes irrelevant; they show ⊘ „neattiecas", never as missing work. */
export function stepsNotApplicable(p: TenderProfile | undefined): StepId[] {
	if (!p?.confirmed) return [];
	const out: StepId[] = [];
	const proc = p.procedure.value;
	// a private price request or market survey has no amendments, Q&A or published template versions
	if (proc === "Neregulēts iepirkums" || proc === "Tirgus izpēte") out.push("versija");
	// nothing is signed electronically when the offer goes on paper in envelopes
	if (p.submission.value === "papīrs" || p.submission.value === "anonīms") out.push("paraksti");
	return out;
}

/**
 * Who receives a pack. Designing for builders: each builder gets its own folder and the base pack is only the
 * template the copies are made from. Otherwise one pack. Daļas do not split a pack (one Bauska pack covered
 * "1., 2. un 3. daļā"); they scope requirements and prices.
 */
export function recipients(p: TenderProfile | undefined, builders: string[]): string[] {
	const forBuilders = p ? p.ourRole.value === "apaksuznemejs" : builders.length > 0;
	return forBuilders && builders.length ? builders.map((b) => `builder:${b}`) : [""];
}
