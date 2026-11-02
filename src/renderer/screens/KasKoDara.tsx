import { useEffect, useState } from "react";
import type { Roles, RoleRow, RoleSuggestion } from "../../shared/state";
import type { Specialist } from "../../shared/registers";
import type { Project } from "../../shared/types";
import { api, type StateBundle } from "../api";
import { Banner, ScreenHead, useAction, useAgentOn } from "../ui";
import { KasV1 } from "./KasV1";
import { ExtraSources } from "./Sources";

const ROLE_SUGGESTIONS = [
	"Projekta informācijas vadītājs / BIM koordinators",
	"VDV pārvaldnieks",
	"BIM modeļa autors",
	"4D speciālists",
	"5D speciālists",
	"Tāmētājs",
	"Būvdarbu vadītājs",
	"Lāzerskenēšanas speciālists",
];
const uid = () => crypto.randomUUID();
const blank = (): RoleRow => ({ id: uid(), role: "", part: "", company: "", person: "" });

function RoleTable({ rows, onChange, people, defaultCompany }: { rows: RoleRow[]; onChange: (r: RoleRow[]) => void; people: Specialist[]; defaultCompany?: string }) {
	const set = (id: string, patch: Partial<RoleRow>) => onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
	return (
		<>
			<table>
				<thead><tr><th>Loma</th><th>Būvprojekta daļa (kodi ar komatu)</th><th>Uzņēmums</th><th>Vārds Uzvārds</th><th /></tr></thead>
				<tbody>
					{rows.map((r) => (
						<tr key={r.id}>
							<td><input list="role-suggest" style={{ width: 260 }} value={r.role} onChange={(e) => set(r.id, { role: e.target.value })} /></td>
							<td><input style={{ width: 150 }} placeholder="AR, IN, BK" value={r.part} onChange={(e) => set(r.id, { part: e.target.value })} /></td>
							<td><input style={{ width: 180 }} placeholder={defaultCompany} value={r.company} onChange={(e) => set(r.id, { company: e.target.value })} /></td>
							<td>
								<input list="people" style={{ width: 190 }} value={r.person} onChange={(e) => set(r.id, { person: e.target.value })} />
							</td>
							<td><button aria-label="Dzēst rindu" onClick={() => onChange(rows.filter((x) => x.id !== r.id))}>×</button></td>
						</tr>
					))}
				</tbody>
			</table>
			<datalist id="role-suggest">{ROLE_SUGGESTIONS.map((s) => <option key={s} value={s} />)}</datalist>
			<datalist id="people">{people.map((p) => <option key={p.id} value={p.name} />)}</datalist>
			<div><button onClick={() => onChange([...rows, blank()])}>+ Pievienot lomu</button></div>
		</>
	);
}

const SIDE_TEXT: Record<RoleSuggestion["side"], string> = { projektesana: "projektētāja puse", buvdarbi: "būvnieka puse", nav_skaidrs: "dokuments nepasaka, kuras puses loma" };

/** Roles the agent read from the tender, each with its quote. Nothing goes into the table until a person presses a button; a company or person is offered only when the document names them. */
function RoleSuggestions({ picks, builders, busy, agentOn, onSuggest, onAdd, onReject }: {
	picks: NonNullable<StateBundle["state"]["rolePicks"]> | undefined;
	builders: string[];
	busy: string;
	agentOn: boolean;
	onSuggest: () => void;
	onAdd: (s: RoleSuggestion, target: string) => void;
	onReject: (s: RoleSuggestion) => void;
}) {
	const open = (picks?.items ?? []).filter((i) => !i.decision);
	return (
		<div className="card">
			<div className="row">
				<h2 className="grow">Lomas, ko prasa konkurss</h2>
				<button className="primary" disabled={!!busy || !agentOn} title={agentOn ? undefined : "Aģents ir izslēgts"} onClick={onSuggest}>{busy === "suggest" ? "Lasu dokumentus…" : "Ieteikt lomas no konkursa"}</button>
			</div>
			<p className="hint">Aģents izlasa PIP, nolikumu un specifikāciju un piedāvā lomas ar citātu. Ja dokuments pats nosauc uzņēmumu vai cilvēku, tie tiek piedāvāti līdzi (tikai tad, ja tie stāv citātā). Tabulā nekas neparādās, kamēr nenospied pogu.</p>
			{!agentOn && <Banner>Aģents ir izslēgts — lomas jāieraksta pašam.</Banner>}
			{picks && (
				<div className="hint">
					Nolasīts {new Date(picks.readAt).toLocaleTimeString("lv-LV", { hour: "2-digit", minute: "2-digit" })} · {open.length} ieteikumi{picks.already ? ` · ${picks.already} jau ir tabulā` : ""}{picks.rejected ? ` · ${picks.rejected} atmesti (citāts dokumentā nav atrasts)` : ""}
				</div>
			)}
			{open.map((s) => (
				<div key={s.id} className="src-row">
					<div className="row">
						<strong>{s.role}</strong>
						{s.part && <span className="chip mono">{s.part}</span>}
						{s.company && <span className="chip">{s.company}</span>}
						{s.person && <span className="chip">{s.person}</span>}
						<span className="hint">{SIDE_TEXT[s.side]}</span>
						<span className="grow" />
						<button className={s.side === "projektesana" ? "primary" : ""} disabled={!!busy} onClick={() => onAdd(s, "design")}>→ Projektēšana (mēs)</button>
						{builders.map((b) => <button key={b} className={s.side === "buvdarbi" && builders.length === 1 ? "primary" : ""} disabled={!!busy} onClick={() => onAdd(s, b)}>→ {b}</button>)}
						<button disabled={!!busy} onClick={() => onReject(s)}>Atmest</button>
					</div>
					<div className="quote-pop">„{s.cite.quote}” <span className="hint">— {s.cite.file}</span></div>
				</div>
			))}
			{picks && open.length === 0 && <div className="hint">Nav neatrisinātu ieteikumu.</div>}
		</div>
	);
}

/** 5. Kas ko dara for V2/V3: our design-side roles, and a separate construction-side table per builder. */
export function KasKoDara({ project, bundle, reload }: { project: Project; bundle: StateBundle; reload: () => Promise<void> }) {
	const variant = bundle.state.variant?.value ?? project.variant;
	const [roles, setRoles] = useState<Roles>(bundle.state.roles);
	const [people, setPeople] = useState<Specialist[]>([]);
	const [company, setCompany] = useState("");
	const [dirty, setDirty] = useState(false);
	const act = useAction();
	const [agentOn] = useAgentOn();
	useEffect(() => {
		api.registers.get().then((r) => {
			setPeople(r.registers.specialists);
			setCompany(r.registers.company.fields.find((f) => /^nosaukums$/i.test(f.key))?.value ?? "");
		});
	}, []);

	const head = <ScreenHead agent title="5. Kas ko dara" what="Šeit savieno konkursa prasības ar mūsu cilvēkiem. Katra izvēle var radīt papildu dokumentus — app pateiks, kādus." />;
	if (variant === "V1") return <KasV1 project={project} bundle={bundle} reload={reload} />;
	if (variant !== "V2" && variant !== "V3") {
		return (
			<div className="screen">
				{head}
				<Banner>Konkursa veids vēl nav noteikts. Nosaki to 1. solī (Dokumenti → Konkursa veids).</Banner>
			</div>
		);
	}
	const edit = (r: Roles) => {
		setRoles(r);
		setDirty(true);
	};
	const save = () => act.run("save", async () => void (await api.roles.save(project.id, roles)), async () => { setDirty(false); await reload(); });
	const builders = project.builders;

	const suggest = () => act.run("suggest", () => api.roles.suggest(project.id), reload);
	// the row goes into the table and is saved at once, so the suggestion cannot vanish while the row exists only on screen
	const addSuggested = (s: RoleSuggestion, target: string) =>
		act.run(
			"add",
			async () => {
				const row: RoleRow = { ...blank(), role: s.role, part: s.part, company: s.company ?? "", person: s.person ?? "" };
				const next: Roles = target === "design" ? { ...roles, design: [...roles.design, row] } : { ...roles, build: { ...roles.build, [target]: [...(roles.build[target] ?? []), row] } };
				await api.roles.save(project.id, next);
				await api.roles.decide(project.id, s.id, "added");
				setRoles(next);
				setDirty(false);
			},
			reload,
		);
	const rejectSuggested = (s: RoleSuggestion) => act.run("reject", async () => void (await api.roles.decide(project.id, s.id, "rejected")), reload);

	return (
		<div className="screen">
			{head}
			{act.error && <Banner kind="critical">{act.error}</Banner>}
			<ExtraSources project={project} bundle={bundle} reload={reload} page="kas" />
			<RoleSuggestions picks={bundle.state.rolePicks} builders={builders} busy={act.busy} agentOn={agentOn} onSuggest={suggest} onAdd={addSuggested} onReject={rejectSuggested} />
			{builders.length === 0 && <Banner>Konkursam nav norādīts neviens būvnieks. Pievieno tos 1. solī (Konkursa veids un būvnieki).</Banner>}
			<div className="row">
				<span className="hint">Projektēšanas puse ir kopīga visiem būvniekiem; būvdarbu puse ir atsevišķa katram — viena būvnieka dati nekad nenonāk cita būvnieka dokumentos.</span>
				<span className="grow" />
				{dirty && <span className="hint">ir nesaglabātas izmaiņas</span>}
				<button className="primary" disabled={!dirty || !!act.busy} onClick={save}>Saglabāt</button>
			</div>
			<div className="card">
				<h2>Projektēšana (mēs)</h2>
				<RoleTable rows={roles.design} people={people} defaultCompany={company} onChange={(rows) => edit({ ...roles, design: rows })} />
			</div>
			{builders.map((b) => (
				<div className="card" key={b}>
					<h2>Būvdarbi — {b}</h2>
					<p className="hint">Būvnieka personas. Ja kādu vēl nezina, atstāj tukšu — dokumentā tas paliks atzīmēts kā BŪVNIEKS.</p>
					<RoleTable rows={roles.build[b] ?? []} people={people} defaultCompany={b} onChange={(rows) => edit({ ...roles, build: { ...roles.build, [b]: rows } })} />
				</div>
			))}
		</div>
	);
}
