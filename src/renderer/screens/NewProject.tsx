import { useEffect, useState } from "react";
import type { Variant } from "../../shared/state";
import type { FolderSummary, Project } from "../../shared/types";
import { api, errorText } from "../api";
import { Banner, FolderRules, ScreenHead } from "../ui";

export const VARIANTS: { id: Variant; label: string; hint: string }[] = [
	{ id: "V1", label: "Projektēšana", hint: "BŪVDIZAINS ir pretendents" },
	{ id: "V2", label: "Projektē un būvē", hint: "Pretendents ir būvnieks, mēs projektētāji" },
	{ id: "V3", label: "Tikai BIM daļa", hint: "BIP, matrica, paraugmodeļi citam pretendentam" },
];

function FolderSummaryView({ s }: { s: FolderSummary | null }) {
	if (!s) return null;
	if (!s.exists) return <Banner>Mape vēl neeksistē — app to izveidos, kad saglabās pirmo dokumentu.</Banner>;
	if (s.total === 0) return <Banner>Mape ir tukša. Pārbaudi, vai tā ir īstā kopija (Desktop kopijas mēdz būt tukšas čaulas).</Banner>;
	const parts = Object.entries(s.byExt).sort((a, b) => b[1] - a[1]).map(([ext, n]) => `${n} ${ext}`);
	return <Banner kind="good">Atrasti {s.total} faili: {parts.join(", ")}</Banner>;
}

const parentOf = (p: string) => p.replace(/[\\/][^\\/]+[\\/]?$/, "");
/** The tender folder of a documents folder: a KONKURSS subfolder belongs to its parent. */
export const tenderOf = (p: string) => (/[\\/]konkurss[\\/]?$/i.test(p) ? parentOf(p) : p.replace(/[\\/]+$/, ""));

/** "Jauns konkurss no mapes": izejas dati → output folder → variant → name. */
export interface NewProjectInit {
	sourceDir: string;
	outputDir: string;
	name: string;
	builders: string[];
}

export function NewProject({ onCreated, onCancel, initial }: { onCreated: (p: Project) => void; onCancel: () => void; initial?: NewProjectInit }) {
	const [source, setSource] = useState(initial?.sourceDir ?? "");
	const [sourceSum, setSourceSum] = useState<FolderSummary | null>(null);
	const [output, setOutput] = useState(initial?.outputDir ?? "");
	const [outputSum, setOutputSum] = useState<FolderSummary | null>(null);
	const [variant, setVariant] = useState<Variant | null>(initial?.builders.length ? "V2" : null);
	const [builders, setBuilders] = useState(initial?.builders.join(", ") ?? "");
	const [name, setName] = useState(initial?.name ?? "");
	const [error, setError] = useState("");
	// from the board: show what the pre-filled folders hold, as if they had been picked
	useEffect(() => {
		if (!initial) return;
		void api.folders.summary(initial.sourceDir).then(setSourceSum);
		void api.folders.summary(initial.outputDir).then(setOutputSum);
	}, [initial]);

	const setOut = async (p: string) => {
		setOutput(p);
		setOutputSum(await api.folders.summary(p));
	};
	const pickSource = async () => {
		const p = await api.folders.pick("Izvēlies konkursa dokumentu mapi (izejas dati)");
		if (!p) return;
		setSource(p);
		setSourceSum(await api.folders.summary(p));
		// a work folder on this PC named after the tender — never next to the tender's documents
		if (!output) await setOut((await api.board.defaults(p)).workFolder ?? `${parentOf(p)}\\IESNIEDZAMIE`);
	};
	const pickOutput = async () => {
		const p = await api.folders.pick("Darba mape šajā datorā");
		if (p) await setOut(p);
	};
	const create = async () => {
		setError("");
		try {
			const p = await api.projects.add({
				name,
				sourceDir: source,
				outputDir: output,
				variant,
				builders: variant === "V2" || variant === "V3" ? builders.split(",") : [],
			});
			onCreated(p);
		} catch (e) {
			setError(errorText(e));
		}
	};

	return (
		<div className="screen">
			<ScreenHead title="Jauns konkurss no mapes" what="Izvēlies mapi, kur ir konkursa dokumenti, un darba mapi, kur app liks visu, ko sagatavo." why="Konkursa mapi app tikai lasa. Viss jaunais ir darba mapē šajā datorā; gatavo paku uz konkursa mapes IESNIEDZAMIE pārvieto pats, kad viss ir pabeigts." />
			<div className="card">
				<h2>Kur būs faili</h2>
				<FolderRules tender={source ? tenderOf(source) : undefined} work={output || undefined} target={source ? `${tenderOf(source)}\\IESNIEDZAMIE` : undefined} />
			</div>
			<div className="card">
				<h2>1. Konkursa dokumenti (tikai lasīšanai)</h2>
				<p className="hint">Mape ar nolikumu, pielikumiem, grozījumiem un komisijas atbildēm (parasti KONKURSS). App šajā mapē neko neraksta, nemaina un nedzēš.</p>
				<div className="row">
					<code className="pathbox grow">{source || "nav izvēlēta"}</code>
					<button onClick={pickSource}>Izvēlēties mapi</button>
				</div>
				<FolderSummaryView s={sourceSum} />
			</div>
			<div className="card">
				<h2>2. Darba mape (šajā datorā)</h2>
				<p className="hint">Šeit būs melnraksti (Iesniedzamie), pierādījumu kopijas (Pierādījumi) un gatavā, sanumurētā paka (Paka). Konkursu mapē (B:) darba mapi likt nevar.</p>
				<div className="row">
					<code className="pathbox grow">{output || "nav izvēlēta"}</code>
					<button onClick={pickOutput}>Izvēlēties mapi</button>
				</div>
				<FolderSummaryView s={outputSum} />
			</div>
			<div className="card">
				<h2>3. Konkursa veids</h2>
				<div className="cards">
					{VARIANTS.map((v) => (
						<button key={v.id} className={`opt ${variant === v.id ? "selected" : ""}`} onClick={() => setVariant(variant === v.id ? null : v.id)}>
							<strong>{v.label}</strong>
							<span className="hint">{v.hint}</span>
						</button>
					))}
				</div>
				<p className="hint">Nezini? Atstāj tukšu — pēc dokumentu nolasīšanas app to nolasīs no tehniskās specifikācijas ar citātu.</p>
				{(variant === "V2" || variant === "V3") && (
					<label className="field">
						Būvnieki (ar komatu), kuriem gatavojam
						<input value={builders} onChange={(e) => setBuilders(e.target.value)} placeholder="piem. Būvnieks A, Būvnieks B" />
					</label>
				)}
			</div>
			<div className="card">
				<h2>4. Nosaukums</h2>
				<input value={name} onChange={(e) => setName(e.target.value)} placeholder="ja tukšs — mapes nosaukums" />
			</div>
			{error && <Banner kind="critical">{error}</Banner>}
			<div className="row">
				<button className="primary" disabled={!source || !output} onClick={create}>Izveidot</button>
				<button onClick={onCancel}>Atcelt</button>
			</div>
		</div>
	);
}
