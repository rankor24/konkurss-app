// Phase 10: Konkursu tāfele — every tender folder, its deadline, the tracker's decision, the pack, the next step.
import { useEffect, useState } from "react";
import { BOARD_STATUS_LABELS, type BoardRow, type BoardStatus } from "../../shared/board";
import { api, onTaskText } from "../api";
import { Banner, ScreenHead, useAction } from "../ui";

const DECISION: Record<string, string> = { liekam: "Liekam", "neinteresē": "Neinteresē", "interesē_nav_pieredzes": "Interesē / nav pieredzes", "pārtraukts": "Pārtraukts" };
const SOURCE: Record<string, string> = { dokuments: "no nolikuma", uzskaite: "no uzskaites", "mapes nosaukums": "pēc mapes nosaukuma" };

function days(date: string, today: string): number {
	return Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);
}

export function Tafele({ onOpen, onAdd }: { onOpen: (projectId: string) => void; onAdd: (init: { sourceDir: string; outputDir: string; name: string; builders: string[] }) => void }) {
	const [data, setData] = useState<{ rows: BoardRow[]; today: string; trackerLoaded: boolean; root: string; stats: { sheet: string; rows: number; submitted: number; won: number; lost: number }[] } | null>(null);
	const [progress, setProgress] = useState("");
	const [showDone, setShowDone] = useState(false);
	const act = useAction();
	const load = () => act.run("load", async () => {
		const r = await api.board.get();
		if (r.ok) setData(r);
		setProgress("");
		return r;
	});
	useEffect(() => {
		void load();
		return onTaskText((scope, text) => scope === "board" && setProgress(text));
	}, []);
	if (!data) return <div className="screen"><ScreenHead title="Konkursu tāfele" what="Ielādē…" />{act.error ? <Banner kind="critical">{act.error}</Banner> : <div className="hint">{progress || "Lasa konkursu mapes…"}</div>}</div>;

	const rows = data.rows.filter((r) => showDone || (r.status !== "atteikts" && r.status !== "iesniegts"));
	const count = (s: BoardStatus) => data.rows.filter((r) => r.status === s).length;
	const week = data.rows.filter((r) => r.deadline && r.status !== "atteikts" && r.status !== "iesniegts" && days(r.deadline.date, data.today) >= 0 && days(r.deadline.date, data.today) <= 7).length;
	const setStatus = (r: BoardRow, s: string) => act.run("st", async () => void (await api.board.setStatus(r.folder, s === "auto" ? null : (s as BoardStatus), r.note)), load);
	const add = (r: BoardRow) => act.run("add", async () => {
		const f = await api.board.projectFolders(r.path);
		onAdd({ ...f, name: r.folder, builders: r.submission.builders });
	});

	return (
		<div className="screen">
			<ScreenHead title="Konkursu tāfele" what={`Visas konkursu mapes no ${data.root}: termiņš, ko saka uzskaite, kas jau sagatavots, un nākamais solis.`} why="Termiņu app ņem no nolikuma (ar citātu), tad no uzskaites, tad no mapes nosaukuma. Ja avoti nesakrīt, rāda agrāko un brīdina — vēlāks nepareizs termiņš ir bīstamāks. Konkursu mapes app tikai lasa — neko tur neveido, nemaina un nepārvieto; darba faili ir katram savā mapē Mani dokumenti\Konkursi." />
			{!data.trackerLoaded && <Banner>Uzskaite nav ielasīta — Reģistri › Konkursu uzskaite › „Ielasīt no Excel”. Bez tās termiņi un lēmumi būs tikai no mapēm.</Banner>}
			{act.error && <Banner kind="critical">{act.error}</Banner>}
			<div className="row">
				{(Object.keys(BOARD_STATUS_LABELS) as BoardStatus[]).map((s) => <span key={s} className="chip">{BOARD_STATUS_LABELS[s]}: {count(s)}</span>)}
				<span className={`chip ${week ? "critical" : ""}`}>termiņš 7 dienās: {week}</span>
				<span className="grow" />
				<label className="row" style={{ gap: 4 }}><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> rādīt arī iesniegtos un atteiktos</label>
				<button disabled={!!act.busy} onClick={load}>{act.busy === "load" ? progress || "Lasa…" : "Atjaunot"}</button>
			</div>
			<div className="table-wrap">
				<table>
					<thead><tr><th>Termiņš</th><th>Konkurss</th><th>Veids</th><th>Uzskaitē</th><th>Paka</th><th>Statuss</th><th>Nākamais solis</th><th /></tr></thead>
					<tbody>
						{rows.map((r) => {
							const d = r.deadline ? days(r.deadline.date, data.today) : null;
							return (
								<tr key={r.folder}>
									<td style={{ whiteSpace: "nowrap", color: d !== null && d >= 0 && d <= 3 && r.status !== "iesniegts" ? "var(--critical)" : undefined }}>
										{r.deadline ? `${r.deadline.date}${r.deadline.time ? " " + r.deadline.time : ""}` : "nav atrasts"}
										{d !== null && <div className="hint">{d < 0 ? `pirms ${-d} d.` : d === 0 ? "šodien" : `pēc ${d} d.`} · {SOURCE[r.deadline!.source]}</div>}
										{r.conflicts.length > 0 && <div className="hint" style={{ color: "var(--warn)" }} title={r.deadline?.cite?.quote}>⚠ arī {r.conflicts.map((c) => `${c.date} (${SOURCE[c.source]})`).join(", ")} — pārbaudi grozījumus</div>}
									</td>
									<td>
										<div>{r.title}</div>
										<div className="hint">{r.code}{r.tracker && <> · uzskaitē: {r.tracker.title.slice(0, 90)}{r.tracker.score < 0.67 ? " (iespējams)" : ""}</>}</div>
										{r.tracker?.eisUrl && <a href={r.tracker.eisUrl} target="_blank" rel="noreferrer" className="hint">EIS</a>}
									</td>
									<td className="small">{[r.tracker?.procedure, r.tracker?.subject].filter(Boolean).join(" · ") || <span className="muted">—</span>}</td>
									<td className="small">{r.tracker?.decision ? DECISION[r.tracker.decision] ?? r.tracker.decision : <span className="muted">—</span>}</td>
									<td className="small">{r.submission.files ? `${r.submission.files} faili` : <span className="muted">tukša</span>}{r.submission.builders.length > 0 && <div className="hint">{r.submission.builders.join(", ")}</div>}</td>
									<td>
										<select value={r.statusBy === "person" ? r.status : "auto"} onChange={(e) => setStatus(r, e.target.value)} aria-label="Statuss">
											<option value="auto">{BOARD_STATUS_LABELS[r.status]} (auto)</option>
											{(Object.keys(BOARD_STATUS_LABELS) as BoardStatus[]).map((s) => <option key={s} value={s}>{BOARD_STATUS_LABELS[s]}</option>)}
										</select>
									</td>
									<td className="small">{r.next}</td>
									<td>{r.projectId ? <button onClick={() => onOpen(r.projectId!)}>Atvērt</button> : r.status !== "atteikts" && <button disabled={!!act.busy} onClick={() => add(r)}>Pievienot app</button>}</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
			{data.stats.length > 0 && (
				<div className="card">
					<h2>Uzskaite pa gadiem</h2>
					<table>
						<thead><tr><th>Gads</th><th>Rindas</th><th>Iesniegti</th><th>Uzvarēti</th><th>Zaudēti</th><th>Uzvaru daļa</th></tr></thead>
						<tbody>{data.stats.map((s) => <tr key={s.sheet}><td>{s.sheet}</td><td>{s.rows}</td><td>{s.submitted}</td><td>{s.won}</td><td>{s.lost}</td><td>{s.won + s.lost ? `${Math.round((100 * s.won) / (s.won + s.lost))} %` : "—"}</td></tr>)}</tbody>
					</table>
				</div>
			)}
		</div>
	);
}
