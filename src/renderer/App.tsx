import { useCallback, useEffect, useState } from "react";
import { countdown, parseDeadline } from "../shared/format";
import { STEPS, type StepId } from "../shared/state";
import type { Project } from "../shared/types";
import { api, errorText, type StateBundle } from "./api";
import { Chat } from "./screens/Chat";
import { Dokumenti } from "./screens/Dokumenti";
import { FirstRun } from "./screens/FirstRun";
import { Konkursi } from "./screens/Konkursi";
import { NewProject } from "./screens/NewProject";
import { SettingsScreen } from "./screens/Settings";
import { Stub } from "./screens/Stub";
import { Banner, StateIcon } from "./ui";

type View = { kind: "list" } | { kind: "new" } | { kind: "settings" } | { kind: "project"; id: string; step: StepId | "chat" };

const STUBS: Record<string, { title: string; what: string; why?: string; phase: number }> = {
	versija: { title: "2. Kura versija spēkā", what: "Nolikumu drīkst grozīt pēc publicēšanas, un komisijas atbildes var mainīt vērtēšanas kritērijus.", why: "Ja strādāsi ar veco redakciju, vari izpildīt prasību, kas vairs nav spēkā.", phase: 2 },
	prasibas: { title: "3. Ko konkurss prasa", what: "App izlasa nolikumu un piedāvā, ko tas prasa. Pie katras vērtības redzams teikums, no kura tā nolasīta.", why: "Visi turpmākie soļi balstās uz šo.", phase: 2 },
	varam: { title: "4. Vai varam pieteikties", what: "Pirms sāc aizpildīt, app salīdzina konkursa prasības ar mūsu reģistriem.", phase: 4 },
	kas: { title: "5. Kas ko dara", what: "Šeit savieno konkursa prasības ar mūsu cilvēkiem un objektiem.", phase: 3 },
	aizpildit: { title: "6. Aizpildīt", what: "App saliek katram dokumentam sarakstu, kas kur jāieraksta un no kurienes tas nāk.", phase: 3 },
	pieradijumi: { title: "7. Pierādījumi", what: "Katram pieredzes objektam vajag pierādījumus.", phase: 4 },
	parbaude: { title: "8. Pārbaude", what: "Pārbaudes pirms iesniegšanas. Tās atrod tieši tās kļūdas, kas iepriekš maksājušas punktus.", phase: 5 },
	paraksti: { title: "9. Paraksti", what: "Katru dokumentu paraksta noteikta persona. App nolasa, kas tos patiešām parakstījis, un salīdzina.", phase: 5 },
	rezultats: { title: "10. Rezultāts", what: "Ko iesniedza, kas notika, un ko no tā paņemt nākamajam konkursam.", phase: 5 },
};

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
		if (!project) return <div className="screen"><Banner kind="critical">Konkurss nav atrasts.</Banner></div>;
		if (!bundle) return <div className="screen">{error ? <Banner kind="critical">{error}</Banner> : "Ielādē…"}</div>;
		if (view.step === "chat")
			return (
				<div className="screen">
					<Chat project={project} />
				</div>
			);
		if (view.step === "dokumenti") return <Dokumenti project={project} bundle={bundle} reload={reload} onProjectChanged={loadProjects} />;
		const s = STUBS[view.step];
		return <Stub {...s} />;
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
					<button className="rail-item" disabled title="Būs 3. posmā">Reģistri</button>
					<button className={`rail-item ${view.kind === "settings" ? "active" : ""}`} onClick={() => setView({ kind: "settings" })}>Iestatījumi</button>
				</nav>
				<main className="main">{main()}</main>
			</div>

			<footer className="statusbar">
				<span>{error ? "⚠ kļūda" : "Gatavs ✓"}</span>
				<span>Nekas netiek dzēsts, oriģināli netiek mainīti</span>
				{project && <span className="path" title={project.outputDir}>{project.outputDir}</span>}
			</footer>
		</div>
	);
}
