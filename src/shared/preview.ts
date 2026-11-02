// The shape of a template as the person sees it on screen 6: the document top to bottom, with the fields marked.
// Values are not in here — they come from the value sheet, so an edit shows at once without reading the file again.
export interface PreviewCell {
	text: string;
	/** the field that fills this cell; absent for the template's own text */
	slotId?: string;
}

export type PreviewBlock =
	| { kind: "text"; text: string; /** 0 = body text, 1–6 = heading level */ level: number }
	| { kind: "slot"; slotId: string }
	| { kind: "table"; t: number; rows: PreviewCell[][] };
