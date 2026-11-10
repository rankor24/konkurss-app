// Phase 8: the pack — every document to submit, per recipient, numbered, with its signer and status.
import { useEffect, useState } from "react";
import { PACK_SOURCE_LABELS, PACK_STATUS_LABELS, recipientLabel, type PackItem } from "../../shared/pack";
import { SUBMISSIONS } from "../../shared/profile";
import type { Project } from "../../shared/types";
import { api, type PackView, type StateBundle } from "../api";
import { Banner, FolderRules, ScreenHead, useAction } from "../ui";

const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const STATUS_COLOR: Record<string, string> = { nav: "var(--critical)", melnraksts: "var(--warn)", parakstits: "var(--good)", gatavs: "var(--good)" };

function Rows({ items, onGenerate, busy }: { items: PackItem[]; onGenerate: (it: PackItem) => void; busy: boolean }) {
	return (
		<table>
			<thead><tr><th>Nr.</th><th>Dokuments</th><th>No kurienes</th><th>Paraksta</th><th>Statuss</th></tr></thead>
			<tbody>
				{items.map((it) => (
					<tr key={it.id}>
						<td className="mono">{it.number}</td>
						<td>
							<div>{it.fileName}</div>
							{it.required?.cite && <div className="hint" title={it.required.cite.quote}>prasīts: „{it.required.cite.quote.slice(0, 120)}”</div>}
							{it.note && <div className="hint">{it.note}</div>}
						</td>
						<td>
							{PACK_SOURCE_LABELS[it.source]}
							{it.from ? <div className="hint" title={it.from}>{fileName(it.from)}</div> : it.source !== "manual" && <div className="hint" style={{ color: "var(--critical)" }}>avota faila vēl nav</div>}
							{it.source === "generated" && <button className="link" disabled={busy} onClick={() => onGenerate(it)}>{it.from ? "izveidot no jauna" : "izveidot no standarta teksta"}</button>}
						</td>
						<td>{it.signer ?? <span className="muted">{it.source === "evidence" ? "jau parakstīts (izdevējs)" : "—"}</span>}</td>
						<td style={{ color: STATUS_COLOR[it.status] }}>{PACK_STATUS_LABELS[it.status]}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

/**
 * Where everything is, and whether the pack may be moved: the app works only in the work folder on this PC; the
 * person moves the finished Paka into the tender folder's IESNIEDZAMIE by hand.
 */
export function Places({ view }: { view: PackView }) {
	const r = view.readiness;
	const todo = [
		r.notInPack ? `${r.notInPack} faili vēl nav mapē Paka (nospied „Sakārtot paku”)` : "",
		r.unsigned ? `${r.unsigned} faili jāparaksta — ieliec parakstīto .edoc blakus` : "",
		r.toMake ? `${r.toMake} dokumenti jāsagatavo pašai` : "",
		r.checkMissing ? "pārbaude (8. solis) vēl nav palaista" : r.checkErrors ? `${r.checkErrors} kļūdas pārbaudē (8. solis)` : "",
	].filter(Boolean);
	return (
		<>
			{r.ready ? (
				<Banner kind="good">
					<strong>Paka gatava pārvietošanai.</strong> Pārvieto (vai nokopē) visu mapes Paka saturu uz <span className="mono">{view.targetDir}</span>, tad iesniedz. App to nedara pati — konkursu mapē tā neraksta.
					<div className="row" style={{ marginTop: 6 }}>
						<button className="primary" onClick={() => (api.folders.open(view.packDir), api.folders.open(view.targetExists ? view.targetDir : view.tenderDir))}>Atvērt Paka un konkursa mapi</button>
					</div>
				</Banner>
			) : (
				<Banner>Vēl nav gatavs pārvietošanai uz konkursa mapi: {todo.join("; ") || "pakā vēl nav neviena faila"}.</Banner>
			)}
			<div className="card">
				<h2>Kur kas atrodas</h2>
				<FolderRules tender={view.tenderDir} work={view.workDir} target={view.targetDir} />
				<table>
					<tbody>
						<tr><td style={{ width: 230 }}>Konkursa dokumenti <span className="hint">(tikai lasa)</span></td><td className="mono small">{view.tenderDir}</td><td><button onClick={() => api.folders.open(view.tenderDir)}>Atvērt</button></td></tr>
						<tr><td>Darba mape <span className="hint">(šajā datorā)</span></td><td className="mono small">{view.workDir}<div className="hint">Iesniedzamie — melnraksti un versijas · Pierādījumi — kopijas · Paka — gatavais komplekts · .konkurss — app piezīmes, neaiztikt</div></td><td><button onClick={() => api.folders.open(view.workDir)}>Atvērt</button></td></tr>
						<tr><td><strong>Paka</strong> <span className="hint">(to pārvieto)</span></td><td className="mono small">{view.packDir}</td><td><button onClick={() => api.folders.open(view.packDir)}>Atvērt</button></td></tr>
						<tr><td>Uz kurieni pārvietot</td><td className="mono small">{view.targetDir}{!view.targetExists && <div className="hint">mapes vēl nav — izveido to, pārvietojot</div>}</td><td>{view.targetExists && <button onClick={() => api.folders.open(view.targetDir)}>Atvērt</button>}</td></tr>
					</tbody>
				</table>
			</div>
		</>
	);
}

/** How the pack leaves the office: EIS, e-mail to the address the documents give, or envelopes (mets: anonymously). */
function Submission({ project, bundle }: { project: Project; bundle: StateBundle }) {
	const p = bundle.state.profile;
	const act = useAction();
	const [anon, setAnon] = useState<{ problems: { file: string; detail: string; quote: string }[]; devize: string | null; checked: number; unread: string[] } | null>(null);
	if (!p?.submission.value) return null;
	const dl = bundle.state.deadline;
	const when = dl.date.value ? `${dl.date.value}${dl.time.value ? " plkst. " + dl.time.value : ""}` : "termiņš nav ievadīts (2. solis)";
	return (
		<div className="card">
			<h2>Iesniegšana — {SUBMISSIONS[p.submission.value]}</h2>
			{p.submission.value === "EIS" && <div>Augšupielādē mapes Paka saturu EIS e-konkursos līdz {when}. Parakstītie .edoc faili — tādi, kādi tie ir.</div>}
			{p.submission.value === "e-pasts" && (
				<div>
					Nosūti uz <span className="mono">{p.email.value ?? "— adrese nav atrasta, skat. uzaicinājumu —"}</span> līdz {when}.
					{p.email.cite && <div className="hint">„{p.email.cite.quote}”</div>}
				</div>
			)}
			{(p.submission.value === "papīrs" || p.submission.value === "anonīms") && <div>Izdrukā, sagrupē pa aploksnēm, kā prasa nolikums; termiņš {when}.</div>}
			{p.submission.value === "anonīms" && (
				<>
					<div className="row">
						<button disabled={!!act.busy} onClick={() => act.run("anon", async () => setAnon(await api.pack.anonymity(project.id)))}>Pārbaudīt anonimitāti un devīzi</button>
						<span className="hint">Ārpus iekšējās aploksnes (devīzes atšifrējums, pieteikums, CV) nedrīkst būt mūsu nosaukuma, reģ. Nr., e-pasta domēna un cilvēku vārdu.</span>
					</div>
					{anon && (anon.problems.length === 0
						? <Banner kind={anon.unread.length ? "warn" : "good"}>Pārbaudīti {anon.checked} dokumenti; devīze „{anon.devize ?? "—"}” visur vienāda.{anon.unread.length > 0 && ` Nav pārbaudīti (nav Word — pārbaudi pati): ${anon.unread.join(", ")}.`}</Banner>
						: <Banner kind="critical">Žūrija var metu izslēgt: <ul>{anon.problems.map((x, i) => <li key={i}>{x.file}: {x.detail} — „{x.quote}”</li>)}</ul></Banner>)}
				</>
			)}
			{act.error && <Banner kind="critical">{act.error}</Banner>}
		</div>
	);
}

export function Paka({ project, bundle }: { project: Project; bundle: StateBundle }) {
	const [view, setView] = useState<PackView | null>(null);
	const [identity, setIdentity] = useState<{ problems: { file: string; detail: string; quote: string }[]; checked: number } | null>(null);
	const act = useAction();
	const load = async () => setView(await api.pack.get(project.id));
	useEffect(() => void load(), [project.id, bundle]);
	if (!view) return <div className="screen">Ielādē…</div>;
	const m = view.manifest;
	const groups = [...new Set(m.items.map((i) => i.recipient))];
	const open = m.items.filter((i) => i.status === "nav").length;
	return (
		<div className="screen">
			<ScreenHead title="Paka" what="Viss, kas jāiesniedz, vienā sarakstā: secība un numuri pēc konkursa prasīto dokumentu saraksta, pierādījumi zem pieredzes veidlapas, katram failam — kas paraksta." why="„Sakārtot paku” nokopē gatavos failus uz mapi Paka darba mapē ar pareizajiem nosaukumiem; esošus failus (arī parakstītus .edoc) app nekad nepārraksta. Kad viss gatavs, Paku uz konkursa mapes IESNIEDZAMIE pārvieto pats." />
			{!bundle.state.profile?.confirmed && <Banner>Konkursa kārtība vēl nav apstiprināta (1. solis) — paketes saņēmēji var būt nepareizi.</Banner>}
			<Places view={view} />
			<Submission project={project} bundle={bundle} />
			{m.unmatched.length > 0 && <Banner kind="critical">Šiem prasītajiem dokumentiem app nevar sagatavot failu — tie jāsagatavo pašai: {m.unmatched.join("; ")}.</Banner>}
			{m.items.length === 0 && <Banner>Saraksts ir tukšs: 3. solī vispirms nolasi, kas jāiesniedz.</Banner>}
			{act.error && <Banner kind="critical">{act.error}</Banner>}
			{act.note && <Banner kind="good">{act.note}</Banner>}
			<div className="row">
				<span>{m.items.length} faili · {open} vēl nav pakā</span>
				<span className="grow" />
				<button onClick={() => api.folders.open(view.packDir)}>Atvērt mapi Paka</button>
				<button disabled={!!act.busy} title="Katram uzņēmumam savs reģ. Nr.; būvnieku kopijās nav citu būvnieku; mūsu nosaukums bez kļūdām" onClick={() => act.run("id", async () => {
					const r = await api.pack.identity(project.id);
					setIdentity(r);
				})}>Pārbaudīt reģ. Nr.</button>
				<button className="primary" disabled={!!act.busy || m.items.length === 0} onClick={() => act.run("asm", async () => {
					const r = await api.pack.assemble(project.id);
					if (r.ok) act.setNote(`Nokopēti ${r.copied.length} faili; ${r.kept.length} jau bija (netika aiztikti); ${r.missing.length} vēl nav avota.`);
					return r;
				}, load)}>Sakārtot paku</button>
			</div>
			{identity && (identity.problems.length === 0
				? <Banner kind="good">Pārbaudīti {identity.checked} Word dokumenti — katram uzņēmumam savs reģ. Nr., citu būvnieku kopijās nav.</Banner>
				: <Banner kind="critical">
					{identity.problems.length} problēmas ar uzņēmumu datiem — komisija var noraidīt vai prasīt precizējumu:
					<ul>{identity.problems.map((p, i) => <li key={i}>{fileName(p.file)}: {p.detail} — „{p.quote}”</li>)}</ul>
				</Banner>)}
			{groups.map((g) => (
				<div className="card" key={g}>
					<h2>{recipientLabel(g)}</h2>
					<Rows items={m.items.filter((i) => i.recipient === g)} busy={!!act.busy} onGenerate={(it) => act.run("gen", async () => {
						const r = await api.pack.generate(project.id, it.id);
						if (r.ok) act.setNote(`Izveidots: ${r.file}`);
						return r;
					}, load)} />
				</div>
			))}
			{view.existing.length > 0 && (
				<div className="card">
					<h2>Jau sagatavots ar roku</h2>
					<p className="hint">{view.existingDir} — {view.existing.length} dokumenti. App tos tikai parāda.</p>
					<table>
						<tbody>{view.existing.map((x, i) => <tr key={i}><td className="mono">{x.number ?? "—"}</td><td>{x.stem}</td><td className="muted">{x.exts.join(" ")}</td><td className="muted">{x.recipient ? recipientLabel(x.recipient) : ""}</td></tr>)}</tbody>
					</table>
				</div>
			)}
		</div>
	);
}
