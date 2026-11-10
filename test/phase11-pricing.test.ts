import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { financeRows, hoursCost, importOfferSheet, lineTotal, priceHistory, sheetTotals, toMicro } from "../src/main/v1/pricing.ts";
import { parseTracker } from "../src/main/library/imports.ts";
import { readXlsx } from "../src/main/office.ts";
import type { PriceLine, PriceSheet } from "../src/shared/pricing.ts";
import type { TrackerRow } from "../src/shared/library.ts";

const B = "B:/01_Konkursi";
const haveB = existsSync(B);
const LIDL = join(B, "261106_LIDL_Slokas161", "PIEDAVAJUMS", "261104_BD_P_Lidl_Slokas161_v2.xlsx");

const line = (p: Partial<PriceLine>): PriceLine => ({ id: Math.random().toString(36), marka: "", name: "", section: "", by: "BŪVDIZAINS", hours: {}, direct: "", markup: "1", included: true, au: false, ...p });
const rates = [{ role: "Arhitekts", eurPerHour: "25" }, { role: "Tehniķis", eurPerHour: "23" }];

test("exact arithmetic: Excel floats and comma decimals, rounded once at the total", () => {
	assert.equal(toMicro("1839.9999999999998"), 1_840_000_000n);
	assert.equal(toMicro("12 405,50"), 12_405_500_000n);
	assert.equal(toMicro("-"), null);
	// 2 731,25 × 1,15 = 3 140,9375 — four such lines are 12 563,75, not 4 × 3 140,94
	const s: PriceSheet = { source: null, rates, lines: [1, 2, 3, 4].map(() => line({ by: "NCS", direct: "2731.25", markup: "1.15" })) };
	assert.equal(sheetTotals(s).designCents, 1_256_375);
});

test("own work: hours × rates when no amount is written; the written amount wins when there is one", () => {
	const ar = line({ marka: "AR", hours: { Arhitekts: "110", Tehniķis: "240" }, markup: "1.5" });
	assert.equal(hoursCost(ar, rates), 8_270_000_000n);
	assert.equal(lineTotal(ar, rates).total, 12_405_000_000n);
	const tsl = line({ marka: "TS-L", hours: { Arhitekts: "40", Tehniķis: "120" }, direct: "3560", markup: "1.5" });
	assert.equal(lineTotal(tsl, rates).total, 5_340_000_000n, "the sheet's direct cost (landscape architect at 20 €/h) is kept");
});

test("a line whose sheet total is not direct × markup keeps the sheet's number and says so", () => {
	const t = lineTotal(line({ direct: "3980", markup: "1.2", override: "7176" }), rates);
	assert.equal(t.total, 7_176_000_000n);
	assert.ok(t.differs);
});

test("totals: excluded lines out, autoruzraudzība apart; the tender's price form gets two rows", () => {
	const s: PriceSheet = { source: null, rates, lines: [line({ direct: "1000", markup: "1.5" }), line({ direct: "500", markup: "2", included: false }), line({ direct: "65000", markup: "1.15", au: true }), line({ by: "ENORA", direct: "2000", markup: "1.15" })] };
	const t = sheetTotals(s);
	assert.deepEqual([t.designCents, t.auCents, t.allCents, t.directCents], [380_000, 7_475_000, 7_855_000, 300_000]);
	assert.deepEqual(t.bySub, [{ by: "ENORA", cents: 200_000 }]);
	assert.deepEqual(financeRows(s), [{ name: "Būvprojekta izstrāde", amount: "3800,00" }, { name: "Autoruzraudzība", amount: "74750,00" }]);
});

test("price history: similar titles and the same purchaser, only rows that carry a price", () => {
	const r = (n: number, title: string, purchaser: string, our: number | null, win: number | null): TrackerRow => ({ sheet: "2025", row: n, title, work: "", purchaser, builders: [], ourAmount: "", ourCents: our, deadline: `2025-01-${String(n).padStart(2, "0")}`, procedure: "", subject: "", decision: "", submitted: true, result: "zaudejums", comment: "", winner: win ? "SIA “X”" : null, winnerCents: win, eisUrl: null });
	const rows = [r(1, "Sporta zāles pārbūve Ulbrokā", "Ropažu novada pašvaldība", 4_500_000, 3_900_000), r(2, "Sporta zāles jumta atjaunošana", "Ogres novada pašvaldība", 2_000_000, null), r(3, "Bibliotēkas pārbūve", "Ropažu novada pašvaldība", null, null), r(4, "Ielu apgaismojums", "Ādažu novada pašvaldība", 100_000, null)];
	const h = priceHistory(rows, "Ulbrokas sporta zāles ģērbtuvju pārbūve", "Ropažu novada pašvaldība");
	assert.deepEqual(h.map((x) => x.row.row), [1, 2]);
});

test("ORACLE: the LIDL Slokas 161 offer reproduced to the cent from its own sheet, and its one inconsistent row found", { skip: !haveB }, () => {
	const { price, sheetTotals: st } = importOfferSheet(readXlsx(LIDL)[0], LIDL);
	const t = sheetTotals(price);
	const cents = (s: string | null) => Math.round(Number(s) * 100);
	assert.equal(t.designCents, cents(st.design));
	assert.equal(t.allCents, cents(st.all));
	assert.equal(t.designCents, 17_923_366);
	assert.equal(t.allCents, 25_398_366);
	assert.deepEqual(price.rates.map((r) => [r.role, r.eurPerHour]), [["Proj. vad", "25"], ["Arhitekts", "25"], ["Tehniķis", "23"], ["Ainavu arhitekts", "20"]]);
	const flagged = price.lines.filter((l) => l.override);
	assert.deepEqual(flagged.map((l) => l.name.trim()), ["DEMONTĀŽAS PROJEKTS"]);
	assert.ok(price.lines.some((l) => l.marka === "BK" && l.by === "CONSTRUCTOR"));
	assert.ok(!price.lines.find((l) => l.marka === "SAT")!.included, "\"-\" rows stay out");
	assert.equal(price.lines.filter((l) => l.au).length, 1);
});

test("ORACLE: price history for the NVA IDA tender finds earlier IDA / NVA tenders with prices", { skip: !haveB }, () => {
	const tracker = parseTracker(readXlsx(join(B, "02_Iepirkumi_BD_jauns.xlsx")));
	const h = priceHistory(tracker, "IDA praktiskā mācību centra (poligona) ēkas, taktiskā auto poligona un operatīvā transporta stāvvietu Ezermalas ielā 8A, Rīgā būvniecība", "Nodrošinājuma valsts aģentūra");
	assert.ok(h.length >= 1);
	assert.ok(h.every((x) => x.row.ourCents !== null || x.row.winnerCents !== null));
});
