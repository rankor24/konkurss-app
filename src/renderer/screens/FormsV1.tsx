import { useEffect, useState } from "react";
import type { FillSheet, SheetItem, TechState } from "../../shared/state";
import type { Project } from "../../shared/types";
import { api, type StateBundle } from "../api";
import { Banner, useAction } from "../ui";

/** V1 forms: every empty cell has a source ("No kurienes"), the person can change it, missing data blocks the file. */
export function FormsV1({ project }: { project: Project; bundle: StateBundle }) {
	const id = project.id;
	const act = useAction();
	const [forms, setForms] = useState<{ key: string; rel: string; kind: string }[]>([]);
	const [key, setKey] = useState("");
	const [sheet, setSheet] = useState<FillSheet | null>(null);
	const [vocab, setVocab] = useState<{ id: string; label: string }[]>([]);
	const [unplaced, setUnplaced] = useState<string[]>([]);
	const [made, setMade] = useState<string[]>([]);
	const [info, setInfo] = useState("");

	useEffect(() => {
		api.v1.forms(id).then((f) => {
			setForms(f);
			setKey((k) => k || f.at(-1)?.key || "");
		});
	}, [id]);
	useEffect(() => {
		setSheet(null);
		setUnplaced([]);
		if (key) {
			api.fill.sheet(id, key).then(setSheet);
			api.v1.vocabulary(id).then(setVocab);
		}
	}, [id, key]);

	const refresh = async () => {
		setSheet(await api.fill.sheet(id, key));
		setVocab(await api.v1.vocabulary(id));
	};
	const cells = (sheet?.items ?? []).filter((i) => i.kind === "cell");
	const open = cells.filter((i) => i.status === "missing");

	return (
		<div className="card">
			<h2>Veidlapas (pieteikums, kvalifikācija, finanšu piedāvājums, apliecinājumi)</h2>
			<p className="hint">Katram laukam ir avots („No kurienes”). Ja aģents piesaisti izvēlējies nepareizi, nomaini — app to atcerēsies nākamajai līdzīgai veidlapai.</p>
			{act.error && <Banner kind="critical">{act.error}</Banner>}
			{forms.length === 0 && <Banner>Konkursa mapē nav atrasta neviena veidlapa (1. solī pārbaudi dokumentu veidus).</Banner>}
			<div className="row">
				<select value={key} onChange={(e) => setKey(e.target.value)} style={{ minWidth: 420 }}>
					{forms.map((f) => <option key={f.key} value={f.key}>{f.rel}</option>)}
				</select>
				<button className="primary" disabled={!!act.busy || !key} onClick={() => act.run("bind", async () => {
					const r = await api.v1.bindForm(id, key);
					if (r.ok) {
						setUnplaced(r.unplaced);
						setInfo(`No atmiņas: ${r.fromMemory} · aģents piedāvāja: ${r.fromModel} · bez piesaistes: ${r.unbound}`);
					}
					return r;
				}, refresh)}>{act.busy === "bind" ? "Piesaista…" : "Piesaistīt datus"}</button>
				{info && <span className="hint">{info}</span>}
			</div>
			{unplaced.length > 0 && (
				<Banner kind="critical">
					Šajā veidlapā nav rindas prasītajam speciālistam: <strong>{unplaced.join("; ")}</strong>. Izsniegtā veidlapa var būt vecāka par nolikumā iekļauto — aizpildi pēc nolikuma versijas (2. solis → Veidlapu salīdzinājums).
				</Banner>
			)}

			{sheet && (
				<div className="table-wrap">
					<table>
						<thead><tr><th /><th>Kas jāieraksta</th><th>No kurienes</th><th>Kas tur būs</th><th /></tr></thead>
						<tbody>
							{cells.map((it: SheetItem) => (
								<tr key={it.slotId} style={{ height: "auto" }} className={it.status === "missing" ? "missingrow" : ""}>
									<td style={{ color: it.status === "missing" ? "var(--warning)" : it.status === "na" ? "var(--ink-2)" : "var(--good)" }}>{it.status === "missing" ? "○" : it.status === "na" ? "⊘" : "●"}</td>
									<td style={{ width: 240 }}>
										<div>{it.label}</div>
										{it.heading && <div className="hint">{it.heading.split(" › ").pop()}</div>}
									</td>
									<td style={{ width: 280 }}>
										<select value={it.binding ?? ""} aria-label={`No kurienes: ${it.label}`} onChange={(e) => e.target.value && act.run("b", async () => api.v1.setBinding(id, key, it.slotId, e.target.value), refresh)}>
											<option value="">— izvēlies —</option>
											{vocab.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
											{it.binding && !vocab.some((v) => v.id === it.binding) && <option value={it.binding}>{it.binding}</option>}
										</select>
										{it.bindingBy === "model" && !it.bindingOk && <button className="link" onClick={() => api.v1.confirmBinding(id, key, it.slotId).then(refresh)}> pareizi</button>}
									</td>
									<td>
										{it.value ? <span style={{ whiteSpace: "pre-wrap" }}>{it.value}</span> : <span className="missing">trūkst</span>}
										{it.note && <div className="hint">{it.note}</div>}
									</td>
									<td>{it.status === "missing" && <button onClick={() => api.v1.notApplicable(id, key, it.slotId).then(refresh)} title="Veidlapā būs „---”">neattiecas</button>}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
			{sheet && open.length > 0 && <Banner>{open.length} vietas bez datiem — failu neizveidos, kamēr tās nav piesaistītas, ievadītas vai atzīmētas kā „neattiecas”.</Banner>}
			<div className="row">
				<button className="primary" disabled={!sheet || !!act.busy} onClick={() => act.run("gen", async () => {
					const r = await api.v1.generateForm(id, key);
					if (r.ok) setMade((m) => [r.file, ...m]);
					return r;
				}, refresh)}>{act.busy === "gen" ? "Raksta…" : "Izveidot failu"}</button>
				{project.builders.length > 0 && (
					<button disabled={!sheet || !!act.busy} title="Katram būvniekam sava kopija ar viņa nosaukumu, reģ. Nr. un paraksttiesīgo no būvnieku reģistra" onClick={() => act.run("copies", async () => {
						const r = await api.v1.builderCopies(id, key);
						if (r.ok) {
							setMade((m) => [...r.files, ...m]);
							if (r.blocked.length) act.setNote(`Neizveidotas: ${r.blocked.join("; ")}.`);
						}
						return r;
					}, refresh)}>{act.busy === "copies" ? "Raksta…" : `Būvnieku kopijas (${project.builders.length})`}</button>
				)}
				{made.map((f) => <span key={f} className="mono small">{f}</span>)}
				{act.note && <span className="hint">{act.note}</span>}
			</div>
		</div>
	);
}

/** Technical proposal: the earlier text stays; proposed changes are accepted or rejected paragraph by paragraph. */
export function TechV1({ project, bundle, reload }: { project: Project; bundle: StateBundle; reload: () => Promise<void> }) {
	const id = project.id;
	const act = useAction();
	const tech: TechState | undefined = bundle.state.tech;
	const [made, setMade] = useState("");
	const [text, setText] = useState<Record<number, string>>({});

	return (
		<div className="card">
			<h2>Tehniskais piedāvājums</h2>
			<p className="hint">Netiek rakstīts no nulles. Izvēlies iepriekš veiksmīgi iesniegtu tehnisko piedāvājumu; aģents piedāvā mainīt tikai rindkopas ar iepriekšējā konkursa faktiem, katru ar citātu no jaunā konkursa. Tu pieņem vai noraidi katru. Pārējais teksts paliek tieši tāds pats.</p>
			{act.error && <Banner kind="critical">{act.error}</Banner>}
			<div className="row">
				<button disabled={!!act.busy} onClick={() => act.run("tech", async () => {
					const f = await api.v1.pickFile("Izvēlies iepriekš iesniegtu tehnisko piedāvājumu (.docx)");
					if (!f) return;
					return api.v1.techProposal(id, f);
				}, reload)}>{act.busy === "tech" ? "Aģents lasa…" : tech ? "Izvēlēties citu un nolasīt" : "Izvēlēties iepriekšējo piedāvājumu"}</button>
				{tech && <span className="mono small">{tech.boilerplate}</span>}
			</div>
			{tech && tech.changes.length === 0 && <Banner kind="good">Aģents neatrada rindkopas, kas jāmaina.</Banner>}
			{tech?.changes.map((c) => (
				<div key={c.i} className="card" style={{ background: "var(--bg)" }}>
					<div className="small"><span className="muted">Bija: </span>{c.before}</div>
					<textarea rows={3} value={text[c.i] ?? c.after} onChange={(e) => setText({ ...text, [c.i]: e.target.value })} style={{ width: "100%" }} aria-label="Jaunais teksts" />
					{c.cites.map((q, k) => <div key={k} className="quote-pop"><div className="hint">{q.file}</div>“{q.quote}”</div>)}
					<div className="hint">{c.why}</div>
					<div className="row">
						<button className={c.decision === "accept" ? "primary" : ""} onClick={() => (text[c.i] !== undefined && text[c.i] !== c.after ? api.v1.techEdit(id, c.i, text[c.i]) : api.v1.techDecision(id, c.i, "accept")).then(reload)}>Pieņemt</button>
						<button className={c.decision === "reject" ? "primary" : ""} onClick={() => api.v1.techDecision(id, c.i, "reject").then(reload)}>Atmest</button>
						{c.decision === null && <span className="hint">vēl nav izlemts</span>}
					</div>
				</div>
			))}
			{tech && tech.changes.length > 0 && (
				<div className="row">
					<button className="primary" disabled={!!act.busy} onClick={() => act.run("tgen", async () => {
						const r = await api.v1.techGenerate(id);
						if (r.ok) setMade(`${r.file} — pieņemtas ${r.applied}, vēl neizlemtas ${r.pending}`);
						return r;
					}, reload)}>Izveidot failu</button>
					{made && <span className="mono small">{made}</span>}
				</div>
			)}
		</div>
	);
}
