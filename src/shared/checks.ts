// Types of 8. Pārbaude, 9. Paraksti and 10. Rezultāts, shared by main process and renderer.
import type { StepId } from "./state.js";

export type FindingStatus = "fail" | "warn" | "ok" | "na";
export interface Finding {
	id: string;
	kind: "precīza" | "satura";
	status: FindingStatus;
	title: string;
	/** consequence + what was found, plain Latvian */
	detail: string;
	/** where it is visible: document and place */
	where: string[];
	step?: StepId;
	fix?: string;
	/** satura checks: both sides of the comparison, each with a verbatim quote */
	cites?: { file: string; quote: string }[];
}
export interface CheckRun {
	ranAt: string;
	findings: Finding[];
}

/** 9. Paraksti — one row per document that must be signed. */
export interface SignatureRow {
	/** template key ("root:rel") */
	id: string;
	label: string;
	via: "EIS" | "eParaksts" | "nav";
	/** who should sign, by role and, when known, by name */
	expected: { role: string; name: string | null };
	/** the .edoc found or chosen for this row */
	file: string | null;
	/** read from the .edoc (name only — personal codes are never kept) */
	actual: { name: string; time: string | null }[];
	/** typed by a person when the file cannot be read; shown yellow „ievadīts ar roku" */
	manual: { name: string; at: string } | null;
}
export type SignatureVerdict = "ok" | "wrong" | "unsigned" | "manual" | "eis" | "unread";

export interface Closeout {
	submittedAt: string | null;
	result: "uzvara" | "zaudejums" | "gaida" | "atcelts" | null;
	points: { criterion: string; ours: string; best: string }[];
	lessons: string;
	/** deadlines after a win: contract signing, insurance, guarantee … */
	postWin: { what: string; due: string; cite?: { file: string; quote: string } }[];
	/** the register object that was added from this tender, if any */
	addedObjectId: string | null;
}
export const emptyCloseout = (): Closeout => ({ submittedAt: null, result: null, points: [], lessons: "", postWin: [], addedObjectId: null });
