import { useEffect, useState } from "react";
import type { Expiry, KV, RegObject, Registers, Specialist } from "../../shared/registers";
import { api } from "../api";
import { Banner, ScreenHead, useAction } from "../ui";
import { Apaksuznemeji, Buvnieki, Ieteikumi, LIBRARY_TABS, Teksti, Uzskaite, type LibraryTab } from "./Biblioteka";

type Tab = "uznemums" | "specialisti" | "objekti" | LibraryTab;
const TAB_LABELS: Record<Tab, string> = { uznemums: "Uzņēmums", specialisti: "Speciālisti", objekti: "Objekti", ...LIBRARY_TABS };
const uid = () => crypto.randomUUID();

function KVTable({ rows, onChange, keyLabel = "Lauks", valueLabel = "Vērtība" }: { rows: KV[]; onChange: (r: KV[]) => void; keyLabel?: string; valueLabel?: string }) {
	return (
		<>
			<table>
				<thead><tr><th>{keyLabel}</th><th>{valueLabel}</th><th /></tr></thead>
				<tbody>
					{rows.map((r, i) => (
						<tr key={i}>
							<td style={{ width: 260 }}><input style={{ width: "100%" }} value={r.key} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} /></td>
							<td><input style={{ width: "100%" }} value={r.value} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} /></td>
							<td><button aria-label="Dzēst rindu" onClick={() => onChange(rows.filter((_, j) => j !== i))}>×</button></td>
						</tr>
					))}
				</tbody>
			</table>
			<div><button onClick={() => onChange([...rows, { key: "", value: "" }])}>+ Pievienot rindu</button></div>
		</>
	);
}

export function Registri({ initialTab }: { initialTab?: string } = {}) {
	const [reg, setReg] = useState<Registers | null>(null);
	const [expiry, setExpiry] = useState<Expiry[]>([]);
	const [hasData, setHasData] = useState(true);
	const [dirty, setDirty] = useState(false);
	const [tab, setTab] = useState<Tab>(initialTab && initialTab in TAB_LABELS ? (initialTab as Tab) : "specialisti");
	const [sel, setSel] = useState<string | null>(null);
	const act = useAction();

	const load = async () => {
		const r = await api.registers.get();
		setReg(r.registers);
		setExpiry(r.expiring);
		setHasData(r.hasData);
		setDirty(false);
	};
	useEffect(() => void load(), []);
	if (!reg) return <div className="screen">Ielādē…</div>;

	const edit = (patch: Partial<Registers>) => {
		setReg({ ...reg, ...patch });
		setDirty(true);
	};
	const save = () => act.run("save", async () => {
		const r = await api.registers.save(reg);
		setExpiry(r.expiring);
		setDirty(false);
	});
	const importIt = (replace: boolean) =>
		act.run("import", async () => {
			const r = await api.registers.import(replace);
			if (r.ok) act.setNote(`Ievietoti: ${r.specialists} speciālisti, ${r.objects} objekti, ${r.fields} uzņēmuma lauki.`);
			return r;
		}, load);

	const sp = (id: string, patch: Partial<Specialist>) => edit({ specialists: reg.specialists.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
	const obj = reg.objects.find((o) => o.id === sel) ?? reg.objects[0];
	const setObj = (o: RegObject) => edit({ objects: reg.objects.map((x) => (x.id === o.id ? o : x)) });
	const expOf = (id: string) => expiry.find((e) => e.id === id);

	return (
		<div className="screen">
			<ScreenHead title="Reģistri" what="Mūsu pastāvīgie dati — uzņēmums, speciālisti, iepriekšējie objekti. Tos aizpilda vienreiz un lieto visos konkursos." why="Konkursa dokumentos šie dati tiek ņemti no šejienes; tos nekad neizdomā." />
			{act.error && <Banner kind="critical">{act.error}</Banner>}
			{!hasData && (
				<Banner>
					Reģistri vēl ir tukši. <button className="link" onClick={() => importIt(false)}>Ielasīt esošos datus no konkursu skill</button> (uzņēmuma dati, speciālisti, objekti) vai ievadi pašai.
				</Banner>
			)}
			{act.note && <Banner kind="good">{act.note}</Banner>}
			{expiry.map((e) => (
				<Banner key={e.id} kind={e.status === "expired" ? "critical" : "warn"}>
					{e.name}: sertifikāts {e.status === "expired" ? "ir beidzies" : `beidzas pēc ${e.days} dienām`} ({e.validUntil}). Pārbaudi BIS.
				</Banner>
			))}
			<div className="row">
				{(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
					<button key={t} data-tour={`tab-${t}`} className={tab === t ? "primary" : ""} onClick={() => (dirty && t in LIBRARY_TABS ? act.setNote("Vispirms saglabā izmaiņas — bibliotēkas cilnes saglabā reģistrus pašas.") : setTab(t))}>{TAB_LABELS[t]}</button>
				))}
				<span className="grow" />
				{dirty && <span className="hint">ir nesaglabātas izmaiņas</span>}
				<button className="primary" disabled={!dirty || !!act.busy} onClick={save}>Saglabāt</button>
			</div>

			{tab === "uznemums" && (
				<div className="card">
					<h2>Rekvizīti</h2>
					<KVTable rows={reg.company.fields} onChange={(fields) => edit({ company: { ...reg.company, fields } })} />
					<h2>Personas</h2>
					<table>
						<thead><tr><th>Loma</th><th>Persona</th><th>Piezīmes</th><th /></tr></thead>
						<tbody>
							{reg.company.persons.map((p, i) => (
								<tr key={i}>
									{(["role", "person", "note"] as const).map((k) => (
										<td key={k}><input style={{ width: "100%" }} value={p[k]} onChange={(e) => edit({ company: { ...reg.company, persons: reg.company.persons.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)) } })} /></td>
									))}
									<td><button aria-label="Dzēst rindu" onClick={() => edit({ company: { ...reg.company, persons: reg.company.persons.filter((_, j) => j !== i) } })}>×</button></td>
								</tr>
							))}
						</tbody>
					</table>
					<div><button onClick={() => edit({ company: { ...reg.company, persons: [...reg.company.persons, { role: "", person: "", note: "" }] } })}>+ Pievienot personu</button></div>
					<h2>Standarta atbildes veidlapu laukos</h2>
					<KVTable rows={reg.company.answers} keyLabel="Veidnes jautājums" valueLabel="Standarta atbilde" onChange={(answers) => edit({ company: { ...reg.company, answers } })} />
				</div>
			)}

			{tab === "specialisti" && (
				<>
					<div className="card">
						<table>
							<thead><tr><th>Persona</th><th>Joma (darbības sfēra)</th><th>Sertifikāts</th><th>Tips</th><th>Caur ko</th><th>Derīgs līdz</th><th /></tr></thead>
							<tbody>
								{reg.specialists.map((s) => {
									const ex = expOf(s.id);
									return (
										<tr key={s.id} style={{ height: "auto" }}>
											<td><input style={{ width: 150 }} value={s.name} onChange={(e) => sp(s.id, { name: e.target.value })} /></td>
											<td><input style={{ width: 280 }} value={s.field} onChange={(e) => sp(s.id, { field: e.target.value })} /></td>
											<td><input style={{ width: 90 }} value={s.certificate} onChange={(e) => sp(s.id, { certificate: e.target.value })} /></td>
											<td>
												<select value={s.type} onChange={(e) => sp(s.id, { type: e.target.value as Specialist["type"] })} title="A = mūsu darbinieks · B = apakšuzņēmēja darbinieks · C = atsevišķs līgums">
													<option value="A">A</option><option value="B">B</option><option value="C">C</option>
												</select>
											</td>
											<td><input style={{ width: 160 }} value={s.via} onChange={(e) => sp(s.id, { via: e.target.value })} /></td>
											<td>
												<input style={{ width: 100, borderColor: ex ? "var(--critical)" : undefined }} placeholder="GGGG-MM-DD" value={s.validUntil} onChange={(e) => sp(s.id, { validUntil: e.target.value })} aria-label="Sertifikāts derīgs līdz" />
												{ex && <span style={{ color: "var(--critical)" }}> ⚠ {ex.status === "expired" ? "beidzies" : `${ex.days} d.`}</span>}
											</td>
											<td><button aria-label="Dzēst" onClick={() => edit({ specialists: reg.specialists.filter((x) => x.id !== s.id) })}>×</button></td>
										</tr>
									);
								})}
							</tbody>
						</table>
						<div className="row">
							<button onClick={() => edit({ specialists: [...reg.specialists, { id: uid(), name: "", field: "", certificate: "", type: "A", via: "", note: "", validUntil: "" }] })}>+ Pievienot speciālistu</button>
							<span className="hint">Derīguma datumus app neizdomā — ievadi pēc BIS. Tukšs datums brīdinājumu nedod.</span>
						</div>
					</div>
					<div className="card">
						<h2>Jomas, kurām nav neviena</h2>
						<p className="hint">Šo sarakstu ved pati; 4. solī (Vai varam) tas tiek salīdzināts ar konkrētā konkursa prasībām.</p>
						<KVTable rows={reg.gaps.map((g) => ({ key: g.field, value: g.note }))} keyLabel="Joma" valueLabel="Statuss / piezīme" onChange={(rows) => edit({ gaps: rows.map((r) => ({ field: r.key, note: r.value })) })} />
					</div>
				</>
			)}

			{tab === "objekti" && (
				<div className="split" style={{ gridTemplateColumns: "260px 1fr" }}>
					<div className="card">
						{reg.objects.map((o) => (
							<button key={o.id} className={`opt ${obj?.id === o.id ? "selected" : ""}`} onClick={() => setSel(o.id)}>{o.name}</button>
						))}
						<button onClick={() => { const o: RegObject = { id: uid(), name: "Jauns objekts", fields: [], evidence: [] }; edit({ objects: [...reg.objects, o] }); setSel(o.id); }}>+ Jauns objekts</button>
					</div>
					{obj ? (
						<div className="card">
							<label className="field">Nosaukums<input value={obj.name} onChange={(e) => setObj({ ...obj, name: e.target.value })} /></label>
							<KVTable rows={obj.fields} onChange={(fields) => setObj({ ...obj, fields })} />
							{obj.cites && Object.keys(obj.cites).length > 0 && (
								<div className="hint">Avots: {Object.entries(obj.cites).map(([k, c]) => `${k} — ${c.file.split(/[\\/]/).slice(-3).join("\\")}`).join(" · ")}</div>
							)}
							<h2>Pierādījumu faili</h2>
							<p className="hint">Kur glabājas atsauksme, būvatļauja, energosertifikāts — lai 7. solī tos var atnest. Ceļš uz failu vai mapi.</p>
							<KVTable rows={obj.evidence.map((e) => ({ key: e.label, value: e.path }))} keyLabel="Dokuments" valueLabel="Ceļš" onChange={(rows) => setObj({ ...obj, evidence: rows.map((r, i) => ({ label: r.key, path: r.value, ...(obj.evidence[i]?.kind ? { kind: obj.evidence[i].kind } : {}) })) })} />
							<div><button onClick={() => edit({ objects: reg.objects.filter((o) => o.id !== obj.id) })}>Dzēst objektu no saraksta</button></div>
						</div>
					) : <div className="card muted">Nav objektu.</div>}
				</div>
			)}
			{tab === "ieteikumi" && <Ieteikumi objects={reg.objects} onChanged={load} />}
			{tab === "buvnieki" && <Buvnieki />}
			{tab === "apaksuznemeji" && <Apaksuznemeji />}
			{tab === "teksti" && <Teksti />}
			{tab === "uzskaite" && <Uzskaite />}
			{hasData && <div className="hint">Importēšana no skill pārrakstītu visus šos datus, tāpēc tā ir pieejama tikai tukšiem reģistriem. Iepriekšējā versija saglabājas rezerves kopijā.</div>}
		</div>
	);
}
