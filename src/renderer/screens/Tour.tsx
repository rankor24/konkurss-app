// The tutorial overlay: one card per step of the whole process, the process map on top, a ring around the real
// button the step talks about. Skippable at any point (Esc or „Izlaist”); replayable from Iestatījumi.
import { useEffect, useRef, useState } from "react";
import { firstOfStage, TOUR, TOUR_MAP, type TourStep } from "../tour/steps";

type Rect = { top: number; left: number; width: number; height: number };
const CARD_W = 460;
const GAP = 14;

/** Where the element named by `anchor` is, once it has rendered (the step may have just opened another screen). */
function useAnchorRect(anchor: string | undefined, key: number): Rect | null {
	const [rect, setRect] = useState<Rect | null>(null);
	useEffect(() => {
		setRect(null);
		if (!anchor || typeof document === "undefined") return;
		let frames = 0;
		let raf = 0;
		const find = () => {
			const el = document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`);
			if (el) {
				el.scrollIntoView({ block: "nearest", inline: "nearest" });
				const r = el.getBoundingClientRect();
				setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
			} else if (frames++ < 60) raf = requestAnimationFrame(find);
		};
		raf = requestAnimationFrame(find);
		const onResize = () => {
			frames = 0;
			find();
		};
		window.addEventListener("resize", onResize);
		return () => (cancelAnimationFrame(raf), window.removeEventListener("resize", onResize));
	}, [anchor, key]);
	return rect;
}

/** Beside the element when there is room, else below it; always inside the window. */
export function cardPosition(rect: Rect | null, view: { w: number; h: number }, cardH = 320): { top: number; left: number } {
	if (!rect) return { top: Math.max(GAP, (view.h - cardH) / 2), left: Math.max(GAP, (view.w - CARD_W) / 2) };
	const clampTop = (t: number) => Math.min(Math.max(GAP, t), Math.max(GAP, view.h - cardH - GAP));
	const clampLeft = (l: number) => Math.min(Math.max(GAP, l), Math.max(GAP, view.w - CARD_W - GAP));
	if (rect.left + rect.width + GAP + CARD_W <= view.w) return { top: clampTop(rect.top - 20), left: rect.left + rect.width + GAP };
	return { top: clampTop(rect.top + rect.height + GAP), left: clampLeft(rect.left) };
}

export interface TourProps {
	index: number;
	onIndex: (i: number) => void;
	/** "skip" = closed before the end; "done" = finished */
	onClose: (how: "skip" | "done") => void;
	/** the person has at least one tender, so project steps open a real one */
	hasProject: boolean;
	onFinish: (where: "board" | "new") => void;
}

export function Tour({ index, onIndex, onClose, hasProject, onFinish }: TourProps) {
	const step: TourStep = TOUR[index] ?? TOUR[0];
	const last = index === TOUR.length - 1;
	const rect = useAnchorRect(step.anchor, index);
	const card = useRef<HTMLDivElement>(null);
	const [view, setView] = useState({ w: 1280, h: 800 });
	useEffect(() => {
		const size = () => setView({ w: window.innerWidth, h: window.innerHeight });
		size();
		window.addEventListener("resize", size);
		return () => window.removeEventListener("resize", size);
	}, []);
	useEffect(() => card.current?.focus(), [index]);
	useEffect(() => {
		const key = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose("skip");
			else if ((e.key === "ArrowRight" || e.key === "Enter") && !last) onIndex(index + 1);
			else if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
		};
		window.addEventListener("keydown", key);
		return () => window.removeEventListener("keydown", key);
	}, [index, last, onClose, onIndex]);

	const pos = cardPosition(rect, view);
	const projectStep = step.go?.kind === "project";
	return (
		<div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
			{rect ? <div className="tour-ring" style={{ top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8 }} /> : <div className="tour-backdrop" />}
			<div className="tour-card" ref={card} tabIndex={-1} style={{ top: pos.top, left: pos.left, width: CARD_W }}>
				<nav className="tour-map" aria-label="Process karte">
					{TOUR_MAP.map((g) => (
						<div key={g.group} className="tour-group">
							<span className="tour-group-label">{g.group}</span>
							<span className="tour-stages">
								{g.stages.map((s) => (
									<button key={s.id} className={`tour-stage ${s.id === step.stage ? "current" : ""} ${firstOfStage(s.id) < index && s.id !== step.stage ? "past" : ""}`} onClick={() => onIndex(firstOfStage(s.id))} aria-current={s.id === step.stage ? "step" : undefined}>
										{s.label}
									</button>
								))}
							</span>
						</div>
					))}
				</nav>
				<h2 id="tour-title">{step.title}</h2>
				<div className="tour-cols">
					<div><div className="tour-label">Ko dari tu</div><p>{step.you}</p></div>
					<div><div className="tour-label">Ko dara app</div><p>{step.app}</p></div>
				</div>
				{step.note && <div className="tour-note">{step.note}</div>}
				{projectStep && !hasProject && <div className="hint">Šis solis ir konkursa iekšienē. Kad pievienosi pirmo konkursu, tas būs kreisajā joslā.</div>}
				<div className="row tour-actions">
					<span className="hint">{index + 1} / {TOUR.length}</span>
					<span className="grow" />
					{!last && <button onClick={() => onClose("skip")}>Izlaist</button>}
					{index > 0 && <button onClick={() => onIndex(index - 1)}>Atpakaļ</button>}
					{!last && <button className="primary" onClick={() => onIndex(index + 1)}>Tālāk</button>}
					{last && (
						<>
							<button onClick={() => onClose("done")}>Aizvērt</button>
							<button onClick={() => (onClose("done"), onFinish("new"))}>+ Jauns konkurss</button>
							<button className="primary" onClick={() => (onClose("done"), onFinish("board"))}>Atvērt tāfeli</button>
						</>
					)}
				</div>
			</div>
		</div>
	);
}
