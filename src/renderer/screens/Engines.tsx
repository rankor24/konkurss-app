import { useEffect, useState } from "react";
import { ENGINE_LABELS, type EngineStatus, type Settings } from "../../shared/types";
import { api, errorText } from "../api";
import { PiPanel } from "./PiPanel";

/** Per-agent status, sign-in and key entry. Used by first run and Iestatījumi. */
export function EnginesPanel({ onChange }: { onChange?: (s: EngineStatus[]) => void }) {
	const [statuses, setStatuses] = useState<EngineStatus[]>([]);
	const [settings, setSettings] = useState<Settings | null>(null);
	const [key, setKey] = useState("");
	const [msg, setMsg] = useState("");

	const refresh = async () => {
		const s = await api.engines.status();
		setStatuses(s);
		setSettings(await api.settings.get());
		onChange?.(s);
	};
	useEffect(() => {
		refresh();
	}, []);

	const saveKey = async () => {
		setMsg("");
		try {
			await api.settings.setClaudeKey(key);
			setKey("");
			setMsg("Atslēga saglabāta šifrētā veidā šajā datorā.");
			refresh();
		} catch (e) {
			setMsg(errorText(e));
		}
	};

	return (
		<>
			<div className="card">
				{statuses.map((s) => (
					<div key={s.id} className="row spread" style={{ borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
						<div className="grow">
							<strong>{ENGINE_LABELS[s.id]}</strong>
							<div className="small" style={{ color: s.ready ? "var(--good)" : "var(--warning)" }}>
								{s.ready ? "● " : "○ "}
								{s.reason}
							</div>
						</div>
						{s.id === "claude" && (
							<div className="row">
								<input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-… (atslēgu iedod Boriss)" style={{ width: 240 }} />
								<button disabled={!key} onClick={saveKey}>
									Saglabāt atslēgu
								</button>
							</div>
						)}
						{s.canLogin && (
							<button
								onClick={async () => {
									await api.engines.login(s.id);
									setMsg("Atvērts pieslēgšanās logs. Kad pieslēdzies, spied „Pārbaudīt vēlreiz”.");
								}}
							>
								Pieslēgties
							</button>
						)}
						{/* pi has a model per provider, set in its own panel below */}
						{s.id !== "pi" && (
							<label className="field small">
								Modelis (tukšs = noklusējums)
								<input
									defaultValue={settings?.models[s.id] ?? ""}
									style={{ width: 170 }}
									onBlur={async (e) => setSettings(await api.settings.save({ models: { ...settings?.models, [s.id]: e.target.value.trim() || undefined } }))}
								/>
							</label>
						)}
					</div>
				))}
				<div className="row">
					<button onClick={refresh}>Pārbaudīt vēlreiz</button>
					{msg && <span className="muted small">{msg}</span>}
				</div>
			</div>
			<PiPanel onChange={refresh} />
		</>
	);
}
