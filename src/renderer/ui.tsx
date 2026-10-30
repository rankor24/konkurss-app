import { useState, type ReactNode } from "react";
import { withHint } from "../shared/hints";
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

/** Runs one async action with busy/error state — the pattern every task button uses. */
export function useAction() {
	const [busy, setBusy] = useState<string>("");
	const [error, setError] = useState("");
	const [note, setNote] = useState("");
	const run = async (label: string, fn: () => Promise<{ ok: boolean; error?: string } | void>, after?: () => Promise<void> | void) => {
		setBusy(label);
		setError("");
		setNote("");
		try {
			const r = await fn();
			if (r && r.ok === false) setError(withHint(r.error ?? "Neizdevās."));
			else await after?.();
		} catch (e) {
			setError(withHint(String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "")));
		} finally {
			setBusy("");
		}
	};
	return { busy, error, note, setNote, run };
}

/**
 * A cited value a person can correct. Saving makes it "ievadīts ar roku" (no quote mark);
 * a second-pass conflict is resolved by keeping the first reading or taking the other one.
 */
export function EditableCited({
	c,
	onChange,
	parse,
	format,
	width = 160,
}: {
	c: Cited<string> | Cited<number>;
	onChange: (next: Cited<string> | Cited<number>) => void;
	parse?: (raw: string) => string | number | null;
	format?: (v: string | number) => string;
	width?: number;
}) {
	const [editing, setEditing] = useState(false);
	const [raw, setRaw] = useState("");
	const isNum = typeof c.value === "number" || parse !== undefined;
	const start = () => {
		setRaw(c.value === null ? "" : String(c.value));
		setEditing(true);
	};
	const save = () => {
		const v = raw.trim() === "" ? null : parse ? parse(raw.trim()) : raw.trim();
		onChange(v === null ? { value: null, status: "missing" } : ({ value: v, status: "manual" } as Cited<string> | Cited<number>));
		setEditing(false);
	};
	if (editing) {
		return (
			<span className="row" style={{ gap: 4 }}>
				<input autoFocus value={raw} onChange={(e) => setRaw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} style={{ width }} inputMode={isNum ? "decimal" : undefined} />
				<button onClick={save}>Saglabāt</button>
				<button onClick={() => setEditing(false)}>Atcelt</button>
			</span>
		);
	}
	return (
		<span>
			<CitedValue c={c as Cited<string | number>} format={format as ((v: string | number) => string) | undefined} />{" "}
			<button className="link" onClick={start} title="Ievadīt vai labot pašai">labot</button>
			{c.conflict && (
				<span className="row" style={{ gap: 4, display: "inline-flex", marginLeft: 6 }}>
					<button onClick={() => onChange({ ...c, conflict: undefined } as Cited<string> | Cited<number>)}>Atstāt pirmo</button>
					<button onClick={() => onChange({ value: c.conflict!.value, status: "model", cite: c.conflict!.cite } as Cited<string> | Cited<number>)}>Ņemt otro</button>
				</span>
			)}
		</span>
	);
}
