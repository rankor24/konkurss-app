// 4. Vai varam pieteikties — computed from the confirmed requirements and our registers. No tender data is hard-coded.
import type { Requirements } from "../../shared/state.js";
import type { RegObject, Registers, Specialist } from "../../shared/registers.js";
import { coverage, type Coverage } from "../registers/registers.js";
import { experienceSlots, parseObject, qualify, type ExperienceSlot } from "./objects.js";

export interface SlotVerdict {
	slot: ExperienceSlot;
	qualifying: RegObject[];
	excluded: { object: RegObject; reasons: string[] }[];
	needed: number;
	met: boolean;
}
export interface Feasibility {
	specialists: Coverage[];
	specialistsCovered: number;
	slots: SlotVerdict[];
	/** points a criterion can still reach / total offered, price excluded from "reachable" because it depends on competitors */
	points: { price: number; reachable: number; lost: { name: string; points: number; why: string }[]; total: number };
	blockers: string[];
}

export function feasibility(req: Requirements, reg: Registers, deadline: Date | null, now: Date = new Date()): Feasibility {
	const required = req.specialisti.filter((s) => s.mandatory && s.field.value).map((s) => s.field.value as string);
	const specialists = coverage(required, reg.specialists);

	const slots: SlotVerdict[] = experienceSlots(req).map((slot) => {
		const qualifying: RegObject[] = [];
		const excluded: SlotVerdict["excluded"] = [];
		for (const o of reg.objects) {
			const q = qualify(o, slot, deadline, now);
			if (q.ok) qualifying.push(o);
			else excluded.push({ object: o, reasons: q.reasons });
		}
		const needed = slot.count ?? 1;
		return { slot, qualifying, excluded, needed, met: qualifying.length >= needed };
	});

	let price = 0;
	let reachable = 0;
	const lost: Feasibility["points"]["lost"] = [];
	let total = 0;
	for (const c of req.vertesana) {
		const pts = c.points.value ?? 0;
		total += pts;
		const name = c.name.value ?? "";
		if (/cena|c[eē]na/i.test(name)) {
			price += pts;
			continue;
		}
		const v = slots.find((s) => s.slot.title === name && s.slot.source === "vērtēšana");
		if (!v) reachable += pts; // criterion that needs no register object
		else if (v.met) reachable += pts;
		else lost.push({ name, points: pts, why: `kvalificējas ${v.qualifying.length} no ${v.needed} objektiem` });
	}

	const blockers: string[] = [];
	for (const s of specialists) if (!s.covered) blockers.push(`Reģistrā nav neviena speciālista: ${s.required}. Vajag apakšuzņēmēju.`);
	for (const v of slots) if (v.slot.kind === "company" && !v.met) blockers.push(`Uzņēmuma pieredzei nepietiek objektu (${v.qualifying.length} no ${v.needed}).`);
	return { specialists, specialistsCovered: specialists.filter((s) => s.covered).length, slots, points: { price, reachable, lost, total }, blockers };
}

// ---------- BPV consistency (mistake catalogue B1) ----------
export interface BpvFinding {
	ok: boolean;
	message: string;
}

const normName = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const certOf = (s: string) => s.match(/\b\d-\d{4,6}\b/)?.[0] ?? "";

/**
 * The person listed as responsible BPV in the qualification must be the person whose experience earns the points.
 * Compares the chosen BPV with the BPV recorded on each object used for the BPV criterion.
 */
export function bpvConsistency(opts: { chosen: Specialist | undefined; objects: RegObject[]; points: number | null }): BpvFinding[] {
	if (!opts.chosen) return [{ ok: false, message: "Atbildīgais būvprojekta vadītājs vēl nav izvēlēts." }];
	const out: BpvFinding[] = [];
	const me = normName(opts.chosen.name);
	const myCert = opts.chosen.certificate;
	for (const o of opts.objects) {
		const recorded = parseObject(o).bpv;
		if (!recorded) {
			out.push({ ok: false, message: `Objektam „${o.name}” reģistrā nav norādīts BPV — pārbaudi, vai tas ir ${opts.chosen.name}.` });
			continue;
		}
		const same = normName(recorded).includes(me) || (!!myCert && certOf(recorded) === myCert);
		if (!same) {
			const pts = opts.points ? ` — šie ${opts.points} punkti var netikt piešķirti` : "";
			out.push({
				ok: false,
				message: `Kvalifikācijā kā atbildīgais būvprojekta vadītājs būs ${opts.chosen.name}${myCert ? ` (${myCert})` : ""}, bet punktus prasi par objekta „${o.name}” pieredzi, kur BPV bija ${recorded}. Punktus piešķir tam vadītājam, kurš norādīts kvalifikācijā${pts}.`,
			});
		}
	}
	if (out.length === 0 && opts.objects.length) out.push({ ok: true, message: `Visi izvēlētie objekti ir ${opts.chosen.name} pieredze.` });
	return out;
}
