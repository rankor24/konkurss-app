import { useEffect, useState } from "react";
import type { DepItem } from "../../shared/deps";
import { api } from "../api";
import { Banner, useAction } from "../ui";

const ICON = { ok: "●", missing: "○", old: "⚠", warn: "⚠" } as const;
const COLOR = { ok: "var(--good)", missing: "var(--critical)", old: "var(--warning)", warn: "var(--warning)" } as const;

/** What this computer has and what is missing — one line each, with what to do about it. */
export function DepsPanel() {
	const [items, setItems] = useState<DepItem[] | null>(null);
	const [out, setOut] = useState("");
	const act = useAction();
	const load = () => api.deps.status().then(setItems);
	useEffect(() => void load(), []);
	return (
		<div className="card">
			<h2>Vai dators ir gatavs</h2>
			<div className="small">Ja kaut kas nestrādā, sāc šeit. Katrai rindai blakus ir teikts, ko darīt.</div>
			{act.error && <Banner kind="critical">{act.error}</Banner>}
			{!items && <div className="small">Pārbauda…</div>}
			{items?.map((d) => (
				<div key={d.id} className="row spread" style={{ borderTop: "1px solid var(--line)", paddingTop: 8, marginTop: 8 }}>
					<div className="grow">
						<strong>{d.label}</strong>
						<div className="small" style={{ color: COLOR[d.state] }}>{ICON[d.state]} {d.detail}</div>
						{d.fix && <div className="small">{d.fix}</div>}
					</div>
					{d.action === "update-grok" && (
						<button disabled={!!act.busy} onClick={() => act.run("grok", async () => { const r = await api.deps.updateGrok(); setOut(r.out); if (!r.ok) return { ok: false, error: r.out || "Neizdevās atjaunināt Grok." }; }, load)}>
							{act.busy === "grok" ? "Atjaunina…" : "Atjaunināt Grok"}
						</button>
					)}
				</div>
			))}
			{out && <pre className="small" style={{ whiteSpace: "pre-wrap" }}>{out}</pre>}
			<div style={{ marginTop: 8 }}><button onClick={load}>Pārbaudīt vēlreiz</button></div>
		</div>
	);
}
