import { useEffect, useState } from "react";
import { emptyCloseout, type Closeout } from "../../shared/checks";
import type { Project } from "../../shared/types";
import { api, type StateBundle } from "../api";
import { Banner, ScreenHead, useAction } from "../ui";

const RESULTS: { id: NonNullable<Closeout["result"]>; label: string }[] = [
	{ id: "gaida", label: "Gaidām rezultātu" },
	{ id: "uzvara", label: "Uzvara" },
	{ id: "zaudejums", label: "Zaudējums" },
	{ id: "atcelts", label: "Konkurss atcelts" },
];

/** 10. Rezultāts — what was submitted, what happened, what to carry into the next tender, and the commission's clarification requests. */
export function Rezultats({ project }: { project: Project; bundle: StateBundle; reload: () => Promise<void> }) {
	const [c, setC] = useState<Closeout>(emptyCloseout());
	const [request, setRequest] = useState("");
	const [secret, setSecret] = useState(false);
	const [draft, setDraft] = useState<{ file: string; answered: number; unsupported: { question: string; why: string }[] } | null>(null);
	const act = useAction();
	useEffect(() => void api.closeout.get(project.id).then(setC), [project.id]);
	const save = (patch: Partial<Closeout>) => api.closeout.save(project.id, patch).then(setC);

	return (
		<div className="screen">
			<ScreenHead agent
				title="10. Rezultāts"
				what="Ko iesniedza, kas notika, un ko no tā paņemt nākamajam konkursam."
				why="Šeit beidzas konkurss: rezultāts, punkti, mācība un termiņi pēc uzvaras. Pieredzes objektu pievieno reģistram tikai tu pats ar pogu."
			/>
			{act.error && <Banner kind="critical">{act.error}</Banner>}
			<div className="card">
				<div className="row">
					<label className="small">Iesniegts&nbsp;<input type="date" value={c.submittedAt?.slice(0, 10) ?? ""} onChange={(e) => save({ submittedAt: e.target.value || null })} /></label>
					<label className="small">Rezultāts&nbsp;
						<select value={c.result ?? ""} onChange={(e) => save({ result: (e.target.value || null) as Closeout["result"] })}>
							<option value="">— vēl nav —</option>
							{RESULTS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
						</select>
					</label>
				</div>
			</div>

			<div className="card">
				<h2>Punkti pa kritērijiem</h2>
				<div className="small">Ievadi no komisijas protokola. Tukšs = nav zināms.</div>
				<table>
					<thead><tr><th>Kritērijs</th><th>Mūsu</th><th>Labākais</th><th /></tr></thead>
					<tbody>
						{c.points.map((p, i) => (
							<tr key={i} style={{ height: "auto" }}>
								{(["criterion", "ours", "best"] as const).map((k) => (
									<td key={k}><input value={p[k]} onChange={(e) => setC({ ...c, points: c.points.map((q, j) => (j === i ? { ...q, [k]: e.target.value } : q)) })} onBlur={() => save({ points: c.points })} /></td>
								))}
								<td><button onClick={() => save({ points: c.points.filter((_, j) => j !== i) })}>Noņemt</button></td>
							</tr>
						))}
					</tbody>
				</table>
				<button onClick={() => save({ points: [...c.points, { criterion: "", ours: "", best: "" }] })}>Pievienot rindu</button>
			</div>

			<div className="card">
				<h2>Ko mācāmies</h2>
				<textarea rows={4} style={{ width: "100%" }} value={c.lessons} placeholder="Kas strādāja, kur zaudējām punktus, ko nākamreiz darīt citādi" onChange={(e) => setC({ ...c, lessons: e.target.value })} onBlur={() => save({ lessons: c.lessons })} />
			</div>

			<div className="card">
				<h2>Termiņi pēc uzvaras</h2>
				<div className="small">Līguma slēgšana, izpildes nodrošinājums, apdrošināšana — nolasīti no nolikuma ar citātu.</div>
				{c.postWin.length === 0 && <div className="small" style={{ marginTop: 6 }}>Vēl nav nolasīti.</div>}
				{c.postWin.map((w, i) => (
					<div key={i} style={{ marginTop: 6 }}>
						<b>{w.what}</b> — {w.due}
						{w.cite && <div className="small"><span className="mono">{w.cite.file}</span>: „{w.cite.quote}”</div>}
					</div>
				))}
				<div style={{ marginTop: 8 }}>
					<button disabled={!!act.busy} onClick={() => act.run("postwin", async () => { const r = await api.closeout.postWin(project.id); if (!r.ok) return r; }, async () => void setC(await api.closeout.get(project.id)))}>
						{act.busy === "postwin" ? "Lasa nolikumu…" : "Nolasīt termiņus no nolikuma"}
					</button>
				</div>
			</div>

			<div className="card">
				<h2>Nākamajam konkursam</h2>
				{c.addedObjectId ? (
					<div className="small">✓ Objekts šim konkursam reģistram jau pievienots. Atver Reģistri un papildini platību, gadu, lomu un pierādījumu failus.</div>
				) : (
					<>
						<div className="small">Pievieno šo darbu objektu pieredzes reģistram. App ieliks tikai to, ko tā zina; pārējo papildini pats.</div>
						<button style={{ marginTop: 6 }} disabled={!!act.busy} onClick={() => act.run("object", async () => { const r = await api.closeout.addObject(project.id); if (!r.ok) return r; }, async () => void setC(await api.closeout.get(project.id)))}>Pievienot objektu reģistram</button>
					</>
				)}
			</div>

			<div className="card">
				<h2>Komisija lūdz precizēt</h2>
				<div className="small">Ielīmē komisijas pieprasījumu. Atbilde tiek sagatavota tikai no jau iesniegtajiem dokumentiem, ar „negrozot saturu”, vienā dokumentā, ko pārvērst vienā PDF un parakstīt.</div>
				<textarea rows={5} style={{ width: "100%", marginTop: 6 }} value={request} onChange={(e) => setRequest(e.target.value)} placeholder="Komisijas jautājumi…" />
				<label className="small" style={{ display: "block", marginTop: 6 }}><input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} /> Pievienot komercnoslēpuma rindu</label>
				<div style={{ marginTop: 8 }}>
					<button className="primary" disabled={!!act.busy || !request.trim()} onClick={() => act.run("clarify", async () => { const r = await api.closeout.clarify(project.id, request, secret); if (!r.ok) return r; setDraft(r.result); })}>
						{act.busy === "clarify" ? "Raksta…" : "Sagatavot atbildi"}
					</button>
				</div>
				{draft && (
					<div style={{ marginTop: 10 }}>
						<Banner kind="good">Atbilde saglabāta: <span className="mono">{draft.file}</span>. Ar pamatojumu: {draft.answered}.</Banner>
						{draft.unsupported.length > 0 && (
							<Banner>
								Šiem jautājumiem iesniegtie dokumenti atbildi nedod — dokumentā tie atzīmēti [aizpildīt], raksti pats:
								<ul>{draft.unsupported.map((u, i) => <li key={i}>{u.question} <span className="small">({u.why})</span></li>)}</ul>
							</Banner>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
