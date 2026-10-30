// 1.7 Konkursa veids (V1/V2/V3) read from the tender documents, with a verified quote.
import { z } from "zod";
import type { Cited, Variant } from "../../shared/state.js";
import { toCited, type DocInput } from "./grounding.js";

export const variantSchema = z.object({
	variant: z.object({
		value: z.enum(["V1", "V2", "V3"]).nullable(),
		quote: z.string().nullable(),
		file: z.string().nullable(),
	}),
	reason: z.string(),
});

export const VARIANT_INSTRUCTIONS = [
	"Nosaki konkursa veidu:",
	"- V1 = projektēšanas (un autoruzraudzības) konkurss, kur pretendents ir projektētājs.",
	'- V2 = "projektē un būvē" (projektēšana un būvdarbi vienā līgumā), pretendents ir būvnieks.',
	"- V3 = mēs gatavojam tikai BIM daļu (BIP, atbildības matrica, paraugmodeļi) citam pretendentam — to no dokumentiem parasti nevar noteikt, tad liec null.",
	"Citātam jābūt teikumam, kas tieši pasaka līguma priekšmetu vai veidu (piem. iepirkuma priekšmets vai PIP tabulas virsraksts \"Līguma veids – …\").",
].join("\n");

/** Lines worth showing the model when deciding the tender type. */
export const VARIANT_KEYWORDS = /projekt[eē]|b[uū]vdarb|l[iī]guma\s+veids|iepirkuma\s+priek|b[uū]vniec|autoruzraudz|pretendent/i;

export const VARIANT_SCHEMA_HINT = `{"variant": {"value": "V1" | "V2" | "V3" | null, "quote": "…", "file": "…"}, "reason": "viens teikums latviski"}`;

export function groundVariant(data: z.infer<typeof variantSchema>, docs: DocInput[]): Cited<Variant> {
	const c = toCited<Variant>(data.variant, docs);
	return { ...c, note: c.status === "model" ? data.reason : c.note };
}
