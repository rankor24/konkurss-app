// Detects the tender type (V1/V2/V3) from the extracted documents and stores it with its quote.
import type { Cited, Variant } from "../../shared/state.js";
import type { Project } from "../../shared/types.js";
import type { Engine, RunOptions } from "../engines/types.js";
import { loadState, updateState } from "../project-state.js";
import { docsByKind, excerpt } from "./docs.js";
import { runModelTask } from "./runner.js";
import { groundVariant, VARIANT_INSTRUCTIONS, VARIANT_KEYWORDS, VARIANT_SCHEMA_HINT, variantSchema } from "./variant.js";

export type VariantOutcome = { ok: true; variant: Cited<Variant>; engine: string } | { ok: false; error: string };

export async function detectVariant(p: Project, engine: Engine, base: Omit<RunOptions, "prompt" | "onEvent">): Promise<VariantOutcome> {
	const s = loadState(p.outputDir);
	const docs = docsByKind(p, s, ["tehniska_specifikacija", "nolikums", "pip", "pu"]);
	if (docs.length === 0) return { ok: false, error: "Vispirms nolasi dokumentu tekstu (1. Dokumenti)." };
	const r = await runModelTask({
		engine,
		base,
		instructions: VARIANT_INSTRUCTIONS,
		schemaHint: VARIANT_SCHEMA_HINT,
		schema: variantSchema,
		// the model sees relevant excerpts; the quote is then checked against the FULL text below
		docs: docs.map((d) => excerpt(d, VARIANT_KEYWORDS)),
	});
	if (!r.ok) return { ok: false, error: r.error };
	const variant = groundVariant(r.data, docs);
	// one atomic write: a failed task above never reaches this line
	updateState(p.outputDir, (st) => void (st.variant = variant));
	return { ok: true, variant, engine: r.engine };
}
