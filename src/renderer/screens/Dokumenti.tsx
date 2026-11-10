import { Fragment, useEffect, useMemo, useState } from "react";
import { bytes } from "../../shared/format";
import { DOC_KINDS, WHERE_LABELS, type DocKind, type FileEntry, type Variant, type Where } from "../../shared/state";
import type { Project } from "../../shared/types";
import { api, errorText, type StateBundle } from "../api";
import { Banner, CitedValue, FolderRules, ScreenHead } from "../ui";
import { tenderOf, VARIANTS } from "./NewProject";
import { ProfileCard } from "./Profils";

const TEXT_MARK: Record<FileEntry["text"], { icon: string; label: string; color: string }> = {
	nav: { icon: "○", label: "nav nolasīts", color: "var(--ink-2)" },
	ok: { icon: "✓", label: "nolasīts", color: "var(--good)" },
	tukss: { icon: "⚠", label: "teksta nav", color: "var(--critical)" },
	kluda: { icon: "⚠", label: "neizdevās", color: "var(--critical)" },
	neattiecas: { icon: "⊘", label: "neattiecas", color: "var(--ink-2)" },
};

const MAX_PREVIEW = 200_000;

function Highlighted({ text, query }: { text: string; query: string }) {
	const q = query.trim();
	const shown = text.length > MAX_PREVIEW ? text.slice(0, MAX_PREVIEW) : text;
	if (!q) return <>{shown}{text.length > MAX_PREVIEW && "\n[… teksts saīsināts priekšskatījumā]"}</>;
	const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
	const parts: (string | { m: string })[] = [];
	let last = 0;
	let count = 0;
	for (const m of shown.matchAll(re)) {
		if (count++ >= 500) break;
		parts.push(shown.slice(last, m.index), { m: m[0] });
		last = m.index! + m[0].length;
	}
	parts.push(shown.slice(last));
	return <>{parts.map((p, i) => (typeof p === "string" ? <Fragment key={i}>{p}</Fragment> : <mark key={i}>{p.m}</mark>))}</>;
}

export function Dokumenti({ project, bundle, reload, onProjectChanged }: { project: Project; bundle: StateBundle; reload: () => Promise<void>; onProjectChanged: () => void }) {
	const { state, warnings } = bundle;
	const [busy, setBusy] = useState<"" | "scan" | "extract" | "variant">("");
	const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
	const [error, setError] = useState("");
	const [where, setWhere] = useState<"" | Where>("");
	const [kind, setKind] = useState<"" | DocKind>("");
	const [onlyBad, setOnlyBad] = useState(false);
	const [q, setQ] = useState("");
	const [sel, setSel] = useState<FileEntry | null>(null);
	const [preview, setPreview] = useState<string | null>(null);
	const [pq, setPq] = useState("");

	useEffect(() => api.files.onProgress((id, done, total) => id === project.id && setProgress({ done, total })), [project.id]);

	useEffect(() => {
		setPreview(null);
		if (sel?.text === "ok") api.files.text(project.id, sel.root, sel.rel).then(setPreview);
	}, [sel?.rel, sel?.root, sel?.text, project.id]);

	const files = useMemo(
		() =>
			state.files.filter(
				(f) =>
					(!where || f.where === where) &&
					(!kind || f.kind === kind) &&
					(!onlyBad || f.text === "tukss" || f.text === "kluda") &&
					(!q || f.rel.toLowerCase().includes(q.toLowerCase())),
			),
		[state.files, where, kind, onlyBad, q],
	);

	const run = async (what: "scan" | "extract", fn: () => Promise<unknown>) => {
		setBusy(what);
		setError("");
		setProgress(null);
		try {
			await fn();
			await reload();
		} catch (e) {
			setError(errorText(e));
		} finally {
			setBusy("");
			setProgress(null);
		}
	};

	const readable = state.files.filter((f) => f.text !== "neattiecas").length;
	const read = state.files.filter((f) => f.text === "ok").length;
	const variant = state.variant;

	const detectVariant = async () => {
		setBusy("variant");
		setError("");
		try {
			const r = await api.tasks.variant(project.id);
			if (!r.ok) setError(r.error);
			await reload();
		} catch (e) {
			setError(errorText(e));
		} finally {
			setBusy("");
		}
	};
	const confirmVariant = async (v: Variant) => {
		await api.tasks.confirmVariant(project.id, v);
		await reload();
		onProjectChanged();
	};

	return (
		<div className="screen">
			<ScreenHead title="1. Dokumenti" what="Šeit app pārskata konkursa mapi un nolasa visu dokumentu tekstu, lai tālāk varētu meklēt un salīdzināt." why="Skenētos PDF nolasīt nevar — tos jāpārbauda ar aci." />
			<FolderRules tender={tenderOf(project.sourceDir)} work={project.outputDir} target={`${tenderOf(project.sourceDir)}\\IESNIEDZAMIE`} />

			<div className="row">
				<button className="primary" disabled={!!busy} onClick={() => run("scan", () => api.files.scan(project.id))}>Pārskatīt mapi</button>
				<button disabled={!!busy || !state.scannedAt} onClick={() => run("extract", () => api.files.extract(project.id))}>Nolasīt tekstu</button>
				{busy === "extract" && <span className="small muted">{progress ? `Nolasu ${progress.done} no ${progress.total}…` : "Sāku…"}</span>}
				{busy === "scan" && <span className="small muted">Pārskatu mapi…</span>}
				<span className="grow" />
				{state.scannedAt && <span className="small muted">Faili: {state.files.length} · nolasīti {read} no {readable} nolasāmajiem</span>}
			</div>
			{error && <Banner kind="critical">{error}</Banner>}
			{!state.scannedAt && <Banner>Mape vēl nav pārskatīta. Spied „Pārskatīt mapi”.</Banner>}
			{warnings.map((w) => <Banner key={w}>{w}</Banner>)}

			{state.scannedAt && (
				<>
					<div className="row">
						<select value={where} onChange={(e) => setWhere(e.target.value as "" | Where)} aria-label="Kur">
							<option value="">Kur: visi</option>
							{(Object.keys(WHERE_LABELS) as Where[]).map((w) => <option key={w} value={w}>{WHERE_LABELS[w]}</option>)}
						</select>
						<select value={kind} onChange={(e) => setKind(e.target.value as "" | DocKind)} aria-label="Veids">
							<option value="">Veids: visi</option>
							{(Object.keys(DOC_KINDS) as DocKind[]).map((k) => <option key={k} value={k}>{DOC_KINDS[k]}</option>)}
						</select>
						<label className="row small"><input type="checkbox" checked={onlyBad} onChange={(e) => setOnlyBad(e.target.checked)} /> tikai nenolasītie</label>
						<input placeholder="meklēt failu nosaukumos…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 240 }} />
						<span className="hint">{files.length} no {state.files.length}</span>
					</div>

					<div className="split">
						<div className="table-wrap">
							<table>
								<thead><tr><th>Dokuments</th><th>Kur</th><th>Veids</th><th>Teksts</th></tr></thead>
								<tbody>
									{files.map((f) => {
										const m = TEXT_MARK[f.text];
										const key = `${f.root}:${f.rel}`;
										return (
											<tr key={key} className={`click ${sel && `${sel.root}:${sel.rel}` === key ? "sel" : ""}`} onClick={() => setSel(f)}>
												<td className="path-cell" title={f.rel}>{f.rel}</td>
												<td>{WHERE_LABELS[f.where]}</td>
												<td onClick={(e) => e.stopPropagation()}>
													<select
														value={f.kind}
														aria-label={`Veids: ${f.rel}`}
														onChange={async (e) => {
															await api.files.setKind(project.id, f.root, f.rel, e.target.value as DocKind);
															await reload();
														}}
													>
														{(Object.keys(DOC_KINDS) as DocKind[]).map((k) => <option key={k} value={k}>{DOC_KINDS[k]}</option>)}
													</select>
													{f.kindSetByUser && <span className="manual">labots</span>}
												</td>
												<td style={{ color: m.color }} title={f.textNote ?? m.label}>{m.icon} {m.label}</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>

						<div className="card">
							{!sel && <p className="muted">Izvēlies failu, lai redzētu tā tekstu.</p>}
							{sel && (
								<>
									<div className="mono small" style={{ wordBreak: "break-all" }}>{sel.rel}</div>
									<div className="hint">{bytes(sel.size)}{sel.textChars ? ` · ${sel.textChars} zīmes` : ""}</div>
									<div className="row">
										<button onClick={() => api.files.openOne(project.id, sel.root, sel.rel)}>Atvērt failu</button>
									</div>
									{sel.textNote && <Banner>{sel.textNote}</Banner>}
									{sel.text === "ok" && (
										<>
											<input placeholder="meklēt tekstā…" value={pq} onChange={(e) => setPq(e.target.value)} />
											<div className="preview">{preview === null ? "Ielādēju…" : <Highlighted text={preview} query={pq} />}</div>
										</>
									)}
								</>
							)}
						</div>
					</div>
				</>
			)}

			{state.extractedAt && (
				<div className="card">
					<h2>Konkursa veids</h2>
					<p className="hint">Nosaka, kuri dokumenti ir mūsu un kuram pretendentam gatavojam piedāvājumu. App to nolasa no tehniskās specifikācijas; tu apstiprini.</p>
					<div className="row">
						{variant?.value ? (
							<>
								<strong>{VARIANTS.find((v) => v.id === variant.value)?.label}</strong>
								<CitedValue c={variant} format={(v) => `(${v})`} />
								{variant.confirmed ? <span style={{ color: "var(--good)" }}>● apstiprināts</span> : <button onClick={() => confirmVariant(variant.value!)}>Apstiprināt</button>}
							</>
						) : (
							<span className="muted">{variant?.note ?? "Vēl nav noteikts."}</span>
						)}
						<span className="grow" />
						<button disabled={!!busy} onClick={detectVariant}>{busy === "variant" ? "Lasu dokumentus…" : "Nolasīt no dokumentiem"}</button>
					</div>
					{variant?.note && variant.value && <div className="hint">{variant.note}</div>}
					<div className="row small">
						<span className="muted">Vai izvēlies pats:</span>
						{VARIANTS.map((v) => <button key={v.id} onClick={() => confirmVariant(v.id)}>{v.label}</button>)}
					</div>
					{project.variant && !variant?.confirmed && <div className="hint">Konkursam saglabāts veids: {project.variant}</div>}
				</div>
			)}
			{state.extractedAt && <ProfileCard project={project} profile={state.profile} reload={reload} />}
		</div>
	);
}
