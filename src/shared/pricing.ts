// Phase 11: the price sheet per design part (marka), shaped like the office's BD_P_*.xlsx offers. Shared types.
export interface Rate {
	role: string;
	/** EUR per hour, as typed */
	eurPerHour: string;
}

export interface PriceLine {
	id: string;
	/** "AR", "BK", "AVK-A" … ("" for lines like Būvprojekta vadība) */
	marka: string;
	name: string;
	section: string;
	/** "BŪVDIZAINS" for our own work, else the subcontractor */
	by: string;
	/** our own work: hours per role (role names as in rates) */
	hours: Record<string, string>;
	/** a subcontractor's quote, or a direct amount (EUR without VAT) */
	direct: string;
	/** "1.15" */
	markup: string;
	/** "-" in the sheet: not in the offer */
	included: boolean;
	/** autoruzraudzība — totalled apart */
	au: boolean;
	/** the subcontractor's offer file (Apaksnieki\…pdf) */
	quoteFile?: string;
	/** the line total as the source sheet had it, when it is not direct × markup — kept, and shown to a person */
	override?: string;
	note?: string;
}

export interface PriceSheet {
	source: string | null;
	rates: Rate[];
	lines: PriceLine[];
}

export const emptyPriceSheet = (): PriceSheet => ({ source: null, rates: [], lines: [] });
