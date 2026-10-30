// Types of the permanent registers, shared by main process and renderer.
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
}
export interface RegObject {
	id: string;
	name: string;
	fields: KV[];
	evidence: Evidence[];
}
export interface Registers {
	company: Company;
	specialists: Specialist[];
	gaps: { field: string; note: string }[];
	objects: RegObject[];
}
export interface Expiry {
	id: string;
	name: string;
	validUntil: string;
	status: "expired" | "soon";
	days: number;
}
