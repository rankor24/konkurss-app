import { useEffect, useState } from "react";
import type { Activity } from "../../shared/activity";
import { onActivity } from "../api";

const ICON = { start: "▶", tool: "·", progress: "…", done: "✓", error: "✗" } as const;
const MAX = 80;

/** Keeps the newest lines; a progress line of a run replaces that run's previous progress line instead of piling up. */
export function addActivity(list: Activity[], a: Activity): Activity[] {
	const prev = list[0];
	const next = a.kind === "progress" && prev && prev.run === a.run && prev.kind === "progress" ? [a, ...list.slice(1)] : [a, ...list];
	return next.slice(0, MAX);
}

/** A run is "running" until its latest line is done or an error. */
export function runningNow(list: Activity[]): boolean {
	const latest = list[0];
	return !!latest && latest.kind !== "done" && latest.kind !== "error";
}

/** What the agent is doing right now, in plain words: which file it reads, how much it has written, when it finished or failed. */
export function ActivityPanel({ projectId }: { projectId: string | null }) {
	const [all, setAll] = useState<Activity[]>([]);
	const [open, setOpen] = useState(true);
	useEffect(() => onActivity((a) => setAll((cur) => addActivity(cur, a))), []);
	const list = all.filter((a) => a.project === projectId);
	const running = runningNow(list);
	const engine = list[0]?.engine;

	if (!open) {
		return (
			<aside className="activity closed">
				<button className="link" title="Rādīt, ko dara aģents" onClick={() => setOpen(true)}>«</button>
			</aside>
		);
	}
	return (
		<aside className="activity" aria-label="Aģenta darbība">
			<div className="activity-head">
				{running && <span className="pulse" />}
				<span className="grow">Ko dara aģents</span>
				<button className="link" title="Paslēpt" onClick={() => setOpen(false)}>»</button>
			</div>
			<div className="activity-list">
				{list.length === 0 && <div className="small">Šobrīd nekas nenotiek. Kad app lasīs dokumentus vai rakstīs atbildi, to redzēsi te.</div>}
				{running && engine && <div className="small">Strādā: <b>{engine === "claude" ? "Claude" : engine === "codex" ? "Codex" : "Grok"}</b></div>}
				{list.map((a, i) => (
					<div key={`${a.run}-${a.at}-${i}`} className={`activity-row ${a.kind}`}>
						<span className="t">{new Date(a.at).toLocaleTimeString("lv-LV", { hour: "2-digit", minute: "2-digit" })}</span>
						<span>{ICON[a.kind]}</span>
						<span className="msg">{a.text}</span>
					</div>
				))}
			</div>
		</aside>
	);
}
