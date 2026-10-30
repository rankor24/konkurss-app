// Guesses where a file belongs and what kind of document it is, from its path alone.
// The person can always correct the kind; the correction wins (kindSetByUser).
// Patterns come from the real tender folders (NVA 2025/122, VUGD 2, LRS, Salacgrīva).
import type { DocKind, Where } from "./state.js";

const norm = (s: string) =>
	s
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[\\/]+/g, "/")
		.replace(/ +/g, "_");

/** Order matters: the first match wins, most specific first. */
const KIND_RULES: [RegExp, DocKind][] = [
	[/vertesanas_?kriterij.*(bip|bim_?isten)|bip.*vertesanas/, "bip_kriteriji"],
	[/paraugmodel.*vertesanas|paraugmodelu_?vertesanas/, "paraugmodelu_kriteriji"],
	[/paraugmodel.*prasib/, "paraugmodelu_prasibas"],
	[/atbildibas_?matric/, "matrica"],
	[/pirms_?(liguma|kontrakta)_?bip|_bip(_|\.)|bim_?istenosanas_?plan/, "bip_veidne"],
	[/(^|[_ .-])pip([_ .-]|$)|bim_?prasib|pasutitaja_?bim/, "pip"],
	[/grozij|groz_\d|_groz/, "grozijumi"],
	[/jautajum|atbild(e|es)_?uz|visiem_?ieinteres|skaidrojum/, "qa"],
	[/pazinojums|(^|_)iub(_|\.|$)/, "iub"],
	[/projektesanas_?uzdevum|^pu$/, "pu"],
	[/tehniska.?specifikacij|tehniskas.?specifikacijas|^ts_\d/, "tehniska_specifikacija"],
	[/buvatlauj/, "buvatlauja"],
	[/tehniskie_?noteikumi/, "tehniskie_noteikumi"],
	[/nolikum|nolik_/, "nolikums"],
	[/finansu|finanšu|cenu_?piedav/, "finansu"],
	[/kvalifikacij|specialistu_?sarakst/, "kvalifikacija"],
	[/pieteikum/, "pieteikums"],
	[/saimnieciski|vertesanas_?veidlap|bpv_?pieredz|pieredz/, "vertesanas_veidlapa"],
	[/tehniskais_?piedav|tehn\.? ?piedav/, "tehniskais_piedavajums"],
	[/apliecinajum/, "apliecinajums"],
	[/ligum/, "ligums"],
	[/atsauksm/, "atsauksme"],
	[/energosert|(^|[_ ])een[_ .]|energoefektiv.*sertif|ekspluatacijas_?energ/, "energosertifikats"],
];

export function guessKind(rel: string): DocKind {
	// File name first, then the folders from the innermost outwards: in
	// "Projektesanas uzdevums/3.pielikums_Buvatlauja/Dok.edoc" the permit folder decides.
	const segments = norm(rel).split("/").reverse();
	for (const seg of segments) {
		for (const [re, kind] of KIND_RULES) if (re.test(seg)) return kind;
	}
	return "cits";
}

/** Working files: our own extracts, app state, earlier skill output. */
const WORK_DIRS = /(^|\/)(workflow|\.konkurss|extracted|txt)(\/|$)/;

export function guessWhere(rel: string, root: "source" | "output"): Where {
	if (WORK_DIRS.test(norm(rel))) return "darba";
	return root === "source" ? "konkurss" : "piedavajums";
}

/** Extensions the app can turn into text. */
export const READABLE = new Set([".docx", ".edoc", ".pdf", ".xlsx", ".txt", ".md", ".csv"]);
