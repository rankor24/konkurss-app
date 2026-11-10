// Portfolio board types (phase 10), shared by the main process and the renderer.
export type BoardStatus = "jauns" | "izverte" | "gatavo" | "iesniegts" | "atteikts";
export const BOARD_STATUS_LABELS: Record<BoardStatus, string> = { jauns: "Jauns", izverte: "Izvērtē", gatavo: "Gatavo", iesniegts: "Iesniegts", atteikts: "Atteikts" };

export interface Deadline {
	date: string;
	time: string | null;
	source: "dokuments" | "uzskaite" | "mapes nosaukums";
	cite: { file: string; quote: string } | null;
}

export interface BoardRow {
	folder: string;
	path: string;
	/** folder name date (YYMMDD → YYYY-MM-DD) — the office names folders by deadline */
	folderDate: string | null;
	code: string;
	title: string;
	deadline: Deadline | null;
	tracker: { sheet: string; row: number; title: string; decision: string; procedure: string; subject: string; work: string; eisUrl: string | null; score: number } | null;
	submission: { files: number; builders: string[] };
	projectId: string | null;
	status: BoardStatus;
	statusBy: "person" | "auto";
	note: string;
	next: string;
	/** rule documents the deadline could not be read from (old .doc, .pdf) */
	unreadable: string[];
	/** other dates found for the deadline (grozījumi move deadlines; people rename folders) */
	conflicts: { date: string; source: Deadline["source"] }[];
}

export interface ManualStatus {
	status: BoardStatus;
	note: string;
	at: string;
}
