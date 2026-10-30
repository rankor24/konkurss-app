import { useEffect, useState } from "react";
import type { Project } from "../../shared/types";
import { api, type EvidenceItem, type StateBundle } from "../api";
import { Banner, ScreenHead, useAction } from "../ui";

/** 7. Pierādījumi — bring the evidence files for the chosen objects into the package, numbered. */
export function Pieradijumi({ project, bundle }: { project: Project; bundle: StateBundle; reload: () => Promise<void> }) {
	const [plan, setPlan] = useState<EvidenceItem[] | null>(null);
	const [result, setResult] = useState<{ copied: string[]; skipped: string[] } | null>(null);
	const act = useAction();
	const chosen = Object.values(bundle.state.choices.objects).flat().length;
	const load = () => api.v1.proofPlan(project.id).then(setPlan);
	useEffect(() => void load(), [project.id, bundle.state.choices]);

	const missing = plan?.filter((p) => p.status === "missing") ?? [];
	return (
		<div className="screen">
			<ScreenHead title="7. Pierādījumi" what="Katram pieredzes objektam vajag pierādījumus. App zina, kur tie glabājas no iepriekšējiem konkursiem, un var tos atnest." why="Faili tiek nokopēti uz izvades mapi ar pareizo numerāciju; oriģināli paliek tur, kur bija." />
			{act.error && <Banner kind="critical">{act.error}</Banner>}
			{chosen === 0 && <Banner>Vēl nav izvēlēts neviens objekts — to dara 5. solī (Kas ko dara).</Banner>}
			{plan && plan.length > 0 && (
				<div className="table-wrap">
					<table>
						<thead><tr><th>Objekts</th><th>Dokuments</th><th>Kur liks</th><th /></tr></thead>
						<tbody>
							{plan.map((p, i) => (
								<tr key={i} style={{ height: "auto" }}>
									<td>{p.object}</td>
									<td>{p.label}</td>
									<td className="mono small">{p.status === "ok" ? p.toRel : <span style={{ color: "var(--critical)" }}>{p.reason}</span>}</td>
									<td style={{ color: p.status === "ok" ? "var(--good)" : "var(--critical)" }}>{p.status === "ok" ? "✓" : "✗"}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
			{missing.length > 0 && <Banner kind="critical">{missing.length} pierādījumi nav atrasti. Atver objektu Reģistros un norādi, kur glabājas fails.</Banner>}
			<div className="card">
				<h2>Kur tos liks</h2>
				<div className="small">Uzņēmuma pieredzei → <span className="mono">Pierādījumi\2_1…</span>. BPV un energoefektivitātes pieredzei → apakšmape ar BPV uzvārdu (<span className="mono">Pierādījumi\Kalnins\3_1…</span>), lai BPV var parakstīt savu komplektu. Finanšu piedāvājums paliek atsevišķi, ne kopā ar pārējiem.</div>
			</div>
			<div className="row">
				<button className="primary" disabled={!plan || plan.every((p) => p.status !== "ok") || !!act.busy} onClick={() => act.run("collect", async () => void setResult(await api.v1.proofCollect(project.id)), load)}>Atnest failus</button>
				{result && <span className="small">Nokopēti {result.copied.length}, jau bija {result.skipped.length}.</span>}
			</div>
		</div>
	);
}
