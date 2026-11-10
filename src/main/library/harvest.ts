// Harvester (phase 7): builds library proposals from what the office already submitted. Read-only — this module
// never writes, moves or renames anything; it returns proposals that a person accepts in Reģistri.
//
//  1. code — list submission folders (IESNIEDZAMIE / PIEDĀVĀJUMS) under the given roots, classify evidence files
//            by name, reduce each name to an object key, cluster keys into objects
//  2. code — lift facts from the experience tables of submitted forms; each value is the cell text itself,
//            cited with its file, so nothing is paraphrased
//  3. code — builder folders (V2) and the company + reg. Nr. their statements carry
import { readdirSync } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, extname, join, relative, sep } from "node:path";
import type { Builder, EvidenceKind, HarvestFact, HarvestFile, HarvestProposal, HarvestRun } from "../../shared/library.js";
import type { RegObject } from "../../shared/registers.js";
import { clean, readDocx } from "../office.js";

export const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// ---------- 1. files ----------
export interface Submission {
	tender: string;
	dir: string;
}
export interface SubFile {
	tender: string;
	path: string;
	/** path inside the submission folder */
	rel: string;
	name: string;
	size: number;
	mtimeMs: number;
	/** first folder level inside the submission when it names a builder, else "" */
	builder: string;
}

const SUBMISSION_DIR = /^(iesniedzamie|piedavajum)/;

/** Tender folders directly under each root that hold a submission folder. Unreadable folders are skipped. */
export function listSubmissions(roots: string[]): Submission[] {
	const out: Submission[] = [];
	for (const root of roots) {
		let tenders: string[];
		try {
			tenders = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
		} catch {
			continue;
		}
		for (const t of tenders) {
			let subs: string[];
			try {
				subs = readdirSync(join(root, t), { withFileTypes: true }).filter((d) => d.isDirectory() && SUBMISSION_DIR.test(fold(d.name))).map((d) => d.name);
			} catch {
				continue;
			}
			for (const s of subs) out.push({ tender: t, dir: join(root, t, s) });
		}
	}
	return out;
}

/** Folder names inside a submission that are a document group, not a builder. */
const NOT_BUILDER =
	/pieredz|objekt|pielik|specialist|nodrosin|apaksuzn|^bim$|papild|kvalif|finans|tehnisk|iesniedz|citi|dokument|aploksn|^v\d|zip|pierad|veidlap|sertif|cv$|^\d|apliecin|licenc|draft|vec[ie]|jaun|gala|final|paraksti|edoc|^pdf|word|skan|scan|atsauks|buvatlauj|lig[ui]m|rasej|foto|test|^ip$|apaksniek|^cits$|^other$/;
/** A builder folder is a company name — not a document group, and not a person ("N.Pavars", "A. Kalnins"). */
export const isBuilderFolder = (name: string) =>
	!NOT_BUILDER.test(fold(name).trim()) && /[a-z]/i.test(name) && !/^[A-ZĀČĒĢĪĶĻŅŠŪŽ]\.\s?[A-ZĀČĒĢĪĶĻŅŠŪŽ]/.test(name.trim()) && name.trim().length <= 30 && !/[,;]/.test(name);

/** Lists the files of a submission; size and mtime are filled later, only for the files that matter (statFiles). */
export function walkSubmission(sub: Submission, maxDepth = 5): SubFile[] {
	const out: SubFile[] = [];
	const walk = (dir: string, depth: number) => {
		let es;
		try {
			es = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of es) {
			const p = join(dir, e.name);
			if (e.isDirectory()) {
				if (depth < maxDepth) walk(p, depth + 1);
				continue;
			}
			if (e.name.startsWith("~$") || /^thumbs\.db$/i.test(e.name) || /\.(lnk|url|tmp)$/i.test(e.name)) continue;
			const rel = relative(sub.dir, p);
			const first = rel.split(sep).length > 1 ? rel.split(sep)[0] : "";
			out.push({ tender: sub.tender, path: p, rel, name: e.name, size: 0, mtimeMs: 0, builder: first && isBuilderFolder(first) ? first : "" });
		}
	};
	walk(sub.dir, 0);
	return out;
}

/** Fills size and mtime, a bounded number of stats at a time (B:\ is a network drive: one by one is slow). */
export async function statFiles(files: SubFile[], concurrency = 48): Promise<void> {
	let i = 0;
	const worker = async () => {
		while (i < files.length) {
			const f = files[i++];
			try {
				const st = await stat(f.path);
				f.size = st.size;
				f.mtimeMs = st.mtimeMs;
			} catch {
				/* unreadable: stays 0 and sorts last */
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
}

// ---------- classification and object keys ----------
/** Leading numbering in any of the office's styles: "3_1", "P8_1", "3C ", "1_0". */
const NUMBERING = /^(?:[a-z]?\d+(?:[a-z](?=[\s._-]))?[\s._-]*)+(?=[a-z])/;

const KIND_RULES: [RegExp, EvidenceKind][] = [
	[/atsauk|atsauskm/, "atsauksme"],
	[/buvatlauj/, "buvatlauja"],
	[/pn[ _]?atzim|projektesanas nosacijum/, "pn_atzime"],
	[/ekspluat|pienemsanas akts/, "ekspluatacija"],
	[/izzin/, "izzina"],
	[/generalplan|(^|[^a-z])gp[-_ ]\d|(^|[_ ])ar[_ -]|rasejum/, "generalplans"],
	[/energo|es-p|(^|[_ ])een[_ ]/, "energosertifikats"],
	[/paskaidrojuma raksts|apliecinajuma kart/, "paskaidrojums"],
	[/lemum/, "lemums"],
	[/pilnvar|parstavib/, "pilnvara"],
];
export function evidenceKind(fileName: string): EvidenceKind | null {
	if (/\.(zip|7z|rar|lnk|url|msg|eml|dwg|ifc|rvt|xlsx?)$/i.test(fileName)) return null;
	const n = fold(basename(fileName, extname(fileName))).replace(NUMBERING, "");
	for (const [re, k] of KIND_RULES) if (re.test(n)) return k;
	return null;
}

/** Words that say what kind of document a file is, or nothing at all — never which object. */
const NOISE = new Set(
	(
		"atsauksme atsauksmes atsaukmse atsauskme buvatlauja buvatlaujai buvatlaujas pn atzime atzimi ekspluatacijas akts akta akti " +
		"izzina izzinas generalplans gp ar energosertifikats sertifikats sakotnejais pagaidu es een lemums lemumu par pilnvara pielikums " +
		"izstradataja nomainu nomaina buvdizains buvdizainam buvdizaina au iela ielas bulv bulvaris bulvari eka ekas ekai stavs stava " +
		"karta kartas ii iii iv un ar uz no pdf edoc docx skaidrojosais apraksts paskaidrojuma raksts raksti apliecinajuma parregistraciju " +
		"izmainam valdes atseviska parstaviba sia as vsia ps gala kopija copy scan skenets signed parakstits shortcut"
	).split(" "),
);
/** Doubled letters collapsed and long words cut, so "Mēnessgaismas" and "Mēnesgaismas" are one word. */
const canon = (w: string) => {
	const c = w.replace(/(.)\1+/g, "$1");
	return c.length > 6 ? c.slice(0, 6) : c;
};

export interface ObjectKey {
	words: string[];
	nums: string[];
}
export function objectKey(text: string): ObjectKey {
	let n = fold(basename(text, extname(text)));
	n = n.replace(NUMBERING, "");
	n = n.replace(/bd\d{2,4}-\d{4}/g, " ").replace(/\d{1,2}\.\d{1,2}\.\d{4}/g, " ").replace(/\(\d+\)$/, " ");
	const words: string[] = [];
	const nums: string[] = [];
	for (const raw of n.split(/[^a-z0-9]+/)) {
		if (!raw) continue;
		if (/^\d+$/.test(raw)) {
			if (raw.length <= 4 && !/^(19|20)\d\d$/.test(raw)) nums.push(String(Number(raw)));
			continue;
		}
		if (/\d/.test(raw)) continue;
		if (raw.length < 3 || NOISE.has(raw)) continue;
		const c = canon(raw);
		if (!words.includes(c)) words.push(c);
	}
	return { words: words.sort(), nums: [...new Set(nums)].sort() };
}
export const keyString = (k: ObjectKey) => `${k.words.join(" ")}${k.nums.length ? ` #${k.nums.join(",")}` : ""}`;

const subset = (a: string[], b: string[]) => a.every((x) => b.includes(x));
/** a's key is a less specific spelling of b's: all of a's words are in b, and the address numbers do not disagree. */
const narrower = (a: ObjectKey, b: ObjectKey) =>
	a.words.length > 0 && subset(a.words, b.words) && (a.nums.length === 0 || subset(a.nums, b.nums)) && (a.words.length < b.words.length || a.nums.length < b.nums.length);

export interface Cluster {
	key: ObjectKey;
	files: SubFile[];
	kinds: Map<string, EvidenceKind>;
}

/**
 * Groups evidence files by object. A key folds into a more specific key only when one family of more specific keys
 * could be meant: "cigorinu iela" stays apart while both "cigorinu #1" and "cigorinu #3" are in real use.
 */
export function clusterEvidence(files: SubFile[]): { clusters: Cluster[]; unnamed: number } {
	const groups = new Map<string, Cluster>();
	let unnamed = 0;
	for (const f of files) {
		const kind = evidenceKind(f.name);
		if (!kind) continue;
		const k = objectKey(f.name);
		if (k.words.length === 0) {
			unnamed++;
			continue;
		}
		const ks = keyString(k);
		const g = groups.get(ks) ?? ({ key: k, files: [], kinds: new Map() } as Cluster);
		g.files.push(f);
		g.kinds.set(f.path, kind);
		groups.set(ks, g);
	}
	const keys = [...groups.keys()];
	const parent = new Map<string, string>();
	for (const ks of keys) {
		const k = groups.get(ks)!.key;
		const own = groups.get(ks)!.files.length;
		// one-off spellings ("dot menesg #1,2,24,4") do not make a key ambiguous
		const substantial = (o: string) => groups.get(o)!.files.length >= Math.max(2, Math.ceil(own * 0.1));
		const wider = keys.filter((o) => o !== ks && narrower(k, groups.get(o)!.key) && substantial(o));
		if (wider.length === 0) continue;
		const nums = new Set(wider.map((o) => groups.get(o)!.key.nums.join(",")).filter(Boolean));
		if (nums.size > 1) continue;
		wider.sort((a, b) => groups.get(b)!.files.length - groups.get(a)!.files.length || groups.get(b)!.key.words.length - groups.get(a)!.key.words.length);
		parent.set(ks, wider[0]);
	}
	const root = (ks: string): string => {
		const seen = new Set<string>();
		while (parent.has(ks) && !seen.has(ks)) {
			seen.add(ks);
			ks = parent.get(ks)!;
		}
		return ks;
	};
	const merged = new Map<string, Cluster>();
	for (const ks of keys) {
		const r = root(ks);
		const g = groups.get(ks)!;
		const m = merged.get(r) ?? ({ key: groups.get(r)!.key, files: [], kinds: new Map() } as Cluster);
		m.files.push(...g.files);
		for (const [p, k] of g.kinds) m.kinds.set(p, k);
		merged.set(r, m);
	}
	return { clusters: [...merged.values()], unnamed };
}

/** "3_1Atsauksme_Cigorinu 3 AU.edoc" → "Cigorinu 3 AU": the file stem without its number and document word. */
export function readableStem(fileName: string): string {
	return basename(fileName, extname(fileName))
		.replace(/^(?:[A-Za-z]?\d+(?:[A-Za-z](?=[\s._-]))?[\s._-]*)+(?=[A-Za-zĀ-ž])/, "")
		.replace(/^(atsauksme|atsaukmse|atsauskme|buvatlauja|būvatļauja|ekspluatacijas[_ ]akts|izzina|izziņa)[_ -]*/i, "")
		.replace(/[_]+/g, " ")
		.trim();
}

/** Newest version of each distinct file; a signed .edoc wins over its .docx/.pdf twin. */
export function newestFiles(c: Cluster): HarvestFile[] {
	const best = new Map<string, SubFile>();
	const rank = (f: SubFile) => (extname(f.name).toLowerCase() === ".edoc" ? 1 : 0);
	for (const f of c.files) {
		const id = `${c.kinds.get(f.path)}|${fold(readableStem(f.name)).replace(/[^a-z0-9]+/g, " ").replace(/\bcopy\b/g, "").trim()}`;
		const cur = best.get(id);
		if (!cur || rank(f) > rank(cur) || (rank(f) === rank(cur) && f.mtimeMs > cur.mtimeMs)) best.set(id, f);
	}
	return [...best.values()].map((f) => ({ path: f.path, kind: c.kinds.get(f.path)!, mtimeMs: f.mtimeMs, size: f.size })).sort((a, b) => a.kind.localeCompare(b.kind) || b.mtimeMs - a.mtimeMs);
}

function label(c: Cluster): string {
	const counts = new Map<string, number>();
	const main = c.files.filter((f) => ["atsauksme", "buvatlauja", "ekspluatacija"].includes(c.kinds.get(f.path) ?? ""));
	for (const f of main.length ? main : c.files) {
		const s = readableStem(f.name).replace(/\s*-\s*copy$/i, "");
		if (s.length >= 3) counts.set(s, (counts.get(s) ?? 0) + 1);
	}
	return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]?.[0] ?? keyString(c.key);
}

/** Register object whose name and fields contain every word of the cluster key (and its address numbers). */
export function matchObject(key: ObjectKey, objects: RegObject[]): { id: string; name: string } | null {
	for (const o of objects) {
		const k = objectKey(`${o.name} ${o.fields.map((f) => f.value).join(" ")}`);
		if (subset(key.words, k.words) && subset(key.nums, k.nums)) return { id: o.id, name: o.name };
	}
	return null;
}

// ---------- 2. facts from experience tables ----------
const FACT_HEADERS: [string, RegExp][] = [
	["Pasūtītājs", /pasutitaj/],
	["Pieredzes raksturojums", /raksturojum|objekta nosaukum|objekts|projekta nosaukum/],
	["Līguma izpildes laiks", /izpildes laiks|izpildes period|no\s*\/\s*lidz|termin/],
	["Būvvaldes atzīmes datums", /buvvald|atzim|akcept/],
	["Nodots ekspluatācijā", /ekspluatac/],
	["Līgumcena", /ligumcen|summa|vertib/],
	["Platība", /platib/],
];
export interface ExperienceRow {
	file: string;
	mtimeMs: number;
	cells: Record<string, string>;
}
/** Rows of every table whose header names the purchaser and the object; empty placeholder rows are dropped. */
export function experienceRows(tables: string[][][], file: string, mtimeMs: number): ExperienceRow[] {
	const out: ExperienceRow[] = [];
	for (const t of tables) {
		const hi = t.findIndex((r) => r.some((c) => /pasutitaj/.test(fold(c))) && r.some((c) => /raksturojum|objekt|nosaukum/.test(fold(c))));
		if (hi < 0) continue;
		const map: { col: number; key: string }[] = [];
		t[hi].forEach((h, col) => {
			const hit = FACT_HEADERS.find(([, re]) => re.test(fold(h)));
			if (hit && !map.some((m) => m.key === hit[0])) map.push({ col, key: hit[0] });
		});
		for (const r of t.slice(hi + 1)) {
			if (r.length < map.length) continue;
			const cells: Record<string, string> = {};
			for (const m of map) {
				const v = clean(r[m.col] ?? "");
				if (v && !/^[-–_.…\s]*$/.test(v)) cells[m.key] = v;
			}
			if (cells["Pieredzes raksturojums"] && cells["Pieredzes raksturojums"].length > 12) out.push({ file, mtimeMs, cells });
		}
	}
	return out;
}

export function rowMatches(key: ObjectKey, row: ExperienceRow): boolean {
	const k = objectKey(`${row.cells["Pieredzes raksturojums"] ?? ""} ${row.cells["Pasūtītājs"] ?? ""}`);
	return key.words.length > 0 && subset(key.words, k.words) && subset(key.nums, k.nums);
}

/** The newest row that matches, as cited facts (one per column). */
export function factsFor(key: ObjectKey, rows: ExperienceRow[]): HarvestFact[] {
	const hit = rows.filter((r) => rowMatches(key, r)).sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
	if (!hit) return [];
	return Object.entries(hit.cells).map(([k, v]) => ({ key: k, value: v, cite: { file: hit.file, quote: v } }));
}

// ---------- 3. builders ----------
export const builderKey = (n: string) => fold(n).replace(/\b(sia|as|ps|vsia)\b/g, "").replace(/[^a-z0-9]+/g, "");

export interface CompanyMention {
	name: string;
	/** name without the legal form, for comparing */
	key: string;
	regNr: string;
	quote: string;
}
/**
 * Every "SIA “X”, reģ. nr. 12345678901" in a text, in any wording — "ja ar pretendentu SIA “SANART”, reģ. nr. …",
 * "Pretendents SIA “FF” Reģ. Nr. …" across two paragraphs. Fills the builder register and, in phase 9, catches a
 * company paired with someone else's number.
 */
export function companyMentions(text: string): CompanyMention[] {
	const out: CompanyMention[] = [];
	const re = /\b(SIA|AS|PS|VSIA|IK)\s*[„“"”']([^„“"”'\n]{2,60}?)[”"“']\s*,?\s*\(?\s*re[gģ](?:istrācijas)?\.?\s*(?:nr|numurs)\.?\s*[:\s_]*(\d{11})/gi;
	for (const m of clean(text).matchAll(re)) out.push({ name: `${m[1].toUpperCase()} “${m[2].trim()}”`, key: builderKey(m[2]), regNr: m[3], quote: m[0] });
	return out;
}

const sameCompany = (folderKey: string, mentionKey: string) => {
	const n = Math.min(4, folderKey.length, mentionKey.length);
	return n >= 2 && (mentionKey.startsWith(folderKey.slice(0, n)) || folderKey.startsWith(mentionKey.slice(0, n)));
};

export function harvestBuilders(files: SubFile[], readParas: (path: string) => string[] | null, maxDocsPerBuilder = 4): Builder[] {
	const by = new Map<string, Builder & { docs: number }>();
	const ordered = [...files].filter((f) => f.builder).sort((a, b) => b.tender.localeCompare(a.tender));
	for (const f of ordered) {
		const key = builderKey(f.builder);
		if (!key) continue;
		const b = by.get(key) ?? { id: key, name: f.builder.trim(), regNr: "", address: "", signatory: "", signatoryTitle: "", contact: "", seenIn: [], cites: [], docs: 0 };
		if (!b.seenIn.includes(f.tender)) b.seenIn.push(f.tender);
		if (!b.regNr && b.docs < maxDocsPerBuilder && extname(f.name).toLowerCase() === ".docx" && /apaksuzn|apliec/.test(fold(f.name))) {
			b.docs++;
			const paras = readParas(f.path);
			const p = paras ? companyMentions(paras.join(" ")).find((m) => sameCompany(key, m.key)) : undefined;
			if (p) {
				b.name = p.name;
				b.regNr = p.regNr;
				b.cites.push({ file: f.path, quote: p.quote });
			}
		}
		by.set(key, b);
	}
	// two folder spellings of one company ("KUUM", "KUUM & PC") are one builder once their reg. Nr. agree
	const out: Builder[] = [];
	for (const { docs: _d, ...b } of by.values()) {
		const same = b.regNr ? out.find((x) => x.regNr === b.regNr) : undefined;
		if (!same) out.push(b);
		else {
			for (const t of b.seenIn) if (!same.seenIn.includes(t)) same.seenIn.push(t);
			same.cites.push(...b.cites);
		}
	}
	return out.sort((a, b) => b.seenIn.length - a.seenIn.length);
}

// ---------- the run ----------
export interface HarvestOptions {
	roots: string[];
	objects: RegObject[];
	/** a proposal needs files from at least this many submissions */
	minUses?: number;
	/** experience tables are read from the newest N submissions only */
	tablesFromNewest?: number;
	now?: Date;
}

const safeDocx = (path: string) => {
	try {
		return readDocx(path);
	} catch {
		return null;
	}
};
const tableForm = (f: SubFile) => extname(f.name).toLowerCase() === ".docx" && /pieredz|kvalifik|specialist|pretendent|pielikums_nr/.test(fold(f.name));

export async function harvest(o: HarvestOptions, onProgress?: (text: string) => void): Promise<HarvestRun> {
	onProgress?.("Meklē iesniegšanas mapes…");
	const subs = listSubmissions(o.roots);
	const files = subs.flatMap((s) => walkSubmission(s));
	onProgress?.(`Atrastas ${subs.length} iesniegšanas mapes, ${files.length} faili. Nolasa datumus…`);
	await statFiles(files.filter((f) => evidenceKind(f.name) || tableForm(f) || (f.builder && /\.docx$/i.test(f.name))));
	const { clusters, unnamed } = clusterEvidence(files);

	onProgress?.("Lasa pieredzes tabulas iesniegtajās veidlapās…");
	const newestTenders = new Set([...new Set(subs.map((s) => s.tender))].sort().reverse().slice(0, o.tablesFromNewest ?? 80));
	const rows: ExperienceRow[] = [];
	for (const f of files) {
		if (!newestTenders.has(f.tender) || !tableForm(f)) continue;
		const d = safeDocx(f.path);
		if (d) rows.push(...experienceRows(d.tables, f.path, f.mtimeMs));
	}

	const proposals: HarvestProposal[] = clusters
		.map((c) => {
			const tenders = [...new Set(c.files.map((f) => f.tender))].sort().reverse();
			return { key: keyString(c.key), label: label(c), uses: tenders.length, tenders, files: newestFiles(c), facts: factsFor(c.key, rows), match: matchObject(c.key, o.objects), decision: null } satisfies HarvestProposal;
		})
		.filter((p) => p.uses >= (o.minUses ?? 2))
		.sort((a, b) => b.uses - a.uses || a.label.localeCompare(b.label));

	onProgress?.("Lasa būvnieku mapes…");
	const builders = harvestBuilders(files, (p) => safeDocx(p)?.paragraphs ?? null);
	return { ranAt: (o.now ?? new Date()).toISOString(), roots: o.roots, submissions: subs.length, files: files.length, unnamed, proposals, builders };
}
