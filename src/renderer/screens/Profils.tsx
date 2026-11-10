// Phase 8: the tender profile card on step 1 — procedure, subject, our role, daļas, how the offer is submitted.
import { useEffect, useState } from "react";
import { OUR_ROLES, PROCEDURES, SUBJECTS, SUBMISSIONS, type OurRole, type Procedure, type Subject, type SubmissionChannel, type TenderProfile } from "../../shared/profile";
import type { Cited } from "../../shared/state";
import type { Project } from "../../shared/types";
import { api } from "../api";
import { Banner, CitedValue, useAction } from "../ui";

function Pick<T extends string>({ label, c, options, onChange }: { label: string; c: Cited<T>; options: Record<string, string> | readonly string[]; onChange: (c: Cited<T>) => void }) {
	const entries = Array.isArray(options) ? options.map((o) => [o, o] as const) : Object.entries(options);
	return (
		<div className="row">
			<span style={{ width: 170 }}>{label}</span>
			<select value={c.value ?? ""} onChange={(e) => onChange(e.target.value ? { value: e.target.value as T, status: "manual" } : { value: null, status: "missing" })}>
				<option value="">— nav noteikts —</option>
				{entries.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
			</select>
			<CitedValue c={c} format={() => ""} />
			{c.note && <span className="hint">{c.note}</span>}
		</div>
	);
}

/** Framework-agreement mini-tender: start from an earlier tender's specialists, objects and roles. */
function Inherit({ project, reload }: { project: Project; reload: () => Promise<void> }) {
	const [list, setList] = useState<Project[]>([]);
	const [from, setFrom] = useState("");
	const act = useAction();
	useEffect(() => void api.projects.list().then((ps) => setList(ps.filter((x) => x.id !== project.id))), [project.id]);
	if (list.length === 0) return null;
	return (
		<div className="row">
			<span style={{ width: 170 }}>Vispārīgā vienošanās</span>
			<select value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Konkurss, no kura pārņemt">
				<option value="">— konkurss, no kura pārņemt —</option>
				{list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
			</select>
			<button disabled={!from || !!act.busy} onClick={() => act.run("inh", async () => void (await api.pack.inherit(project.id, from)), reload)}>Pārņemt speciālistus, objektus un lomas</button>
			{act.error && <span style={{ color: "var(--critical)" }}>{act.error}</span>}
		</div>
	);
}

export function ProfileCard({ project, profile, reload }: { project: Project; profile: TenderProfile | undefined; reload: () => Promise<void> }) {
	const act = useAction();
	const [draft, setDraft] = useState<TenderProfile | null>(null);
	const p = draft ?? profile;
	const read = () => act.run("read", async () => {
		const r = await api.profile.read(project.id);
		if (r.ok) setDraft(null);
		return r;
	}, reload);
	const save = (confirmed: boolean) => act.run("save", async () => {
		await api.profile.save(project.id, { ...p!, confirmed });
		setDraft(null);
	}, reload);
	const edit = (patch: Partial<TenderProfile>) => setDraft({ ...p!, ...patch, confirmed: false });
	return (
		<div className="card">
			<h2>Konkursa kārtība</h2>
			<p className="hint">Kāda procedūra, kas tiek pirkts, kāda ir mūsu loma, vai ir daļas un kā piedāvājumu iesniedz. App to nolasa no nolikuma teksta ar citātu; tu apstiprini. No tā atkarīgs, kuri soļi attiecas un kam tiek gatavotas paketes.</p>
			{act.error && <Banner kind="critical">{act.error}</Banner>}
			{!p && <div className="row"><span className="muted">Vēl nav nolasīts.</span><button disabled={!!act.busy} onClick={read}>Nolasīt no dokumentiem</button></div>}
			{p && (
				<>
					<Pick<Procedure> label="Procedūra" c={p.procedure} options={PROCEDURES} onChange={(procedure) => edit({ procedure })} />
					<Pick<Subject> label="Iepirkuma priekšmets" c={p.subject} options={SUBJECTS} onChange={(subject) => edit({ subject })} />
					<Pick<OurRole> label="Mūsu loma" c={p.ourRole} options={OUR_ROLES} onChange={(ourRole) => edit({ ourRole })} />
					<Pick<SubmissionChannel> label="Iesniegšana" c={p.submission} options={SUBMISSIONS} onChange={(submission) => edit({ submission })} />
					{p.submission.value === "e-pasts" && (
						<div className="row"><span style={{ width: 170 }}>E-pasta adrese</span><input value={p.email.value ?? ""} onChange={(e) => edit({ email: e.target.value ? { value: e.target.value, status: "manual" } : { value: null, status: "missing" } })} /><CitedValue c={p.email} format={() => ""} /></div>
					)}
					<div className="row">
						<span style={{ width: 170 }}>Daļas</span>
						{p.lots.length === 0 && <span className="muted">dokumentos daļas nav atrastas</span>}
						{p.lots.map((l, i) => (
							<label key={l.n} className="row" style={{ gap: 4 }} title={l.name.cite?.quote}>
								<input type="checkbox" checked={l.apply} onChange={(e) => edit({ lots: p.lots.map((x, j) => (j === i ? { ...x, apply: e.target.checked } : x)) })} />
								{l.name.value}
							</label>
						))}
					</div>
					{p.procedure.value === "Vispārīgā vienošanās" && <Inherit project={project} reload={reload} />}
					{project.builders.length === 0 && p.ourRole.value === "apaksuznemejs" && <Banner>Projektējam būvniekiem, bet konkursam vēl nav pievienots neviens būvnieks — pievieno tos konkursa iestatījumos augšā.</Banner>}
					<div className="row">
						{p.confirmed ? <span style={{ color: "var(--good)" }}>● apstiprināts</span> : <button className="primary" disabled={!!act.busy || !p.procedure.value || !p.subject.value} onClick={() => save(true)}>Apstiprināt</button>}
						{draft && <button disabled={!!act.busy} onClick={() => save(false)}>Saglabāt nemainot statusu</button>}
						<button disabled={!!act.busy} onClick={read}>Nolasīt vēlreiz</button>
					</div>
				</>
			)}
		</div>
	);
}
