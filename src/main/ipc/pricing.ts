// 🔒 IPC for phase 11: the price sheet per marka, import from an earlier offer, the tender's price form rows, an offer
// document for a builder, and the price history (advice only — never written into a form).
import { join } from "node:path";
import { BrowserWindow, dialog, ipcMain } from "electron";
import type { PriceSheet } from "../../shared/pricing.js";
import type { AppContext } from "../context.js";
import { nextVersionPath, safeName } from "../fill/run.js";
import { readXlsx } from "../office.js";
import { toolsConfig, writeDocx } from "../pytools.js";
import { loadFinance, saveFinance } from "../v1/finance.js";
import { financeRows, importOfferSheet, loadPriceSheet, priceHistory, savePriceSheet, sheetTotals } from "../v1/pricing.js";

const eur = (c: number) => `${Math.floor(c / 100).toLocaleString("lv-LV").replace(/ /g, " ")},${String(Math.abs(c) % 100).padStart(2, "0")}`;

export function registerPricing(ctx: AppContext, toolsScript: string): void {
	const tools = toolsConfig(process.env, toolsScript);
	const view = (projectId: string) => {
		const p = ctx.project(projectId);
		const s = ctx.state(projectId);
		const sheet = loadPriceSheet(p.outputDir);
		const reg = ctx.store.registers();
		const history = priceHistory(reg.tracker ?? [], s.requirements.dati.subject.value ?? p.name, s.requirements.dati.purchaser.value ?? "");
		return { sheet, totals: sheetTotals(sheet), history: history.map((h) => ({ ...h.row, score: h.score })), trackerLoaded: (reg.tracker ?? []).length > 0 };
	};
	ipcMain.handle("price:get", (_e, projectId: string) => view(projectId));
	ipcMain.handle("price:save", (_e, projectId: string, sheet: PriceSheet) => {
		savePriceSheet(ctx.project(projectId).outputDir, sheet);
		return view(projectId);
	});
	ipcMain.handle("price:import", async (e, projectId: string) => {
		const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender)!, { title: "Iepriekšējais cenu piedāvājums (BD_P_….xlsx)", properties: ["openFile"], filters: [{ name: "Excel", extensions: ["xlsx"] }] });
		if (r.canceled || !r.filePaths[0]) return { ok: false, error: "Fails nav izvēlēts." };
		try {
			const sheets = readXlsx(r.filePaths[0]);
			const sheet = sheets.find((x) => x.rows.some((row) => Object.values(row.cells).some((v) => v.trim().toLowerCase() === "marka")));
			if (!sheet) return { ok: false, error: "Šajā failā nav cenu tabulas ar kolonnu „Marka”." };
			const { price, sheetTotals: st } = importOfferSheet(sheet, r.filePaths[0]);
			savePriceSheet(ctx.project(projectId).outputDir, price);
			return { ok: true, lines: price.lines.length, sheetTotals: st, ...view(projectId) };
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message : String(err) };
		}
	});
	ipcMain.handle("price:toFinance", (_e, projectId: string) => {
		const p = ctx.project(projectId);
		const fin = loadFinance(p.outputDir);
		fin.rows = financeRows(loadPriceSheet(p.outputDir));
		saveFinance(p.outputDir, fin);
		return { ok: true, rows: fin.rows };
	});
	/** Our offer to a builder as a Word document: parts, who makes them, amounts; totals without VAT. */
	ipcMain.handle("price:offerDoc", async (_e, projectId: string, builder: string) => {
		const p = ctx.project(projectId);
		const s = ctx.state(projectId);
		const sheet = loadPriceSheet(p.outputDir);
		const t = sheetTotals(sheet);
		if (sheet.lines.length === 0) return { ok: false, error: "Cenu lapa ir tukša." };
		const reg = ctx.store.registers();
		const company = reg.company.fields.filter((f) => /^(nosaukums|re[gģ]|juridisk|adrese|biroja)/i.test(f.key)).map((f) => `${f.key}: ${f.value}`);
		const tot = new Map(t.lines.map((l) => [l.id, l]));
		const rows = [["Marka", "Darbu veids", "Izstrādātājs", "EUR bez PVN"], ...sheet.lines.filter((l) => l.included && !l.au).map((l) => [l.marka, l.name, l.by, eur(tot.get(l.id)!.totalCents)])];
		const blocks = [
			{ text: "CENAS PIEDĀVĀJUMS", bold: true },
			...company.map((text) => ({ text })),
			{ text: `Pasūtītājs: ${builder || "—"}` },
			{ text: `Objekts: ${s.requirements.dati.subject.value ?? p.name}` },
			{ table: rows },
			{ text: `KOPĀ bez PVN: ${eur(t.designCents)} EUR`, bold: true },
			...(t.auCents ? [{ text: `Autoruzraudzība bez PVN: ${eur(t.auCents)} EUR` }, { text: `KOPĀ ar autoruzraudzību bez PVN: ${eur(t.allCents)} EUR`, bold: true }] : []),
		];
		const dst = nextVersionPath(join(p.outputDir, "Iesniedzamie", builder ? safeName(builder) : ""), "Cenas piedavajums", ".docx");
		try {
			await writeDocx(tools, { dst, blocks });
			return { ok: true, file: dst };
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message : String(err) };
		}
	});
}
