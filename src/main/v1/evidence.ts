// 7. Pierādījumi: for the objects the person chose, bring the evidence files (atsauksme, būvatļauja, energosertifikāts …)
// from where earlier tenders stored them into the new package, numbered the way EIS packages are numbered.
// Originals are only read; copies never overwrite anything.
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { Choices } from "../../shared/state.js";
import type { Registers } from "../../shared/registers.js";

export interface EvidenceItem {
	slot: string;
	object: string;
	label: string;
	from: string;
	/** path relative to the output folder, or "" when nothing can be copied */
	toRel: string;
	status: "ok" | "missing";
	reason?: string;
}

const ascii = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9_-]+/g, "");

/** "Andis Kalniņš" → "Kalnins": the dossier folder is named after the BPV so that person can sign their own set. */
export const bpvFolder = (name: string) => ascii(name.trim().split(/\s+/).at(-1) ?? "BPV") || "BPV";

function filesOf(path: string): string[] {
	if (!existsSync(path)) return [];
	const st = statSync(path);
	if (st.isFile()) return [path];
	return readdirSync(path, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(path, e.name)).sort();
}

/** Numbering: company experience → "2_<n>", the BPV's dossier → "<Surname>\3_<n>". Each source file is used once per folder. */
export function planEvidence(choices: Choices, reg: Registers, bpvName: string | undefined): EvidenceItem[] {
	const items: EvidenceItem[] = [];
	const counters = new Map<string, number>();
	const used = new Set<string>();
	const slots = Object.keys(choices.objects).sort((a, b) => (a.startsWith("company") ? -1 : 0) - (b.startsWith("company") ? -1 : 0) || a.localeCompare(b));
	for (const slot of slots) {
		const company = slot.startsWith("company");
		const folder = company ? "" : bpvFolder(bpvName ?? "BPV");
		const prefix = company ? "2" : "3";
		for (const id of choices.objects[slot]) {
			const o = reg.objects.find((x) => x.id === id);
			if (!o) continue;
			if (o.evidence.length === 0) items.push({ slot, object: o.name, label: "(pierādījumi nav norādīti reģistrā)", from: "", toRel: "", status: "missing", reason: "Reģistrā objektam nav norādīts, kur glabājas atsauksme, būvatļauja, energosertifikāts." });
			for (const ev of o.evidence) {
				const files = ev.path.trim() ? filesOf(ev.path.trim()) : [];
				if (files.length === 0) {
					items.push({ slot, object: o.name, label: ev.label, from: ev.path, toRel: "", status: "missing", reason: "Fails nav atrasts norādītajā vietā." });
					continue;
				}
				for (const file of files) {
					const key = `${folder}|${file.toLowerCase()}`;
					if (used.has(key)) continue;
					used.add(key);
					const n = (counters.get(folder) ?? 0) + 1;
					counters.set(folder, n);
					items.push({ slot, object: o.name, label: ev.label, from: file, toRel: join("Pierādījumi", folder, `${prefix}_${n}${basename(file)}`), status: "ok" });
				}
			}
		}
	}
	return items;
}

/** Copies the planned files into the output folder. An existing destination is never overwritten (a counter is added). */
export function collectEvidence(outputDir: string, plan: EvidenceItem[]): { copied: string[]; skipped: string[] } {
	const copied: string[] = [];
	const skipped: string[] = [];
	for (const it of plan) {
		if (it.status !== "ok") continue;
		let dst = join(outputDir, it.toRel);
		if (existsSync(dst)) {
			skipped.push(it.toRel);
			continue;
		}
		mkdirSync(join(dst, ".."), { recursive: true });
		copyFileSync(it.from, dst);
		copied.push(it.toRel);
	}
	return { copied, skipped };
}

export { extname };
