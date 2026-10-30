import { useState } from "react";
import type { Variant } from "../../shared/state";
import type { FolderSummary, Project } from "../../shared/types";
import { api, errorText } from "../api";
import { Banner, ScreenHead } from "../ui";

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

/** "Jauns konkurss no mapes": izejas dati → output folder → variant → name. */
export function NewProject({ onCreated, onCancel }: { onCreated: (p: Project) => void; onCancel: () => void }) {
	const [source, setSource] = useState("");
	const [sourceSum, setSourceSum] = useState<FolderSummary | null>(null);
	const [output, setOutput] = useState("");
	const [outputSum, setOutputSum] = useState<FolderSummary | null>(null);
	const [variant, setVariant] = useState<Variant | null>(null);
	const [builders, setBuilders] = useState("");
	const [name, setName] = useState("");
	const [error, setError] = useState("");

	const setOut = async (p: string) => {
		setOutput(p);
		setOutputSum(await api.folders.summary(p));
	};
	const pickSource = async () => {
		const p = await api.folders.pick("Izvēlies konkursa dokumentu mapi (izejas dati)");
		if (!p) return;
		setSource(p);
		setSourceSum(await api.folders.summary(p));
		if (!output) await setOut(`${parentOf(p)}\\IESNIEDZAMIE`);
	};
	const pickOutput = async () => {
		const p = await api.folders.pick("Kur likt jaunos dokumentus?");
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
			<ScreenHead title="Jauns konkurss no mapes" what="Izvēlies mapi, kur ir konkursa dokumenti, un mapi, kur likt jaunos dokumentus." why="Oriģinālos dokumentus app nekad nemaina — jaunās versijas tiek liktas tikai izvades mapē." />
			<div className="card">
				<h2>1. Izejas dati</h2>
				<p className="hint">Mape ar nolikumu, pielikumiem, grozījumiem un komisijas atbildēm (parasti KONKURSS).</p>
				<div className="row">
					<code className="pathbox grow">{source || "nav izvēlēta"}</code>
					<button onClick={pickSource}>Izvēlēties mapi</button>
				</div>
				<FolderSummaryView s={sourceSum} />
			</div>
			<div className="card">
				<h2>2. Kur likt jaunos dokumentus</h2>
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
