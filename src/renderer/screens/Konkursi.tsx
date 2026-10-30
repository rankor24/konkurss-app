import { useEffect, useState } from "react";
import { ago } from "../../shared/format";
import { api, errorText, type ProjectSummary } from "../api";
import { Banner, ScreenHead } from "../ui";

export function Konkursi({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
	const [list, setList] = useState<ProjectSummary[] | null>(null);
	const [error, setError] = useState("");
	const [confirmForget, setConfirmForget] = useState<string | null>(null);

	const load = () => api.projects.summaries().then(setList).catch((e) => setError(errorText(e)));
	useEffect(() => {
		load();
	}, []);

	return (
		<div className="screen">
			<div className="row spread">
				<ScreenHead title="Konkursi" what="Šeit ir visi konkursi, pie kuriem strādā. Katram redzams, cik tālu tas ir un cik laika atlicis." />
				<button className="primary" onClick={onNew}>+ Jauns konkurss no mapes</button>
			</div>
			{error && <Banner kind="critical">{error}</Banner>}
			{list?.length === 0 && <p className="muted">Vēl nav neviena konkursa.</p>}
			<div className="card" style={{ padding: 0 }}>
				{list?.map(({ project: p, progress, tenderId, deadline, changedAt, sourceExists }) => (
					<div key={p.id} className="proj" onClick={() => onOpen(p.id)}>
						<div>
							<div className="name">{p.name}</div>
							<div className="small muted">
								{tenderId ?? "ID vēl nav nolasīts"}
								{deadline ? ` · termiņš ${deadline}` : ""}
								{p.variant ? ` · ${p.variant}` : ""}
								{p.builders.length ? ` · būvnieki: ${p.builders.join(", ")}` : ""}
							</div>
							<div className="progress" style={{ width: 220, marginTop: 6 }} aria-label={`${progress.done} no ${progress.total} soļiem`}>
								<span style={{ width: `${(progress.done / progress.total) * 100}%` }} />
							</div>
							<div className="hint">
								{progress.done} no {progress.total} soļiem · mainīts {ago(changedAt)}
								{progress.problems > 0 && <span style={{ color: "var(--critical)" }}> · ⚠ {progress.problems} jālabo</span>}
								{!sourceExists && <span style={{ color: "var(--critical)" }}> · ⚠ izejas datu mape nav atrasta</span>}
							</div>
							<div className="hint mono">{p.sourceDir}</div>
						</div>
						<div onClick={(e) => e.stopPropagation()}>
							{confirmForget === p.id ? (
								<div className="small" style={{ textAlign: "right" }}>
									<div>Noņemt no saraksta? Faili diskā paliek.</div>
									<button
										onClick={async () => {
											await api.projects.forget(p.id);
											setConfirmForget(null);
											load();
										}}
									>
										Noņemt
									</button>{" "}
									<button onClick={() => setConfirmForget(null)}>Atcelt</button>
								</div>
							) : (
								<button title="Noņemt no saraksta (faili paliek)" aria-label="Noņemt no saraksta" onClick={() => setConfirmForget(p.id)}>
									×
								</button>
							)}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
