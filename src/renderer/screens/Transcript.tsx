import { useEffect, useRef, useState, type ReactNode } from "react";
import { thinkingLine } from "../../shared/activity";
import type { ToolKind } from "../../shared/types";
import { prettyInput, type Block } from "../transcript";

const ICON: Record<ToolKind, string> = { read: "▤", search: "⌕", edit: "✎", shell: ">_", web: "◎", plan: "☰", other: "·" };

/** A details element the person can open and close, which opens itself while its content is being written until they touch it. */
function Fold({ auto, className, head, children }: { auto: boolean; className: string; head: ReactNode; children: ReactNode }) {
	const [open, setOpen] = useState(auto);
	const touched = useRef(false);
	useEffect(() => {
		if (!touched.current) setOpen(auto);
	}, [auto]);
	return (
		<details
			className={className}
			open={open}
			onToggle={(e) => {
				const now = e.currentTarget.open;
				if (now !== open) {
					touched.current = true;
					setOpen(now);
				}
			}}
		>
			<summary>{head}</summary>
			{children}
		</details>
	);
}

/** **bold** and `code` inside a line. */
function inline(text: string): ReactNode[] {
	return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, i) => {
		if (p.startsWith("**") && p.endsWith("**") && p.length > 4) return <b key={i}>{p.slice(2, -2)}</b>;
		if (p.startsWith("`") && p.endsWith("`") && p.length > 2) return <code key={i}>{p.slice(1, -1)}</code>;
		return p;
	});
}

/** The model's answer as paragraphs, lists and headings. It is text the model wrote, so nothing in it is ever run or inserted as markup. */
export function Prose({ text }: { text: string }) {
	const out: ReactNode[] = [];
	let list: string[] = [];
	let ordered = false;
	const flush = () => {
		if (!list.length) return;
		const items = list.map((x, i) => <li key={i}>{inline(x)}</li>);
		out.push(ordered ? <ol key={out.length}>{items}</ol> : <ul key={out.length}>{items}</ul>);
		list = [];
	};
	for (const raw of text.split("\n")) {
		const line = raw.trimEnd();
		const item = /^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$/.exec(line);
		if (item) {
			const isOrdered = !!item[1];
			if (list.length && isOrdered !== ordered) flush();
			ordered = isOrdered;
			list.push(item[2]);
			continue;
		}
		flush();
		if (!line.trim()) continue;
		const h = /^#{1,4}\s+(.*)$/.exec(line);
		out.push(h ? <h3 key={out.length}>{inline(h[1])}</h3> : <p key={out.length}>{inline(line)}</p>);
	}
	flush();
	return <>{out}</>;
}

function ToolCard({ b, active }: { b: Extract<Block, { k: "tool" }>; active: boolean }) {
	// a call that never got its result because the run ended or was stopped is not "running"
	const state = b.status === "running" && !active ? "stopped" : b.status;
	const input = prettyInput(b.input);
	const body = !!input || !!b.output || !!b.error;
	const head = (
		<>
			<span className="tx-ic" aria-hidden>{ICON[b.tool]}</span>
			<span className="tx-words">{b.words}</span>
			{b.target && <span className="tx-target">{b.target}</span>}
			<span className="tx-state">
				{state === "running" && <span className="spin" aria-label="darbojas" />}
				{state === "ok" && <span className="ok" aria-label="izdevās">✓</span>}
				{state === "failed" && <span className="bad" aria-label="neizdevās">✗</span>}
				{state === "stopped" && <span className="muted" aria-label="pārtraukts">—</span>}
			</span>
		</>
	);
	if (!body) return <div className={`tx tx-tool k-${b.tool} ${state}`}><div className="tx-sum static">{head}</div></div>;
	return (
		<Fold auto={false} className={`tx tx-tool k-${b.tool} ${state}`} head={head}>
			<div className="tx-body">
				{input && <><div className="tx-label">Ievade</div><pre className="tx-pre">{input}</pre></>}
				{b.error && <><div className="tx-label bad">Kļūda</div><pre className="tx-pre">{b.error}</pre></>}
				{b.output && <><div className="tx-label">Rezultāts</div><pre className="tx-pre">{b.output}</pre></>}
			</div>
		</Fold>
	);
}

/** The agent's work in the order it happened: reasoning you can open, tool calls you can open, and the answer. */
export function Transcript({ blocks, active, engine }: { blocks: Block[]; active: boolean; engine: string }) {
	const lastAt = blocks.length - 1;
	const tail = blocks[lastAt];
	// between two steps (asked but nothing back yet, or a tool finished and the next has not begun) show that the agent is still working
	const quiet = active && (!tail || tail.k === "user" || (tail.k === "tool" && tail.status !== "running"));
	return (
		<>
			{blocks.map((b, i) => {
				const isLast = i === lastAt;
				switch (b.k) {
					case "user":
						return <div key={i} className="tx tx-user">{b.text}</div>;
					case "thinking": {
						const writing = active && isLast;
						return (
							<Fold key={i} auto={writing} className={`tx tx-think ${writing ? "writing" : ""}`} head={<><span className="tx-ic" aria-hidden>◌</span><span className="tx-words">{writing ? "Domā" : "Domāja"}</span><span className="tx-target">{thinkingLine(b.text)}</span></>}>
								<div className="tx-body"><div className="tx-thought">{b.text}</div></div>
							</Fold>
						);
					}
					case "tool":
						return <ToolCard key={i} b={b} active={active} />;
					case "answer":
						return (
							<div key={i} className={`tx tx-answer ${active && isLast ? "writing" : ""}`}>
								<div className="tx-who">{engine}</div>
								<Prose text={b.text} />
							</div>
						);
					case "error":
						return <div key={i} className="tx tx-error"><span className="tx-ic" aria-hidden>✗</span><span>{b.text}</span></div>;
					case "done":
						return <div key={i} className="tx tx-done"><span>✓ Pabeigts</span></div>;
				}
			})}
			{quiet && <div className="tx tx-wait" role="status"><span className="dots"><i /><i /><i /></span>Aģents strādā</div>}
		</>
	);
}
