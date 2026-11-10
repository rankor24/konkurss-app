// Types of the permanent registers, shared by main process and renderer.
import type { Builder, EvidenceKind, HarvestRun, StatementTemplate, Subcontractor, TrackerRow } from "./library.js";
export interface KV {
	key: string;
	value: string;
}
export interface Company {
	fields: KV[];
	persons: { role: string; person: string; note: string }[];
	answers: KV[];
}
export interface Specialist {
	id: string;
	name: string;
	field: string;
	certificate: string;
	/** A = our employee · B = employee of a subcontractor · C = person on a separate contract */
	type: "A" | "B" | "C";
	via: string;
	note: string;
	/** certificate valid until, YYYY-MM-DD (or YYYY-MM); BIS is the authority */
	validUntil: string;
}
export interface Evidence {
	label: string;
	path: string;
	/** library v2: what the file proves; absent on evidence entered before v2 */
	kind?: EvidenceKind;
}
export interface RegObject {
	id: string;
	name: string;
	fields: KV[];
	evidence: Evidence[];
	/** library v2: field key → the submitted form cell it was taken from */
	cites?: Record<string, { file: string; quote: string }>;
	/** library v2: harvest key this object was built from or merged with */
	harvestKeys?: string[];
}
export interface Registers {
	company: Company;
	specialists: Specialist[];
	gaps: { field: string; note: string }[];
	objects: RegObject[];
	/** library v2 — absent in registers saved before v2 */
	builders?: Builder[];
	subcontractors?: Subcontractor[];
	tracker?: TrackerRow[];
	statements?: StatementTemplate[];
	/** the last harvesting run with its proposals and decisions */
	harvest?: HarvestRun;
}
export interface Expiry {
	id: string;
	name: string;
	validUntil: string;
	status: "expired" | "soon";
	days: number;
}
