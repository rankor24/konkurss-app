// 8. Pārbaude — the exact checks ("precīza"), done in code. Each returns fail / warn / ok / na with the consequence
// in plain Latvian, where it is visible, and which step fixes it. `na` (⊘) means the tender does not require the
// check — it is never an error and never silence.
import type { Registers } from "../../shared/registers.js";
import type { LeakReport } from "../../shared/leaks.js";
import type { ProjectState } from "../../shared/state.js";
import type { Finding, FindingStatus } from "../../shared/checks.js";
import type { InspectedSheet } from "../pytools.js";
import { bpvConsistency } from "../v1/feasibility.js";
import { criteriaSum } from "../tasks/phase2.js";
import { expiring } from "../registers/registers.js";
import { parseObject } from "../v1/objects.js";
import { deadlineFinding } from "./submission.js";
import { matrixLayout, type LodProposal, type MatrixLayout } from "../fill/matrica.js";

export type { Finding, FindingStatus };

export interface OutDoc {
	file: string;
	label: string;
	/** "" = our own / base copy */
	builder: string;
	kind: "bip" | "matrica" | "form" | "tech" | "other";
	text: string;
	paragraphs: { text: string; italic: number }[];
	tables: string[][][];
}
export interface MatrixDoc {
	file: string;
	builder: string;
	sheet: InspectedSheet;
}
export interface CheckInput {
	state: ProjectState;
	registers: Registers;
	builders: string[];
	docs: OutDoc[];
	matrices: MatrixDoc[];
	leaks: Record<string, LeakReport>;
	/** project code the paraugmodeļu prasības fix (e.g. "KRB"); null when not set */
	projectCode: string | null;
	pipLod: LodProposal[];
	today: Date;
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const f = (id: string, status: FindingStatus, title: string, detail: string, extra: Partial<Finding> = {}): Finding => ({ id, kind: "precīza", status, title, detail, where: [], ...extra });
const base = (p: string) => p.split(/[\\/]/).pop() ?? p;

const variantOf = (i: CheckInput) => i.state.variant?.value ?? null;

// ---------- V1 ----------
export function ruleBpv(i: CheckInput): Finding {
	if (variantOf(i) !== "V1") return f("bpv", "na", "Būvprojekta vadītājs sakrīt ar pieredzes objektiem", "Šis nav projektēšanas konkurss, kurā mēs esam pretendents.");
	const req = i.state.requirements;
	const idx = req.specialisti.findIndex((s) => /b[uū]vprojekta vad[iī]t[aā]j/i.test(s.field.value ?? ""));
	const bpvSlot = Object.keys(i.state.choices.objects).filter((k) => k.startsWith("bpv:"));
	if (idx < 0 || bpvSlot.length === 0) return f("bpv", "na", "Būvprojekta vadītājs sakrīt ar pieredzes objektiem", "Konkursā nav BPV pieredzes kritērija vai objekti vēl nav izvēlēti.");
	const chosen = i.registers.specialists.find((s) => s.id === i.state.choices.specialists[String(idx)]);
	const objects = bpvSlot.flatMap((k) => i.state.choices.objects[k]).map((id) => i.registers.objects.find((o) => o.id === id)).filter((o): o is NonNullable<typeof o> => !!o);
	const pts = req.vertesana.find((c) => /b[uū]vprojekta vad/i.test(c.name.value ?? ""))?.points.value ?? null;
	const res = bpvConsistency({ chosen, objects, points: pts });
	const bad = res.filter((r) => !r.ok);
	return bad.length
		? f("bpv", "fail", "Būvprojekta vadītājs nesakrīt", bad.map((b) => b.message).join(" "), { where: ["Kvalifikācija — speciālistu tabula", "Vērtēšanas veidlapa — BPV pieredze"], step: "kas", fix: "Salāgot" })
		: f("bpv", "ok", "Būvprojekta vadītājs sakrīt ar pieredzes objektiem", res[0]?.message ?? "");
}

export function ruleSpecialists(i: CheckInput): Finding {
	if (variantOf(i) !== "V1") return f("specialists", "na", "Visi prasītie speciālisti norādīti", "Speciālistu tabula attiecas uz projektēšanas konkursu (V1).");
	const req = i.state.requirements.specialisti.filter((s) => s.mandatory && s.field.value);
	if (req.length === 0) return f("specialists", "na", "Visi prasītie speciālisti norādīti", "Nolikums neprasa konkrētus speciālistus.");
	const missing = req.filter((_, k) => !i.state.choices.specialists[String(i.state.requirements.specialisti.indexOf(req[k]))]);
	if (missing.length) return f("specialists", "fail", "Nav norādīti visi prasītie speciālisti", `Trūkst: ${missing.map((m) => m.field.value).join("; ")}. Bez tā piedāvājumu var noraidīt kā neatbilstošu nolikumam.`, { where: ["Kvalifikācija — B tabula"], step: "kas", fix: "Izvēlēties speciālistu" });
	return f("specialists", "ok", "Visi prasītie speciālisti norādīti", `${req.length} no ${req.length}.`);
}

export function ruleCertificates(i: CheckInput): Finding {
	const chosenIds = new Set(Object.values(i.state.choices.specialists));
	const chosen = i.registers.specialists.filter((s) => chosenIds.has(s.id));
	if (chosen.length === 0) return f("certs", "na", "Sertifikāti ir spēkā", "Nav izvēlēts neviens speciālists.");
	const dl = i.state.deadline.date.value ? new Date(i.today) : i.today;
	const ex = expiring(chosen, dl, 3);
	const blank = chosen.filter((s) => !s.validUntil);
	if (ex.some((e) => e.status === "expired")) return f("certs", "fail", "Beidzies sertifikāts", ex.filter((e) => e.status === "expired").map((e) => `${e.name} (${e.validUntil})`).join("; ") + ". Komisija sertifikātus pārbauda BIS.", { where: ["Reģistri → Speciālisti"], step: "kas" });
	if (ex.length) return f("certs", "warn", "Sertifikāts drīz beidzas", ex.map((e) => `${e.name} — pēc ${e.days} d. (${e.validUntil})`).join("; "), { where: ["Reģistri → Speciālisti"] });
	if (blank.length) return f("certs", "warn", "Sertifikātu derīgums nav pārbaudīts", `Reģistrā nav derīguma datuma: ${blank.map((s) => s.name).join(", ")}. Pārbaudi BIS un ievadi datumu.`, { where: ["Reģistri → Speciālisti"] });
	return f("certs", "ok", "Sertifikāti ir spēkā", `${chosen.length} speciālistu.`);
}

// ---------- shared ----------
export function ruleCriteriaSum(i: CheckInput): Finding {
	const crit = i.state.requirements.vertesana;
	if (crit.length === 0) return f("criteria", "na", "Vērtēšanas kritēriju summa", "Vērtēšanas kritēriji nav nolasīti vai konkurss tos nevērtē.");
	const s = criteriaSum(crit);
	if (!s.complete) return f("criteria", "warn", "Vērtēšanas kritēriju punkti nav pilnībā zināmi", "Daļai kritēriju trūkst punktu skaita.", { step: "prasibas" });
	return s.sum === 100 ? f("criteria", "ok", "Vērtēšanas kritēriju summa", "Kopā 100.") : f("criteria", "warn", "Vērtēšanas kritēriju summa nav 100", `Kopā ${s.sum}. Pārbaudi, vai nolasīti visi kritēriji.`, { step: "prasibas" });
}

export const ruleDeadline = (i: CheckInput): Finding => deadlineFinding(i.state, i.today);

export function ruleCompanyName(i: CheckInput): Finding {
	const name = i.registers.company.fields.find((x) => /^nosaukums$/i.test(x.key))?.value.replace(/\*\*/g, "").trim();
	if (!name) return f("company-name", "na", "Uzņēmuma nosaukums visur vienāds", "Uzņēmuma reģistrā nav nosaukuma.");
	const ours = i.docs.filter((d) => d.builder === "" && !(variantOf(i) !== "V1" && d.kind === "bip"));
	if (ours.length === 0) return f("company-name", "na", "Uzņēmuma nosaukums visur vienāds", "Nav izveidotu dokumentu, kuros mēs esam pretendents.");
	const bad: string[] = [];
	for (const d of ours) {
		const variants = new Set([...d.text.matchAll(/SIA\s*[„“"”']?\s*B[ŪU]VDIZAINS(?:\.LV)?\s*[“”"']?/gi)].map((m) => m[0].replace(/\s+/g, " ").trim()));
		for (const v of variants) if (norm(v) !== norm(name) || v.replace(/[„“”"']/g, "") !== name.replace(/[„“”"']/g, "")) bad.push(`${d.label}: „${v}”`);
	}
	return bad.length ? f("company-name", "fail", "Uzņēmuma nosaukums nav visur vienāds", `Reģistrā: ${name}. Atšķiras: ${[...new Set(bad)].join("; ")}.`, { where: bad.map((b) => b.split(":")[0]), step: "aizpildit" }) : f("company-name", "ok", "Uzņēmuma nosaukums visur vienāds", name);
}

export function ruleProjectCode(i: CheckInput): Finding {
	if (!i.projectCode) return f("project-code", "na", "Projekta kods atbilst prasībām", "Projekta kods nav norādīts (paraugmodeļu prasībās fiksētais kods).");
	const code = i.projectCode;
	const bad: string[] = [];
	for (const d of i.docs.filter((x) => x.kind === "bip" || x.kind === "matrica")) {
		const found = new Set([...d.text.matchAll(/\b([A-Z]{3})_[A-Z]{2,3}_/g)].map((m) => m[1]));
		for (const c of found) if (c !== code) bad.push(`${d.label}: ${c}`);
	}
	return bad.length ? f("project-code", "fail", "Projekta kods atšķiras no prasītā", `Prasītais kods ${code}. Dokumentos atrasts: ${bad.join("; ")}. Komisija pārbauda burtu precizitāti.`, { where: bad.map((b) => b.split(":")[0]), step: "aizpildit" }) : f("project-code", "ok", "Projekta kods atbilst prasībām", code);
}

export function ruleLeftoverInstructions(i: CheckInput): Finding {
	const bad = i.docs.filter((d) => d.kind === "bip" || d.kind === "form" || d.kind === "tech").map((d) => ({ d, n: d.paragraphs.filter((p) => p.italic > 0.6 && p.text.trim().length >= 40 && !/^Avots:|^zaļš =|^sarkans =|^pelēks =/.test(p.text.trim())).length })).filter((x) => x.n > 0);
	return bad.length ? f("leftover-italics", "fail", "Veidnes pamācības nav izdzēstas", `${bad.map((x) => `${x.d.label}: ${x.n}`).join("; ")} slīpraksta rindkopas ir veidnes norādījumi — sadaļa nav uzrakstīta. Komisija to uzskata par neaizpildītu.`, { where: bad.map((x) => x.d.label), step: "aizpildit" }) : f("leftover-italics", "ok", "Veidnes pamācības izdzēstas", "Slīpraksta norādījumu nav palicis.");
}

export function ruleLeaks(i: CheckInput): Finding {
	const items = Object.entries(i.leaks).filter(([, r]) => !r.clean);
	if (Object.keys(i.leaks).length === 0) return f("leaks", "na", "Citu konkursu dati dokumentos", "Nav izveidotu dokumentu, ko pārbaudīt.");
	if (items.length === 0) return f("leaks", "ok", "Citu konkursu datu nav", `${Object.keys(i.leaks).length} dokumenti pārbaudīti.`);
	const parts = items.map(([file, r]) => `${base(file)}: ${[...r.foreign.map((h) => `„${h.term}”`), ...r.notes.map(() => "darba piezīme [..]"), ...r.unreadable.map(() => "nevar nolasīt")].join(", ")}`);
	return f("leaks", "fail", "Dokumentos ir citu konkursu dati vai darba piezīmes", `${parts.join("; ")}. Tas nedrīkst nonākt pie komisijas.`, { where: items.map(([file]) => base(file)), step: "aizpildit", fix: "Pārrakstīt vietu" });
}

export function ruleBuilderLeaks(i: CheckInput): Finding {
	if (i.builders.length < 2) return f("builder-leaks", "na", "Būvnieku dati nav sajaukti", "Konkursā nav vairāku būvnieku.");
	const state = i.state;
	const hits: string[] = [];
	for (const d of i.docs.filter((x) => x.builder)) {
		for (const other of i.builders.filter((b) => b !== d.builder)) {
			const terms = [other, ...(state.roles.build[other] ?? []).flatMap((r) => [r.person, r.company])].filter((t) => t.trim().length >= 4);
			const mine = new Set((state.roles.build[d.builder] ?? []).flatMap((r) => [norm(r.person), norm(r.company)]));
			for (const t of new Set(terms)) if (!mine.has(norm(t)) && norm(d.text).includes(norm(t))) hits.push(`${d.label} (${d.builder}): „${t}”`);
		}
	}
	return hits.length ? f("builder-leaks", "fail", "Viena būvnieka dati cita būvnieka dokumentā", `${[...new Set(hits)].join("; ")}. Katram būvniekam jāsaņem tikai savi dati.`, { where: hits.map((h) => h.split(" (")[0]), step: "aizpildit" }) : f("builder-leaks", "ok", "Būvnieku dati nav sajaukti", `${i.builders.length} kopijas pārbaudītas.`);
}

export function ruleMarkers(i: CheckInput): Finding {
	const rows = i.docs.map((d) => ({ d, n: (d.text.match(/\[aizpildīt\]/gi) ?? []).length, b: (d.text.match(/BŪVNIEKS/g) ?? []).length })).filter((x) => x.n + x.b > 0);
	if (i.docs.length === 0) return f("markers", "na", "Atlikušās tukšās vietas", "Nav izveidotu dokumentu.");
	return rows.length ? f("markers", "warn", "Dokumentos ir tukšas vietas", rows.map((x) => `${x.d.label}: ${x.n} × [aizpildīt]${x.b ? `, ${x.b} × BŪVNIEKS` : ""}`).join("; ") + ". TBC robežās to var atstāt, bet izslēgšanas kritērijos (speciālistu vārdi, atbildības matrica) tukšums ir izslēgšanas iemesls.", { where: rows.map((x) => x.d.label), step: "aizpildit" }) : f("markers", "ok", "Tukšu vietu nav", "Visi lauki aizpildīti.");
}

// ---------- BIP ↔ matrica (B12–B14) ----------
const isCoordinator = (role: string) => /koordinator/i.test(role);

/** B12: the person who is BIM coordinator in the BIP must be the author of the combined model in the matrica. */
export function ruleCoordinator(i: CheckInput): Finding {
	if (variantOf(i) === "V1" || i.matrices.length === 0) return f("coordinator", "na", "BIM koordinators sakrīt ar savietotā modeļa autoru", "Nav atbildības matricas vai tā netiek prasīta.");
	const issues: string[] = [];
	const where: string[] = [];
	for (const m of i.matrices) {
		const layout = matrixLayout(m.sheet);
		const comb = layout?.rows.find((r) => r.kind === "combined");
		if (!layout || !comb) continue;
		const coord = [...i.state.roles.design, ...(i.state.roles.build[m.builder] ?? [])].filter((r) => isCoordinator(r.role) && r.person.trim());
		if (coord.length === 0) continue;
		const authors = layout.authorCols.map((c) => m.sheet.cells[`${String.fromCharCode(64 + c)}${comb.row}`]?.trim()).filter(Boolean) as string[];
		const names = new Set(coord.map((c) => norm(c.person)));
		const other = [...new Set(authors)].filter((a) => !names.has(norm(a)));
		if (other.length) {
			issues.push(`BIP: BIM koordinators ir ${[...new Set(coord.map((c) => c.person))].join(", ")}, bet matricā savietotā modeļa autors ir ${other.join(", ")}`);
			where.push(base(m.file));
		}
	}
	return issues.length ? f("coordinator", "fail", "BIM koordinators nesakrīt ar savietotā modeļa autoru", `${issues.join("; ")}. Komisija prasa skaidrot, kurš pilda šo lomu; piedāvājums ir pretrunīgs.`, { where, step: "kas", fix: "Salāgot lomas" }) : f("coordinator", "ok", "BIM koordinators sakrīt ar savietotā modeļa autoru", "Lomas BIP un matricā sakrīt.");
}

/** B13: a model/phase has a LOD but no author, or an author but no LOD. */
export function ruleLodAuthor(i: CheckInput): Finding {
	if (i.matrices.length === 0) return f("lod-author", "na", "LOD un autors katram modelim", "Nav atbildības matricas.");
	const gaps = new Map<string, string[]>();
	const where = new Set<string>();
	for (const m of i.matrices) {
		const layout = matrixLayout(m.sheet);
		if (!layout) continue;
		for (const row of layout.rows.filter((r) => r.kind === "model")) {
			layout.phases.forEach((ph, k) => {
				const a = m.sheet.cells[`${String.fromCharCode(64 + layout.authorCols[k])}${row.row}`]?.trim();
				const l = m.sheet.cells[`${String.fromCharCode(64 + layout.lodCols[k])}${row.row}`]?.trim();
				const author = a && !/^([aizpildīt]|BŪVNIEKS)$/i.test(a) ? a : "";
				if (l && !author) {
					const key = `${row.code}${m.builder ? ` (${m.builder})` : ""}`;
					gaps.set(key, [...(gaps.get(key) ?? []), ph]);
					where.add(base(m.file));
				}
			});
		}
	}
	if (gaps.size === 0) return f("lod-author", "ok", "LOD un autors katram modelim", "Visiem modeļiem ar LOD ir autors.");
	const parts = [...gaps].map(([code, phases]) => `${code}: ${phases.join(", ")}`);
	// one line per model; every model is named so none is lost behind a "…"
	return f("lod-author", "fail", "Modelim ir LOD, bet nav autora", `${parts.join("; ")}. Matricā autora ailes ir izslēgšanas kritērijs.`, { where: [...where], step: "aizpildit" });
}

/** The matrica LOD must never be lower than the PIP minimum for the contract type. */
export function ruleLodPip(i: CheckInput): Finding {
	if (i.matrices.length === 0 || i.pipLod.length === 0) return f("lod-pip", "na", "LOD nav zemāks par PIP prasību", "Nav matricas vai PIP LOD tabula nav nolasīta (6. Aizpildīt → matrica).");
	const low: string[] = [];
	for (const m of i.matrices) {
		const layout: MatrixLayout | null = matrixLayout(m.sheet);
		if (!layout) continue;
		for (const row of layout.rows.filter((r) => r.kind === "model")) {
			layout.phases.forEach((ph, k) => {
				const need = i.pipLod.find((p) => p.code === row.code && p.phase === ph);
				const have = Number(m.sheet.cells[`${String.fromCharCode(64 + layout.lodCols[k])}${row.row}`]);
				if (need && Number.isFinite(have) && have < need.lod) low.push(`${row.code} ${ph}: ${have} < ${need.lod}`);
			});
		}
	}
	return low.length ? f("lod-pip", "fail", "Matricā LOD ir zemāks par PIP prasību", `${low.join("; ")}. Zemāks LOD kaut vienam modelim kaut vienā posmā ir izslēgšanas iemesls.`, { where: i.matrices.map((m) => base(m.file)), step: "aizpildit" }) : f("lod-pip", "ok", "LOD nav zemāks par PIP prasību", `${i.pipLod.length} pārbaudīti.`);
}

/** B14: authoring software outside the usual BIM authors needs a conformity statement. */
const NON_BIM = [/civil\s*3d/i, /cadmatic/i, /autocad(?!\s*architecture)/i, /microstation/i];
export function ruleSoftware(i: CheckInput): Finding {
	const bips = i.docs.filter((d) => d.kind === "bip");
	if (bips.length === 0) return f("software", "na", "Autorprogrammatūra atbilst PIP", "Nav BIP dokumenta.");
	const found = new Set<string>();
	for (const d of bips) for (const t of d.tables) for (const row of t) for (const cell of row) for (const re of NON_BIM) { const m = cell.match(re); if (m) found.add(m[0]); }
	return found.size ? f("software", "warn", "Autorprogrammatūrai var prasīt apliecinājumu", `BIP minēts: ${[...found].join(", ")}. Komisija var prasīt apstiprināt, ka tā ir BIM autorprogrammatūra pēc PIP prasībām, un iesniegt apliecinošu dokumentu. Sagatavo to jau tagad.`, { where: bips.map((d) => d.label), step: "aizpildit" }) : f("software", "ok", "Autorprogrammatūra", "Nestandarta programmatūra nav minēta.");
}

/** B13 (BIP side): the BIP's own LOD table vs the matrica, by model code and phase. */
export function ruleBipVsMatricaLod(i: CheckInput): Finding {
	const bips = i.docs.filter((d) => d.kind === "bip");
	if (bips.length === 0 || i.matrices.length === 0) return f("bip-matrica-lod", "na", "BIP LOD tabula sakrīt ar matricu", "Nav BIP vai matricas.");
	const diffs: string[] = [];
	let compared = 0;
	for (const d of bips) {
		for (const t of d.tables) {
			const header = (t[0] ?? []).map((c) => c.trim().toUpperCase());
			const phaseCols = header.map((h, idx) => ({ h, idx })).filter((x) => ["KC", "ST", "DT", "AP", "BV", "IM", "AIM"].includes(x.h));
			if (phaseCols.length < 2) continue;
			for (const row of t.slice(1)) {
				const code = (row[0] ?? "").trim().toUpperCase().split(/\s+/)[0].replace(/\s/g, "");
				if (!code) continue;
				for (const m of i.matrices.filter((x) => x.builder === d.builder)) {
					const layout = matrixLayout(m.sheet);
					const mrow = layout?.rows.find((r) => r.code === code);
					if (!layout || !mrow) continue;
					for (const pc of phaseCols) {
						const k = layout.phases.indexOf(pc.h);
						const bip = Number((row[pc.idx] ?? "").trim());
						if (k < 0 || !Number.isFinite(bip) || bip === 0) continue;
						compared++;
						const mv = m.sheet.cells[`${String.fromCharCode(64 + layout.lodCols[k])}${mrow.row}`]?.trim();
						if (!mv || Number(mv) !== bip) diffs.push(`${code} ${pc.h}: BIP ${bip}, matrica ${mv || "tukšs"}`);
					}
				}
			}
		}
	}
	if (compared === 0) return f("bip-matrica-lod", "na", "BIP LOD tabula sakrīt ar matricu", "BIP nav LOD tabulas ar posmu kolonnām (KC, ST, DT …).");
	return diffs.length ? f("bip-matrica-lod", "fail", "BIP un matricas LOD nesakrīt", `${diffs.slice(0, 12).join("; ")}${diffs.length > 12 ? " …" : ""}. Komisija prasa skaidrot, kura informācija ir saistoša.`, { where: [...bips.map((d) => d.label), ...i.matrices.map((m) => base(m.file))], step: "aizpildit" }) : f("bip-matrica-lod", "ok", "BIP un matricas LOD sakrīt", `${compared} vērtības salīdzinātas.`);
}

/** Energy comparison only exists when the tender scores energy efficiency (⊘ otherwise, with the reason). */
export function ruleEnergy(i: CheckInput): Finding {
	const crit = i.state.requirements.vertesana.find((c) => /energoefektiv/.test(norm(c.name.value ?? "")));
	if (!crit) return f("energy", "na", "Energoklašu salīdzinājums", "Šis konkurss energoefektivitāti nevērtē.");
	const ids = Object.entries(i.state.choices.objects).filter(([k]) => k.startsWith("energy:")).flatMap(([, v]) => v);
	if (ids.length === 0) return f("energy", "warn", "Energoefektīvas pieredzes objekts nav izvēlēts", `Kritērijs „${crit.name.value}” dod ${crit.points.value ?? "?"} punktus.`, { step: "kas" });
	const bad = ids.map((id) => i.registers.objects.find((o) => o.id === id)).filter((o): o is NonNullable<typeof o> => !!o).filter((o) => !["A+", "A", "B"].includes(parseObject(o).energyClass ?? ""));
	return bad.length ? f("energy", "fail", "Energoefektīvajam kritērijam izvēlēts objekts ar sliktu energoklasi", bad.map((o) => `${o.name}: apkure ${parseObject(o).energyClass ?? "nav norādīta"}`).join("; "), { step: "kas" }) : f("energy", "ok", "Energoklases", "Izvēlētie objekti ir energoefektīvi.");
}

export const RULES = [ruleBpv, ruleSpecialists, ruleCertificates, ruleCriteriaSum, ruleDeadline, ruleCompanyName, ruleProjectCode, ruleLeftoverInstructions, ruleLeaks, ruleBuilderLeaks, ruleMarkers, ruleCoordinator, ruleLodAuthor, ruleLodPip, ruleBipVsMatricaLod, ruleSoftware, ruleEnergy] as const;

const ORDER: Record<FindingStatus, number> = { fail: 0, warn: 1, ok: 2, na: 3 };
export function runRules(input: CheckInput): Finding[] {
	return RULES.map((r) => r(input)).sort((a, b) => ORDER[a.status] - ORDER[b.status]);
}
export function summary(fs: Finding[]) {
	return { fail: fs.filter((x) => x.status === "fail").length, warn: fs.filter((x) => x.status === "warn").length, ok: fs.filter((x) => x.status === "ok").length, na: fs.filter((x) => x.status === "na").length };
}
