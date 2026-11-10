// Phase 8: building, reading and assembling the pack manifest. Decided in code from project state, the registers and
// the evidence plan — the model is not involved. Assembling only copies into <output>\Paka; nothing is overwritten.
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import type { PackItem, PackManifest, PackSource, PackStatus } from "../../shared/pack.js";
import { recipientFolder } from "../../shared/pack.js";
import { recipients } from "../../shared/profile.js";
import type { TenderProfile } from "../../shared/profile.js";
import type { Registers } from "../../shared/registers.js";
import type { ProjectState, RequiredDoc } from "../../shared/state.js";
import { companySigner } from "../checks/signatures.js";
import { evidenceKind, fold, isBuilderFolder } from "../library/harvest.js";
import type { EvidenceItem } from "../v1/evidence.js";

/** Leading pack numbering in the office's styles: "3_1", "3_0", "1_", "P8_1", "3C ". */
const NUMBER = /^([A-Za-z]?\d+(?:[_.]\d+)*)(?:[A-Za-z](?=[\s._-]))?[\s._-]*/;
export const stripNumber = (name: string) => name.replace(NUMBER, "");
export const numberOf = (name: string) => name.match(NUMBER)?.[1]?.replace(".", "_") ?? null;

const GENERIC = new Set(["pielik", "pielikums", "veidla", "forma", "nr", "dokume", "iesnie", "atklat", "konkur", "versij", "parakst", "piedav"]);
const words = (s: string) => new Set(fold(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 4).map((w) => w.slice(0, 6)).filter((w) => !GENERIC.has(w)));

/** "source:KONKURSS\1.pielikums_Specialistu_saraksts.docx" → "Specialistu_saraksts": the tender's own numbering goes. */
export function templateLabel(key: string): string {
	const rel = key.includes(":") ? key.split(":").slice(1).join(":") : key;
	return stripNumber(basename(rel, extname(rel)))
		.replace(/^(\d+[._]?\s*)?pielikums(\s*nr\.?)?[\s._-]*(\d+[._-]*)?/i, "")
		.replace(/^[\s._-]+/, "");
}

/**
 * How well a required document's name and a template file name agree (shared distinctive words). A statement form
 * only fills a statement, an experience form only an experience document.
 */
export function nameScore(required: string, file: string): number {
	const label = templateLabel(file);
	const rk = requiredKind(required);
	const tk = requiredKind(label);
	if (rk !== tk && (rk !== "other" || tk !== "other")) {
		const statement = (k: Kind) => k === "spec_apliec" || k === "apaksuzn_apliec";
		// a generic "Apliecinājums" form may still be the statement the tender names
		if (!(statement(rk) && tk === "other" && /apliec/.test(fold(label)))) return 0;
	}
	const a = words(required);
	let n = 0;
	for (const w of words(label)) if (a.has(w)) n++;
	return n;
}

type Kind = "spec_apliec" | "apaksuzn_apliec" | "pieredze" | "other";
export function requiredKind(name: string): Kind {
	const n = fold(name);
	if (/apliecin/.test(n) && /specialist|buvprojekta vaditaj|autoruzraug|projektetaj/.test(n)) return "spec_apliec";
	if (/apliecin/.test(n) && /apaksuznem/.test(n)) return "apaksuzn_apliec";
	if (/pieredz/.test(n)) return "pieredze";
	return "other";
}

const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
const surnameInitial = (full: string) => {
	const p = full.trim().split(/\s+/);
	return p.length > 1 ? `${p[0][0]}. ${p.slice(1).join(" ")}` : full.trim();
};

export const generatedKey = (recipient: string, ref: string, number: string) => `${recipient}|${ref}|${number}`;

export interface ManifestInput {
	state: ProjectState;
	registers: Registers;
	builders: string[];
	profile?: TenderProfile;
	evidence: EvidenceItem[];
	now?: Date;
}

/**
 * The plan of the pack. Order and numbers follow the tender's list of required documents; evidence hangs under the
 * experience document it proves ("3_0" form, "3_1"… files); a statement per person or firm gets its own sub-number.
 */
export function buildManifest(i: ManifestInput): PackManifest {
	const s = i.state;
	const docs: RequiredDoc[] = s.requirements.dokumenti.filter((d) => d.name.value);
	const fills = Object.entries(s.fills);
	const usedFills = new Set<string>();
	const signer = companySigner(i.registers);
	const base: Omit<PackItem, "id" | "recipient">[] = [];
	const unmatched: string[] = [];

	const chosenSpecialists = Object.values(s.choices.specialists).map((id) => i.registers.specialists.find((x) => x.id === id)).filter((x): x is NonNullable<typeof x> => !!x);
	const subFirms = [...new Set(chosenSpecialists.filter((x) => x.type === "B" && x.via.trim()).map((x) => x.via.trim()))];
	const ownName = i.registers.company.fields.find((f) => /^nosaukums$/i.test(f.key))?.value ?? "";

	const companyEvidence = i.evidence.filter((e) => e.slot.startsWith("company"));
	const personEvidence = i.evidence.filter((e) => !e.slot.startsWith("company"));
	let companyPlaced = false;
	let personPlaced = false;

	docs.forEach((d, idx) => {
		const nr = String(idx + 1);
		const name = d.name.value!;
		const kind = requiredKind(name);
		const best = fills.filter(([k]) => !usedFills.has(k)).map(([k, sh]) => ({ k, sh, score: nameScore(name, k) })).sort((a, b) => b.score - a.score)[0];
		const fill = best && best.score > 0 ? best : null;
		if (fill) usedFills.add(fill.k);
		const req = d.name;

		if (kind === "spec_apliec" && !fill) {
			if (chosenSpecialists.length === 0) unmatched.push(name);
			chosenSpecialists.forEach((sp, j) => {
				const n = chosenSpecialists.length > 1 ? `${nr}_${j + 1}` : nr;
				base.push({ number: n, label: `Speciālista apliecinājums — ${sp.name}`, required: req, source: "generated", ref: `specialist:${sp.id}`, fileName: `${n}_Spec. apliec. ${safe(surnameInitial(sp.name))}.docx`, from: null, signer: sp.name, status: "nav" });
			});
			return;
		}
		if (kind === "apaksuzn_apliec" && !fill) {
			const firms = [...(i.profile?.ourRole.value === "apaksuznemejs" && ownName ? [ownName] : []), ...subFirms];
			if (firms.length === 0) unmatched.push(name);
			firms.forEach((firm, j) => {
				const n = firms.length > 1 ? `${nr}_${j + 1}` : nr;
				const ours = firm === ownName;
				base.push({ number: n, label: `Apakšuzņēmēja apliecinājums — ${firm}`, required: req, source: "generated", ref: ours ? "company" : `firm:${firm}`, fileName: `${n}_Apaksuzn. apliec. ${safe(firm.replace(/^(SIA|AS)\s*/i, "").replace(/[„“”"]/g, ""))}.docx`, from: null, signer: ours ? signer : null, status: "nav", note: ours ? undefined : "Paraksta apakšuzņēmēja paraksttiesīgā persona." });
			});
			return;
		}

		// company experience goes under the first experience document, a person's under the one naming specialists / BPV
		const personal = /specialist|bpv|buvprojekta vaditaj|arhitekt/.test(fold(name));
		const ev = kind !== "pieredze" ? [] : personal ? (personPlaced ? [] : personEvidence) : companyPlaced ? [] : companyEvidence;
		if (kind === "pieredze" && personal) personPlaced = personPlaced || ev.length > 0;
		if (kind === "pieredze" && !personal) companyPlaced = companyPlaced || ev.length > 0;
		const n = ev.length ? `${nr}_0` : nr;
		const label = fill ? templateLabel(fill.k) : name;
		const ext = fill ? extname(fill.k) || ".docx" : ".docx";
		const output = fill ? (fill.sh.outputs[""] ?? Object.values(fill.sh.outputs)[0] ?? null) : null;
		const source: PackSource = fill ? "form" : "manual";
		if (!fill) unmatched.push(name);
		base.push({ number: n, label: fill ? label : name, required: req, source, ref: fill?.k ?? "", fileName: `${n}_${safe(fill ? label : name)}${ext}`, from: output, signer, status: "nav" });

		{
			ev.forEach((e, j) => {
				const cn = `${nr}_${j + 1}`;
				const stem = e.from ? stripNumber(basename(e.from)) : safe(e.label);
				base.push({ number: cn, label: `${e.object} — ${e.label}`, source: "evidence", ref: e.object, fileName: `${cn}${stem}`, from: e.from || null, signer: null, status: "nav", note: e.status === "ok" ? undefined : e.reason });
			});
		}
	});
	// forms the tender has but its list of documents did not name
	for (const [k, sh] of fills) {
		if (usedFills.has(k)) continue;
		const nr = String(base.filter((b) => !b.number.includes("_") || b.number.endsWith("_0")).length + 1);
		const label = templateLabel(k);
		base.push({ number: nr, label, source: "form", ref: k, fileName: `${nr}_${safe(label)}${extname(k) || ".docx"}`, from: sh.outputs[""] ?? Object.values(sh.outputs)[0] ?? null, signer, status: "nav", note: "Veidlapa ir konkursa dokumentos, bet prasīto dokumentu sarakstā nav nosaukta." });
	}

	const items: PackItem[] = [];
	for (const r of recipients(i.profile, i.builders)) {
		const b = recipientFolder(r);
		for (const it of base) {
			const made = it.source === "generated" ? s.generated?.[generatedKey(r, it.ref, it.number)] : undefined;
			const from = it.source === "form" && b ? (s.fills[it.ref]?.outputs[b] ?? it.from) : (made ?? it.from);
			items.push({ ...it, from, id: `${r}|${it.number}|${it.fileName}`, recipient: r });
		}
	}
	return { builtAt: (i.now ?? new Date()).toISOString(), items, unmatched };
}

/** Status from what lies in the assembled pack folder: a signed .edoc twin → parakstīts; the file → gatavs / melnraksts. */
export function withStatus(m: PackManifest, packDir: string): PackManifest {
	return {
		...m,
		items: m.items.map((it) => {
			const dir = join(packDir, recipientFolder(it.recipient));
			const file = join(dir, it.fileName);
			const signed = join(dir, `${basename(it.fileName, extname(it.fileName))}.edoc`);
			let status: PackStatus = "nav";
			if (existsSync(signed)) status = "parakstits";
			else if (existsSync(file)) status = it.signer ? "melnraksts" : "gatavs";
			return { ...it, status };
		}),
	};
}

/**
 * Copies every item that has a source file into <output>\Paka\[<builder>\]<fileName>. Existing files are kept
 * (a signed .edoc placed there by a person is never replaced); returns what was copied and what was skipped.
 */
export function assemblePack(m: PackManifest, outputDir: string): { copied: string[]; kept: string[]; missing: string[] } {
	const root = join(outputDir, "Paka");
	const copied: string[] = [];
	const kept: string[] = [];
	const missing: string[] = [];
	for (const it of m.items) {
		const rel = join(recipientFolder(it.recipient), it.fileName);
		const dst = join(root, rel);
		if (!it.from || !existsSync(it.from)) {
			if (it.source !== "external") missing.push(rel);
			continue;
		}
		if (existsSync(dst)) {
			kept.push(rel);
			continue;
		}
		mkdirSync(dirname(dst), { recursive: true });
		copyFileSync(it.from, dst);
		copied.push(rel);
	}
	return { copied, kept, missing };
}

// ---------- reading a pack that already exists (hand-made, or an old submission) ----------
export interface FolderItem {
	recipient: string;
	number: string | null;
	stem: string;
	/** extensions present for this stem: ".docx", ".edoc", ".pdf" … */
	exts: string[];
	kind: string;
}

/** Items of an existing IESNIEDZAMIE: one per stem (a .docx and its signed .edoc are one document). */
export function manifestFromFolder(dir: string, maxDepth = 3): FolderItem[] {
	const by = new Map<string, FolderItem>();
	const walk = (d: string, depth: number) => {
		for (const e of readdirSync(d, { withFileTypes: true })) {
			const p = join(d, e.name);
			if (e.isDirectory()) {
				if (depth < maxDepth) walk(p, depth + 1);
				continue;
			}
			if (e.name.startsWith("~$") || /\.(lnk|tmp|msg)$/i.test(e.name)) continue;
			const rel = relative(dir, p);
			const first = rel.split(sep).length > 1 ? rel.split(sep)[0] : "";
			const recipient = first && isBuilderFolder(first) ? `builder:${first}` : "";
			const ext = extname(e.name).toLowerCase();
			const stem = basename(e.name, extname(e.name));
			const key = `${recipient}|${relative(dir, d)}|${stem.toLowerCase()}`;
			const it = by.get(key) ?? { recipient, number: numberOf(e.name), stem, exts: [], kind: evidenceKind(e.name) ?? (/apliec/i.test(fold(stem)) ? "apliecinajums" : "veidlapa") };
			if (!it.exts.includes(ext)) it.exts.push(ext);
			by.set(key, it);
		}
	};
	if (existsSync(dir) && statSync(dir).isDirectory()) walk(dir, 0);
	return [...by.values()].sort((a, b) => a.recipient.localeCompare(b.recipient) || (a.number ?? "~").localeCompare(b.number ?? "~", undefined, { numeric: true }));
}

/** The file names a folder manifest stands for — used to check the model can represent a real pack exactly. */
export function folderItemFiles(items: FolderItem[]): string[] {
	return items.flatMap((it) => it.exts.map((x) => it.stem + x)).sort();
}
