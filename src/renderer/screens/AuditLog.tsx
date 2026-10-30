import { useEffect, useState } from "react";
import type { Project } from "../../shared/types";
import { api } from "../api";

type Row = { at: string; tool: string; path?: string; ok: boolean; reason?: string; engine?: string };
const TOOL: Record<string, string> = { list_files: "Failu saraksts", read_doc: "Dokumenta lasīšana", get_skill: "Instrukcijas", write_text: "Faila rakstīšana" };

/** Every file the assistant touched in one tender: what it read, what it wrote, and what was refused. */
export function AuditLog() {
	const [projects, setProjects] = useState<Project[]>([]);
	const [id, setId] = useState("");
	const [rows, setRows] = useState<Row[] | null>(null);
	useEffect(() => void api.projects.list().then((p) => { setProjects(p); if (p[0]) setId(p[0].id); }), []);
	useEffect(() => {
		if (id) api.audit.tail(id, 200).then(setRows);
	}, [id]);
	return (
		<div className="card">
			<h2>Darbību žurnāls</h2>
			<div className="small">Ko palīgs konkursa mapēs lasīja, ko rakstīja un ko aizliedza. Tiek veidots automātiski; neko nevar izdzēst no šejienes.</div>
			<select value={id} onChange={(e) => setId(e.target.value)} style={{ maxWidth: 360, marginTop: 6 }}>
				{projects.length === 0 && <option value="">Nav neviena konkursa</option>}
				{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
			</select>
			{rows && rows.length === 0 && <div className="small" style={{ marginTop: 6 }}>Šim konkursam vēl nav ierakstu.</div>}
			{rows && rows.length > 0 && (
				<div className="table-wrap" style={{ maxHeight: 280, overflow: "auto", marginTop: 6 }}>
					<table>
						<thead><tr><th>Laiks</th><th>Darbība</th><th>Fails</th><th>Rezultāts</th></tr></thead>
						<tbody>
							{rows.map((r, i) => (
								<tr key={i} style={{ height: "auto" }}>
									<td className="small">{new Date(r.at).toLocaleString("lv-LV")}</td>
									<td>{TOOL[r.tool] ?? r.tool}{r.engine && <span className="small"> · {r.engine}</span>}</td>
									<td className="mono small">{r.path ?? "—"}</td>
									<td style={{ color: r.ok ? "var(--good)" : "var(--critical)" }}>{r.ok ? "✓" : `✗ ${r.reason ?? "aizliegts"}`}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}
