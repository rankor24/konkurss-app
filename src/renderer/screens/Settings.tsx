import { useEffect, useState } from "react";
import { ENGINE_LABELS, type EngineId, type Settings } from "../../shared/types";
import { api } from "../api";
import { ScreenHead } from "../ui";
import { EnginesPanel } from "./Engines";

export function SettingsScreen() {
	const [settings, setSettings] = useState<Settings | null>(null);
	useEffect(() => void api.settings.get().then(setSettings), []);
	return (
		<div className="screen">
			<ScreenHead title="Iestatījumi" what="Šeit pieslēdz aģentus, ar kuriem app lasa dokumentus, un izvēlies, kuru lietot." why="Ja aģents nav pieejams, app parāda kļūdu un uz citu aģentu automātiski nepārslēdzas — tev jāizvēlas pašai." />
			<EnginesPanel />
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
		</div>
	);
}
