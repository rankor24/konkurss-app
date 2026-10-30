import { useEffect, useState } from "react";
import type { SignatureVerdict } from "../../shared/checks";
import type { Project } from "../../shared/types";
import { api, type SignaturesView, type StateBundle } from "../api";
import { Banner, ScreenHead, useAction } from "../ui";

const VERDICT: Record<SignatureVerdict, { icon: string; text: string; color: string }> = {
	ok: { icon: "✓", text: "Parakstījis īstā persona", color: "var(--good)" },
	eis: { icon: "●", text: "Paraksta EIS lietotājs ar pilnvaru — failu nelasa", color: "var(--muted)" },
	manual: { icon: "✎", text: "ievadīts ar roku", color: "var(--warn)" },
	wrong: { icon: "✗", text: "Parakstījis kāds cits", color: "var(--critical)" },
	unsigned: { icon: "○", text: "Vēl nav parakstīts", color: "var(--muted)" },
	unread: { icon: "⚠", text: "Failu vai parakstītāju nevar nolasīt", color: "var(--warn)" },
};

/** 9. Paraksti — who must sign each document, and who actually did (read from the signed file). */
export function Paraksti({ project, bundle }: { project: Project; bundle: StateBundle; reload: () => Promise<void> }) {
	const [view, setView] = useState<SignaturesView | null>(null);
	const [manual, setManual] = useState<Record<string, string>>({});
	const act = useAction();
	const load = () => api.signatures.get(project.id).then(setView);
	useEffect(() => void load(), [project.id, bundle.state.choices, bundle.state.fills]);

	const wrong = view?.rows.filter((r) => view.verdicts[r.id] === "wrong") ?? [];
	return (
		<div className="screen">
			<ScreenHead
				title="9. Paraksti"
				what="Katru dokumentu paraksta noteikta persona. App nolasa, kas parakstu patiešām licis, un salīdzina ar to, kam jāparaksta."
				why="Dokuments, ko parakstījis nepareizais cilvēks, tiek uzskatīts par neparakstītu. Personas kodi netiek rādīti un netiek glabāti."
			/>
			{act.error && <Banner kind="critical">{act.error}</Banner>}
			{view?.deadline.date.value && <Banner>Iesniegšanas termiņš: {view.deadline.date.value} {view.deadline.time.value ?? ""}</Banner>}
			{wrong.length > 0 && <Banner kind="critical">Nepareizs parakstītājs: {wrong.map((r) => r.label).join("; ")}</Banner>}
			{view && view.rows.length === 0 && <Banner>Nav neviena dokumenta, kam vajadzīgs paraksts. Vispirms 1. solī jānolasa konkursa veidlapas.</Banner>}
			{view && view.rows.length > 0 && (
				<div className="table-wrap">
					<table>
						<thead><tr><th>Dokuments</th><th>Kā paraksta</th><th>Kam jāparaksta</th><th>Kas parakstījis</th><th>Statuss</th><th /></tr></thead>
						<tbody>
							{view.rows.map((r) => {
								const v = VERDICT[view.verdicts[r.id]];
								return (
									<tr key={r.id} style={{ height: "auto" }}>
										<td>{r.label}</td>
										<td>{r.via === "EIS" ? "EIS (pilnvarotais lietotājs)" : "eParaksts, .edoc"}</td>
										<td>{r.expected.role}{r.expected.name ? <><br /><b>{r.expected.name}</b></> : <><br /><span className="small" style={{ color: "var(--warn)" }}>vārds nav zināms — norādi reģistros / 4. solī</span></>}</td>
										<td>
											{r.manual ? <span style={{ background: "var(--warn-bg, #fff3bf)", padding: "1px 6px", borderRadius: 4 }}>{r.manual.name} <span className="small">(ievadīts ar roku)</span></span> : r.actual.length ? r.actual.map((a, i) => <div key={i}>{a.name}{a.time && <span className="small"> · {new Date(a.time).toLocaleString("lv-LV")}</span>}</div>) : <span className="small">—</span>}
											{r.file && <div className="small mono">{r.file}</div>}
										</td>
										<td style={{ color: v.color }}>{v.icon} {v.text}</td>
										<td>
											{r.via === "eParaksts" && (
												<>
													<button onClick={() => act.run("pick", async () => { const f = await api.signatures.pick(); if (f) setView(await api.signatures.save(project.id, r.id, { file: f, manual: null })); })}>Izvēlēties .edoc</button>
													<div className="row" style={{ marginTop: 4 }}>
														<input placeholder="parakstītājs (ar roku)" value={manual[r.id] ?? ""} onChange={(e) => setManual({ ...manual, [r.id]: e.target.value })} style={{ width: 140 }} />
														<button disabled={!(manual[r.id] ?? "").trim()} onClick={() => act.run("manual", async () => setView(await api.signatures.save(project.id, r.id, { manual: { name: manual[r.id].trim(), at: new Date().toISOString() } })))}>Saglabāt</button>
													</div>
												</>
											)}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}

			{view && (
				<div className="card">
					<h2>Ko ievada EIS ar roku</h2>
					<div className="small">App neko neatzīmē pati — tu atzīmē, kad esi izdarījis. Tā tiek atrasti aizmirstie lauki.</div>
					{view.ticks.map((t) => (
						<label key={t.id} style={{ display: "block", marginTop: 8 }}>
							<input type="checkbox" checked={!!view.ticked[t.id]} onChange={(e) => act.run("tick", async () => { await api.signatures.tick(project.id, t.id, e.target.checked); await load(); })} /> {t.text}
							<div className="small" style={{ marginLeft: 22 }}>Avots: {t.source}</div>
						</label>
					))}
				</div>
			)}
		</div>
	);
}
