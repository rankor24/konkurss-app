// 🔒 Phase 11: the price sheet per marka — own hours × rates or a subcontractor's quote, markup, totals; the price
// history from the tracker is shown beside it as advice only.
import { useEffect, useState } from "react";
import type { PriceLine, PriceSheet } from "../../shared/pricing";
import type { Project } from "../../shared/types";
import { api, type PriceView } from "../api";
import { Banner, ScreenHead, useAction } from "../ui";

export const eur = (c: number | null) => (c === null ? "—" : `${(c < 0 ? "-" : "")}${Math.floor(Math.abs(c) / 100).toLocaleString("lv-LV")},${String(Math.abs(c) % 100).padStart(2, "0")}`);

export function Cenas({ project }: { project: Project }) {
	const [v, setV] = useState<PriceView | null>(null);
	const [sheet, setSheet] = useState<PriceSheet | null>(null);
	const [dirty, setDirty] = useState(false);
	const [builder, setBuilder] = useState(project.builders[0] ?? "");
	const act = useAction();
	const take = (x: PriceView) => (setV(x), setSheet(x.sheet), setDirty(false));
	useEffect(() => void api.price.get(project.id).then(take), [project.id]);
	if (!v || !sheet) return <div className="screen">Ielādē…</div>;
	const total = new Map(v.totals.lines.map((l) => [l.id, l]));
	const set = (id: string, patch: Partial<PriceLine>) => (setSheet({ ...sheet, lines: sheet.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) }), setDirty(true));
	const sections = [...new Set(sheet.lines.map((l) => l.section))];
	const roles = sheet.rates.map((r) => r.role);
	return (
		<div className="screen">
			<ScreenHead title="Cenas" what="Cena pa sadaļām (markām): mūsu darbs — stundas × likme, apakšuzņēmēju darbs — viņu piedāvājums; katrai rindai uzcenojums. Kopsummas aprēķina precīzi līdz centam." why="Cenas glabājas atsevišķā failā un nekad nenonāk aģenta uzdevumā. Iepriekšējo konkursu cenas ir tikai uzziņai — formā tās neieraksta." />
			{act.error && <Banner kind="critical">{act.error}</Banner>}
			{act.note && <Banner kind="good">{act.note}</Banner>}
			<div className="row">
				<button disabled={!!act.busy} onClick={() => act.run("imp", async () => {
					const r = await api.price.import(project.id);
					if (r.ok) {
						take(r);
						const match = r.sheetTotals.design && Math.abs(Math.round(Number(r.sheetTotals.design) * 100) - r.totals.designCents) <= 1;
						act.setNote(`Ielasītas ${r.lines} rindas. ${r.sheetTotals.design ? (match ? "Kopsumma sakrīt ar avota lapu." : `Avota lapā KOPĀ ${r.sheetTotals.design} — atšķiras, pārbaudi iezīmētās rindas.`) : ""}`);
					}
					return r;
				})}>Sākt no iepriekšējā piedāvājuma (xlsx)…</button>
				<span className="grow" />
				{dirty && <span className="hint">nesaglabātas izmaiņas</span>}
				<button className="primary" disabled={!dirty || !!act.busy} onClick={() => act.run("save", async () => take(await api.price.save(project.id, sheet)))}>Saglabāt</button>
			</div>
			{sheet.source && <div className="hint">Sākts no: {sheet.source}</div>}
			{sheet.rates.length > 0 && (
				<div className="row">
					{sheet.rates.map((r, i) => (
						<label key={r.role} className="row" style={{ gap: 4 }}>{r.role}<input className="mono" style={{ width: 60, textAlign: "right" }} value={r.eurPerHour} onChange={(e) => (setSheet({ ...sheet, rates: sheet.rates.map((x, j) => (j === i ? { ...x, eurPerHour: e.target.value } : x)) }), setDirty(true))} />€/h</label>
					))}
				</div>
			)}
			{sheet.lines.length === 0 && <Banner>Cenu lapa ir tukša — sāc no iepriekšējā piedāvājuma, lai būtu visas markas un apakšuzņēmēji.</Banner>}
			{sections.map((sec) => (
				<div className="card" key={sec}>
					<h2>{sec || "Citi"}</h2>
					<table>
						<thead><tr><th>Iekļauts</th><th>Marka</th><th>Darbu veids</th><th>Izstrādātājs</th>{roles.slice(1, 3).map((r) => <th key={r}>{r}, h</th>)}<th>Tiešās izmaksas</th><th>Uzcen.</th><th>Kopā, EUR</th></tr></thead>
						<tbody>
							{sheet.lines.filter((l) => l.section === sec).map((l) => {
								const t = total.get(l.id);
								return (
									<tr key={l.id} style={{ opacity: l.included ? 1 : 0.5 }}>
										<td><input type="checkbox" checked={l.included} onChange={(e) => set(l.id, { included: e.target.checked })} aria-label="Iekļauts piedāvājumā" /></td>
										<td className="mono">{l.marka}</td>
										<td>{l.name}{l.note && <div className="hint" style={{ color: "var(--warn)" }}>{l.note}</div>}</td>
										<td><input style={{ width: 120 }} value={l.by} onChange={(e) => set(l.id, { by: e.target.value })} /></td>
										{roles.slice(1, 3).map((r) => <td key={r}><input className="mono" style={{ width: 55, textAlign: "right" }} value={l.hours[r] ?? ""} title="Mainot stundas, tiešās izmaksas tiek rēķinātas no likmēm" onChange={(e) => set(l.id, { hours: { ...l.hours, [r]: e.target.value }, direct: "" })} /></td>)}
										<td><input className="mono" style={{ width: 95, textAlign: "right" }} value={l.direct} placeholder={eur(t?.directCents ?? null)} onChange={(e) => set(l.id, { direct: e.target.value, override: undefined, note: undefined })} /></td>
										<td><input className="mono" style={{ width: 50, textAlign: "right" }} value={l.markup} onChange={(e) => set(l.id, { markup: e.target.value, override: undefined, note: undefined })} /></td>
										<td className="mono" style={{ textAlign: "right", color: t?.differs ? "var(--warn)" : undefined }}>{l.included ? eur(t?.totalCents ?? null) : "—"}</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			))}
			{sheet.lines.length > 0 && (
				<div className="card">
					<div className="cards">
						<div><div className="hint">Projektēšana bez PVN</div><div className="mono" style={{ fontSize: 20 }}>{eur(v.totals.designCents)}</div></div>
						<div><div className="hint">Autoruzraudzība bez PVN</div><div className="mono" style={{ fontSize: 20 }}>{eur(v.totals.auCents)}</div></div>
						<div><div className="hint">Kopā bez PVN</div><div className="mono" style={{ fontSize: 20 }}>{eur(v.totals.allCents)}</div></div>
					</div>
					<div className="hint">Tiešās izmaksas {eur(v.totals.directCents)} · uzcenojumu summa {eur(v.totals.marginCents)}{v.totals.bySub.length > 0 && <> · apakšuzņēmēji: {v.totals.bySub.map((s) => `${s.by} ${eur(s.cents)}`).join(", ")}</>}</div>
					{dirty && <div className="hint">Kopsummas atjaunosies pēc saglabāšanas.</div>}
					<div className="row">
						<button disabled={dirty || !!act.busy} onClick={() => act.run("fin", async () => {
							const r = await api.price.toFinance(project.id);
							if (r.ok) act.setNote(`Finanšu piedāvājumā ierakstīts: ${r.rows.map((x) => `${x.name} ${x.amount}`).join("; ")}.`);
							return r;
						})}>Pārnest uz finanšu piedāvājumu</button>
						<input style={{ width: 160 }} value={builder} onChange={(e) => setBuilder(e.target.value)} placeholder="būvnieks" aria-label="Būvnieks" />
						<button disabled={dirty || !!act.busy} onClick={() => act.run("doc", async () => {
							const r = await api.price.offerDoc(project.id, builder);
							if (r.ok) act.setNote(`Izveidots: ${r.file}`);
							return r;
						})}>Cenu piedāvājums būvniekam (Word)</button>
					</div>
				</div>
			)}
			<div className="card">
				<h2>Līdzīgi konkursi uzskaitē (tikai uzziņai)</h2>
				{!v.trackerLoaded && <div className="muted">Uzskaite nav ielasīta (Reģistri › Konkursu uzskaite).</div>}
				{v.trackerLoaded && v.history.length === 0 && <div className="muted">Uzskaitē nav līdzīgu konkursu ar cenām.</div>}
				{v.history.length > 0 && (
					<table>
						<thead><tr><th>Termiņš</th><th>Konkurss</th><th>Mūsu cena</th><th>Uzvarētājs</th><th>Rezultāts</th></tr></thead>
						<tbody>{v.history.map((h) => <tr key={`${h.sheet}-${h.row}`}><td>{h.deadline ?? h.sheet}</td><td className="small">{h.title.slice(0, 110)}<div className="hint">{h.purchaser}</div></td><td className="mono">{eur(h.ourCents)}</td><td className="small">{h.winner ?? "—"}<div className="mono">{eur(h.winnerCents)}</div></td><td>{{ uzvara: "uzvarēts", zaudejums: "zaudēts", parstraukts: "pārtraukts", gaida: "gaida", nav: "—" }[h.result]}</td></tr>)}</tbody>
					</table>
				)}
			</div>
		</div>
	);
}
