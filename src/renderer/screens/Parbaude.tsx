import { useState } from "react";
import type { CheckRun, Finding } from "../../shared/checks";
import type { StepId } from "../../shared/state";
import type { Project } from "../../shared/types";
import { api, type StateBundle } from "../api";
import { Banner, ScreenHead, useAction } from "../ui";

const ICON = { fail: "✗", warn: "⚠", ok: "✓", na: "⊘" } as const;
const COLOR = { fail: "var(--critical)", warn: "var(--warn)", ok: "var(--good)", na: "var(--muted)" } as const;
const STEP_NAME: Partial<Record<StepId, string>> = { versija: "2. Kura versija", prasibas: "3. Ko prasa", kas: "5. Kas ko dara", aizpildit: "6. Aizpildīt", pieradijumi: "7. Pierādījumi" };

/** 8. Pārbaude — exact checks done in code, plus the substance checks the model reads and code verifies. */
export function Parbaude({ project, bundle, reload, go }: { project: Project; bundle: StateBundle; reload: () => Promise<void>; go?: (step: StepId) => void }) {
	const act = useAction();
	const [code, setCode] = useState((bundle.state.projectCode as string | null | undefined) ?? "");
	const [unreadable, setUnreadable] = useState<string[]>([]);
	const run = bundle.state.checks as CheckRun | undefined;
	const ack = (bundle.state.checkAck as Record<string, true> | undefined) ?? {};
	const findings = run?.findings ?? [];
	const by = (s: Finding["status"]) => findings.filter((f) => f.status === s);
	const open = findings.filter((f) => (f.status === "fail" || f.status === "warn") && !ack[f.id]);

	return (
		<div className="screen">
			<ScreenHead
				title="8. Pārbaude"
				what="Pārbaudes pirms iesniegšanas. Tās atrod tieši tās kļūdas, kas iepriekš maksājušas punktus: nesakritīgas lomas, aizmirstus norādījumus, cita konkursa datus."
				why="Pārbaude tikai nolasa — neko dokumentos nemaina. Katra atrasta lieta pasaka, ko tā nozīmē un kur to labot."
			/>
			{act.error && <Banner kind="critical">{act.error}</Banner>}
			<div className="card">
				<div className="row">
					<label className="small">Projekta kods (no paraugmodeļu prasībām)&nbsp;
						<input value={code} placeholder="piem. KRB" maxLength={6} style={{ width: 90 }} onChange={(e) => setCode(e.target.value.toUpperCase())} onBlur={() => api.checks.setCode(project.id, code.trim() || null)} />
					</label>
					<button className="primary" disabled={!!act.busy} onClick={() => act.run("run", async () => { await api.checks.setCode(project.id, code.trim() || null); const r = await api.checks.run(project.id); setUnreadable(r.unreadable); }, reload)}>
						{act.busy === "run" ? "Pārbauda…" : "Pārbaudīt tagad"}
					</button>
					<button disabled={!!act.busy} title="Modelis izlasa abas puses; kods pārbauda katru citātu" onClick={() => act.run("substance", async () => { const r = await api.checks.substance(project.id); if (!r.ok) return { ok: false, error: r.errors.join(" · ") }; }, reload)}>
						{act.busy === "substance" ? "Lasa saturu…" : "Pārbaudīt saturu"}
					</button>
				</div>
				{!run && <div className="small" style={{ marginTop: 8 }}>Vēl nav pārbaudīts. Vispirms izveido dokumentus 6. solī.</div>}
			</div>

			{run && (
				<div className="row" style={{ gap: 8 }}>
					<span className="chip critical">✗ {by("fail").length} kļūdas</span>
					<span className="chip">⚠ {by("warn").length} jāpārbauda</span>
					<span className="chip">✓ {by("ok").length} kārtībā</span>
					<span className="chip">⊘ {by("na").length} neattiecas</span>
					<span className="small">Pārbaudīts {new Date(run.ranAt).toLocaleString("lv-LV")}</span>
				</div>
			)}
			{unreadable.length > 0 && <Banner kind="critical">Nevar nolasīt: {unreadable.join("; ")}</Banner>}
			{run && open.length === 0 && <Banner kind="good">Visas kļūdas un brīdinājumi ir novērsti vai apzināti atstāti.</Banner>}

			{(["fail", "warn", "ok"] as const).map((st) =>
				by(st).map((f) => (
					<div key={f.id} className="card" style={{ borderLeft: `4px solid ${COLOR[st]}` }}>
						<div className="row" style={{ justifyContent: "space-between" }}>
							<h2 style={{ margin: 0, color: COLOR[st] }}>{ICON[st]} {f.title} {f.kind === "satura" && <span className="small">(satura pārbaude)</span>}</h2>
							{st !== "ok" && (
								<label className="small"><input type="checkbox" checked={!!ack[f.id]} onChange={(e) => act.run("ack", () => api.checks.ack(project.id, f.id, e.target.checked), reload)} /> Redzēju, atstāju</label>
							)}
						</div>
						<div style={{ marginTop: 6 }}>{f.detail}</div>
						{f.where.length > 0 && <div className="small" style={{ marginTop: 4 }}>Kur: {f.where.join(" · ")}</div>}
						{f.cites?.map((c, i) => (
							<div key={i} className="small" style={{ marginTop: 4 }}>
								<span className="mono">{c.file}</span>: „{c.quote}”
							</div>
						))}
						{st !== "ok" && f.step && go && (
							<div style={{ marginTop: 8 }}><button onClick={() => go(f.step!)}>{f.fix ?? "Labot"} → {STEP_NAME[f.step] ?? f.step}</button></div>
						)}
					</div>
				)),
			)}

			{by("na").length > 0 && (
				<details className="card">
					<summary>⊘ Neattiecas šim konkursam ({by("na").length})</summary>
					{by("na").map((f) => (
						<div key={f.id} className="small" style={{ marginTop: 6 }}><b>{f.title}</b> — {f.detail}</div>
					))}
				</details>
			)}
		</div>
	);
}
