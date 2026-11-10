// Pack manifest (phase 8): the single list of what goes into a submission, per recipient — numbered the office way
// ("3_1Atsauksme_Cigorinu 3.edoc"), with who signs each file and how far it is.
import type { Cited } from "./state.js";

export type PackSource = "form" | "generated" | "evidence" | "external" | "manual";
export type PackStatus = "nav" | "melnraksts" | "parakstits" | "gatavs";

export interface PackItem {
	id: string;
	/** "" = the base pack; "builder:<name>" = that builder's folder */
	recipient: string;
	/** "1", "3_0", "3_1" … */
	number: string;
	label: string;
	/** what the tender asks for, with its quote; absent for children (evidence of an experience form) */
	required?: Cited<string>;
	source: PackSource;
	/** template key, specialist id, register object id, or the party that supplies the document */
	ref: string;
	/** file name in the pack, numbering included */
	fileName: string;
	/** our file this item is made from (latest output, evidence original), when there is one */
	from: string | null;
	/** who signs; null = signed by whoever issued it (atsauksme) or not signed */
	signer: string | null;
	status: PackStatus;
	note?: string;
}

export interface PackManifest {
	builtAt: string;
	items: PackItem[];
	/** required documents no item could be made for — they need a person */
	unmatched: string[];
}

export const PACK_SOURCE_LABELS: Record<PackSource, string> = {
	form: "Konkursa veidlapa",
	generated: "Mūsu standarta teksts",
	evidence: "Pierādījums no reģistra",
	external: "Iesniedz cits (būvnieks, partneris)",
	manual: "Jāsagatavo pašai",
};
export const PACK_STATUS_LABELS: Record<PackStatus, string> = { nav: "nav", melnraksts: "melnraksts", parakstits: "parakstīts", gatavs: "gatavs" };

/**
 * Is the pack ready for a person to move into the tender folder? Every item is in the pack folder, everything that
 * needs a signature is signed, nothing is left for a person to make, and the last check has no open error.
 */
export interface Readiness {
	ready: boolean;
	notInPack: number;
	unsigned: number;
	toMake: number;
	checkErrors: number;
	/** the check was never run, or run before the pack changed */
	checkMissing: boolean;
}
export function packReadiness(m: PackManifest, check: { ranAt: string; failsOpen: number } | null): Readiness {
	const notInPack = m.items.filter((i) => i.status === "nav").length;
	const unsigned = m.items.filter((i) => i.status === "melnraksts").length;
	const toMake = m.unmatched.length;
	const checkMissing = !check;
	const checkErrors = check?.failsOpen ?? 0;
	return { ready: m.items.length > 0 && notInPack === 0 && unsigned === 0 && toMake === 0 && !checkMissing && checkErrors === 0, notInPack, unsigned, toMake, checkErrors, checkMissing };
}

export const recipientLabel =(r: string) => (r === "" ? "Pamata pakete" : r.startsWith("builder:") ? r.slice(8) : r);
export const recipientFolder = (r: string) => (r.startsWith("builder:") ? r.slice(8) : "");
