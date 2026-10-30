// Result of the leak check on a finished document.
export interface TermHit {
	file: string;
	term: string | null;
	context: string;
}
export interface LeakReport {
	clean: boolean;
	foreign: TermHit[];
	notes: TermHit[];
	unreadable: TermHit[];
}
