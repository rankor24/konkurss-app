import { useEffect, useRef, useState } from "react";
import { ENGINE_LABELS, type EngineId, type EngineStatus, type Project, type RunEvent } from "../../shared/types";
import { api, errorText } from "../api";

type Line = { kind: "user" | "text" | "tool" | "result" | "error" | "done"; text: string };

function toLine(ev: RunEvent): Line {
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

/** Free-form question to the agent about this tender. Every answer should cite or say „dokumentos nav”. */
export function Chat({ project }: { project: Project }) {
	const [statuses, setStatuses] = useState<EngineStatus[]>([]);
	const [engine, setEngine] = useState<EngineId>("claude");
	const [text, setText] = useState("");
	const [log, setLog] = useState<Line[]>([]);
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
				setLog((l) => {
					const last = l[l.length - 1];
					// Grok streams a few characters at a time; join consecutive text into one line.
					if (ev.type === "text" && last?.kind === "text") return [...l.slice(0, -1), { kind: "text", text: last.text + ev.text }];
					return [...l, toLine(ev)];
				});
			}),
		[],
	);
	useEffect(() => void logRef.current?.scrollTo({ top: logRef.current.scrollHeight }), [log]);

	const ready = statuses.find((s) => s.id === engine)?.ready ?? false;

	const send = async (prompt: string) => {
		if (!prompt.trim() || runId) return;
		const id = crypto.randomUUID();
		runRef.current = id;
		setRunId(id);
		setLog((l) => [...l, { kind: "user", text: prompt }]);
		setText("");
		try {
			await api.agent.run({ runId: id, projectId: project.id, engine, text: prompt });
		} catch (e) {
			setLog((l) => [...l, { kind: "error", text: errorText(e) }]);
		} finally {
			runRef.current = null;
			setRunId(null);
		}
	};

	return (
		<div className="card">
			<h2>Jautāt aģentam</h2>
			<div className="row">
				<select value={engine} onChange={(e) => setEngine(e.target.value as EngineId)} aria-label="Aģents">
					{(Object.keys(ENGINE_LABELS) as EngineId[]).map((id) => (
						<option key={id} value={id}>{ENGINE_LABELS[id]}{statuses.find((s) => s.id === id)?.ready ? "" : " — nav gatavs"}</option>
					))}
				</select>
				{!ready && <span className="small" style={{ color: "var(--warning)" }}>{statuses.find((s) => s.id === engine)?.reason}</span>}
			</div>
			<div className="log" ref={logRef}>
				{log.length === 0 && <div className="muted small">Jautā par šo konkursu. Atbildei jābūt ar citātu no dokumenta vai „dokumentos nav”.</div>}
				{log.map((l, i) => <div key={i} className={`line ${l.kind}`}>{l.text}</div>)}
				{runId && <div className="line tool">… strādā</div>}
			</div>
			<div className="row">
				<textarea className="grow" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Piem.: kur rakstīts, kāds LOD jāiesniedz KC posmā?" />
				{runId ? <button onClick={() => api.agent.stop(runId)}>Apturēt</button> : <button className="primary" disabled={!ready} onClick={() => send(text)}>Sūtīt</button>}
			</div>
		</div>
	);
}
