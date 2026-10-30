import { useCallback, useEffect, useState } from "react";
import { countdown, parseDeadline } from "../shared/format";
import { STEPS, type StepId } from "../shared/state";
import type { Project } from "../shared/types";
import { api, errorText, type StateBundle } from "./api";
import { Chat } from "./screens/Chat";
import { Aizpildit } from "./screens/Aizpildit";
import { Pieradijumi } from "./screens/Pieradijumi";
import { Varam } from "./screens/Varam";
import { Dokumenti } from "./screens/Dokumenti";
import { KasKoDara } from "./screens/KasKoDara";
import { Registri } from "./screens/Registri";
import { Prasibas } from "./screens/Prasibas";
import { Versija } from "./screens/Versija";
import { FirstRun } from "./screens/FirstRun";
import { Konkursi } from "./screens/Konkursi";
import { NewProject } from "./screens/NewProject";
import { SettingsScreen } from "./screens/Settings";
import { Parbaude } from "./screens/Parbaude";
import { Paraksti } from "./screens/Paraksti";
import { Rezultats } from "./screens/Rezultats";
import { ActivityPanel } from "./screens/ActivityPanel";
import { Banner, StateIcon } from "./ui";

type View = { kind: "list" } | { kind: "new" } | { kind: "settings" } | { kind: "registers" } | { kind: "project"; id: string; step: StepId | "chat" };

export function App() {
	const [projects, setProjects] = useState<Project[] | null>(null);
	const [view, setView] = useState<View>({ kind: "list" });
	const [bundle, setBundle] = useState<StateBundle | null>(null);
	const [error, setError] = useState("");
	const [firstRunDone, setFirstRunDone] = useState(() => {
		try {
			return localStorage.getItem("firstRunDone") === "1";
		} catch {
			return false;
		}
	});

	const loadProjects = useCallback(async () => setProjects(await api.projects.list()), []);
	useEffect(() => void loadProjects(), [loadProjects]);

	const project = view.kind === "project" ? projects?.find((p) => p.id === view.id) : undefined;
	const projectId = project?.id;

	const reload = useCallback(async () => {
		if (!projectId) return setBundle(null);
		try {
			setBundle(await api.state.get(projectId));
			setError("");
		} catch (e) {
			setError(errorText(e));
		}
	}, [projectId]);
	useEffect(() => void reload(), [reload]);

	const finishFirstRun = () => {
		try {
			localStorage.setItem("firstRunDone", "1");
		} catch {
			/* private mode: the welcome simply shows again */
		}
		setFirstRunDone(true);
	};

	const [now, setNow] = useState(() => new Date());
	useEffect(() => {
		const t = setInterval(() => setNow(new Date()), 60_000);
		return () => clearInterval(t);
	}, []);
	const cd = bundle ? countdown(parseDeadline(bundle.state.deadline.date.value, bundle.state.deadline.time.value), now) : null;

	if (projects === null) return <div className="screen">Ielādē…</div>;
	const showFirstRun = projects.length === 0 && !firstRunDone && view.kind === "list";

	const main = () => {
		if (showFirstRun) return <FirstRun onNewProject={() => (finishFirstRun(), setView({ kind: "new" }))} onSkip={finishFirstRun} />;
		if (view.kind === "list") return <Konkursi onOpen={(id) => setView({ kind: "project", id, step: "dokumenti" })} onNew={() => setView({ kind: "new" })} />;
		if (view.kind === "new")
			return <NewProject onCreated={async (p) => (await loadProjects(), setView({ kind: "project", id: p.id, step: "dokumenti" }))} onCancel={() => setView({ kind: "list" })} />;
		if (view.kind === "settings") return <SettingsScreen />;
		if (view.kind === "registers") return <Registri />;
		if (!project) return <div className="screen"><Banner kind="critical">Konkurss nav atrasts.</Banner></div>;
		if (!bundle) return <div className="screen">{error ? <Banner kind="critical">{error}</Banner> : "Ielādē…"}</div>;
		if (view.step === "chat")
			return (
				<div className="screen">
					<Chat project={project} />
				</div>
			);
		if (view.step === "dokumenti") return <Dokumenti project={project} bundle={bundle} reload={reload} onProjectChanged={loadProjects} />;
		if (view.step === "varam") return <Varam project={project} bundle={bundle} reload={reload} />;
		if (view.step === "pieradijumi") return <Pieradijumi project={project} bundle={bundle} reload={reload} />;
		if (view.step === "kas") return <KasKoDara project={project} bundle={bundle} reload={reload} />;
		if (view.step === "aizpildit") return <Aizpildit project={project} bundle={bundle} reload={reload} />;
		if (view.step === "versija") return <Versija project={project} bundle={bundle} reload={reload} />;
		if (view.step === "prasibas") return <Prasibas project={project} bundle={bundle} reload={reload} />;
		if (view.step === "parbaude") return <Parbaude project={project} bundle={bundle} reload={reload} go={(step) => setView({ kind: "project", id: project.id, step })} />;
		if (view.step === "paraksti") return <Paraksti project={project} bundle={bundle} reload={reload} />;
		return <Rezultats project={project} bundle={bundle} reload={reload} />;
	};

	return (
		<div className="app">
			<header className="topbar">
				<button className="link" onClick={() => setView({ kind: "list" })}>Konkursi</button>
				{project && (
					<>
						<span className="title">{project.name}</span>
						{bundle?.state.requirements.dati.id.value && <span className="mono">{bundle.state.requirements.dati.id.value}</span>}
						{cd && <span className={`chip ${cd.critical ? "critical" : ""}`}>⏱ {cd.text}</span>}
						{bundle && <span className="chip" title="Konkrēti darāmie punkti, kas jau izdarīti">Čeklists {bundle.checklist.done}/{bundle.checklist.total}</span>}
					</>
				)}
				<span className="spacer" />
			</header>

			<div className="body">
				<nav className="rail" aria-label="Soļi">
					{project ? (
						<>
							{STEPS.map((st) => (
								<button key={st.id} className={`rail-item ${view.kind === "project" && view.step === st.id ? "active" : ""}`} onClick={() => setView({ kind: "project", id: project.id, step: st.id })}>
									<StateIcon status={bundle?.steps[st.id] ?? "nav"} />
									<span className="n">{st.n}</span>
									{st.label}
								</button>
							))}
							<button className={`rail-item ${view.kind === "project" && view.step === "chat" ? "active" : ""}`} onClick={() => setView({ kind: "project", id: project.id, step: "chat" })}>
								<span className="st">?</span><span className="n" />Jautāt aģentam
							</button>
							<div className="rail-sep" />
						</>
					) : null}
					<button className={`rail-item ${view.kind === "list" || view.kind === "new" ? "active" : ""}`} onClick={() => setView({ kind: "list" })}>Konkursi</button>
					<button className={`rail-item ${view.kind === "registers" ? "active" : ""}`} onClick={() => setView({ kind: "registers" })}>Reģistri</button>
					<button className={`rail-item ${view.kind === "settings" ? "active" : ""}`} onClick={() => setView({ kind: "settings" })}>Iestatījumi</button>
				</nav>
				<main className="main">{main()}</main>
				<ActivityPanel projectId={project?.id ?? null} />
			</div>

			<footer className="statusbar">
				<span>{error ? "⚠ kļūda" : "Gatavs ✓"}</span>
				<span>Nekas netiek dzēsts, oriģināli netiek mainīti</span>
				{project && <span className="path" title={project.outputDir}>{project.outputDir}</span>}
			</footer>
		</div>
	);
}
