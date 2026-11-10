// 🔒 Phase 11: price sheet arithmetic, import from an earlier BD_P_*.xlsx offer, and the price history from the tracker.
// Kept in cenu-lapa.json next to finanses.json, never in a model prompt. Exact arithmetic in micro-euros (1 € = 10⁶),
// rounded to cents once, at the total — the way the spreadsheet rounds only for display.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { PriceLine, PriceSheet, Rate } from "../../shared/pricing.js";
import { emptyPriceSheet } from "../../shared/pricing.js";
import type { TrackerRow } from "../../shared/library.js";
import type { XlsxSheet } from "../office.js";
import { stateDir } from "../project-state.js";

const MICRO = 1_000_000n;

/** "12 405,50" / "1839.9999999999998" / "1.15" → micro-units (bigint); null if not a number. Floats from Excel are rounded to 6 places. */
export function toMicro(s: string | undefined): bigint | null {
	if (s === undefined) return null;
	const t = s.replace(/[\s ]/g, "").replace(",", ".");
	if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
	return BigInt(Math.round(Number(t) * 1e6));
}
const microToCents = (m: bigint) => Number((m + (m >= 0n ? 5000n : -5000n)) / 10000n);

export interface LineTotal {
	id: string;
	direct: bigint;
	total: bigint;
	/** the sheet's own total differs from direct × markup */
	differs: boolean;
}

/** Hours × rates of our own work on a line (what a person edits in the hours columns). */
export function hoursCost(l: PriceLine, rates: Rate[]): bigint {
	return Object.entries(l.hours).reduce((s, [role, h]) => {
		const hrs = toMicro(h);
		const rate = toMicro(rates.find((r) => r.role === role)?.eurPerHour);
		return hrs === null || rate === null ? s : s + (hrs * rate) / MICRO;
	}, 0n);
}

/**
 * The line's direct cost: the amount written on the line (a quote, or our cost as the source sheet had it — its
 * hours may be priced at another role's rate, e.g. ainavu arhitekts), else hours × rates.
 */
export function lineDirect(l: PriceLine, rates: Rate[]): bigint {
	return toMicro(l.direct) ?? hoursCost(l, rates);
}

export function lineTotal(l: PriceLine, rates: Rate[]): LineTotal {
	const direct = lineDirect(l, rates);
	const markup = toMicro(l.markup) ?? MICRO;
	const computed = (direct * markup) / MICRO;
	const o = toMicro(l.override);
	const differs = o !== null && (o - computed > 10000n || computed - o > 10000n);
	return { id: l.id, direct, total: o ?? computed, differs };
}

export interface SheetTotals {
	lines: { id: string; directCents: number; totalCents: number; differs: boolean }[];
	designCents: number;
	auCents: number;
	allCents: number;
	directCents: number;
	/** planned profit = total − direct cost, of the design part */
	marginCents: number;
	/** subcontractor share of the direct cost, by firm */
	bySub: { by: string; cents: number }[];
}

export function sheetTotals(s: PriceSheet): SheetTotals {
	const lt = s.lines.map((l) => ({ l, t: lineTotal(l, s.rates) }));
	const inc = lt.filter((x) => x.l.included);
	const sum = (xs: typeof lt, f: (x: (typeof lt)[number]) => bigint) => xs.reduce((a, x) => a + f(x), 0n);
	const design = sum(inc.filter((x) => !x.l.au), (x) => x.t.total);
	const au = sum(inc.filter((x) => x.l.au), (x) => x.t.total);
	const direct = sum(inc.filter((x) => !x.l.au), (x) => x.t.direct);
	const subs = new Map<string, bigint>();
	for (const x of inc) if (!/b[uū]vdizains/i.test(x.l.by) && x.l.by.trim()) subs.set(x.l.by, (subs.get(x.l.by) ?? 0n) + x.t.direct);
	return {
		lines: lt.map((x) => ({ id: x.l.id, directCents: microToCents(x.t.direct), totalCents: microToCents(x.t.total), differs: x.t.differs })),
		designCents: microToCents(design),
		auCents: microToCents(au),
		allCents: microToCents(design + au),
		directCents: microToCents(direct),
		marginCents: microToCents(design - direct),
		bySub: [...subs.entries()].map(([by, m]) => ({ by, cents: microToCents(m) })).sort((a, b) => b.cents - a.cents),
	};
}

// ---------- import from an earlier offer ----------
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/**
 * Reads a BD_P_*.xlsx sheet: the header row ("Marka", "Darbu veids", "Izmaksas kopā", "Izstrādātājs",
 * "Tiešās izmaksas…", "Uzcenojums", "Arhitekts", "Stundu budžets", "Tehniķis", "Stundu budžets"), the hourly rates
 * above it, section rows, "-" rows, the KOPĀ rows and the autoruzraudzība line after them.
 */
export function importOfferSheet(sheet: XlsxSheet, source: string): { price: PriceSheet; sheetTotals: { design: string | null; all: string | null } } {
	const hi = sheet.rows.findIndex((r) => Object.values(r.cells).some((v) => norm(v) === "marka"));
	if (hi < 0) throw new Error("Šajā lapā nav cenu tabulas (nav kolonnas „Marka”).");
	const h = sheet.rows[hi].cells;
	const col = (re: RegExp, after?: string) => Object.entries(h).filter(([c, v]) => re.test(norm(v)) && (!after || c > after)).map(([c]) => c).sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
	const cMarka = col(/^marka$/)!;
	const cName = col(/^darbu veids/) ?? "C";
	const cTotal = col(/^izmaksas kopa/) ?? "D";
	const cBy = col(/^izstradatajs/) ?? "E";
	const cDirect = col(/^tiesas izmaksas/) ?? "F";
	const cMarkup = col(/^uzcenojums/) ?? "G";
	const cArch = col(/^arhitekts$/);
	const cArchH = cArch ? col(/^stundu budzets/, cArch) : undefined;
	const cTech = col(/^tehnikis$/);
	const cTechH = cTech ? col(/^stundu budzets/, cTech) : undefined;
	const cNr = Object.keys(h).sort()[0];

	// hourly rates: "Arhitekts | 25 | 4200" above the table
	const rates: Rate[] = [];
	for (const r of sheet.rows.slice(0, hi)) {
		for (const [c, v] of Object.entries(r.cells)) {
			const next = String.fromCharCode(c.charCodeAt(0) + 1);
			if (/^(proj\.? ?vad|arhitekts|tehnikis|ainavu arhitekts)/.test(norm(v)) && toMicro(r.cells[next]) !== null) rates.push({ role: v.trim(), eurPerHour: r.cells[next] });
		}
	}
	const roleOf = (re: RegExp) => rates.find((r) => re.test(norm(r.role)))?.role;
	const archRole = roleOf(/^arhitekts/);
	const techRole = roleOf(/^tehnikis/);

	const lines: PriceLine[] = [];
	let section = "";
	let afterTotal = false;
	let designTotal: string | null = null;
	let allTotal: string | null = null;
	for (const r of sheet.rows.slice(hi + 1)) {
		const v = (c?: string) => (c ? (r.cells[c] ?? "").trim() : "");
		const name = v(cName);
		// "*" / "**" in the marka column are footnote marks, not a part code
		const marka = v(cMarka).replace(/^\*+/, "");
		if (/^kopa ar autoruzraudz/.test(norm(name))) {
			allTotal = v(cTotal);
			break;
		}
		if (/^kopa bez pvn/.test(norm(name))) {
			designTotal = v(cTotal);
			afterTotal = true;
			continue;
		}
		if (!name) continue;
		const isSection = !marka && /^\d+$/.test(v(cNr)) && !v(cBy) && name === name.toUpperCase() && !/vadiba|autoruzraudz|demontaz/.test(norm(name));
		if (isSection) {
			section = name;
			continue;
		}
		const total = v(cTotal);
		const included = total !== "-" && total !== "";
		const hours: Record<string, string> = {};
		if (archRole && cArchH && toMicro(v(cArchH)) && /b[uū]vdizains/i.test(v(cBy))) hours[archRole] = v(cArchH);
		if (techRole && cTechH && toMicro(v(cTechH)) && /b[uū]vdizains/i.test(v(cBy))) hours[techRole] = v(cTechH);
		const line: PriceLine = { id: randomUUID(), marka, name, section: marka ? section : name, by: v(cBy), hours, direct: v(cDirect), markup: v(cMarkup) || "1", included, au: afterTotal || /autoruzraudz/.test(norm(name)) };
		const t = lineTotal(line, rates);
		const sheetTotal = toMicro(total);
		if (included && sheetTotal !== null && (sheetTotal - t.total > 10000n || t.total - sheetTotal > 10000n)) {
			line.override = total;
			line.note = `Avota lapā kopā ${total}, bet ${Number(t.direct) / 1e6} × ${line.markup} = ${Number(t.total) / 1e6}. Pārbaudi uzcenojumu.`;
		}
		lines.push(line);
	}
	return { price: { source, rates, lines }, sheetTotals: { design: designTotal, all: allTotal } };
}

/** The tender's price form rows from the sheet: design work and autoruzraudzība, without VAT. */
export function financeRows(s: PriceSheet): { name: string; amount: string }[] {
	const t = sheetTotals(s);
	const eur = (c: number) => `${Math.floor(c / 100)},${String(c % 100).padStart(2, "0")}`;
	const rows = [{ name: "Būvprojekta izstrāde", amount: eur(t.designCents) }];
	if (t.auCents) rows.push({ name: "Autoruzraudzība", amount: eur(t.auCents) });
	return rows;
}

// ---------- price history (advice only) ----------
export interface HistoryHit {
	row: TrackerRow;
	score: number;
}
const WORDS = (s: string) => new Set(norm(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 5 && !/^(buvniecibas|dokumentacijas|izstrade|autoruzraudziba|projektesana|ieceres|novada|pasvaldiba|2024|2025|2026)/.test(w)).map((w) => w.slice(0, 6)));

/** Earlier tenders like this one (title words, same purchaser) that carry our price or the winner's. */
export function priceHistory(rows: TrackerRow[], subject: string, purchaser: string, limit = 8): HistoryHit[] {
	const sw = WORDS(subject);
	const pk = norm(purchaser).split(" ").filter((w) => w.length >= 4).slice(0, 2).join(" ");
	return rows
		.filter((r) => r.ourCents !== null || r.winnerCents !== null)
		.map((r) => {
			const tw = WORDS(`${r.title} ${r.work}`);
			let hit = 0;
			for (const w of sw) if (tw.has(w)) hit++;
			const samePurchaser = pk.length > 0 && norm(r.purchaser).includes(pk);
			return { row: r, score: hit + (samePurchaser ? 2 : 0) };
		})
		.filter((x) => x.score >= 2)
		.sort((a, b) => b.score - a.score || (b.row.deadline ?? "").localeCompare(a.row.deadline ?? ""))
		.slice(0, limit);
}

// ---------- storage 🔒 ----------
const file = (outputDir: string) => join(stateDir(outputDir), "cenu-lapa.json");
export function loadPriceSheet(outputDir: string): PriceSheet {
	const f = file(outputDir);
	if (!existsSync(f)) return emptyPriceSheet();
	try {
		return { ...emptyPriceSheet(), ...(JSON.parse(readFileSync(f, "utf8")) as Partial<PriceSheet>) };
	} catch {
		throw new Error(`Cenu lapas fails ir bojāts: ${f}`);
	}
}
export function savePriceSheet(outputDir: string, s: PriceSheet): void {
	mkdirSync(stateDir(outputDir), { recursive: true });
	const f = file(outputDir);
	writeFileSync(`${f}.tmp`, JSON.stringify(s, null, 2), "utf8");
	renameSync(`${f}.tmp`, f);
}
