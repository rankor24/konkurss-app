import { useEffect, useState } from "react";
import type { Project } from "../../shared/types";
import { api, type FeasibilityView, type StateBundle } from "../api";
import { Banner, ScreenHead, useAction } from "../ui";

/** 4. Vai varam pieteikties — a verdict computed from the confirmed requirements and our registers, before any filling starts. */
export function Varam({ project, bundle, reload }: { project: Project; bundle: StateBundle; reload: () => Promise<void> }) {
	const [v, setV] = useState<FeasibilityView | null>(null);
	const [apply, setApply] = useState<"yes" | "no" | null>(null);
	const [reason, setReason] = useState("");
	const act = useAction();
	const hasReqs = !!bundle.state.requirements.readAt.specialisti || !!bundle.state.requirements.readAt.vertesana;

	useEffect(() => {
		if (!hasReqs) return;
		api.v1.feasibility(project.id).then((r) => {
			setV(r);
			setApply(r.choices.decision.apply);
			setReason(r.choices.decision.reason);
		});
	}, [project.id, hasReqs, bundle.state.requirements]);

	const head = <ScreenHead title="4. Vai varam pieteikties" what="Pirms sāc aizpildīt, app salīdzina konkursa prasības ar mūsu reģistriem un pasaka, vai vispār varam kvalificēties un cik punktus reāli varam iegūt." />;
	if (!hasReqs) return <div className="screen">{head}<Banner>Vispirms 3. solī izlasi un pārbaudi speciālistus un vērtēšanas kritērijus — no tiem tiek rēķināts šis atzinums.</Banner></div>;
	if (!v) return <div className="screen">{head}Rēķina…</div>;
	const f = v.feasibility;

	return (
		<div className="screen">
			{head}
			{act.error && <Banner kind="critical">{act.error}</Banner>}
			<div className="card">
				<h2>Speciālisti — {f.specialistsCovered} no {f.specialists.length} prasībām</h2>
				{f.specialists.map((s) => (
					<div key={s.required} className="small">
						<span style={{ color: s.covered ? "var(--good)" : "var(--critical)" }}>{s.covered ? "✓" : "✗"}</span> {s.required}
						{s.covered ? <span className="muted"> — {s.by.map((b) => `${b.name}${b.type !== "A" ? ` (${b.type === "B" ? "apakšuzņēmējs" : "atsevišķs līgums"})` : ""}`).join(", ")}</span> : <span style={{ color: "var(--critical)" }}> — reģistrā nav neviena. Vajag apakšuzņēmēju.</span>}
					</div>
				))}
			</div>
			<div className="card">
				<h2>Pieredze — {f.slots.filter((s) => s.met).length} no {f.slots.length} vietām</h2>
				{f.slots.length === 0 && <div className="muted">Konkursā nav pieredzes prasību vai kritēriju, kam vajag objektus.</div>}
				{f.slots.map((s) => (
					<div key={s.slot.id} className="small">
						<span style={{ color: s.met ? "var(--good)" : "var(--critical)" }}>{s.met ? "✓" : "✗"}</span> {s.slot.title}: der {s.qualifying.length} no vajadzīgajiem {s.needed}
						{s.excluded.length > 0 && <div className="hint">neder: {s.excluded.map((e) => `${e.object.name} — ${e.reasons.join("; ")}`).join(" · ")}</div>}
					</div>
				))}
			</div>
			<div className="card">
				<h2>Reālais punktu maksimums</h2>
				<div className="mono">Cena {f.points.price} (atkarīgs no konkurentiem) + pārējie sasniedzamie {f.points.reachable} = {f.points.price + f.points.reachable} no {f.points.total}</div>
				{f.points.lost.map((l) => <Banner key={l.name}>{l.name}: līdz {l.points} punktiem nav sasniedzami — {l.why}.</Banner>)}
				{f.blockers.length > 0 && <Banner kind="critical">{f.blockers.map((b) => <div key={b}>{b}</div>)}Ja to neatrisina, piedāvājumu var noraidīt.</Banner>}
				{f.blockers.length === 0 && <Banner kind="good">Šķēršļu kvalifikācijai nav.</Banner>}
			</div>
			<div className="card">
				<h2>Lēmums</h2>
				<div className="row">
					{(["yes", "no"] as const).map((o) => (
						<label key={o} className="row" style={{ gap: 4 }}>
							<input type="radio" name="apply" checked={apply === o} onChange={() => setApply(o)} /> {o === "yes" ? "Pieteiksimies" : "Nepieteiksimies"}
						</label>
					))}
					<input className="grow" placeholder="Pamatojums" value={reason} onChange={(e) => setReason(e.target.value)} />
					<button className="primary" disabled={!apply || !!act.busy} onClick={() => act.run("save", async () => void (await api.v1.saveDecision(project.id, { apply, reason })), reload)}>Saglabāt</button>
				</div>
			</div>
		</div>
	);
}
