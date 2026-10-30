// Which earlier objects can serve as experience for which requirement — decided in code from the object's own
// register fields, with the reason stated („apkure E — nav energoefektīvs”). The model is not involved.
import type { Criterion, ExperienceReq, Requirements } from "../../shared/state.js";
import type { KV, RegObject } from "../../shared/registers.js";
import { parseDeadline } from "../../shared/format.js";

const strip = (s: string) => s.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const field = (o: RegObject | { fields: KV[] }, re: RegExp) => strip(o.fields.find((f) => re.test(norm(f.key)))?.value ?? "");

export interface ObjectFacts {
	area: number | null;
	code: string | null;
	group: number | null;
	/** true / false when the register says so, null when it cannot be told */
	isPublic: boolean | null;
	energyClass: string | null;
	acceptDate: Date | null;
	bpv: string;
}

const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3 };

export function parseObject(o: RegObject): ObjectFacts {
	const kind = field(o, /^plat/);
	const area = kind.match(/([\d][\d\s]*(?:[.,]\d+)?)\s*m²/)?.[1];
	// "area / code (label) / group": the code is the 4-digit number of the middle part, never the area
	const parts = kind.split(/\s\/\s/);
	const code = (parts[1] ?? "").match(/\b(\d{4})\b/)?.[1] ?? null;
	const g = (parts[2] ?? kind).match(/\b(III|II|I|\d)\.?\s*grupa/i)?.[1];
	const group = g ? (ROMAN[g.toUpperCase()] ?? Number(g)) : null;
	let isPublic: boolean | null = null;
	if (/nav publisk/i.test(kind)) isPublic = false;
	else if (/publisk/i.test(kind)) isPublic = true;
	else if (code?.startsWith("12") && group === 3) isPublic = true;
	else if (group !== null || code) isPublic = false;

	const energy = field(o, /^energoklase/).match(/apkure\s*(A\+|[A-G])(?![A-Za-z0-9])/i)?.[1]?.toUpperCase() ?? null;

	const acc = field(o, /^buvvaldes akcepts/);
	// "17-18.12.2024" is a range: the later day counts
	const dates = [...acc.matchAll(/(\d{1,2})(?:-(\d{1,2}))?\.(\d{2})\.(\d{4})/g)];
	const last = dates.at(-1);
	const acceptDate = last ? new Date(Number(last[4]), Number(last[3]) - 1, Number(last[2] ?? last[1])) : null;

	return {
		area: area ? Number(area.replace(/\s/g, "").replace(",", ".")) : null,
		code,
		group,
		isPublic,
		energyClass: energy,
		acceptDate,
		bpv: field(o, /^bpv$/),
	};
}

export const GOOD_ENERGY = new Set(["A+", "A", "B"]);

export type SlotKind = "company" | "bpv" | "energy";
export interface ExperienceSlot {
	id: string;
	kind: SlotKind;
	title: string;
	/** how many objects the requirement or criterion asks for */
	count: number | null;
	years: number | null;
	needsPublic: boolean;
	needsEnergy: boolean;
	points: number | null;
	/** where it came from, for the screen */
	source: string;
}

const text = (c: { value: string | null }) => c.value ?? "";
const plain = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const yearsIn = (s: string): number | null => {
	const m = s.match(/(\d+)\s*(?:\([^)]*\)\s*)?gad/i);
	return m ? Number(m[1]) : null;
};

/** Experience slots for this tender, from the confirmed requirements: company experience and scored criteria. */
export function experienceSlots(r: Pick<Requirements, "pieredze" | "vertesana">): ExperienceSlot[] {
	const slots: ExperienceSlot[] = [];
	r.pieredze.forEach((p: ExperienceReq, i) => {
		const t = `${text(p.text)} ${text(p.objectType)}`;
		slots.push({
			id: `company:${i}`,
			kind: "company",
			title: text(p.text) || `Uzņēmuma pieredze ${i + 1}`,
			count: p.count.value,
			years: p.periodYears.value ?? yearsIn(t),
			needsPublic: /publisk/i.test(t),
			needsEnergy: /energoefektiv/.test(plain(t)),
			points: null,
			source: "kvalifikācija",
		});
	});
	r.vertesana.forEach((c: Criterion, j) => {
		const name = text(c.name);
		const t = `${name} ${text(c.formula)}`;
		const isBpv = /b[uū]vprojekta vad[iī]t[aā]j|bpv/i.test(name);
		const isEnergy = /energoefektiv/.test(plain(name));
		if (!isBpv && !isEnergy) return;
		slots.push({
			id: `${isBpv ? "bpv" : "energy"}:${j}`,
			kind: isBpv ? "bpv" : "energy",
			title: name,
			count: c.objectsNeeded,
			years: yearsIn(t),
			needsPublic: isBpv && /publisk/i.test(t),
			needsEnergy: isEnergy || /energoefektiv/.test(plain(t)),
			points: c.points.value,
			source: "vērtēšana",
		});
	});
	return slots;
}

const fmt = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;

export interface Qualification {
	ok: boolean;
	/** why the object does not fit — shown next to the greyed object */
	reasons: string[];
	/** things the register does not say, so the check could not be completed */
	warnings: string[];
}

/** Does this object fit this slot? `deadline` anchors the "last N years" window (today when unknown). */
export function qualify(o: RegObject, slot: ExperienceSlot, deadline: Date | null, now: Date = new Date()): Qualification {
	const f = parseObject(o);
	const reasons: string[] = [];
	const warnings: string[] = [];
	if (slot.needsPublic) {
		if (f.isPublic === false) reasons.push(`nav publiska ēka (${[f.code ? `kods ${f.code}` : "", f.group ? `${f.group}. grupa` : ""].filter(Boolean).join(", ") || "reģistrā norādīts"}) — prasa publisku`);
		else if (f.isPublic === null) warnings.push("reģistrā nav teikts, vai ēka ir publiska");
	}
	if (slot.needsEnergy) {
		if (!f.energyClass) warnings.push("reģistrā nav energoklases");
		else if (!GOOD_ENERGY.has(f.energyClass)) reasons.push(`apkure ${f.energyClass} — nav energoefektīvs`);
	}
	if (slot.years) {
		const anchor = deadline ?? now;
		const from = new Date(anchor);
		from.setFullYear(from.getFullYear() - slot.years);
		if (!f.acceptDate) warnings.push("reģistrā nav būvvaldes akcepta datuma");
		else if (f.acceptDate < from) reasons.push(`akcepts ${fmt(f.acceptDate)} — ārpus ${slot.years} gadu loga (no ${fmt(from)})`);
		else if (f.acceptDate > anchor) reasons.push(`akcepts ${fmt(f.acceptDate)} ir pēc termiņa`);
	}
	return { ok: reasons.length === 0, reasons, warnings };
}

export function deadlineOf(state: { deadline: { date: { value: string | null }; time: { value: string | null } } }): Date | null {
	return parseDeadline(state.deadline.date.value, state.deadline.time.value);
}
