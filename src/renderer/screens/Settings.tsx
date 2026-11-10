import { useEffect, useState } from "react";
import { ENGINE_LABELS, type EngineId, type Settings } from "../../shared/types";
import { api } from "../api";
import { FolderRules, ScreenHead } from "../ui";
import { AuditLog } from "./AuditLog";
import { DepsPanel } from "./Deps";
import { EnginesPanel } from "./Engines";

export function SettingsScreen({ onReplayTour }: { onReplayTour?: () => void }) {
	const [settings, setSettings] = useState<Settings | null>(null);
	useEffect(() => void api.settings.get().then(setSettings), []);
	return (
		<div className="screen">
			<ScreenHead title="Iestatījumi" what="Šeit pieslēdz aģentus, ar kuriem app lasa dokumentus, un izvēlies, kuru lietot." why="Ja aģents nav pieejams, app parāda kļūdu un uz citu aģentu automātiski nepārslēdzas — tev jāizvēlas pašai." />
			<div className="card">
				<h2>Apmācība</h2>
				<div className="row">
					<span className="muted">Viss process no jaunas konkursa mapes līdz rezultātam — ap 3 minūtes, var izlaist jebkurā brīdī.</span>
					<span className="grow" />
					<button data-tour="tour-replay" className="primary" onClick={onReplayTour} disabled={!onReplayTour}>Rādīt apmācību vēlreiz</button>
				</div>
			</div>
			<EnginesPanel />
			<DepsPanel />
			<div className="card">
				<h2>Noklusējuma aģents dokumentu lasīšanai</h2>
				<select
					value={settings?.engineForTasks ?? "claude"}
					onChange={async (e) => setSettings(await api.settings.save({ engineForTasks: e.target.value as EngineId }))}
					style={{ maxWidth: 320 }}
				>
					{(Object.keys(ENGINE_LABELS) as EngineId[]).map((id) => <option key={id} value={id}>{ENGINE_LABELS[id]}</option>)}
				</select>
			</div>
			<div className="card">
				<h2>Mapes</h2>
				<FolderRules work={settings?.workRoot ? `${settings.workRoot}\\<konkurss>` : undefined} />
				<div className="row">
					<span style={{ width: 220 }}>Konkursu mape (tikai lasīšanai)</span>
					<span className="mono">{settings?.tendersRoot || "B:\\01_Konkursi (noklusējums)"}</span>
					<button onClick={async () => { const p = await api.folders.pick("Konkursu mape"); if (p) setSettings(await api.settings.save({ tendersRoot: p })); }}>Mainīt</button>
				</div>
				<div className="row">
					<span style={{ width: 220 }}>Darba mape (šajā datorā)</span>
					<span className="mono">{settings?.workRoot || "Mani dokumenti\\Konkursi (noklusējums — katram lietotājam sava)"}</span>
					<button onClick={async () => { const p = await api.folders.pick("Darba mape šajā datorā"); if (p) setSettings(await api.settings.save({ workRoot: p })); }}>Mainīt</button>
				</div>
				<p className="hint">Katram konkursam tur tiek izveidota sava mape: melnraksti, pierādījumu kopijas un gatavā paka. Konkursu mapē app neko neraksta — gatavo paku uz konkursa IESNIEDZAMIE pārvieto pats.</p>
				<div className="row">
					<span style={{ width: 220 }}>Kopīgā reģistru mape</span>
					<span className="mono">{settings?.libraryDir || "šis dators (nav kopīgas)"}</span>
					<button onClick={async () => { const p = await api.folders.pick("Kopīgā reģistru mape"); if (p) setSettings(await api.settings.save({ libraryDir: p })); }}>Izvēlēties</button>
					{settings?.libraryDir && <button onClick={async () => setSettings(await api.settings.save({ libraryDir: "" }))}>Lietot šī datora reģistrus</button>}
				</div>
				<p className="hint">Kopīgā mapē visi kolēģi redz vienus un tos pašus objektus, speciālistus un būvniekus. Katru saglabāšanu app pirms tam nokopē uz backups\ un uz brīdi aizslēdz, lai divi cilvēki nepārrakstītu viens otru.</p>
			</div>
			<AuditLog />
		</div>
	);
}
