import { useState, type ReactNode } from "react";
import { emptyCited, type BlockId, type Cited, type Criterion, type ExperienceReq, type RequiredDoc, type Requirements, type SpecialistReq } from "../../shared/state";
import type { Project } from "../../shared/types";
import { api, type StateBundle } from "../api";
import { Banner, EditableCited, ScreenHead, useAction } from "../ui";

const num = (raw: string): number | null => {
	const n = Number(raw.replace(/\s/g, "").replace(",", "."));
	return Number.isFinite(n) ? n : null;
};
const manual = <T,>(value: T | null): Cited<T> => (value === null ? emptyCited<T>() : { value, status: "manual" });

/** Sum of points and whether every row has a value; the plan's check "Kopā 100 ✓". */
export function sumOf(items: Criterion[]): { sum: number; complete: boolean } {
	let sum = 0;
	let complete = items.length > 0;
	for (const c of items) c.points.value === null ? (complete = false) : (sum += c.points.value);
	return { sum, complete };
}

type Cell = Cited<string> | Cited<number>;

export function Prasibas({ project, bundle, reload }: { project: Project; bundle: StateBundle; reload: () => Promise<void> }) {
	const r = bundle.state.requirements;
	const id = project.id;
	const act = useAction();
	const [open, setOpen] = useState<Partial<Record<BlockId, boolean>>>({ specialisti: true, vertesana: true });
	const save = <K extends keyof Requirements>(block: BlockId, data: Requirements[K]) => api.req.edit(id, block, data).then(reload);

	const Block = ({ block, title, count, children }: { block: BlockId; title: string; count?: number; children: ReactNode }) => (
		<div className="card">
			<div className="row spread">
				<button className="link" style={{ textDecoration: "none", fontWeight: 600 }} onClick={() => setOpen({ ...open, [block]: !open[block] })}>
					{open[block] ? "▾" : "▸"} {title}{count !== undefined ? ` (${count})` : ""}
				</button>
				<span className="row">
					{r.readAt[block] ? <span className="hint">nolasīts</span> : <span className="hint">vēl nav nolasīts</span>}
					<button disabled={!!act.busy} onClick={() => act.run(block, () => api.req.read(id, block), reload)}>{act.busy === block ? "Aģents lasa…" : "Izlasīt no nolikuma"}</button>
					<label className="row" style={{ gap: 4 }}>
						<input type="checkbox" checked={!!r.confirmed[block]} disabled={!r.readAt[block]} onChange={(e) => api.req.confirm(id, block, e.target.checked).then(reload)} /> Pārbaudīts
					</label>
				</span>
			</div>
			{open[block] && children}
		</div>
	);

	const mandatoryBox = (checked: boolean, onChange: (v: boolean) => void) => <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label="Obligāts" />;
	const del = (onClick: () => void) => <button onClick={onClick} aria-label="Dzēst rindu" title="Dzēst rindu">×</button>;

	const crit = sumOf(r.vertesana);
	const conflicts = [bundle.state.deadline.date, bundle.state.deadline.time, r.apaksuznemeji.threshold, ...r.vertesana.flatMap((c) => [c.name, c.points])].filter((c) => c.conflict).length;

	return (
		<div className="screen">
			<ScreenHead agent
				title="3. Ko konkurss prasa"
				what="App izlasa nolikumu un piedāvā, ko tas prasa. Pie katras vērtības redzams teikums, no kura tā nolasīta — izlasi un apstiprini."
				why="Visi turpmākie soļi balstās uz šo."
			/>
			{act.error && <Banner kind="critical">{act.error}</Banner>}
			<div className="row">
				<button disabled={!!act.busy} onClick={() => act.run("second", () => api.req.secondPass(id), reload)}>
					{act.busy === "second" ? "Lasu vēlreiz…" : "Otrā nolasīšana (termiņš, kritēriji, slieksnis)"}
				</button>
				<span className="hint">Pārbauda svarīgākās vērtības ar neatkarīgu otru nolasījumu. Ja atšķiras, atšķirība tiek parādīta — nekas netiek izvēlēts klusi.</span>
			</div>
			{conflicts > 0 && <Banner kind="critical">{conflicts} vērtībām otrā nolasīšana deva citu rezultātu. Izvēlies, kura ir pareiza (pie vērtības: „Atstāt pirmo” vai „Ņemt otro”).</Banner>}

			<Block block="dati" title="Konkursa dati (pasūtītājs, ID, termiņi)">
				<table>
					<tbody>
						{([["purchaser", "Pasūtītājs"], ["id", "Iepirkuma ID"], ["subject", "Iepirkuma priekšmets"], ["contractType", "Līguma veids"]] as const).map(([k, label]) => (
							<tr key={k}>
								<td style={{ width: 180 }} className="muted">{label}</td>
								<td><EditableCited c={r.dati[k]} width={360} onChange={(c) => save("dati", { ...r.dati, [k]: c } as Requirements["dati"])} /></td>
							</tr>
						))}
						<tr><td className="muted">Iesniegšanas termiņš</td><td className="small">nosaka 2. solī</td></tr>
					</tbody>
				</table>
			</Block>

			<Block block="dokumenti" title="Kas jāiesniedz" count={r.dokumenti.length}>
				<table>
					<thead><tr><th>Dokuments</th><th>Obl.</th><th>Nosacījums</th><th /></tr></thead>
					<tbody>
						{r.dokumenti.map((d: RequiredDoc, i) => (
							<tr key={i}>
								<td><EditableCited c={d.name} width={300} onChange={(c) => save("dokumenti", r.dokumenti.map((x, j) => (j === i ? { ...x, name: c as Cited<string> } : x)))} /></td>
								<td>{mandatoryBox(d.mandatory, (v) => save("dokumenti", r.dokumenti.map((x, j) => (j === i ? { ...x, mandatory: v } : x))))}</td>
								<td className="small">{d.condition ?? ""}</td>
								<td>{del(() => save("dokumenti", r.dokumenti.filter((_, j) => j !== i)))}</td>
							</tr>
						))}
					</tbody>
				</table>
				<button onClick={() => save("dokumenti", [...r.dokumenti, { name: manual("Jauns dokuments"), mandatory: true }])}>+ Pievienot dokumentu</button>
			</Block>

			<Block block="pieredze" title="Uzņēmuma pieredze" count={r.pieredze.length}>
				<table>
					<thead><tr><th>Prasība</th><th>Objekti</th><th>Periods (gadi)</th><th>Veids</th><th /></tr></thead>
					<tbody>
						{r.pieredze.map((p: ExperienceReq, i) => {
							const set = (patch: Partial<ExperienceReq>) => save("pieredze", r.pieredze.map((x, j) => (j === i ? { ...x, ...patch } : x)));
							return (
								<tr key={i}>
									<td><EditableCited c={p.text} width={260} onChange={(c) => set({ text: c as Cited<string> })} /></td>
									<td><EditableCited c={p.count} width={60} parse={num} onChange={(c) => set({ count: c as Cited<number> })} /></td>
									<td><EditableCited c={p.periodYears} width={60} parse={num} onChange={(c) => set({ periodYears: c as Cited<number> })} /></td>
									<td><EditableCited c={p.objectType} width={160} onChange={(c) => set({ objectType: c as Cited<string> })} /></td>
									<td>{del(() => save("pieredze", r.pieredze.filter((_, j) => j !== i)))}</td>
								</tr>
							);
						})}
					</tbody>
				</table>
				<button onClick={() => save("pieredze", [...r.pieredze, { text: manual("Jauna prasība"), count: emptyCited(), periodYears: emptyCited(), objectType: emptyCited() }])}>+ Pievienot prasību</button>
			</Block>

			<Block block="specialisti" title="Kādi speciālisti vajadzīgi" count={r.specialisti.length}>
				<table>
					<thead><tr><th>Joma</th><th>Kāds sertifikāts vajadzīgs</th><th>Obl.</th><th /></tr></thead>
					<tbody>
						{r.specialisti.map((s: SpecialistReq, i) => {
							const set = (patch: Partial<SpecialistReq>) => save("specialisti", r.specialisti.map((x, j) => (j === i ? { ...x, ...patch } : x)));
							return (
								<tr key={i}>
									<td><EditableCited c={s.field} width={280} onChange={(c) => set({ field: c as Cited<string> })} /></td>
									<td><EditableCited c={s.certificate} width={240} onChange={(c) => set({ certificate: c as Cited<string> })} /></td>
									<td>{mandatoryBox(s.mandatory, (v) => set({ mandatory: v }))}</td>
									<td>{del(() => save("specialisti", r.specialisti.filter((_, j) => j !== i)))}</td>
								</tr>
							);
						})}
					</tbody>
				</table>
				<div className="row">
					<button onClick={() => save("specialisti", [...r.specialisti, { field: manual("Jauna joma"), certificate: emptyCited(), mandatory: true }])}>+ Pievienot jomu</button>
					<span className="hint">Skaits jāsalīdzina ar nolikuma veidlapu 2. solī — tur redzams, ja izsniegtajā veidlapā trūkst rindas.</span>
				</div>
			</Block>

			<Block block="vertesana" title="Kā vērtē piedāvājumus" count={r.vertesana.length}>
				<table>
					<thead><tr><th>Kritērijs</th><th>Punkti</th><th>Kā rēķina</th><th>Cik objektu</th><th /></tr></thead>
					<tbody>
						{r.vertesana.map((c: Criterion, i) => {
							const set = (patch: Partial<Criterion>) => save("vertesana", r.vertesana.map((x, j) => (j === i ? { ...x, ...patch } : x)));
							return (
								<tr key={i} style={{ height: "auto" }}>
									<td><EditableCited c={c.name} width={240} onChange={(x) => set({ name: x as Cited<string> })} /></td>
									<td><EditableCited c={c.points} width={60} parse={num} onChange={(x) => set({ points: x as Cited<number> })} /></td>
									<td><EditableCited c={c.formula} width={240} onChange={(x) => set({ formula: x as Cited<string> })} /></td>
									<td>
										<input style={{ width: 50 }} value={c.objectsNeeded ?? ""} aria-label="Objektu skaits" onChange={(e) => set({ objectsNeeded: e.target.value === "" ? null : num(e.target.value) })} />
									</td>
									<td>{del(() => save("vertesana", r.vertesana.filter((_, j) => j !== i)))}</td>
								</tr>
							);
						})}
					</tbody>
				</table>
				<div className="row">
					<button onClick={() => save("vertesana", [...r.vertesana, { name: manual("Jauns kritērijs"), points: emptyCited(), formula: emptyCited(), objectsNeeded: null }])}>+ Pievienot kritēriju</button>
					{r.vertesana.length > 0 && (
						<span className="mono" style={{ color: crit.complete && crit.sum === 100 ? "var(--good)" : "var(--warning)" }}>
							Kopā {crit.sum} {crit.complete && crit.sum === 100 ? "✓" : crit.complete ? "⚠ nav 100" : "⚠ trūkst punktu"}
						</span>
					)}
				</div>
			</Block>

			<Block block="apaksuznemeji" title="Apakšuzņēmēji un ESPD">
				<table>
					<tbody>
						<tr>
							<td style={{ width: 220 }} className="muted">Apakšuzņēmēju slieksnis (EUR)</td>
							<td><EditableCited c={r.apaksuznemeji.threshold} width={120} parse={num} format={(v) => `${Number(v).toLocaleString("lv-LV")} EUR`} onChange={(c) => save("apaksuznemeji", { ...r.apaksuznemeji, threshold: c as Cited<number> })} /></td>
						</tr>
						<tr>
							<td className="muted">ESPD / EVIPD</td>
							<td><EditableCited c={r.apaksuznemeji.espd} width={360} onChange={(c) => save("apaksuznemeji", { ...r.apaksuznemeji, espd: c as Cited<string> })} /></td>
						</tr>
					</tbody>
				</table>
			</Block>
		</div>
	);
}
