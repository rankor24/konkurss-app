import { useEffect, useMemo, useState } from "react";
import type { FillSheet, SheetItem } from "../../shared/state";
import type { LeakReport } from "../../shared/leaks";
import type { Project } from "../../shared/types";
import { api, type Generated, type MatricaResult, type StateBundle } from "../api";
import type { PreviewBlock } from "../../shared/preview";
import { Banner, ScreenHead, useAction, useAgentOn } from "../ui";
import { DocPreview, isOpenItem } from "./DocPreview";
import { FormsV1, TechV1 } from "./FormsV1";

const STATUS: Record<SheetItem["status"], { icon: string; label: string; color: string }> = {
	source: { icon: "●", label: "no dokumenta", color: "var(--good)" },
	manual: { icon: "✎", label: "ievadīts ar roku", color: "var(--ink-2)" },
	missing: { icon: "○", label: "trūkst", color: "var(--warning)" },
	na: { icon: "⊘", label: "neattiecas", color: "var(--ink-2)" },
};

function LeakView({ r }: { r: LeakReport }) {
	if (r.clean) return <span style={{ color: "var(--good)" }}>● svešu datu nav</span>;
	return (
		<div>
			{r.foreign.map((h, i) => <Banner key={`f${i}`} kind="critical">Cita konkursa dati: <strong>{h.term}</strong> — „…{h.context}…”</Banner>)}
			{r.notes.map((h, i) => <Banner key={`n${i}`}>Darba piezīme dokumentā: „…{h.context}…”</Banner>)}
			{r.unreadable.map((h, i) => <Banner key={`u${i}`} kind="critical">{h.context}</Banner>)}
		</div>
	);
}

function Row({ item, onSave }: { item: SheetItem; onSave: (value: string | null) => void }) {
	const [editing, setEditing] = useState(false);
	const [v, setV] = useState(item.value);
	const s = STATUS[item.status];
	return (
		<tr style={{ height: "auto" }}>
			<td style={{ width: 24, color: s.color }} title={s.label} aria-label={s.label}>{s.icon}</td>
			<td style={{ width: 230 }}>
				<div>{item.label}</div>
				{item.heading && <div className="hint">{item.heading}</div>}
			</td>
			<td>
				{editing ? (
					<div>
						<textarea style={{ width: "100%" }} rows={item.kind === "section" ? 5 : 1} value={v} onChange={(e) => setV(e.target.value)} />
						<div className="row">
							<button className="primary" onClick={() => { onSave(v); setEditing(false); }}>Saglabāt</button>
							<button onClick={() => setEditing(false)}>Atcelt</button>
							{item.status !== "missing" && <button onClick={() => { onSave(null); setEditing(false); }}>Atstāt tukšu</button>}
						</div>
					</div>
				) : (
					<div>
						{item.value ? <div style={{ whiteSpace: "pre-wrap" }}>{item.value}</div> : <span className="missing">{item.kind === "section" ? "vēl nav aizpildīts — pamācība paliek" : "nav atrasts — jāaizpilda pašai"}</span>}
						{item.cites.map((c, i) => <div key={i} className="quote-pop"><div className="hint">{c.file}</div>“{c.quote}”</div>)}
						{item.note && <div className="hint">{item.note}</div>}
						{item.kind !== "delete" && <button className="link" onClick={() => { setV(item.value); setEditing(true); }}>labot</button>}
					</div>
				)}
			</td>
		</tr>
	);
}

/** 6. Aizpildīt — BIP and Atbildības matrica: the value sheet, new versioned files, builder copies. */
export function Aizpildit({ project, bundle, reload }: { project: Project; bundle: StateBundle; reload: () => Promise<void> }) {
	const id = project.id;
	const act = useAction();
	const [templates, setTemplates] = useState<{ key: string; rel: string; kind: string }[]>([]);
	const [key, setKey] = useState("");
	const [sheet, setSheet] = useState<FillSheet | null>(null);
	const [onlyOpen, setOnlyOpen] = useState(false);
	const [view, setView] = useState<"doc" | "list">("doc");
	const [blocks, setBlocks] = useState<PreviewBlock[] | null>(null);
	const [previewError, setPreviewError] = useState("");
	const [cursor, setCursor] = useState(0);
	const [agentOn] = useAgentOn();
	const [progress, setProgress] = useState("");
	const [made, setMade] = useState<Generated[]>([]);
	const [matrica, setMatrica] = useState<(MatricaResult & { builder: string })[]>([]);
	const variant = bundle.state.variant?.value ?? project.variant;
	const builders = project.builders;

	useEffect(() => {
		api.fill.templates(id).then((t) => {
			setTemplates(t);
			setKey((k) => k || t.find((x) => x.kind === "bip_veidne")?.key || t[0]?.key || "");
		});
	}, [id]);
	useEffect(() => {
		setSheet(null);
		if (key) api.fill.sheet(id, key).then(setSheet);
	}, [id, key]);
	useEffect(() => window.konkurss.on("task:text", (pid, msg) => pid === id && setProgress(String(msg))), [id]);

	const isMatrica = templates.find((t) => t.key === key)?.kind === "matrica";
	// the document layout only changes when the template is inspected again; values come from the sheet
	const inspectedAt = sheet?.inspectedAt;
	useEffect(() => {
		setBlocks(null);
		setPreviewError("");
		if (!key || isMatrica || !inspectedAt) return;
		let live = true;
		api.fill.preview(id, key).then((r) => live && (r.ok ? setBlocks(r.blocks) : setPreviewError(r.error)));
		return () => void (live = false);
	}, [id, key, isMatrica, inspectedAt]);
	const open = useMemo(() => sheet?.items.filter(isOpenItem).length ?? 0, [sheet]);
	const byId = useMemo(() => new Map((sheet?.items ?? []).map((i) => [i.slotId, i])), [sheet]);
	/** open fields in the order they stand in the document, for "next empty place" */
	const openInOrder = useMemo(() => {
		const order = (blocks ?? []).flatMap((b) => (b.kind === "slot" ? [b.slotId] : b.kind === "table" ? b.rows.flat().flatMap((c) => (c.slotId ? [c.slotId] : [])) : []));
		return order.filter((s) => { const i = byId.get(s); return i && isOpenItem(i); });
	}, [blocks, byId]);
	const nextOpen = () => {
		if (openInOrder.length === 0) return;
		const at = cursor % openInOrder.length;
		document.getElementById(`slot-${openInOrder[at]}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
		setCursor(at + 1);
	};
	const refresh = async () => setSheet(await api.fill.sheet(id, key));
	const generateBase = () =>
		act.run("gen", async () => {
			const r = await api.fill.generate(id, key);
			if (r.ok) setMade((m) => [r.generated, ...m]);
			return r;
		}, refresh);
	const generateCopies = () =>
		act.run("copies", async () => {
			const r = await api.fill.builderCopies(id, key);
			if (r.ok) setMade((m) => [...r.copies, ...m]);
			return r;
		}, refresh);
	const items = (sheet?.items ?? []).filter((i) => i.kind !== "delete" && (!onlyOpen || isOpenItem(i)));
	const save = (slotId: string, value: string | null) => api.fill.setItem(id, key, slotId, value).then(refresh);

	return (
		<div className="screen">
			<ScreenHead
				agent
				title="6. Aizpildīt"
				what="App saliek katram dokumentam sarakstu, kas kur jāieraksta un no kurienes tas nāk. Kur formāts ļauj, app aizpilda failu pati."
				why="Oriģinālās veidlapas netiek mainītas. Ja kāda vieta nav zināma, app to atstāj tukšu un pasaka — tā neizdomā datus."
			/>
			{act.error && <Banner kind="critical">{act.error}</Banner>}
			<div className="row">
				<label className="field">Veidne
					<select value={key} onChange={(e) => setKey(e.target.value)} style={{ minWidth: 380 }}>
						{templates.length === 0 && <option value="">— nav atrasta BIP veidne vai matrica —</option>}
						{templates.map((t) => <option key={t.key} value={t.key}>{t.kind === "matrica" ? "Matrica: " : "BIP: "}{t.rel}</option>)}
					</select>
				</label>
			</div>
			{templates.length === 0 && <Banner>Konkursa mapē nav atrasta BIP veidne (Pirms-līguma BIP) vai atbildības matrica. Pārbaudi dokumentu veidus 1. solī.</Banner>}

			{key && !isMatrica && (
				<>
					<div className="row">
						<button disabled={!!act.busy} onClick={() => act.run("inspect", () => api.fill.inspect(id, key), refresh)}>{sheet ? "Pārskatīt veidni vēlreiz" : "Pārskatīt veidni"}</button>
						<button className="primary" disabled={!!act.busy || !sheet} onClick={() => act.run("fill", () => api.fill.fillBip(id, key), refresh)}>
							{act.busy === "fill" ? `Aizpilda… ${progress}` : "Aizpildīt (reģistri, lomas, konkursa dokumenti)"}
						</button>
						{sheet && <span className="small muted">{sheet.items.filter((i) => i.kind !== "delete").length} lauki · trūkst vai jāpapildina: <strong>{open}</strong></span>}
					</div>
					{!sheet && <div className="muted">Vispirms pārskati veidni — app atradīs laukus un sadaļas, ko aizpildīt.</div>}
					{!agentOn && <Banner>Aģents ir izslēgts — „Aizpildīt” aizpildīs tikai to, ko zina reģistri un lomu tabula. Tekstus no konkursa dokumentiem raksta aģents.</Banner>}
					{sheet && (
						<>
							<div className="row">
								<div className="seg" role="tablist" aria-label="Skats">
									<button role="tab" aria-selected={view === "doc"} className={view === "doc" ? "on" : ""} onClick={() => setView("doc")}>Dokuments</button>
									<button role="tab" aria-selected={view === "list"} className={view === "list" ? "on" : ""} onClick={() => setView("list")}>Saraksts</button>
								</div>
								{view === "doc" && <button disabled={openInOrder.length === 0} onClick={nextOpen}>Nākamā tukšā vieta ({openInOrder.length})</button>}
								{view === "list" && <label className="row small"><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> rādīt tikai trūkstošos</label>}
							</div>
							{view === "doc" && (
								<>
									{previewError && <Banner kind="critical">{previewError}</Banner>}
									{!previewError && !blocks && <div className="muted">Atver dokumentu…</div>}
									{blocks && <DocPreview blocks={blocks} items={byId} onSave={save} />}
								</>
							)}
							{view === "list" && (
								<div className="table-wrap">
									<table>
										<thead><tr><th /><th>Kas jāieraksta</th><th>Kas tur būs</th></tr></thead>
										<tbody>
											{items.map((it) => (
												<Row key={it.slotId} item={it} onSave={(value) => save(it.slotId, value)} />
											))}
										</tbody>
									</table>
								</div>
							)}
							{open > 0 && <Banner>{open} vietas bez datiem. Failu var izveidot jau tagad — tukšās vietas tajā būs sarkanas ar uzrakstu [aizpildīt].</Banner>}
							<div className="row">
								<button className="primary" disabled={!!act.busy} onClick={generateBase}>
									{act.busy === "gen" ? "Raksta…" : "Izveidot failu"}
								</button>
								{(variant === "V2" || variant === "V3") && (
									<button disabled={!!act.busy || builders.length === 0} onClick={generateCopies}>
										Izveidot kopijas katram būvniekam ({builders.join(", ") || "nav būvnieku"})
									</button>
								)}
							</div>
						</>
					)}
				</>
			)}

			{key && isMatrica && (
				<div className="card">
					<h2>Atbildības matrica</h2>
					<p className="hint">Autori tiek ņemti no 5. soļa lomu tabulas pēc modeļa koda; LOD tiek ņemts no veidnes, bet tukšie — no PIP 1. pielikuma ar citātu. Esošas vērtības netiek mainītas. Nezināms autors paliek sarkans.</p>
					<div className="row">
						{(variant === "V2" || variant === "V3") && builders.length > 0
							? builders.map((b) => (
								<button key={b} disabled={!!act.busy} onClick={() => act.run("mat" + b, async () => { const r = await api.fill.matrica(id, key, b); if (r.ok) setMatrica((m) => [{ ...r.result, builder: b }, ...m]); return r; })}>
									{act.busy === "mat" + b ? "Raksta…" : `Aizpildīt matricu — ${b}`}
								</button>
							))
							: <button className="primary" disabled={!!act.busy} onClick={() => act.run("mat", async () => { const r = await api.fill.matrica(id, key); if (r.ok) setMatrica((m) => [{ ...r.result, builder: "" }, ...m]); return r; })}>{act.busy === "mat" ? "Raksta…" : "Aizpildīt matricu"}</button>}
					</div>
					{matrica.map((m, i) => (
						<div key={i} className="small">
							<span className="mono">{m.file}</span> — autoru ailes: {m.filledAuthors} aizpildītas, {m.missingAuthors} atzīmētas kā trūkstošas, {m.keptCells} veidnes vērtības paturētas, LOD no PIP: {m.lodFilled}
							{m.phasesAssumed && <div className="hint">Veidnes posmu galvene bija nederīga — izmantoti KC, ST, DT, AP, BV, IM, AIM.</div>}
						</div>
					))}
				</div>
			)}

			{(variant === "V1" || variant === null) && <FormsV1 project={project} bundle={bundle} />}
			{(variant === "V1" || variant === null) && <TechV1 project={project} bundle={bundle} reload={reload} />}

			{made.length > 0 && (
				<div className="card">
					<h2>Izveidotie faili</h2>
					{made.map((g, i) => (
						<div key={i}>
							<div className="row">
								<strong>{g.builder || "Pamata kopija"}</strong>
								<span className="mono small">{g.file}</span>
								<button onClick={() => api.folders.open(g.file.replace(/[\\/][^\\/]+$/, ""))}>Atvērt mapi</button>
							</div>
							<div className="small">Vietas bez datiem: {g.open}</div>
							<LeakView r={g.leaks} />
						</div>
					))}
				</div>
			)}
		</div>
	);
}
