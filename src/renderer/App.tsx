import { useEffect, useRef, useState } from "react";
import { ENGINE_LABELS, type EngineId, type EngineStatus, type FolderSummary, type Project, type RunEvent, type Settings, type Variant } from "../shared/types";
import { api, errorText } from "./api";

type View = { kind: "project"; id: string } | { kind: "new" } | { kind: "settings" } | { kind: "empty" };

const VARIANTS: { id: Variant; label: string; hint: string }[] = [
	{ id: "V1", label: "Projektēšana", hint: "BŪVDIZAINS ir pretendents" },
	{ id: "V2", label: "Projektē un būvē", hint: "Pretendents ir būvnieks, mēs projektētāji" },
	{ id: "V3", label: "Tikai BIM daļa", hint: "BIP, matrica, paraugmodeļi citam pretendentam" },
];

export function App() {
	const [projects, setProjects] = useState<Project[]>([]);
	const [view, setView] = useState<View>({ kind: "empty" });

	const reload = async (select?: string) => {
		const list = await api().projects.list();
		setProjects(list);
		if (select) setView({ kind: "project", id: select });
		else if (view.kind === "empty" && list.length) setView({ kind: "project", id: list[list.length - 1].id });
	};
	useEffect(() => {
		reload();
	}, []);

	const current = view.kind === "project" ? projects.find((p) => p.id === view.id) : undefined;

	return (
		<div className="shell">
			<nav className="rail">
				<div className="brand">Konkursu App</div>
				<button className="primary" onClick={() => setView({ kind: "new" })}>
					+ Jauns konkurss no mapes
				</button>
				<div className="rail-label">Konkursi</div>
				{projects.length === 0 && <div className="muted small">Vēl nav neviena konkursa.</div>}
				{projects.map((p) => (
					<button key={p.id} className={`rail-item ${current?.id === p.id ? "active" : ""}`} onClick={() => setView({ kind: "project", id: p.id })}>
						<span>{p.name}</span>
						{p.variant && <span className="badge">{p.variant}</span>}
					</button>
				))}
				<div className="rail-spacer" />
				<button className={`rail-item ${view.kind === "settings" ? "active" : ""}`} onClick={() => setView({ kind: "settings" })}>
					Iestatījumi
				</button>
			</nav>
			<main className="content">
				{view.kind === "new" && <NewProject onCreated={(p) => reload(p.id)} onCancel={() => setView({ kind: "empty" })} />}
				{view.kind === "settings" && <SettingsView />}
				{current && <ProjectView key={current.id} project={current} onChanged={() => reload(current.id)} />}
				{view.kind === "empty" && !current && (
					<div className="empty">
						<h1>Sāc ar konkursa mapi</h1>
						<p className="muted">Izvēlies mapi, kur ir konkursa dokumenti (parasti KONKURSS), un mapi, kur likt jaunos dokumentus.</p>
						<button className="primary" onClick={() => setView({ kind: "new" })}>
							+ Jauns konkurss no mapes
						</button>
					</div>
				)}
			</main>
		</div>
	);
}

function Summary({ s }: { s: FolderSummary | null }) {
	if (!s) return null;
	if (!s.exists) return <div className="warn">Mape vēl neeksistē — app to izveidos, kad saglabās pirmo dokumentu.</div>;
	if (s.total === 0) return <div className="warn">Mape ir tukša. Pārbaudi, vai tā ir īstā kopija (Desktop kopijas mēdz būt tukšas).</div>;
	const parts = Object.entries(s.byExt)
		.sort((a, b) => b[1] - a[1])
		.map(([ext, n]) => `${n} ${ext}`);
	return (
		<div className="ok">
			Atrasti {s.total} faili: {parts.join(", ")}
		</div>
	);
}

function parentOf(p: string): string {
	return p.replace(/[\\/][^\\/]+[\\/]?$/, "");
}

function NewProject({ onCreated, onCancel }: { onCreated: (p: Project) => void; onCancel: () => void }) {
	const [source, setSource] = useState("");
	const [sourceSum, setSourceSum] = useState<FolderSummary | null>(null);
	const [output, setOutput] = useState("");
	const [outputSum, setOutputSum] = useState<FolderSummary | null>(null);
	const [variant, setVariant] = useState<Variant | null>(null);
	const [builders, setBuilders] = useState("");
	const [name, setName] = useState("");
	const [error, setError] = useState("");

	const pickSource = async () => {
		const p = await api().folders.pick("Izvēlies konkursa dokumentu mapi (izejas dati)");
		if (!p) return;
		setSource(p);
		setSourceSum(await api().folders.summary(p));
		if (!output) {
			const suggestion = `${parentOf(p)}\\IESNIEDZAMIE`;
			setOutput(suggestion);
			setOutputSum(await api().folders.summary(suggestion));
		}
	};
	const pickOutput = async () => {
		const p = await api().folders.pick("Kur likt jaunos dokumentus?");
		if (!p) return;
		setOutput(p);
		setOutputSum(await api().folders.summary(p));
	};
	const create = async () => {
		setError("");
		try {
			const needsBuilders = variant === "V2" || variant === "V3";
			const p = await api().projects.add({
				name,
				sourceDir: source,
				outputDir: output,
				variant,
				builders: needsBuilders ? builders.split(",") : [],
			});
			onCreated(p);
		} catch (e) {
			setError(errorText(e));
		}
	};

	return (
		<div className="page">
			<h1>Jauns konkurss no mapes</h1>
			<p className="muted">Oriģinālos dokumentus app nekad nemaina. Jaunās versijas tiek liktas izvades mapē.</p>

			<section className="step">
				<h2>1. Izejas dati</h2>
				<p className="muted small">Mape ar nolikumu, pielikumiem, grozījumiem un atbildēm (parasti KONKURSS).</p>
				<div className="row">
					<code className="path">{source || "nav izvēlēta"}</code>
					<button onClick={pickSource}>Izvēlēties mapi</button>
				</div>
				<Summary s={sourceSum} />
			</section>

			<section className="step">
				<h2>2. Kur likt jaunos dokumentus</h2>
				<div className="row">
					<code className="path">{output || "nav izvēlēta"}</code>
					<button onClick={pickOutput}>Izvēlēties mapi</button>
				</div>
				<Summary s={outputSum} />
			</section>

			<section className="step">
				<h2>3. Konkursa veids</h2>
				<div className="cards">
					{VARIANTS.map((v) => (
						<button key={v.id} className={`card ${variant === v.id ? "selected" : ""}`} onClick={() => setVariant(v.id)}>
							<strong>{v.label}</strong>
							<span className="muted small">{v.hint}</span>
						</button>
					))}
				</div>
				<p className="muted small">Nezini? Atstāj tukšu — vēlāk aģents to nolasīs no tehniskās specifikācijas ar citātu.</p>
				{(variant === "V2" || variant === "V3") && (
					<label className="field">
						Būvnieki (ar komatu), kuriem gatavojam
						<input value={builders} onChange={(e) => setBuilders(e.target.value)} placeholder="piem. UPB, Pillar" />
					</label>
				)}
			</section>

			<section className="step">
				<h2>4. Nosaukums</h2>
				<label className="field">
					<input value={name} onChange={(e) => setName(e.target.value)} placeholder="ja tukšs — mapes nosaukums" />
				</label>
			</section>

			{error && <div className="error">{error}</div>}
			<div className="row">
				<button className="primary" disabled={!source || !output} onClick={create}>
					Izveidot
				</button>
				<button onClick={onCancel}>Atcelt</button>
			</div>
		</div>
	);
}

type LogLine = { kind: "user" | "text" | "tool" | "result" | "error" | "done"; text: string };

function ProjectView({ project, onChanged }: { project: Project; onChanged: () => void }) {
	const [statuses, setStatuses] = useState<EngineStatus[]>([]);
	const [engine, setEngine] = useState<EngineId>("claude");
	const [text, setText] = useState("");
	const [log, setLog] = useState<LogLine[]>([]);
	const [runId, setRunId] = useState<string | null>(null);
	const logRef = useRef<HTMLDivElement>(null);
	const runIdRef = useRef<string | null>(null);

	useEffect(() => {
		api().engines.status().then(setStatuses);
		api().settings.get().then((s) => setEngine(s.engineForTasks));
	}, []);
	useEffect(() => {
		return api().agent.onEvent((id, ev) => {
			if (id !== runIdRef.current) return;
			setLog((l) => {
				// Grok streams text a few characters at a time; join consecutive text into one line.
				const last = l[l.length - 1];
				if (ev.type === "text" && last?.kind === "text") return [...l.slice(0, -1), { kind: "text", text: last.text + ev.text }];
				return [...l, toLine(ev)];
			});
		});
	}, []);
	useEffect(() => {
		logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
	}, [log]);

	const ready = statuses.find((s) => s.id === engine)?.ready ?? false;

	const send = async (prompt: string) => {
		if (!prompt.trim() || runId) return;
		const id = crypto.randomUUID();
		runIdRef.current = id;
		setRunId(id);
		setLog((l) => [...l, { kind: "user", text: prompt }]);
		setText("");
		try {
			await api().agent.run({ runId: id, projectId: project.id, engine, text: prompt });
		} catch (e) {
			setLog((l) => [...l, { kind: "error", text: errorText(e) }]);
		} finally {
			runIdRef.current = null;
			setRunId(null);
		}
	};

	return (
		<div className="page project">
			<header className="project-head">
				<h1>{project.name}</h1>
				<div className="meta">
					<span>Veids: {project.variant ? VARIANTS.find((v) => v.id === project.variant)?.label : "nav noteikts"}</span>
					{project.builders.length > 0 && <span>Būvnieki: {project.builders.join(", ")}</span>}
				</div>
				<div className="row small">
					<span className="muted">Izejas dati:</span>
					<code className="path">{project.sourceDir}</code>
					<button onClick={() => api().folders.open(project.sourceDir)}>Atvērt</button>
				</div>
				<div className="row small">
					<span className="muted">Izvade:</span>
					<code className="path">{project.outputDir}</code>
					<button onClick={() => api().folders.open(project.outputDir)}>Atvērt</button>
				</div>
			</header>

			<section className="chat">
				<div className="row">
					<label className="small muted">Aģents:</label>
					<select value={engine} onChange={(e) => setEngine(e.target.value as EngineId)}>
						{(Object.keys(ENGINE_LABELS) as EngineId[]).map((id) => (
							<option key={id} value={id}>
								{ENGINE_LABELS[id]}
								{statuses.find((s) => s.id === id)?.ready ? "" : " — nav gatavs"}
							</option>
						))}
					</select>
					{!ready && <span className="warn small">{statuses.find((s) => s.id === engine)?.reason}</span>}
				</div>
				<div className="quick">
					<button disabled={!!runId || !ready} onClick={() => send("Izlasi visus izejas datu failus un pastāsti, kas ir šajā konkursā: pasūtītājs, ID, termiņš, konkursa veids (ar citātu), kādi dokumenti jāiesniedz. Norādi, cik failu izlasīti no cik.")}>
						Kas ir šajā konkursā?
					</button>
					<button disabled={!!runId || !ready} onClick={() => send("Kurš variants šis ir — projektēšana, projektē un būvē vai tikai BIM daļa? Dod citātu no dokumenta.")}>
						Noteikt konkursa veidu
					</button>
				</div>
				<div className="log" ref={logRef}>
					{log.length === 0 && <div className="muted small">Jautā par šo konkursu. Katrai atbildei jābūt ar citātu no dokumenta.</div>}
					{log.map((l, i) => (
						<div key={i} className={`line ${l.kind}`}>
							{l.text}
						</div>
					))}
					{runId && <div className="line tool">… strādā</div>}
				</div>
				<div className="row">
					<textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Piem.: kur rakstīts, kāds LOD jāiesniedz KC posmā?" rows={3} />
					{runId ? (
						<button onClick={() => api().agent.stop(runId)}>Apturēt</button>
					) : (
						<button className="primary" disabled={!ready} onClick={() => send(text)}>
							Sūtīt
						</button>
					)}
				</div>
			</section>
			<VariantEditor project={project} onChanged={onChanged} />
		</div>
	);
}

function toLine(ev: RunEvent): LogLine {
	switch (ev.type) {
		case "text":
			return { kind: "text", text: ev.text };
		case "tool":
			return { kind: "tool", text: `→ ${ev.name}${ev.detail ? ` ${ev.detail}` : ""}` };
		case "tool_result":
			return { kind: "result", text: `${ev.ok ? "✓" : "✗"} ${ev.name}${ev.detail ? `: ${ev.detail}` : ""}` };
		case "done":
			return { kind: "done", text: "Pabeigts." };
		case "error":
			return { kind: "error", text: `Kļūda (${ev.engine}): ${ev.message}` };
	}
}

function VariantEditor({ project, onChanged }: { project: Project; onChanged: () => void }) {
	const [builders, setBuilders] = useState(project.builders.join(", "));
	const save = async (patch: { variant?: Variant | null; builders?: string[] }) => {
		await api().projects.update(project.id, patch);
		onChanged();
	};
	return (
		<section className="step">
			<h2>Konkursa veids un būvnieki</h2>
			<div className="cards">
				{VARIANTS.map((v) => (
					<button key={v.id} className={`card ${project.variant === v.id ? "selected" : ""}`} onClick={() => save({ variant: v.id })}>
						<strong>{v.label}</strong>
						<span className="muted small">{v.hint}</span>
					</button>
				))}
			</div>
			<div className="row">
				<input value={builders} onChange={(e) => setBuilders(e.target.value)} placeholder="Būvnieki ar komatu" />
				<button onClick={() => save({ builders: builders.split(",").map((b) => b.trim()).filter(Boolean) })}>Saglabāt būvniekus</button>
			</div>
		</section>
	);
}

function SettingsView() {
	const [statuses, setStatuses] = useState<EngineStatus[]>([]);
	const [settings, setSettings] = useState<Settings | null>(null);
	const [key, setKey] = useState("");
	const [msg, setMsg] = useState("");

	const refresh = async () => {
		setStatuses(await api().engines.status());
		setSettings(await api().settings.get());
	};
	useEffect(() => {
		refresh();
	}, []);

	const saveKey = async () => {
		setMsg("");
		try {
			await api().settings.setClaudeKey(key);
			setKey("");
			setMsg("Atslēga saglabāta šifrētā veidā šajā datorā.");
			refresh();
		} catch (e) {
			setMsg(errorText(e));
		}
	};

	return (
		<div className="page">
			<h1>Iestatījumi</h1>
			<section className="step">
				<h2>Aģenti</h2>
				{statuses.map((s) => (
					<div key={s.id} className="engine">
						<div>
							<strong>{ENGINE_LABELS[s.id]}</strong>
							<div className={s.ready ? "ok small" : "warn small"}>{s.reason}</div>
						</div>
						{s.id === "claude" && (
							<div className="row">
								<input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-… (Boriss iedod)" />
								<button onClick={saveKey} disabled={!key}>
									Saglabāt atslēgu
								</button>
							</div>
						)}
						{s.canLogin && (
							<button
								onClick={async () => {
									await api().engines.login(s.id);
									setMsg("Atvērts pieslēgšanās logs. Pēc pieslēgšanās spied „Pārbaudīt vēlreiz”.");
								}}
							>
								Pieslēgties
							</button>
						)}
						<label className="field small">
							Modelis (tukšs = noklusējums)
							<input
								defaultValue={settings?.models[s.id] ?? ""}
								onBlur={async (e) => setSettings(await api().settings.save({ models: { ...settings?.models, [s.id]: e.target.value.trim() || undefined } }))}
							/>
						</label>
					</div>
				))}
				<button onClick={refresh}>Pārbaudīt vēlreiz</button>
				{msg && <div className="muted small">{msg}</div>}
			</section>
			<section className="step">
				<h2>Noklusējuma aģents</h2>
				<select value={settings?.engineForTasks ?? "claude"} onChange={async (e) => setSettings(await api().settings.save({ engineForTasks: e.target.value as EngineId }))}>
					{(Object.keys(ENGINE_LABELS) as EngineId[]).map((id) => (
						<option key={id} value={id}>
							{ENGINE_LABELS[id]}
						</option>
					))}
				</select>
				<p className="muted small">Ja aģents nav pieejams, app parāda kļūdu un automātiski uz citu nepārslēdzas.</p>
			</section>
		</div>
	);
}
