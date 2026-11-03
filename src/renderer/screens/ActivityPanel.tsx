import { useEffect, useRef, useState } from "react";
import { KIND_LABEL, type Activity } from "../../shared/activity";
import type { EngineId, ToolKind } from "../../shared/types";
import { onActivity } from "../api";

const MAX = 600;
const ENGINE: Record<EngineId, string> = { claude: "Claude", codex: "Codex", grok: "Grok", pi: "pi" };
const KIND_ICON: Record<ToolKind | "thinking", string> = { read: "▤", search: "⌕", edit: "✎", shell: ">_", web: "◎", plan: "☰", other: "·", thinking: "◌" };

/** Lines in the order they happened, oldest first. A line with a step replaces the earlier line of that step (a tool call that finished, a block of thinking that grew). */
export function addActivity(list: Activity[], a: Activity): Activity[] {
	const at = a.step ? list.findIndex((x) => x.run === a.run && x.step === a.step) : -1;
	let next: Activity[];
	if (at >= 0) next = list.map((x, i) => (i === at ? a : x));
	else {
		const prev = list[list.length - 1];
		// older callers send the growing answer without a step: it replaces the answer line before it
		next = !a.step && a.kind === "answer" && prev && prev.run === a.run && prev.kind === "answer" && !prev.step ? [...list.slice(0, -1), a] : [...list, a];
	}
	return next.length > MAX ? next.slice(-MAX) : next;
}

/** A run is "running" until its latest line is done or an error. */
export function runningNow(list: Activity[]): boolean {
	const latest = list[list.length - 1];
	return !!latest && latest.kind !== "done" && latest.kind !== "error";
}

/** The lines of each run, runs in the order they started. */
export function groupRuns(list: Activity[]): { run: string; lines: Activity[] }[] {
	const out: { run: string; lines: Activity[] }[] = [];
	for (const a of list) {
		const g = out.find((x) => x.run === a.run);
		if (g) g.lines.push(a);
		else out.push({ run: a.run, lines: [a] });
	}
	return out;
}

const clock = (at: string) => new Date(at).toLocaleTimeString("lv-LV", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function Step({ a, latest }: { a: Activity; latest: boolean }) {
	if (a.kind === "turn") return <div className="act-turn"><span>{a.text}</span></div>;
	if (a.kind === "done") return <div className="act-line done"><span className="ic">✓</span><span>{a.text}</span><span className="t">{clock(a.at)}</span></div>;
	if (a.kind === "error") return <div className="act-line error"><span className="ic">✗</span><span className="msg">{a.text}</span><span className="t">{clock(a.at)}</span></div>;
	if (a.kind === "start") return null;

	const kind: ToolKind | "thinking" = a.kind === "thinking" ? "thinking" : a.kind === "answer" ? "other" : (a.tool ?? "other");
	const label = a.kind === "answer" ? "Atbilde" : KIND_LABEL[kind];
	const state = a.status === "running" ? "running" : a.status === "failed" ? "failed" : "";
	// the newest block of thinking or answer stays open while it is being written
	const open = latest && (a.kind === "thinking" || a.kind === "answer");
	const head = (
		<>
			<span className="ic">{a.kind === "answer" ? "✎" : KIND_ICON[kind]}</span>
			<span className="kind">{label}</span>
			<span className="msg">{a.kind === "answer" ? a.text.replace(/^Atbilde — /, "") : a.text}</span>
			{a.status === "running" && <span className="spin" aria-label="darbojas" />}
			{a.status === "ok" && <span className="ok" aria-label="izdevās">✓</span>}
			{a.status === "failed" && <span className="bad" aria-label="neizdevās">✗</span>}
			<span className="t">{clock(a.at)}</span>
		</>
	);
	if (!a.detail) return <div className={`act-step ${a.kind} ${state}`}><div className="act-sum static">{head}</div></div>;
	return (
		<details className={`act-step ${a.kind} ${state}`} open={open}>
			<summary className="act-sum">{head}</summary>
			<pre className="act-pre">{a.detail}</pre>
		</details>
	);
}

/** One agent run: the task, then every turn with what the agent thought, which files it read, what it searched for and wrote, and how it ended. */
export function Run({ lines, latest }: { lines: Activity[]; latest: boolean }) {
	const start = lines.find((l) => l.kind === "start");
	const end = lines[lines.length - 1];
	const running = end.kind !== "done" && end.kind !== "error";
	const steps = lines.filter((l) => l.kind === "tool").length;
	const mark = running ? <span className="pulse" /> : end.kind === "done" ? <span className="ok">✓</span> : <span className="bad">✗</span>;
	// the steps of a run scroll on their own; the one being written follows its newest step unless the person scrolled up
	const box = useRef<HTMLDivElement>(null);
	const follow = useRef(true);
	useEffect(() => {
		const el = box.current;
		if (el && running && follow.current) el.scrollTo({ top: el.scrollHeight });
	}, [lines.length, end.detail?.length, running]);
	return (
		<details className="act-run" open={latest}>
			<summary>
				{mark}
				<span className="title">{start?.text ?? "Uzdevums"}</span>
				<span className="hint">{ENGINE[lines[0].engine]} · {clock(lines[0].at)}{steps ? ` · ${steps} soļi` : ""}</span>
			</summary>
			{start?.detail && (
				<details className="act-task">
					<summary>Uzdevums aģentam</summary>
					<pre className="act-pre">{start.detail}</pre>
				</details>
			)}
			<div
				className="act-steps"
				ref={box}
				onScroll={(e) => {
					const el = e.currentTarget;
					follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
				}}
			>
				{lines.map((l, i) => <Step key={`${l.step ?? l.kind}-${i}`} a={l} latest={running && i === lines.length - 1} />)}
				{running && lines.length === 1 && <div className="act-wait">Aģents domā un lasa dokumentus…</div>}
			</div>
		</details>
	);
}

/** The agent's work as a transcript, oldest at the top, following the newest line unless the person has scrolled up. */
export function ActivityPanel({ projectId }: { projectId: string | null }) {
	const [all, setAll] = useState<Activity[]>([]);
	const [open, setOpen] = useState(true);
	const [wide, setWide] = useState(false);
	const box = useRef<HTMLDivElement>(null);
	const follow = useRef(true);
	useEffect(() => onActivity((a) => setAll((cur) => addActivity(cur, a))), []);
	const list = all.filter((a) => a.project === projectId);
	const running = runningNow(list);
	const runs = groupRuns(list);
	useEffect(() => {
		const el = box.current;
		if (el && follow.current) el.scrollTo({ top: el.scrollHeight });
	}, [list.length, list[list.length - 1]?.detail?.length]);

	if (!open) {
		return (
			<aside className="activity closed">
				<button className="link" title="Rādīt, ko dara aģents" onClick={() => setOpen(true)}>«</button>
			</aside>
		);
	}
	return (
		<aside className={`activity ${wide ? "wide" : ""}`} aria-label="Aģenta darbība">
			<div className="activity-head">
				{running && <span className="pulse" />}
				<span className="grow">Ko dara aģents</span>
				<button className="link" title={wide ? "Šaurāks" : "Platāks"} onClick={() => setWide(!wide)}>{wide ? "⇥" : "⇤"}</button>
				<button className="link" title="Paslēpt" onClick={() => setOpen(false)}>»</button>
			</div>
			<div
				className="activity-list"
				ref={box}
				onScroll={(e) => {
					const el = e.currentTarget;
					follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
				}}
			>
				{list.length === 0 && <div className="small">Šobrīd nekas nenotiek. Kad app lasīs dokumentus vai rakstīs atbildi, to redzēsi te.</div>}
				{runs.map((r, i) => <Run key={r.run} lines={r.lines} latest={i === runs.length - 1} />)}
			</div>
		</aside>
	);
}
