// 9. Paraksti / iesniegšana (5.5): the deadline warning and the tick lists for what is typed into EIS by hand.
// Ticks are the person's — the app never marks one done on its own; it only says what the value should be.
import type { Finding } from "../../shared/checks.js";
import type { ProjectState } from "../../shared/state.js";

export interface Tick {
	id: string;
	text: string;
	/** where the expected value comes from, or why there is none */
	source: string;
}

const MS_DAY = 86_400_000;

/** "20.09.2026" + "10:00" → Date (local). null if the date is not in DD.MM.GGGG form. */
export function parseDeadline(date: string | null, time: string | null): Date | null {
	const m = date?.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
	if (!m) return null;
	const t = time?.match(/^(\d{1,2}):(\d{2})/);
	return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), t ? Number(t[1]) : 23, t ? Number(t[2]) : 59);
}

export function deadlineFinding(s: ProjectState, now: Date): Finding {
	const base = { id: "deadline-left", kind: "precīza" as const, title: "Iesniegšanas termiņš", where: [], step: "versija" as const };
	const d = parseDeadline(s.deadline.date.value, s.deadline.time.value);
	if (!d) return { ...base, status: "warn", detail: "Termiņš nav zināms vai nav ievadīts kā DD.MM.GGGG — app nevar brīdināt. Skatīt IUB paziņojumā vai EIS kartītē.", fix: "Ievadīt termiņu" };
	const left = d.getTime() - now.getTime();
	const fmt = `${s.deadline.date.value} ${s.deadline.time.value ?? "(laiks nav zināms — skaita līdz dienas beigām)"}`;
	if (left < 0) return { ...base, status: "fail", detail: `Termiņš ${fmt} ir pagājis. Pēc termiņa EIS piedāvājumu nepieņem.` };
	const days = Math.ceil(left / MS_DAY);
	if (left < 3 * MS_DAY) return { ...base, status: "warn", detail: `Līdz termiņam ${fmt} atlikušas ${days <= 1 ? "mazāk par 1 dienu" : `${days} dienas`}. Parakstīšana ar eParaksts un augšupielāde EIS prasa laiku — neatstāj uz pēdējo stundu.` };
	return { ...base, status: "ok", detail: `Termiņš ${fmt}; atlikušas ${days} dienas.` };
}

/** What is typed into EIS by hand. The expected values come from the state; the person ticks them. */
export function eisTicks(s: ProjectState, financeTotal: number | null): Tick[] {
	const ticks: Tick[] = [];
	ticks.push({
		id: "eis-amount",
		text: financeTotal !== null ? `EIS laukā „Piedāvājuma summa” ievadīta ${financeTotal.toLocaleString("lv-LV", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR bez PVN` : "EIS laukā „Piedāvājuma summa” ievadīta tā pati summa, kas Finanšu piedāvājumā",
		source: financeTotal !== null ? "Cenas (🔒 finanses) — tās pašas, kas Finanšu piedāvājuma veidlapā" : "cenas vēl nav ievadītas",
	});
	const espd = s.requirements.apaksuznemeji.espd.value;
	ticks.push({ id: "eis-espd", text: espd ? `ESPD/EVIPD aizpildīts EIS: ${espd}` : "ESPD/EVIPD — pārbaudi, vai nolikums to prasa", source: espd ? "nolikums (apakšuzņēmēji un ESPD)" : "nolikums nav lasīts vai neprasa" });
	const th = s.requirements.apaksuznemeji.threshold.value;
	if (th !== null) ticks.push({ id: "eis-subs", text: `Apakšuzņēmēji, kuru daļa pārsniedz ${th.toLocaleString("lv-LV")} EUR, norādīti EIS`, source: "nolikums" });
	for (const d of s.requirements.dokumenti.filter((x) => x.mandatory && x.name.value)) ticks.push({ id: `eis-doc-${d.name.value}`, text: `Augšupielādēts: ${d.name.value}`, source: "nolikums — iesniedzamie dokumenti" });
	ticks.push({ id: "eis-final", text: "Piedāvājums iesniegts EIS pirms termiņa un EIS apstiprinājums saglabāts", source: "EIS" });
	return ticks;
}
