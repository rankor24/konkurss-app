import { useEffect, useState, type ReactNode } from "react";
import { withHint } from "../shared/hints";
import { STEP_ICON, type Cited, type StepStatus } from "../shared/state";
import { THEMES, themeAttr, themeOf, type Theme } from "../shared/theme";
import { api } from "./api";

// One switch for the whole app, shared by every page that shows it.
let agentOn = true;
let agentLoaded = false;
const agentSubs = new Set<(on: boolean) => void>();
const setAgent = (on: boolean) => {
	agentOn = on;
	agentSubs.forEach((f) => f(on));
};

/** Whether the agent (the model) may read and write; the same value on every page. */
export function useAgentOn(): [boolean, (on: boolean) => void] {
	const [on, setOn] = useState(agentOn);
	useEffect(() => {
		agentSubs.add(setOn);
		if (!agentLoaded) {
			agentLoaded = true;
			api.settings.get().then((s) => setAgent(s.agentOn !== false)).catch(() => (agentLoaded = false));
		} else setOn(agentOn);
		return () => void agentSubs.delete(setOn);
	}, []);
	return [on, (next) => {
		setAgent(next);
		api.settings.save({ agentOn: next }).catch(() => setAgent(!next));
	}];
}

export function AgentSwitch() {
	const [on, set] = useAgentOn();
	return (
		<label className={`agent-switch ${on ? "on" : "off"}`} title={on ? "Aģents lasa dokumentus un raksta tekstus. Izslēdz, ja gribi tikai reģistrus un ierakstus ar roku." : "Aģents ir izslēgts: app neko nelasa un neraksta ar modeli."}>
			<input type="checkbox" role="switch" checked={on} onChange={(e) => set(e.target.checked)} />
			<span className="track" aria-hidden="true"><span className="knob" /></span>
			<span>Aģents: {on ? "ieslēgts" : "izslēgts"}</span>
		</label>
	);
}

// The colour theme is kept like the agent switch: one value, shared, saved in Settings. A copy in localStorage lets the next start paint the right colours before Settings arrive.
const THEME_KEY = "theme";
const readCachedTheme = (): Theme => {
	try {
		return themeOf(localStorage.getItem(THEME_KEY));
	} catch {
		return "auto";
	}
};
let theme: Theme = readCachedTheme();
let themeLoaded = false;
const themeSubs = new Set<(t: Theme) => void>();
const paint = (t: Theme) => {
	const attr = themeAttr(t);
	if (attr) document.documentElement.dataset.theme = attr;
	else delete document.documentElement.dataset.theme;
};
const setThemeValue = (t: Theme) => {
	theme = t;
	paint(t);
	try {
		localStorage.setItem(THEME_KEY, t);
	} catch {
		/* private mode: Settings still keep it */
	}
	themeSubs.forEach((f) => f(t));
};
if (typeof document !== "undefined") paint(theme);

export function useTheme(): [Theme, (t: Theme) => void] {
	const [t, setT] = useState(theme);
	useEffect(() => {
		themeSubs.add(setT);
		if (!themeLoaded) {
			themeLoaded = true;
			api.settings.get().then((s) => setThemeValue(themeOf(s.theme))).catch(() => (themeLoaded = false));
		} else setT(theme);
		return () => void themeSubs.delete(setT);
	}, []);
	return [t, (next) => {
		const before = theme;
		setThemeValue(next);
		api.settings.save({ theme: next }).catch(() => setThemeValue(before));
	}];
}

/** Auto / Gaišs / Tumšs, in the top bar. */
export function ThemeSwitch() {
	const [current, set] = useTheme();
	return (
		<div className="seg" role="group" aria-label="Krāsu tēma">
			{THEMES.map((o) => (
				<button key={o.id} className={current === o.id ? "on" : ""} aria-pressed={current === o.id} title={o.title} onClick={() => set(o.id)}>
					{o.label}
				</button>
			))}
		</div>
	);
}

/** Every screen opens with two lines: what happens here, and why it matters. `agent` adds the switch on screens where the agent works. */
export function ScreenHead({ title, what, why, agent }: { title: string; what: string; why?: string; agent?: boolean }) {
	return (
		<div className="screen-head">
			<div className="head-row">
				<h1>{title}</h1>
				{agent && <AgentSwitch />}
			</div>
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

/** The three places, said the same way everywhere they are explained. */
export const FOLDER_WHY =
	"Konkursa mape ir biroja oficiālā kopija: tie paši faili, ko saņēmām no pasūtītāja, un tā, ko iesniedzam. Ja app tur rakstītu, nepabeigts melnraksts vai kļūda varētu sajaukties ar iesniedzamo vai pārrakstīt oriģinālu. Tāpēc app tur tikai lasa, bet gatavo paku pārvieto cilvēks — tad, kad ir pārliecināts, ka viss ir pareizi.";

/**
 * How files move: the tender folder is only read; everything the app makes is in the person's own work folder;
 * the person moves the finished pack into the tender folder's IESNIEDZAMIE. Paths are shown when known.
 */
export function FolderRules({ tender, work, target, compact = false }: { tender?: string; work?: string; target?: string; compact?: boolean }) {
	const box = (title: string, who: string, path: string | undefined, kind: "read" | "write" | "move") => (
		<div className={`folder-box ${kind}`}>
			<div className="folder-title">{title}</div>
			<div className="hint">{who}</div>
			{path && <div className="mono small folder-path" title={path}>{path}</div>}
		</div>
	);
	return (
		<div className="folder-rules" aria-label="Kur atrodas faili">
			<div className="folder-flow">
				{box("🔒 Konkursa mape", "app tikai lasa — nekad nemaina, nepievieno, nedzēš", tender ?? "B:\\01_Konkursi\\<konkurss>", "read")}
				<span className="folder-arrow" aria-hidden="true">→</span>
				{box("✎ Darba mape", "šeit app raksta visu, ko sagatavo — tikai tavā datorā", work ?? "Mani dokumenti\\Konkursi\\<konkurss>", "write")}
				<span className="folder-arrow" aria-hidden="true">→</span>
				{box("✋ Tu pārvieto", "kad paka gatava un parakstīta — mapes Paka saturu", target ?? "<konkursa mape>\\IESNIEDZAMIE", "move")}
			</div>
			{!compact && (
				<p className="hint" style={{ margin: 0 }}>
					<strong>Kāpēc konkursa mapi tikai lasa?</strong> {FOLDER_WHY}
				</p>
			)}
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
