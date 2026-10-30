// 🔒 Prices. Kept in their own file (finanses.json) so they can never end up in a model prompt by accident.
// All arithmetic is in whole cents: no floating-point drift in a tender sum.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stateDir } from "../project-state.js";

export interface PriceRow {
	name: string;
	/** EUR without VAT, as typed: "75 000,00" */
	amount: string;
}
export interface Finance {
	rows: PriceRow[];
	vatPercent: number;
	/** the amount typed into the EIS field; defaults to the net total */
	eisAmount: string | null;
}
export const emptyFinance = (): Finance => ({ rows: [], vatPercent: 21, eisAmount: null });

/** "75 000,00" / "75000.5" / "75 000" → 7500000 cents, or null if not a number. */
export function toCents(s: string): number | null {
	const t = s.replace(/[\s ]/g, "").replace(",", ".");
	if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
	const [w, f = ""] = t.split(".");
	return Number(w) * 100 + Number((f + "00").slice(0, 2));
}

export function formatCents(c: number): string {
	const sign = c < 0 ? "-" : "";
	const abs = Math.abs(c);
	const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
	return `${sign}${whole},${String(abs % 100).padStart(2, "0")}`;
}

export interface Totals {
	rows: { name: string; net: number | null; vat: number | null; gross: number | null }[];
	net: number;
	vat: number;
	gross: number;
	eis: number | null;
	invalid: string[];
}

export function totals(f: Finance): Totals {
	const rows = f.rows.map((r) => {
		const net = toCents(r.amount);
		const vat = net === null ? null : Math.round((net * f.vatPercent) / 100);
		return { name: r.name, net, vat, gross: net === null || vat === null ? null : net + vat };
	});
	const net = rows.reduce((s, r) => s + (r.net ?? 0), 0);
	// VAT of the total, rounded once — equals the sum of rows unless rounding differs, in which case the total wins
	const vat = Math.round((net * f.vatPercent) / 100);
	return {
		rows,
		net,
		vat,
		gross: net + vat,
		eis: f.eisAmount === null || f.eisAmount.trim() === "" ? net : toCents(f.eisAmount),
		invalid: f.rows.filter((r) => r.amount.trim() !== "" && toCents(r.amount) === null).map((r) => r.name),
	};
}

const file = (outputDir: string) => join(stateDir(outputDir), "finanses.json");

export function loadFinance(outputDir: string): Finance {
	const f = file(outputDir);
	if (!existsSync(f)) return emptyFinance();
	try {
		return { ...emptyFinance(), ...(JSON.parse(readFileSync(f, "utf8")) as Partial<Finance>) };
	} catch {
		throw new Error(`Cenu fails ir bojāts: ${f}`);
	}
}

export function saveFinance(outputDir: string, fin: Finance): void {
	mkdirSync(stateDir(outputDir), { recursive: true });
	const f = file(outputDir);
	const tmp = `${f}.tmp`;
	writeFileSync(tmp, JSON.stringify(fin, null, 2), "utf8");
	renameSync(tmp, f);
}
