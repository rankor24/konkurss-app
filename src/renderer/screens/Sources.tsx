import { useState } from "react";
import { MAX_SOURCE_FILES, SOURCE_USE, type ExtraSource, type SourcePage } from "../../shared/sources";
import type { Project } from "../../shared/types";
import { api, type StateBundle } from "../api";
import { Banner, useAction, useAgentOn } from "../ui";

/** How well a source was read, in words: files that gave no text are named, so nobody thinks the agent saw them. */
export function sourceStatus(src: ExtraSource): { read: number; readable: number; problems: string[] } {
	const readable = src.files.filter((f) => f.text !== "neattiecas");
	const problems = readable.filter((f) => f.text !== "ok").map((f) => `${f.rel}: ${f.textNote ?? "nav nolasīts"}`);
	return { read: readable.length - problems.length, readable: readable.length, problems };
}

function SourceRow({ src, busy, onOpen, onRefresh, onRemove, onNote }: { src: ExtraSource; busy: boolean; onOpen: () => void; onRefresh: () => void; onRemove: () => void; onNote: (note: string) => void }) {
	const st = sourceStatus(src);
	return (
		<div className="src-row">
			<div className="row">
				<span className="chip">{src.kind === "folder" ? "Mape" : "Fails"}</span>
				<span className="mono small grow src-path" title={src.path}>{src.path}</span>
				<span className="hint">nolasīti {st.read} no {st.readable}</span>
				<button disabled={busy} onClick={onOpen}>Atvērt</button>
				<button disabled={busy} onClick={onRefresh} title="Ja fails mainīts vai mapē pievienoti jauni faili">Nolasīt vēlreiz</button>
				<button disabled={busy} onClick={onRemove} title="Noņem tikai no saraksta; pats fails netiek aiztikts">Noņemt</button>
			</div>
			<input
				className="src-note"
				aria-label={`Piezīme aģentam: ${src.path}`}
				placeholder="Piezīme aģentam: kas tas ir un kam to izmantot…"
				defaultValue={src.note}
				onBlur={(e) => e.target.value.trim() !== src.note && onNote(e.target.value)}
			/>
			{src.truncated && <div className="hint">Mapē ir vairāk nolasāmu failu — nolasīti pirmie {MAX_SOURCE_FILES}. Norādi šaurāku mapi.</div>}
			{st.problems.length > 0 && <div className="hint" style={{ color: "var(--warning)" }}>Neizdevās nolasīt: {st.problems.slice(0, 3).join("; ")}{st.problems.length > 3 ? ` (un vēl ${st.problems.length - 3})` : ""}</div>}
			{src.kind === "folder" && (
				<details className="small">
					<summary className="hint">Faili ({src.files.length})</summary>
					<ul className="src-files">
						{src.files.map((f) => <li key={f.abs}><span className="mono">{f.rel}</span> <span className="hint">{f.text === "ok" ? "✓" : f.text === "neattiecas" ? "—" : "⚠"}</span></li>)}
					</ul>
				</details>
			)}
		</div>
	);
}

/** Files and folders a person adds for the agent of this page. Each page has its own list; the agent reads them next to the tender documents. */
export function ExtraSources({ project, bundle, reload, page }: { project: Project; bundle: StateBundle; reload: () => Promise<void>; page: SourcePage }) {
	const list = bundle.state.sources?.[page] ?? [];
	const [agentOn] = useAgentOn();
	const [note, setNote] = useState("");
	const act = useAction();

	const add = (kind: "file" | "folder") =>
		act.run("add", async () => {
			const paths = await api.sources.pick(kind);
			if (!paths) return;
			try {
				for (const path of paths) {
					const r = await api.sources.add(project.id, page, path, note);
					if (!r.ok) return r;
				}
				setNote("");
			} finally {
				await reload();
			}
		});
	const each = (label: string, fn: () => Promise<unknown>) => act.run(label, async () => void (await fn()), reload);

	return (
		<details className="card sources" open={list.length > 0}>
			<summary className="src-sum"><strong>Papildu avoti</strong> <span className="hint">{list.length ? `${list.length} pievienoti` : "nav pievienotu"} · norādi failu vai mapi, kur aģentam vēl meklēt</span></summary>
			<p className="small muted">{SOURCE_USE[page]} Aģents tos izmanto kā palīgmateriālu: ja tie runā pretī konkursa dokumentiem, uzvar konkursa dokumenti, un katrs ieraksts rāda, no kura faila tas nāk.</p>
			{!agentOn && list.length > 0 && <Banner>Aģents ir izslēgts — šie faili netiks lasīti, kamēr to neieslēgsi.</Banner>}
			{act.error && <Banner kind="critical">{act.error}</Banner>}
			{list.map((s) => (
				<SourceRow
					key={s.id}
					src={s}
					busy={!!act.busy}
					onOpen={() => each("open", () => api.sources.open(project.id, page, s.id))}
					onRefresh={() => each("refresh", async () => {
						const r = await api.sources.refresh(project.id, page, s.id);
						if (!r.ok) throw new Error(r.error);
					})}
					onRemove={() => each("remove", () => api.sources.remove(project.id, page, s.id))}
					onNote={(n) => each("note", () => api.sources.note(project.id, page, s.id, n))}
				/>
			))}
			<div className="row">
				<input style={{ flex: 1, minWidth: 200 }} aria-label="Piezīme jaunajam avotam" placeholder="Piezīme jaunajam avotam (nav obligāta): piem. „mūsu iepriekšējais BIP, ņemt pretendenta formulējumus”" value={note} onChange={(e) => setNote(e.target.value)} />
				<button disabled={!!act.busy} onClick={() => add("file")}>Pievienot failus…</button>
				<button disabled={!!act.busy} onClick={() => add("folder")}>Pievienot mapi…</button>
				{act.busy === "add" && <span className="small muted">Nolasu tekstu…</span>}
			</div>
		</details>
	);
}
