import { useState } from "react";
import type { EngineStatus } from "../../shared/types";
import { ScreenHead } from "../ui";
import { EnginesPanel } from "./Engines";

/** Three plain steps for a first launch: welcome → connect an agent → first folder. Skippable. */
export function FirstRun({ onNewProject, onSkip }: { onNewProject: () => void; onSkip: () => void }) {
	const [step, setStep] = useState<1 | 2 | 3>(1);
	const [ready, setReady] = useState(false);

	return (
		<div className="screen">
			<ScreenHead title="Sveicināti Konkursu App" what="Šeit sagatavo konkursu dokumentus: app izlasa konkursa mapi, parāda, ko tas prasa, un palīdz aizpildīt veidlapas." why={`Solis ${step} no 3`} />
			{step === 1 && (
				<div className="card">
					<h2>Kā tas strādā</h2>
					<ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
						<li>Tu izvēlies mapi ar konkursa dokumentiem. <strong>Oriģināli netiek mainīti un nekas netiek dzēsts.</strong></li>
						<li>Jaunie dokumenti tiek ielikti atsevišķā mapē, ko tu izvēlies.</li>
						<li>Pie katras vērtības, ko app izlasa no dokumenta, redzams teikums, no kura tā nolasīta. Ja vērtības nav, app to saka — tā neizdomā.</li>
					</ul>
					<div className="row">
						<button className="primary" onClick={() => setStep(2)}>Tālāk</button>
						<button onClick={onSkip}>Izlaist</button>
					</div>
				</div>
			)}
			{step === 2 && (
				<>
					<p className="intro">Lai app varētu lasīt dokumentus, jāpieslēdz vismaz viens aģents. Claude vajag atslēgu (to iedod Boriss); Codex un Grok pieslēdzas ar tavu abonementu.</p>
					<EnginesPanel onChange={(s: EngineStatus[]) => setReady(s.some((x) => x.ready))} />
					<div className="row">
						<button className="primary" onClick={() => setStep(3)}>{ready ? "Tālāk" : "Tālāk bez aģenta"}</button>
						<button onClick={() => setStep(1)}>Atpakaļ</button>
					</div>
				</>
			)}
			{step === 3 && (
				<div className="card">
					<h2>Pirmais konkurss</h2>
					<p className="muted">Izvēlies mapi, kur ir konkursa dokumenti (parasti KONKURSS), un mapi, kur likt jaunos dokumentus.</p>
					<div className="row">
						<button className="primary" onClick={onNewProject}>+ Jauns konkurss no mapes</button>
						<button onClick={onSkip}>Vēlāk</button>
					</div>
				</div>
			)}
		</div>
	);
}
