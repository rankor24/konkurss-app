import { test } from "node:test";
import assert from "node:assert/strict";
import { locateQuote, mergeSecondPass, normalizeForMatch, quoteFound, toCited } from "../src/main/tasks/grounding.ts";
import type { Cited } from "../src/shared/state.ts";

const nolikums = {
	file: "NOLIKUMS.docx",
	text: 'Iepirkuma priekšmets: projektēšana un būvdarbu īstenošana.\nSpeciālists | Sertifikāts\nSiltumapgāde | „attiecīgās jomas sertifikāts" | 2.2.5.\nTermiņš — 13.07.2026 plkst. 10:00',
};
const other = { file: "PIP.docx", text: "Līguma veids – Projektē un būvē" };

test("quote found despite table separators, dashes, quote styles and case", () => {
	assert.ok(quoteFound("Siltumapgāde „attiecīgās jomas sertifikāts” 2.2.5.", nolikums.text));
	assert.ok(quoteFound("TERMIŅŠ - 13.07.2026 PLKST. 10:00", nolikums.text));
});

test("a quote that is not in the text is rejected", () => {
	assert.equal(quoteFound("Apakšuzņēmēju slieksnis ir 10 000 EUR", nolikums.text), false);
});

test("too-short quotes are rejected (a single word proves nothing)", () => {
	assert.equal(quoteFound("2.2.5.", nolikums.text), false);
});

test("ellipsis quotes must match each part in order", () => {
	assert.ok(quoteFound("Iepirkuma priekšmets … būvdarbu īstenošana", nolikums.text));
	assert.equal(quoteFound("būvdarbu īstenošana … Iepirkuma priekšmets", nolikums.text), false);
});

test("locateQuote finds the real file even when the model names the wrong one", () => {
	const c = locateQuote("Līguma veids – Projektē un būvē", [nolikums, other], "NOLIKUMS.docx");
	assert.equal(c?.file, "PIP.docx");
});

test("toCited: grounded value is 'model' with the citation", () => {
	const c = toCited({ value: "V2", quote: "Līguma veids – Projektē un būvē", file: "PIP.docx" }, [nolikums, other]);
	assert.equal(c.status, "model");
	assert.equal(c.value, "V2");
	assert.equal(c.cite?.file, "PIP.docx");
});

test("toCited: invented value with a fake quote becomes 'nav atrasts', never a number", () => {
	const c = toCited({ value: 10000, quote: "Apakšuzņēmēju slieksnis ir 10 000 EUR", file: "NOLIKUMS.docx" }, [nolikums]);
	assert.equal(c.status, "missing");
	assert.equal(c.value, null);
	assert.match(c.note ?? "", /neatrada/);
});

test("toCited: value without any quote is rejected", () => {
	assert.equal(toCited({ value: "V1", quote: null }, [nolikums]).status, "missing");
});

test("toCited: null means not found in the documents", () => {
	const c = toCited({ value: null, quote: null }, [nolikums]);
	assert.equal(c.status, "missing");
	assert.match(c.note ?? "", /nav atrasts/);
});

const model = (v: string | null): Cited<string> => ({ value: v, status: v ? "model" : "missing", cite: v ? { file: "a", quote: "q" } : undefined });

test("second pass: agreement keeps the first reading, no conflict", () => {
	assert.equal(mergeSecondPass(model("13.07.2026"), model("13.07.2026")).conflict, undefined);
});

test("second pass: disagreement is shown as a conflict, not silently resolved", () => {
	const m = mergeSecondPass(model("13.07.2026"), model("14.07.2026"));
	assert.equal(m.value, "13.07.2026");
	assert.equal(m.conflict?.value, "14.07.2026");
});

test("second pass: a person's manual value is never overridden", () => {
	const manual: Cited<string> = { value: "15.07.2026", status: "manual" };
	assert.deepEqual(mergeSecondPass(manual, model("13.07.2026")), manual);
});

test("normalizeForMatch is idempotent", () => {
	const once = normalizeForMatch(nolikums.text);
	assert.equal(normalizeForMatch(once), once);
});
