import { useState, type ReactNode } from "react";
import { STEP_ICON, type Cited, type StepStatus } from "../shared/state";

/** Every screen opens with two lines: what happens here, and why it matters. */
export function ScreenHead({ title, what, why }: { title: string; what: string; why?: string }) {
	return (
		<div className="screen-head">
			<h1>{title}</h1>
			<div className="intro">
				<p>{what}</p>
				{why && <p>{why}</p>}
			</div>
		</div>
	);
}

const STATE_TEXT: Record<StepStatus, string> = {
	nav: "nav sākts",
	proc: "procesā",
	gatavs: "gatavs",
	problema: "ir problēmas",
	neattiecas: "neattiecas",
};

/** State = shape + colour + text (the text is the accessible label). */
export function StateIcon({ status }: { status: StepStatus }) {
	return (
		<span className={`st st-${status}`} role="img" aria-label={STATE_TEXT[status]} title={STATE_TEXT[status]}>
			{STEP_ICON[status]}
		</span>
	);
}

export function Banner({ kind = "warn", children }: { kind?: "warn" | "critical" | "good"; children: ReactNode }) {
	const icon = kind === "good" ? "✓" : "⚠";
	return (
		<div className={`banner ${kind === "warn" ? "" : kind}`}>
			<span className="ic">{icon}</span>
			<div className="grow">{children}</div>
		</div>
	);
}

/**
 * A model-read value. The quote mark (“) means "the app read this in the document";
 * clicking it shows the exact sentence. A person-typed value gets no mark.
 */
export function CitedValue<T>({ c, format }: { c: Cited<T>; format?: (v: T) => string }) {
	const [open, setOpen] = useState(false);
	if (c.value === null || c.value === undefined) {
		return <span className="missing" title={c.note}>nav atrasts — jāaizpilda pašai</span>;
	}
	const text = format ? format(c.value) : String(c.value);
	return (
		<span>
			<span>{text}</span>
			{c.status === "model" && c.cite && (
				<button className="cite" onClick={() => setOpen(!open)} title="Parādīt teikumu, no kura nolasīts" aria-expanded={open}>
					“
				</button>
			)}
			{c.status === "manual" && <span className="manual">ievadīts ar roku</span>}
			{c.conflict && (
				<span className="chip critical" title="Otrā nolasīšana deva citu vērtību" style={{ marginLeft: 6 }}>
					otra nolasīšana: {String(c.conflict.value ?? "nav atrasts")}
				</span>
			)}
			{open && c.cite && (
				<div className="quote-pop">
					<div className="hint">{c.cite.file}</div>“{c.cite.quote}”
				</div>
			)}
		</span>
	);
}

export const HIDDEN_JARGON = ["JSON", "IPC", "regex", "profils", "validācija", "ekstrakcija", "hash"];
