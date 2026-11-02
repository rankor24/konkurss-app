import { useEffect, useRef, useState } from "react";
import { ENGINE_LABELS, type EngineId, type EngineStatus, type Project } from "../../shared/types";
import { api, errorText } from "../api";
import { AgentSwitch } from "../ui";
import { addEvent, type Block } from "../transcript";
import { Transcript } from "./Transcript";

/** Free-form question to the agent about this tender. Every answer should cite or say „dokumentos nav”. */
const EXAMPLES = [
	"Pārskati, kas vēl nav aizpildīts, un aizpildi tukšās BIP sadaļas ar to, kas rakstīts BIM prasībās (PIP). Katram ierakstam citāts.",
	"Atrodi iesniegšanas termiņu nolikumā un ieraksti to.",
	"Pārskati visas veidlapas un pasaki, kuri lauki palikuši tukši un kāpēc.",
];

/** The agent for this tender: answers questions AND fills fields of the forms, deadline and roles — only with true information it can quote. */
export function Chat({ project, onChanged }: { project: Project; onChanged?: () => Promise<void> | void }) {
	const [statuses, setStatuses] = useState<EngineStatus[]>([]);
	const [engine, setEngine] = useState<EngineId>("claude");
	const [text, setText] = useState("");
	const [log, setLog] = useState<Block[]>([]);
	const [runId, setRunId] = useState<string | null>(null);
	const runRef = useRef<string | null>(null);
	const logRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		api.engines.status().then(setStatuses);
		api.settings.get().then((s) => setEngine(s.engineForTasks));
	}, []);
	useEffect(
		() =>
			api.agent.onEvent((id, ev) => {
				if (id !== runRef.current) return;
				setLog((l) => addEvent(l, ev));
			}),
		[],
	);
	// follow the newest step unless the person has scrolled up to read
	const follow = useRef(true);
	useEffect(() => {
		if (follow.current) logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
	}, [log]);

	const ready = statuses.find((s) => s.id === engine)?.ready ?? false;

	const send = async (prompt: string) => {
		if (!prompt.trim() || runId) return;
		const id = crypto.randomUUID();
		runRef.current = id;
		follow.current = true;
		setRunId(id);
		setLog((l) => [...l, { k: "user", text: prompt }]);
		setText("");
		try {
			await api.agent.run({ runId: id, projectId: project.id, engine, text: prompt });
		} catch (e) {
			setLog((l) => [...l, { k: "error", text: errorText(e) }]);
		} finally {
			runRef.current = null;
			setRunId(null);
			// the agent may have written into the forms: show the new state on every screen
			await onChanged?.();
		}
	};

	return (
		<div className="card">
			<div className="head-row"><h2>Aģents</h2><AgentSwitch /></div>
			<div className="small">Aģents ne tikai atbild, bet arī <b>aizpilda</b>: veidlapu laukus (BIP u.c.), termiņu un lomas. Ieraksta tikai to, ko var citēt no konkursa dokumentiem; ko tu pats esi ierakstījis, to neaizstāj. Word/Excel failus izveido tu ar pogu 6. solī.</div>
			<div className="row">
				<select value={engine} onChange={(e) => setEngine(e.target.value as EngineId)} aria-label="Aģents">
					{(Object.keys(ENGINE_LABELS) as EngineId[]).map((id) => (
						<option key={id} value={id}>{ENGINE_LABELS[id]}{statuses.find((s) => s.id === id)?.ready ? "" : " — nav gatavs"}</option>
					))}
				</select>
				{!ready && <span className="small" style={{ color: "var(--warning)" }}>{statuses.find((s) => s.id === engine)?.reason}</span>}
			</div>
			<div
					className="log"
					ref={logRef}
					onScroll={(e) => {
						const el = e.currentTarget;
						follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
					}}
				>
				{log.length === 0 && (
					<div className="muted small">
						<div>Pasaki, ko darīt, vai jautā. Piemēri (spied, lai ievietotu):</div>
						{EXAMPLES.map((x) => <div key={x}><button className="link" onClick={() => setText(x)}>{x}</button></div>)}
					</div>
				)}
				<Transcript blocks={log} active={!!runId} engine={ENGINE_LABELS[engine]} />
			</div>
			<div className="row">
				<textarea className="grow" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ko darīt? Piem.: aizpildi sadaļu „Garantijas laiks” no PIP / kur rakstīts, kāds LOD jāiesniedz KC posmā?" />
				{runId ? <button onClick={() => api.agent.stop(runId)}>Apturēt</button> : <button className="primary" disabled={!ready} onClick={() => send(text)}>Sūtīt</button>}
			</div>
		</div>
	);
}
