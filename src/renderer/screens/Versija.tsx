import { useEffect, useState } from "react";
import type { QaItem } from "../../shared/state";
import type { Project } from "../../shared/types";
import { api, type Impact, type StateBundle } from "../api";
import { Banner, CitedValue, ScreenHead, useAction } from "../ui";

const IMPACT_LABEL: Record<Impact, string> = { kriterijs: "maina vērtēšanas kritēriju", prasiba: "maina prasību", redakcionala: "redakcionāla" };
const QA_LABEL: Record<NonNullable<QaItem["impact"]>, string> = { maina_apjomu: "maina apjomu", maina_kriteriju: "maina kritēriju", maina_prasibu: "maina prasību", skaidro: "tikai skaidro" };

/** Shortens a long changed paragraph to the part that differs. */
function short(s: string, max = 420) {
	return s.length > max ? `${s.slice(0, max)} …` : s;
}

export function Versija({ project, bundle, reload }: { project: Project; bundle: StateBundle; reload: () => Promise<void> }) {
	const { state, editions } = bundle;
	const v = state.versions;
	const act = useAction();
	const [original, setOriginal] = useState(v.originalFile ?? editions.guess.original ?? "");
	const [amended, setAmended] = useState(v.amendedFile ?? editions.guess.amended ?? "");
	const [date, setDate] = useState(state.deadline.date.value ?? "");
	const [time, setTime] = useState(state.deadline.time.value ?? "");
	const [source, setSource] = useState<"iub" | "eis" | "nolikums" | "manual">(state.deadline.source ?? "iub");
	useEffect(() => {
		setDate(state.deadline.date.value ?? "");
		setTime(state.deadline.time.value ?? "");
	}, [state.deadline.date.value, state.deadline.time.value]);

	const id = project.id;
	const twoEditions = editions.candidates.length > 1;
	const name = (k: string) => k.replace(/^(source|output):/, "");

	return (
		<div className="screen">
			<ScreenHead
				title="2. Kura versija spēkā"
				what="Nolikumu drīkst grozīt pēc publicēšanas, un komisijas atbildes var mainīt vērtēšanas kritērijus."
				why="Ja strādāsi ar veco redakciju, vari izpildīt prasību, kas vairs nav spēkā."
			/>
			{act.error && <Banner kind="critical">{act.error}</Banner>}
			<div className="hint">Ja dokumenti runā pretī, spēkā ir: komisijas atbildes → grozījumi → nolikumā iekļautās veidlapas → atsevišķi izsniegtās veidlapas → PIP un tehniskā specifikācija. Iepriekšējo konkursu dokumenti prasības nenosaka.</div>

			<div className="card">
				<h2>Nolikuma redakcijas</h2>
				{!twoEditions && editions.candidates.length === 1 && <Banner kind="good">Atrasta viena nolikuma redakcija: <span className="mono">{name(editions.candidates[0])}</span>. Ar to arī strādāsim.</Banner>}
				{editions.candidates.length === 0 && <Banner>Nolikuma fails nav atrasts. Pārbaudi failu veidus 1. solī.</Banner>}
				{twoEditions && (
					<>
						<div className="row">
							<label className="field">Sākotnējā
								<select value={original} onChange={(e) => setOriginal(e.target.value)}>
									<option value="">— izvēlies —</option>
									{editions.candidates.map((k) => <option key={k} value={k}>{name(k)}</option>)}
								</select>
							</label>
							<label className="field">Grozītā
								<select value={amended} onChange={(e) => setAmended(e.target.value)}>
									<option value="">— izvēlies —</option>
									{editions.candidates.map((k) => <option key={k} value={k}>{name(k)}</option>)}
								</select>
							</label>
							<button
								className="primary"
								disabled={!!act.busy || !original || !amended || original === amended}
								onClick={() => act.run("diff", async () => (await api.versions.setEditions(id, original, amended), api.versions.compare(id)), reload)}
							>
								Salīdzināt
							</button>
						</div>
						{v.diffedAt && (
							<>
								<div className="row">
									<strong>{v.changes.length} izmaiņas</strong>
									<span className="grow" />
									<button disabled={!!act.busy || v.changes.length === 0} onClick={() => act.run("classify", () => api.versions.classify(id), reload)}>
										{act.busy === "classify" ? "Aģents lasa…" : "Piedāvāt ietekmi (aģents)"}
									</button>
								</div>
								{v.changes.length === 0 && <Banner kind="good">Starp redakcijām satura atšķirību nav.</Banner>}
								{v.changes.map((c, i) => (
									<div key={i} className="card" style={{ background: "var(--bg)" }}>
										{c.before && <div className="small"><span className="muted">Bija: </span>{short(c.before)}</div>}
										{c.after && <div className="small"><span className="muted">Kļuva: </span>{short(c.after)}</div>}
										<div className="row small">
											{(Object.keys(IMPACT_LABEL) as Impact[]).map((k) => (
												<label key={k} className="row" style={{ gap: 4 }}>
													<input type="radio" name={`chg${i}`} checked={c.impact === k} onChange={() => api.versions.confirmChange(id, i, k).then(reload)} />
													{IMPACT_LABEL[k]}
												</label>
											))}
											{c.impact && c.impactBy === "model" && !c.confirmed && (
												<>
													<span className="manual">piedāvā aģents —</span>
													<button onClick={() => api.versions.confirmChange(id, i, null).then(reload)}>Apstiprināt</button>
												</>
											)}
											{c.confirmed && <span style={{ color: "var(--good)" }}>● apstiprināts</span>}
										</div>
									</div>
								))}
							</>
						)}
						<div className="row">
							<strong>Strādājam ar:</strong>
							{(["original", "amended"] as const).map((w) => (
								<label key={w} className="row" style={{ gap: 4 }}>
									<input type="radio" name="inforce" checked={v.inForce === w} onChange={() => api.versions.setInForce(id, w).then(reload)} />
									{w === "original" ? "sākotnējo" : "grozīto redakciju"}
								</label>
							))}
						</div>
					</>
				)}
				{!twoEditions && editions.candidates.length === 1 && (
					<div className="row">
						<button onClick={() => api.versions.setInForce(id, "original").then(reload)} disabled={v.inForce === "original"}>Apstiprināt kā spēkā esošo</button>
						{v.inForce && <span style={{ color: "var(--good)" }}>● apstiprināts</span>}
					</div>
				)}
			</div>

			<div className="card">
				<div className="row spread">
					<h2>Komisijas atbildes</h2>
					<button disabled={!!act.busy} onClick={() => act.run("qa", () => api.versions.readQa(id), reload)}>{act.busy === "qa" ? "Aģents lasa…" : "Nolasīt atbildes"}</button>
				</div>
				<div className="hint">Ietekmi piedāvā aģents, tu apstiprini. Pie katra teksts ir burtisks citāts no dokumenta.</div>
				{v.qa.length === 0 && <div className="muted">{v.qaReadAt ? "Atbilžu nav atrasts." : "Vēl nav nolasīts."}</div>}
				{v.qa.length > 0 && (
					<table>
						<thead><tr><th>Nr</th><th>Jautājums</th><th>Atbilde</th><th>Ietekme</th><th>✓</th></tr></thead>
						<tbody>
							{v.qa.map((q, i) => (
								<tr key={`${q.file}${i}`} style={{ height: "auto" }}>
									<td>{q.nr}</td>
									<td title={q.file}>{short(q.question, 180)}</td>
									<td>{short(q.answer, 180)}</td>
									<td>
										<select value={q.impact ?? ""} onChange={(e) => api.versions.setQaImpact(id, i, e.target.value as QaItem["impact"]).then(reload)}>
											{(Object.keys(QA_LABEL) as (keyof typeof QA_LABEL)[]).map((k) => <option key={k} value={k}>{QA_LABEL[k]}</option>)}
										</select>
									</td>
									<td><input type="checkbox" checked={q.confirmed} aria-label="Apstiprināt" onChange={(e) => api.versions.confirmQa(id, i, e.target.checked).then(reload)} /></td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>

			<div className="card">
				<div className="row spread">
					<h2>Veidlapu salīdzinājums</h2>
					<button disabled={!!act.busy} onClick={() => act.run("tpl", () => api.versions.compareTemplates(id), reload)}>Salīdzināt veidlapas</button>
				</div>
				<div className="hint">Atsevišķi izsniegtās veidlapas tiek salīdzinātas ar tām, kas iekļautas spēkā esošajā nolikumā. Atšķirības gadījumā pilda pilnāko — to, kas ir nolikumā.</div>
				{!v.templatesComparedAt && <div className="muted">Vēl nav salīdzināts.</div>}
				{v.templates.map((t) => (
					<div key={t.distributedFile}>
						{t.equal ? (
							<div className="small"><span style={{ color: "var(--good)" }}>● </span>{t.distributedFile} — {t.embeddedFile ? "vienādas" : "nolikumā nav iekļautas veidnes"}</div>
						) : (
							<Banner kind="critical">
								<strong>{t.distributedFile}:</strong> izsniegtajā veidlapā {t.distributedRows} rindas, nolikumā {t.embeddedRows}.
								{t.missingLabels.length > 0 && <> Trūkst izsniegtajā: <em>{t.missingLabels.join("; ")}</em>.</>}
								{t.extraLabels && t.extraLabels.length > 0 && <> Lieka izsniegtajā: <em>{t.extraLabels.join("; ")}</em>.</>} Aizpildi pēc nolikuma — tur ir pilnākā versija.
							</Banner>
						)}
					</div>
				))}
			</div>

			<div className="card">
				<div className="row spread">
					<h2>Iesniegšanas termiņš</h2>
					<button disabled={!!act.busy} onClick={() => act.run("dl", () => api.versions.readDeadline(id), reload)}>{act.busy === "dl" ? "Aģents lasa…" : "Nolasīt no dokumentiem"}</button>
				</div>
				<div className="hint">Termiņš parasti nav nolikumā — to skatās IUB paziņojumā par līgumu vai EIS kartītē. Ja tā nav mapē, ievadi pati.</div>
				<div className="row">
					<label className="field">Datums<input value={date} onChange={(e) => setDate(e.target.value)} placeholder="13.07.2026" style={{ width: 120 }} /></label>
					<label className="field">Laiks<input value={time} onChange={(e) => setTime(e.target.value)} placeholder="10:00" style={{ width: 80 }} /></label>
					{(["iub", "eis", "nolikums", "manual"] as const).map((s) => (
						<label key={s} className="row" style={{ gap: 4 }}>
							<input type="radio" name="dlsrc" checked={source === s} onChange={() => setSource(s)} />
							{{ iub: "IUB paziņojums", eis: "EIS kartīte", nolikums: "nolikums", manual: "ievadīts ar roku" }[s]}
						</label>
					))}
					<button className="primary" disabled={!date} onClick={() => act.run("save", async () => api.versions.setDeadline(id, date, time, source), reload)}>Saglabāt</button>
				</div>
				<div className="small">
					Nolasīts: <CitedValue c={state.deadline.date} /> <CitedValue c={state.deadline.time} />
					{state.deadline.source && <span className="muted"> · avots: {state.deadline.source}</span>}
				</div>
			</div>
		</div>
	);
}
