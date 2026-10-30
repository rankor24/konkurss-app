import { useEffect, useState } from "react";
import type { Specialist } from "../../shared/registers";
import type { Choices } from "../../shared/state";
import type { Project } from "../../shared/types";
import { api, type FeasibilityView, type FinanceView, type StateBundle } from "../api";
import { Banner, useAction } from "../ui";

const eur = (c: number | null) => (c === null ? "—" : (c / 100).toLocaleString("lv-LV", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/** 5. Kas ko dara for V1: who covers each required field, which objects go where, prices (confidential). */
export function KasV1({ project, bundle, reload }: { project: Project; bundle: StateBundle; reload: () => Promise<void> }) {
	const [v, setV] = useState<FeasibilityView | null>(null);
	const [people, setPeople] = useState<Specialist[]>([]);
	const [choices, setChoices] = useState<Choices | null>(null);
	const [fin, setFin] = useState<FinanceView | null>(null);
	const [finDirty, setFinDirty] = useState(false);
	const act = useAction();
	const refresh = async () => {
		const r = await api.v1.feasibility(project.id);
		setV(r);
		setChoices(r.choices);
	};
	useEffect(() => {
		refresh();
		api.registers.get().then((r) => setPeople(r.registers.specialists));
		api.v1.finance(project.id).then(setFin);
	}, [project.id, bundle.state.requirements]);
	if (!v || !choices) return <div className="screen">Ielādē…</div>;

	const save = async (next: Choices) => {
		setChoices(next);
		await api.v1.saveChoices(project.id, next);
		await refresh();
		await reload();
	};
	const covers = (field: string) => v.feasibility.specialists.find((s) => s.required === field)?.by.map((b) => b.id) ?? [];

	return (
		<div className="screen">
			<h1>5. Kas ko dara</h1>
			<div className="intro"><p>Šeit savieno konkursa prasības ar mūsu cilvēkiem un objektiem. Katra izvēle var radīt papildu dokumentus — app pateiks, kādus.</p></div>
			{act.error && <Banner kind="critical">{act.error}</Banner>}
			{v.bpv.filter((b) => !b.ok).map((b, i) => <Banner key={i} kind="critical">{b.message}</Banner>)}
			{v.bpv.length > 0 && v.bpv.every((b) => b.ok) && <Banner kind="good">{v.bpv[0].message}</Banner>}

			<div className="card">
				<h2>Speciālisti</h2>
				<table>
					<thead><tr><th>Joma</th><th>Kurš</th><th>Sertifikāts</th><th>Derīgs</th><th>Rada dokumentus</th></tr></thead>
					<tbody>
						{v.requirements.map((r, i) => {
							const chosen = people.find((p) => p.id === choices.specialists[String(i)]);
							const ids = covers(r.field ?? "");
							const sorted = [...people].sort((a, b) => Number(ids.includes(b.id)) - Number(ids.includes(a.id)));
							return (
								<tr key={i} style={{ height: "auto" }}>
									<td>{r.field}</td>
									<td>
										<select value={chosen?.id ?? ""} onChange={(e) => {
											const sp = { ...choices.specialists };
											if (e.target.value) sp[String(i)] = e.target.value;
											else delete sp[String(i)];
											save({ ...choices, specialists: sp });
										}}>
											<option value="">{ids.length === 0 ? "— nav neviena ⚠" : "— izvēlies —"}</option>
											{sorted.map((p) => <option key={p.id} value={p.id}>{p.name}{ids.includes(p.id) ? "" : " (neatbilst jomai?)"}</option>)}
										</select>
									</td>
									<td className="mono">{chosen?.certificate ?? ""}</td>
									<td>{chosen?.validUntil || <span className="hint">nav ievadīts</span>}</td>
									<td className="small">{chosen && chosen.type !== "A" ? (chosen.type === "B" ? `⊕ 2 dokumenti (${chosen.via.split(",")[0]})` : "⊕ 1 dokuments") : "—"}</td>
								</tr>
							);
						})}
					</tbody>
				</table>
				{v.produced.length > 0 && <div className="small"><strong>Jāsagatavo papildus:</strong> {v.produced.join(" · ")}</div>}
			</div>

			{v.slots.map((slot) => {
				const chosenIds = choices.objects[slot.id] ?? [];
				const need = slot.count ?? 1;
				return (
					<div className="card" key={slot.id}>
						<h2>{slot.title}</h2>
						<div className="hint">Prasa {need} objektu{slot.years ? `, pēdējie ${slot.years} gadi` : ""}{slot.points ? ` · dod ${slot.points} punktus` : ""} · avots: {slot.source}</div>
						{Array.from({ length: Math.max(need, chosenIds.length) }, (_, n) => (
							<div className="row" key={n}>
								<span>{n + 1}</span>
								<select value={chosenIds[n] ?? ""} onChange={(e) => {
									const list = [...chosenIds];
									if (e.target.value) list[n] = e.target.value;
									else list.splice(n, 1);
									save({ ...choices, objects: { ...choices.objects, [slot.id]: list.filter(Boolean) } });
								}}>
									<option value="">— izvēlies objektu —</option>
									{(v.options[slot.id] ?? []).map((o) => (
										<option key={o.id} value={o.id} disabled={!o.ok} style={o.ok ? undefined : { color: "gray" }}>
											{o.name}{o.ok ? "" : ` — ${o.reasons.join("; ")}`}
										</option>
									))}
								</select>
							</div>
						))}
						{(v.options[slot.id] ?? []).filter((o) => o.warnings.length).map((o) => <div key={o.id} className="hint">⚠ {o.name}: {o.warnings.join("; ")}</div>)}
					</div>
				);
			})}

			<div className="card secret">
				<h2>🔒 Cenas</h2>
				<div className="hint">Cenas glabājas atsevišķā failā un netiek sūtītas aģentam. PVN un kopsummas rēķina app.</div>
				{fin && (
					<>
						<table>
							<thead><tr><th>Pozīcija</th><th>Bez PVN, EUR</th><th>PVN {fin.finance.vatPercent}%</th><th>Kopā</th><th /></tr></thead>
							<tbody>
								{fin.finance.rows.map((r, i) => (
									<tr key={i}>
										<td><input style={{ width: 300 }} value={r.name} onChange={(e) => { setFin({ ...fin, finance: { ...fin.finance, rows: fin.finance.rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) } }); setFinDirty(true); }} /></td>
										<td><input className="mono" style={{ width: 130, textAlign: "right" }} value={r.amount} onChange={(e) => { setFin({ ...fin, finance: { ...fin.finance, rows: fin.finance.rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)) } }); setFinDirty(true); }} /></td>
										<td className="mono" style={{ textAlign: "right" }}>{eur(fin.totals.rows[i]?.vat ?? null)}</td>
										<td className="mono" style={{ textAlign: "right" }}>{eur(fin.totals.rows[i]?.gross ?? null)}</td>
										<td><button aria-label="Dzēst rindu" onClick={() => { setFin({ ...fin, finance: { ...fin.finance, rows: fin.finance.rows.filter((_, j) => j !== i) } }); setFinDirty(true); }}>×</button></td>
									</tr>
								))}
								<tr><td><strong>KOPĀ</strong></td><td className="mono" style={{ textAlign: "right" }}><strong>{eur(fin.totals.net)}</strong></td><td className="mono" style={{ textAlign: "right" }}>{eur(fin.totals.vat)}</td><td className="mono" style={{ textAlign: "right" }}>{eur(fin.totals.gross)}</td><td /></tr>
							</tbody>
						</table>
						{fin.totals.invalid.length > 0 && <Banner kind="critical">Nesaprotama summa: {fin.totals.invalid.join(", ")}.</Banner>}
						<div className="row">
							<button onClick={() => { setFin({ ...fin, finance: { ...fin.finance, rows: [...fin.finance.rows, { name: "", amount: "" }] } }); setFinDirty(true); }}>+ Pievienot pozīciju</button>
							<label className="row small">Summa, ko ievadīsi EIS sistēmā
								<input className="mono" style={{ width: 130, textAlign: "right" }} placeholder={eur(fin.totals.net)} value={fin.finance.eisAmount ?? ""} onChange={(e) => { setFin({ ...fin, finance: { ...fin.finance, eisAmount: e.target.value || null } }); setFinDirty(true); }} />
							</label>
							<button className="primary" disabled={!finDirty} onClick={() => act.run("fin", async () => { setFin(await api.v1.saveFinance(project.id, fin.finance)); setFinDirty(false); })}>Saglabāt cenas</button>
						</div>
					</>
				)}
			</div>
		</div>
	);
}
