// Library v2 tabs of Reģistri: proposals from earlier submissions, builders, subcontractors, the tender tracker.
import { useEffect, useState } from "react";
import { EVIDENCE_KINDS, type Builder, type HarvestProposal, type StatementTemplate } from "../../shared/library";
import type { RegObject } from "../../shared/registers";
import { api, onTaskText, type LibraryView } from "../api";
import { Banner, useAction } from "../ui";

export type LibraryTab = "ieteikumi" | "buvnieki" | "apaksuznemeji" | "teksti" | "uzskaite";
export const LIBRARY_TABS: Record<LibraryTab, string> = { ieteikumi: "Ieteikumi no iesniegtā", buvnieki: "Būvnieki", apaksuznemeji: "Apakšuzņēmēji", teksti: "Standarta teksti", uzskaite: "Konkursu uzskaite" };

const STATEMENT_KINDS: Record<StatementTemplate["kind"], string> = { specialista_apliecinajums: "Speciālista apliecinājums", apaksuznemeja_apliecinajums: "Apakšuzņēmēja apliecinājums", ip_neizpausana: "IP informācijas neizpaušana", sankcijas: "Sankciju apliecinājums", cits: "Cits" };
const PH_HINT = "Vietturi: {{tender:subject}} {{tender:id}} {{who:name}} {{who:cert}} {{who:role}} {{builder:name}} {{builder:regNr}} {{company:…}} {{person:…}} {{date:long}} {{date:today}}";

export function Teksti() {
	const [list, setList] = useState<StatementTemplate[] | null>(null);
	const [kind, setKind] = useState<StatementTemplate["kind"]>("specialista_apliecinajums");
	const [residue, setResidue] = useState<Record<string, string[]>>({});
	const act = useAction();
	useEffect(() => void api.statements.list().then(setList), []);
	if (!list) return <div className="card">Ielādē…</div>;
	const add = () => act.run("add", async () => {
		const path = await api.v1.pickFile("Iesniegts apliecinājums (Word)");
		if (!path) return;
		const r = await api.statements.fromFile(path, kind);
		if (r.ok) {
			setList([...list, r.template]);
			setResidue({ ...residue, [r.template.id]: r.residue });
		}
		return r;
	});
	const edit = (id: string, paragraphs: string[]) => setList(list.map((t) => (t.id === id ? { ...t, paragraphs } : t)));
	return (
		<>
			<div className="card">
				<p className="hint">Mūsu pašu apliecinājumu teksti — tos lieto tikai tad, ja konkursā nav savas veidlapas. Teksts tiek paņemts no jau iesniegta apliecinājuma: konkursa nosaukums, ID, persona, būvnieks un datumi kļūst par vietturiem. Ko app droši aizstāt nevar (piem., vārdi locījumā „Andi Kalniņu”), tas tiek parādīts dzeltenā — izlabo pati.</p>
				<div className="row">
					<select value={kind} onChange={(e) => setKind(e.target.value as StatementTemplate["kind"])}>{Object.entries(STATEMENT_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
					<button disabled={!!act.busy} onClick={add}>Pievienot no iesniegta faila…</button>
					<span className="grow" />
					<button className="primary" disabled={!!act.busy} onClick={() => act.run("save", async () => setList(await api.statements.save(list)))}>Saglabāt tekstus</button>
				</div>
				<div className="hint mono">{PH_HINT}</div>
				{act.error && <Banner kind="critical">{act.error}</Banner>}
			</div>
			{list.map((t) => (
				<div className="card" key={t.id}>
					<div className="row"><strong>{STATEMENT_KINDS[t.kind]}</strong><span className="hint">no {fileName(t.source)}</span><span className="grow" /><button onClick={() => setList(list.filter((x) => x.id !== t.id))}>Noņemt</button></div>
					{(residue[t.id] ?? []).length > 0 && <Banner>Pārbaudi un izlabo — šķiet konkursam vai personai specifisks: {residue[t.id].join("; ")}</Banner>}
					{t.paragraphs.map((p, i) => (
						<textarea key={i} rows={Math.max(1, Math.ceil(p.length / 110))} value={p} onChange={(e) => edit(t.id, t.paragraphs.map((x, j) => (j === i ? e.target.value : x)))} style={{ width: "100%", background: (residue[t.id] ?? []).some((r) => p.includes(r)) ? "var(--warn-bg, #fff6d6)" : undefined }} />
					))}
				</div>
			))}
		</>
	);
}

const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const tenderOf = (p: string) => p.split(/[\\/]/).find((s) => /^\d{6}_/.test(s)) ?? "";

function useLibrary() {
	const [lib, setLib] = useState<LibraryView | null>(null);
	const load = async () => setLib(await api.library.get());
	useEffect(() => void load(), []);
	return { lib, setLib, load };
}

export function Proposal({ p, objects, onAccept, onMerge, onIgnore, busy }: { p: HarvestProposal; objects: RegObject[]; onAccept: (name: string) => void; onMerge: (id: string) => void; onIgnore: () => void; busy: boolean }) {
	const [name, setName] = useState(p.facts.find((f) => f.key === "Pieredzes raksturojums")?.value.split(",")[0] ?? p.label);
	const [target, setTarget] = useState(p.match?.id ?? "");
	return (
		<div className="card">
			<div className="row">
				<strong>{p.label}</strong>
				<span className="chip">izmantots {p.uses} iesniegumos</span>
				{p.match && <span className="chip">šķiet, ir reģistrā: {p.match.name}</span>}
				{p.decision && <span className="chip">{{ accepted: "pievienots", merged: "pievienots esošam", ignored: "atmests" }[p.decision]}</span>}
			</div>
			<table>
				<thead><tr><th>Pierādījums</th><th>Fails (jaunākā versija)</th><th>No konkursa</th></tr></thead>
				<tbody>
					{p.files.map((f) => (
						<tr key={f.path}><td>{EVIDENCE_KINDS[f.kind]}</td><td title={f.path}>{fileName(f.path)}</td><td className="muted">{tenderOf(f.path)}</td></tr>
					))}
				</tbody>
			</table>
			{p.facts.length > 0 ? (
				<>
					<div className="hint">Dati no iesniegtās veidlapas tabulas (šūnas teksts, nekas nav pārrakstīts):</div>
					<table>
						<tbody>
							{p.facts.map((f) => (
								<tr key={f.key}><td style={{ width: 200 }}>{f.key}</td><td>„{f.value}”<div className="hint">{fileName(f.cite.file)} · {tenderOf(f.cite.file)}</div></td></tr>
							))}
						</tbody>
					</table>
				</>
			) : (
				<div className="hint">Pieredzes tabulās šim objektam rinda nav atrasta — lauki būs jāievada pašai.</div>
			)}
			{!p.decision && (
				<div className="row">
					<input style={{ width: 320 }} value={name} onChange={(e) => setName(e.target.value)} aria-label="Objekta nosaukums" />
					<button className="primary" disabled={busy} onClick={() => onAccept(name)}>Pievienot kā jaunu objektu</button>
					<select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Esošs objekts">
						<option value="">— esošs objekts —</option>
						{objects.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
					</select>
					<button disabled={busy || !target} onClick={() => onMerge(target)}>Pievienot failus esošam</button>
					<button disabled={busy} onClick={onIgnore}>Nav objekts / atmest</button>
				</div>
			)}
		</div>
	);
}

export function Ieteikumi({ objects, onChanged }: { objects: RegObject[]; onChanged: () => Promise<void> }) {
	const { lib, setLib, load } = useLibrary();
	const act = useAction();
	const [progress, setProgress] = useState("");
	const [showDone, setShowDone] = useState(false);
	useEffect(() => onTaskText((scope, text) => scope === "library" && setProgress(text)), []);
	if (!lib) return <div className="card">Ielādē…</div>;
	const run = () =>
		act.run("harvest", async () => {
			const r = await api.library.harvest();
			if (r.ok) act.setNote(`Atrasti ${r.proposals} objektu ieteikumi un ${r.builders} būvnieki.`);
			return r;
		}, async () => (await load(), setProgress(""), await onChanged()));
	const decide = (fn: () => Promise<LibraryView>) => act.run("decide", async () => setLib(await fn()), onChanged);
	const h = lib.harvest;
	const list = (h?.proposals ?? []).filter((p) => showDone || !p.decision);
	return (
		<>
			<div className="card">
				<p>
					App izskata visas iesniegšanas mapes konkursu mapē (<span className="mono">{lib.tendersRoot ?? "nav iestatīta"}</span> un tās <span className="mono">07_IESNIEGTI</span>) un sagrupē atsauksmes, būvatļaujas un aktus pa objektiem. Faili netiek mainīti un nekur pārvietoti — reģistrā tiek ierakstīts tikai ceļš uz tiem.
				</p>
				<div className="row">
					<button className="primary" disabled={!!act.busy || !lib.tendersRoot} onClick={run}>{h ? "Meklēt vēlreiz" : "Meklēt iesniegtajos konkursos"}</button>
					{act.busy === "harvest" && <span className="hint">{progress || "Strādā…"} (ap 1 minūti)</span>}
					{h && <span className="hint">Pēdējo reizi {new Date(h.ranAt).toLocaleString("lv-LV")}: {h.submissions} iesniegumi, {h.files} faili. {h.unnamed} pierādījumu failu nosaukumā objekts nav minēts — tos app nesagrupē.</span>}
				</div>
				{act.error && <Banner kind="critical">{act.error}</Banner>}
				{act.note && <Banner kind="good">{act.note}</Banner>}
			</div>
			{h && (
				<div className="row">
					<span>{list.length} ieteikumi{showDone ? "" : " vēl jāizlemj"}</span>
					<label className="row" style={{ gap: 4 }}><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> rādīt arī izlemtos</label>
				</div>
			)}
			{list.map((p) => (
				<Proposal key={p.key} p={p} objects={objects} busy={!!act.busy} onAccept={(name) => decide(() => api.library.accept(p.key, name))} onMerge={(id) => decide(() => api.library.merge(p.key, id))} onIgnore={() => decide(() => api.library.ignore(p.key))} />
			))}
		</>
	);
}

export function Buvnieki() {
	const { lib, setLib } = useLibrary();
	const [rows, setRows] = useState<Builder[] | null>(null);
	const act = useAction();
	useEffect(() => void (lib && setRows(lib.builders)), [lib]);
	if (!lib || !rows) return <div className="card">Ielādē…</div>;
	const set = (i: number, patch: Partial<Builder>) => setRows(rows.map((b, j) => (j === i ? { ...b, ...patch } : b)));
	return (
		<div className="card">
			<p className="hint">Būvnieki, kuriem projektējam „projektē un būvē” konkursos. Nosaukums un reģ. Nr. nolasīti no mūsu iesniegtajiem apliecinājumiem viņu mapēs; pārējo ievadi pati. Šos datus lieto būvnieku kopijās — tie nekad netiek jaukti ar mūsu rekvizītiem.</p>
			{rows.length === 0 && <div className="muted">Vēl nav neviena — palaid „Ieteikumi no iesniegtā”.</div>}
			{rows.length > 0 && (
				<table>
					<thead><tr><th>Nosaukums</th><th>Reģ. Nr.</th><th>Adrese</th><th>Paraksttiesīgais</th><th>Amats</th><th>Konkursos</th></tr></thead>
					<tbody>
						{rows.map((b, i) => (
							<tr key={b.id}>
								<td><input value={b.name} onChange={(e) => set(i, { name: e.target.value })} /></td>
								<td><input style={{ width: 120 }} value={b.regNr} onChange={(e) => set(i, { regNr: e.target.value })} title={b.cites[0] ? `„${b.cites[0].quote}” — ${fileName(b.cites[0].file)}` : "ievadīts ar roku"} /></td>
								<td><input value={b.address} onChange={(e) => set(i, { address: e.target.value })} /></td>
								<td><input value={b.signatory} onChange={(e) => set(i, { signatory: e.target.value })} /></td>
								<td><input style={{ width: 140 }} value={b.signatoryTitle} onChange={(e) => set(i, { signatoryTitle: e.target.value })} /></td>
								<td className="muted">{b.seenIn.length}</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
			<div className="row">
				<button onClick={() => setRows([...rows, { id: crypto.randomUUID(), name: "", regNr: "", address: "", signatory: "", signatoryTitle: "", contact: "", seenIn: [], cites: [] }])}>+ Pievienot būvnieku</button>
				<button className="primary" disabled={!!act.busy} onClick={() => act.run("save", async () => setLib(await api.library.saveBuilders(rows)))}>Saglabāt būvniekus</button>
			</div>
			{act.error && <Banner kind="critical">{act.error}</Banner>}
		</div>
	);
}

export function Apaksuznemeji() {
	const { lib, load } = useLibrary();
	const act = useAction();
	if (!lib) return <div className="card">Ielādē…</div>;
	return (
		<div className="card">
			<div className="row">
				<span className="hint">Avots: {lib.files.subcontractors ?? "„00_Specialistu un apaksuznemeju reg..xlsx” konkursu mapē nav atrasts"}. Fails netiek mainīts.</span>
				<button disabled={!lib.files.subcontractors || !!act.busy} onClick={() => act.run("imp", async () => { const r = await api.library.importSubcontractors(); if (r.ok) act.setNote(`Ielasīti ${r.count} kontakti.`); return r; }, load)}>Ielasīt no Excel</button>
			</div>
			{act.error && <Banner kind="critical">{act.error}</Banner>}
			{act.note && <Banner kind="good">{act.note}</Banner>}
			{lib.subcontractors.length > 0 && (
				<table>
					<thead><tr><th>Sadaļas</th><th>Uzņēmums</th><th>Persona</th><th>Tālrunis</th><th>E-pasts</th><th title="Cena / Kvalitāte / Termiņi">C/K/T</th></tr></thead>
					<tbody>
						{lib.subcontractors.map((s) => (
							<tr key={s.id}><td>{s.parts.join(", ")}</td><td>{s.company}</td><td>{s.person}</td><td>{s.phone}</td><td>{s.email}</td><td className="mono">{[s.price, s.quality, s.terms].map((x) => x || "·").join(" ")}</td></tr>
						))}
					</tbody>
				</table>
			)}
		</div>
	);
}

export function Uzskaite() {
	const { lib, load } = useLibrary();
	const act = useAction();
	if (!lib) return <div className="card">Ielādē…</div>;
	return (
		<div className="card">
			<div className="row">
				<span className="hint">Avots: {lib.files.tracker ?? "„02_Iepirkumi_BD_jauns.xlsx” konkursu mapē nav atrasts"}. Fails netiek mainīts; to turpina vest kā līdz šim.</span>
				<button disabled={!lib.files.tracker || !!act.busy} onClick={() => act.run("imp", async () => { const r = await api.library.importTracker(); if (r.ok) act.setNote(`Ielasītas ${r.count} rindas.`); return r; }, load)}>Ielasīt no Excel</button>
			</div>
			{act.error && <Banner kind="critical">{act.error}</Banner>}
			{act.note && <Banner kind="good">{act.note}</Banner>}
			{lib.trackerStats.length > 0 && (
				<table>
					<thead><tr><th>Gads</th><th>Rindas</th><th>Iesniegti</th><th>Uzvarēti</th><th>Zaudēti</th><th>Liekam / Neinteresē / Nav pieredzes</th></tr></thead>
					<tbody>
						{lib.trackerStats.map((s) => (
							<tr key={s.sheet}>
								<td>{s.sheet}</td><td>{s.rows}</td><td>{s.submitted}</td><td>{s.won}</td><td>{s.lost}</td>
								<td>{s.decided.liekam || s.decided["neinteresē"] || s.decided["interesē_nav_pieredzes"] ? `${s.decided.liekam ?? 0} / ${s.decided["neinteresē"] ?? 0} / ${s.decided["interesē_nav_pieredzes"] ?? 0}` : "—"}</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
		</div>
	);
}
