import { useState, type ReactNode } from "react";
import { BLOCK_LABELS, DOC_KINDS, KEY_BLOCKS, emptyCited, type BlockId, type DocKind, type Cited, type Criterion, type ExperienceReq, type RequiredDoc, type Requirements, type SpecialistReq } from "../../shared/state";
import type { Project } from "../../shared/types";
import { api, type StateBundle } from "../api";
import { Banner, EditableCited, ScreenHead, useAction } from "../ui";
import { ExtraSources } from "./Sources";

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
	const [open, setOpen] = useState<Partial<Record<BlockId, boolean>>>({ pieredze: true, specialisti: true, vertesana: true });
	const save = <K extends keyof Requirements>(block: BlockId, data: Requirements[K]) => api.req.edit(id, block, data).then(reload);

	const Block = ({ block, title, count, children }: { block: BlockId; title: string; count?: number; children: ReactNode }) => (
		<div className="card" id={`blk-${block}`}>
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
	const dot = (b: BlockId) => (r.confirmed[b] ? { ic: "●", color: "var(--good)", text: "pārbaudīts" } : r.readAt[b] ? { ic: "◐", color: "var(--warning)", text: "jāpārbauda" } : { ic: "○", color: "var(--muted, #888)", text: "nav nolasīts" });
	const joinV = (...v: (string | number | null | undefined)[]) => v.filter((x) => x !== null && x !== undefined && x !== "").join(" · ");
	/** one line per key block: what the tender says, in short */
	const brief = (b: BlockId): string => {
		switch (b) {
			case "pieredze": return r.pieredze.length ? r.pieredze.map((p) => joinV(p.count.value !== null ? `${p.count.value} obj.` : null, p.periodYears.value !== null ? `${p.periodYears.value} g.` : null, p.objectType.value)).join("; ") : "";
			case "specialisti": return r.specialisti.length ? `${r.specialisti.length} speciālisti; pieredze norādīta ${r.specialisti.filter((x) => x.experience?.value || x.count?.value != null || x.periodYears?.value != null).length}` : "";
			case "apsekosana": return joinV(r.apsekosana.status.value, r.apsekosana.details.value);
			case "nodrosinajums": return joinV(r.nodrosinajums.offer.value ? `piedāvājuma: ${r.nodrosinajums.offer.value}` : null, r.nodrosinajums.contract.value ? `līguma: ${r.nodrosinajums.contract.value}` : null);
			case "izpilde": return r.izpilde.term.value ?? "";
			case "finanses": return joinV(r.finanses.form.value, r.finanses.notes.value);
			case "tehnisks": return r.tehnisks.length ? r.tehnisks.map((x) => x.name.value).join(", ") : "";
			case "apliecinajumi": return r.apliecinajumi.length ? `${r.apliecinajumi.length} (obligāti ${r.apliecinajumi.filter((x) => x.mandatory).length})` : "";
			default: return "";
		}
	};
	const jump = (b: BlockId) => {
		setOpen((o) => ({ ...o, [b]: true }));
		setTimeout(() => document.getElementById(`blk-${b}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
	};
	const readAllKey = () =>
		act.run("all", async () => {
			for (const b of KEY_BLOCKS) {
				const res = await api.req.read(id, b);
				if (!res.ok) return res;
			}
			return { ok: true, rejected: 0 } as const;
		}, reload);
	/** files the folder already holds for a block (real data, not a model guess) */
	const FoundFiles = ({ kinds, label }: { kinds: DocKind[]; label: string }) => {
		const fs = bundle.state.files.filter((f) => kinds.includes(f.kind));
		return <div className="small muted" style={{ marginTop: 6 }}>{label}: {fs.length ? fs.map((f) => `${f.rel.split(/[\\/]/).pop()} (${DOC_KINDS[f.kind]})`).join("; ") : "mapē nav atrasts"}</div>;
	};
	const conflicts = [bundle.state.deadline.date, bundle.state.deadline.time, r.apaksuznemeji.threshold, ...r.vertesana.flatMap((c) => [c.name, c.points])].filter((c) => c.conflict).length;

	return (
		<div className="screen">
			<ScreenHead agent
				title="3. Ko konkurss prasa"
				what="App izlasa nolikumu un piedāvā, ko tas prasa. Pie katras vērtības redzams teikums, no kura tā nolasīta — izlasi un apstiprini."
				why="Visi turpmākie soļi balstās uz šo."
			/>
		<ExtraSources project={project} bundle={bundle} reload={reload} page="prasibas" />
			{act.error && <Banner kind="critical">{act.error}</Banner>}
			<div className="row">
				<button disabled={!!act.busy} onClick={() => act.run("second", () => api.req.secondPass(id), reload)}>
					{act.busy === "second" ? "Lasu vēlreiz…" : "Otrā nolasīšana (termiņš, kritēriji, slieksnis)"}
				</button>
				<span className="hint">Pārbauda svarīgākās vērtības ar neatkarīgu otru nolasījumu. Ja atšķiras, atšķirība tiek parādīta — nekas netiek izvēlēts klusi.</span>
			</div>
			{conflicts > 0 && <Banner kind="critical">{conflicts} vērtībām otrā nolasīšana deva citu rezultātu. Izvēlies, kura ir pareiza (pie vērtības: „Atstāt pirmo” vai „Ņemt otro”).</Banner>}

			<div className="card">
				<div className="row spread">
					<strong>Galvenais pirms dokumentu veidošanas</strong>
					<span className="row">
						<span className="hint">{KEY_BLOCKS.filter((b) => r.confirmed[b]).length} no {KEY_BLOCKS.length} pārbaudīti</span>
						<button disabled={!!act.busy} onClick={readAllKey}>{act.busy === "all" ? "Aģents lasa visu…" : "Izlasīt visus astoņus"}</button>
					</span>
				</div>
				<table>
					<tbody>
						{KEY_BLOCKS.map((b) => {
							const d = dot(b);
							const v = brief(b);
							return (
								<tr key={b} style={{ cursor: "pointer" }} onClick={() => jump(b)}>
									<td style={{ width: 22, color: d.color }} title={d.text}>{d.ic}</td>
									<td style={{ width: 210 }}><strong>{BLOCK_LABELS[b]}</strong></td>
									<td className="small">{v || <span className="muted">{r.readAt[b] ? "nolikumā nav atrasts" : "—"}</span>}</td>
									<td className="small muted" style={{ width: 90 }}>{d.text}</td>
								</tr>
							);
						})}
					</tbody>
				</table>
				<div className="hint">○ nav nolasīts · ◐ nolasīts, jāpārbauda · ● pārbaudīts. Ja nolikums kaut ko neprasa (piem., apsekošanu), izlasi un atzīmē „Pārbaudīts”.</div>
			</div>

			<Block block="pieredze" title="Pretendenta pieredze" count={r.pieredze.length}>
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

			<Block block="specialisti" title="Speciālisti un viņu pieredze" count={r.specialisti.length}>
				<table>
					<thead><tr><th>Joma</th><th>Kāds sertifikāts vajadzīgs</th><th>Pieredze (kāda)</th><th>Objekti</th><th>Gadi</th><th>Obl.</th><th /></tr></thead>
					<tbody>
						{r.specialisti.map((s: SpecialistReq, i) => {
							const set = (patch: Partial<SpecialistReq>) => save("specialisti", r.specialisti.map((x, j) => (j === i ? { ...x, ...patch } : x)));
							return (
								<tr key={i}>
									<td><EditableCited c={s.field} width={280} onChange={(c) => set({ field: c as Cited<string> })} /></td>
									<td><EditableCited c={s.certificate} width={240} onChange={(c) => set({ certificate: c as Cited<string> })} /></td>
									<td><EditableCited c={s.experience ?? emptyCited<string>()} width={200} onChange={(c) => set({ experience: c as Cited<string> })} /></td>
									<td><EditableCited c={s.count ?? emptyCited<number>()} width={50} parse={num} onChange={(c) => set({ count: c as Cited<number> })} /></td>
									<td><EditableCited c={s.periodYears ?? emptyCited<number>()} width={50} parse={num} onChange={(c) => set({ periodYears: c as Cited<number> })} /></td>
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

			<Block block="apsekosana" title="Apsekošana">
				<table>
					<tbody>
						<tr><td style={{ width: 200 }} className="muted">Vai jāapseko</td><td><EditableCited c={r.apsekosana.status} width={240} onChange={(c) => save("apsekosana", { ...r.apsekosana, status: c as Cited<string> })} /></td></tr>
						<tr><td className="muted">Kad, kur, kā pieteikties</td><td><EditableCited c={r.apsekosana.details} width={420} onChange={(c) => save("apsekosana", { ...r.apsekosana, details: c as Cited<string> })} /></td></tr>
					</tbody>
				</table>
			</Block>

			<Block block="nodrosinajums" title="Nodrošinājums">
				<table>
					<tbody>
						<tr><td style={{ width: 200 }} className="muted">Piedāvājuma nodrošinājums</td><td><EditableCited c={r.nodrosinajums.offer} width={420} onChange={(c) => save("nodrosinajums", { ...r.nodrosinajums, offer: c as Cited<string> })} /></td></tr>
						<tr><td className="muted">Līguma izpildes nodrošinājums</td><td><EditableCited c={r.nodrosinajums.contract} width={420} onChange={(c) => save("nodrosinajums", { ...r.nodrosinajums, contract: c as Cited<string> })} /></td></tr>
					</tbody>
				</table>
			</Block>

			<Block block="izpilde" title="Izpildes termiņš">
				<table>
					<tbody>
						<tr><td style={{ width: 200 }} className="muted">Termiņš</td><td><EditableCited c={r.izpilde.term} width={420} onChange={(c) => save("izpilde", { term: c as Cited<string> })} /></td></tr>
					</tbody>
				</table>
			</Block>

			<Block block="finanses" title="Finanšu piedāvājums">
				<table>
					<tbody>
						<tr><td style={{ width: 200 }} className="muted">Forma (Word veidne, Excel tāme …)</td><td><EditableCited c={r.finanses.form} width={420} onChange={(c) => save("finanses", { ...r.finanses, form: c as Cited<string> })} /></td></tr>
						<tr><td className="muted">Ko jāietver</td><td><EditableCited c={r.finanses.notes} width={420} onChange={(c) => save("finanses", { ...r.finanses, notes: c as Cited<string> })} /></td></tr>
					</tbody>
				</table>
				<FoundFiles kinds={["finansu"]} label="Mapē atrastā veidlapa" />
			</Block>

			<Block block="tehnisks" title="Tehniskais piedāvājums" count={r.tehnisks.length}>
				<table>
					<thead><tr><th>Nosaukums</th><th>Obl.</th><th>Nosacījums</th><th /></tr></thead>
					<tbody>
						{r.tehnisks.map((d: RequiredDoc, i) => (
							<tr key={i}>
								<td><EditableCited c={d.name} width={300} onChange={(c) => save("tehnisks", r.tehnisks.map((x, j) => (j === i ? { ...x, name: c as Cited<string> } : x)))} /></td>
								<td>{mandatoryBox(d.mandatory, (v) => save("tehnisks", r.tehnisks.map((x, j) => (j === i ? { ...x, mandatory: v } : x))))}</td>
								<td className="small">{d.condition ?? ""}</td>
								<td>{del(() => save("tehnisks", r.tehnisks.filter((_, j) => j !== i)))}</td>
							</tr>
						))}
					</tbody>
				</table>
				<button onClick={() => save("tehnisks", [...r.tehnisks, { name: manual("Jauna daļa"), mandatory: true }])}>+ Pievienot</button>
				<FoundFiles kinds={["tehniska_specifikacija", "tehniskais_piedavajums"]} label="Mapē atrasts" />
			</Block>

			<Block block="apliecinajumi" title="Apliecinājumi" count={r.apliecinajumi.length}>
				<table>
					<thead><tr><th>Nosaukums</th><th>Obl.</th><th>Nosacījums</th><th /></tr></thead>
					<tbody>
						{r.apliecinajumi.map((d: RequiredDoc, i) => (
							<tr key={i}>
								<td><EditableCited c={d.name} width={300} onChange={(c) => save("apliecinajumi", r.apliecinajumi.map((x, j) => (j === i ? { ...x, name: c as Cited<string> } : x)))} /></td>
								<td>{mandatoryBox(d.mandatory, (v) => save("apliecinajumi", r.apliecinajumi.map((x, j) => (j === i ? { ...x, mandatory: v } : x))))}</td>
								<td className="small">{d.condition ?? ""}</td>
								<td>{del(() => save("apliecinajumi", r.apliecinajumi.filter((_, j) => j !== i)))}</td>
							</tr>
						))}
					</tbody>
				</table>
				<button onClick={() => save("apliecinajumi", [...r.apliecinajumi, { name: manual("Jauns apliecinājums"), mandatory: true }])}>+ Pievienot</button>
				<FoundFiles kinds={["apliecinajums"]} label="Mapē atrastā veidlapa" />
			</Block>

			<div className="hint" style={{ marginTop: 14 }}>Papildus — šie bloki nav obligāti pirms dokumentu veidošanas, bet no tiem ņem datus citi soļi (vērtēšana, apakšuzņēmēji, iesniedzamo dokumentu saraksts).</div>

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

			<Block block="apaksuznemeji" title="Apakšuzņēmēji">
				<table>
					<tbody>
						<tr>
							<td style={{ width: 220 }} className="muted">Apakšuzņēmēju slieksnis (EUR)</td>
							<td><EditableCited c={r.apaksuznemeji.threshold} width={120} parse={num} format={(v) => `${Number(v).toLocaleString("lv-LV")} EUR`} onChange={(c) => save("apaksuznemeji", { ...r.apaksuznemeji, threshold: c as Cited<number> })} /></td>
						</tr>
					</tbody>
				</table>
			</Block>
		</div>
	);
}
