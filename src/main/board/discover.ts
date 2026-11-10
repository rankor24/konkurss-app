// Phase 10: the portfolio board — every tender folder in the tenders root, its deadline, what the tracker says about
// it, whether the app already works on it, and the next thing to do. Read only: folders are never created or moved.
import { existsSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import type { TrackerRow } from "../../shared/library.js";
import type { Project } from "../../shared/types.js";
import { docxPlainText, readDocx } from "../office.js";
import { fold, isBuilderFolder } from "../library/harvest.js";
import { sentenceAt } from "../profile.js";
import type { BoardRow, BoardStatus, Deadline, ManualStatus } from "../../shared/board.js";
export type { BoardRow, BoardStatus, Deadline, ManualStatus } from "../../shared/board.js";
export { BOARD_STATUS_LABELS } from "../../shared/board.js";

const MONTHS = ["janvar", "februar", "mart", "april", "maij", "junij", "julij", "august", "septembr", "oktobr", "novembr", "decembr"];
const pad = (n: number | string) => String(n).padStart(2, "0");

export function folderDate(name: string): string | null {
	const m = name.match(/^(\d{2})(\d{2})(\d{2})_/);
	if (!m) return null;
	const [y, mo, d] = [2000 + Number(m[1]), Number(m[2]), Number(m[3])];
	if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
	return `${y}-${pad(mo)}-${pad(d)}`;
}

/**
 * The offer deadline in a rule document: a sentence about submitting the offer that carries a date —
 * "līdz 2026. gada 11. novembrim plkst. 12.00" or "līdz 05.11.2026. plkst. 10:00".
 */
export function deadlineIn(text: string, file: string): Deadline | null {
	const folded = fold(text);
	const res: RegExp[] = [/(lidz|ne velak ka|termins[:\s]*)\s*(\d{4})\.\s*gada\s+(\d{1,2})\.\s*(janvar|februar|mart|april|maij|junij|julij|august|septembr|oktobr|novembr|decembr)\w*(?:[^\n]{0,20}?plkst\.?\s*(\d{1,2})[.:](\d{2}))?/g, /(lidz|ne velak ka|termins[:\s]*)\s*(\d{1,2})\.(\d{1,2})\.(\d{4})\.?(?:[^\n]{0,20}?plkst\.?\s*(\d{1,2})[.:](\d{2}))?/g];
	const hits: { at: number; date: string; time: string | null }[] = [];
	for (const m of folded.matchAll(res[0])) hits.push({ at: m.index!, date: `${m[2]}-${pad(MONTHS.indexOf(m[4]) + 1)}-${pad(m[3])}`, time: m[5] ? `${pad(m[5])}:${m[6]}` : null });
	for (const m of folded.matchAll(res[1])) hits.push({ at: m.index!, date: `${m[4]}-${pad(m[3])}-${pad(m[2])}`, time: m[5] ? `${pad(m[5])}:${m[6]}` : null });
	hits.sort((a, b) => a.at - b.at);
	for (const h of hits) {
		const quote = sentenceAt(text, h.at);
		const q = fold(quote);
		if (/piedavajum/.test(q) && /iesnie/.test(q) && !/jautajum|skaidrojum|apsekos/.test(q)) return { date: h.date, time: h.time, source: "dokuments", cite: { file, quote } };
	}
	return null;
}

const RULE_DOC = /nolik|uzaicin|noteikum|pazinoj|instrukc/;
function ruleDocs(dir: string): { readable: string[]; unreadable: string[] } {
	const readable: string[] = [];
	const unreadable: string[] = [];
	const walk = (d: string, depth: number) => {
		let es;
		try {
			es = readdirSync(d, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of es) {
			const p = join(d, e.name);
			if (e.isDirectory()) {
				if (depth < 2 && !/^(iesniedzamie|piedavajum)/i.test(fold(e.name))) walk(p, depth + 1);
				continue;
			}
			if (e.name.startsWith("~$") || !RULE_DOC.test(fold(e.name) + " " + fold(d))) continue;
			const ext = extname(e.name).toLowerCase();
			if (ext === ".docx") readable.push(p);
			else if ([".doc", ".pdf"].includes(ext)) unreadable.push(p);
		}
	};
	walk(dir, 0);
	return { readable, unreadable };
}

const WORDS = (s: string) =>
	new Set(
		fold(s)
			.split(/[^a-z0-9]+/)
			.filter((w) => w.length >= 4 && !/^(2026|2025|ielas|iela|novad|pasvaldib|buvniecibas|dokumentacijas|izstrade|autoruzraudziba|projektesana|konkurs|karta|objekt|dalas|telpu|atkartot|parbuv|atjaunos)/.test(w))
			.map((w) => w.slice(0, 6)),
	);

/**
 * Candidate tracker rows for a folder: shared title words; with a deadline within three weeks of the folder date,
 * or — when the row has no date — at least two thirds of the folder's words.
 */
export function trackerCandidates(folder: string, date: string | null, rows: TrackerRow[]): { r: TrackerRow; score: number }[] {
	const fw = WORDS(folder.replace(/^\d{6}_/, "").replace(/_/g, " "));
	if (fw.size === 0) return [];
	const out: { r: TrackerRow; score: number }[] = [];
	for (const r of rows) {
		const dated = !!(date && r.deadline);
		if (dated && Math.abs(Date.parse(r.deadline!) - Date.parse(date!)) > 21 * 86_400_000) continue;
		const tw = WORDS(`${r.title} ${r.purchaser}`);
		let hit = 0;
		for (const w of fw) if (tw.has(w)) hit++;
		const score = hit / fw.size;
		// one shared word out of several ("Bauskas") is only enough when the dates also agree within three days
		const weak = hit === 1 && fw.size >= 2;
		if (weak && !(dated && Math.abs(Date.parse(r.deadline!) - Date.parse(date!)) <= 3 * 86_400_000)) continue;
		if (hit >= 1 && score >= (dated ? 0.34 : 0.67)) out.push({ r, score });
	}
	return out.sort((a, b) => b.score - a.score);
}
const asTracker = (c: { r: TrackerRow; score: number }): NonNullable<BoardRow["tracker"]> => ({ sheet: c.r.sheet, row: c.r.row, title: c.r.title, decision: c.r.decision, procedure: c.r.procedure, subject: c.r.subject, work: c.r.work, eisUrl: c.r.eisUrl, score: Math.round(c.score * 100) / 100 });

/** One tracker row per folder and one folder per row: best scores are assigned first. */
export function assignTracker(folders: { folder: string; date: string | null }[], rows: TrackerRow[]): Map<string, NonNullable<BoardRow["tracker"]>> {
	const all = folders.flatMap((f) => trackerCandidates(f.folder, f.date, rows).map((c) => ({ folder: f.folder, ...c })));
	all.sort((a, b) => b.score - a.score);
	const taken = new Set<string>();
	const out = new Map<string, NonNullable<BoardRow["tracker"]>>();
	for (const c of all) {
		const k = `${c.r.sheet}|${c.r.row}`;
		if (out.has(c.folder) || taken.has(k)) continue;
		taken.add(k);
		out.set(c.folder, asTracker(c));
	}
	return out;
}

function submissionOf(dir: string): BoardRow["submission"] {
	let files = 0;
	const builders: string[] = [];
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		if (!e.isDirectory() || !/^(iesniedzamie|piedavajum)/i.test(fold(e.name))) continue;
		const walk = (d: string, depth: number) => {
			for (const x of readdirSync(d, { withFileTypes: true })) {
				if (x.isDirectory()) {
					if (depth === 0 && isBuilderFolder(x.name)) builders.push(x.name);
					if (depth < 3) walk(join(d, x.name), depth + 1);
				} else if (!x.name.startsWith("~$")) files++;
			}
		};
		walk(join(dir, e.name), 0);
	}
	return { files, builders };
}


/** Status and next step: a person's choice wins; otherwise what the folders, the tracker and the app show. */
export function decide(r: Pick<BoardRow, "deadline" | "tracker" | "submission" | "projectId">, today: string, manual?: ManualStatus): { status: BoardStatus; statusBy: BoardRow["statusBy"]; next: string } {
	const past = r.deadline ? r.deadline.date < today : false;
	let status: BoardStatus;
	// what lies in the folder outranks a word in the tracker: a prepared pack is never "atteikts" by itself
	if (manual) status = manual.status;
	else if (past && r.submission.files > 0) status = "iesniegts";
	else if (r.projectId || r.submission.files > 0) status = "gatavo";
	else if (/neinterese|partraukt/.test(fold(r.tracker?.decision ?? ""))) status = "atteikts";
	else if (r.tracker?.decision) status = "izverte";
	else status = "jauns";
	const next: Record<BoardStatus, string> = {
		jauns: r.projectId ? "Atvērt konkursu un nolasīt prasības" : "Izlemt: liekam vai neliekam (atvērt app, lai redzētu, vai pieredze un speciālisti der)",
		izverte: r.projectId ? "Pabeigt 4. soli „Vai varam”" : "Atvērt app, lai pārbaudītu prasības pret reģistriem",
		gatavo: past ? "Termiņš pagājis — atzīmē, vai iesniegts" : r.projectId ? "Turpināt paku (Paka)" : "Pievienot app, lai sakārtotu paku un pārbaudītu",
		iesniegts: "Gaidīt rezultātu; ierakstīt to 10. solī un uzskaitē",
		atteikts: "—",
	};
	return { status, statusBy: manual ? "person" : "auto", next: next[status] };
}

export interface DiscoverOptions {
	root: string;
	projects: Project[];
	tracker: TrackerRow[];
	manual: Record<string, ManualStatus>;
	today?: Date;
	/** read deadlines from the documents (slower); false = tracker and folder name only */
	readDocs?: boolean;
	/** deadline found per folder, keyed by the rule documents' names and dates — only changed folders are re-read */
	cache?: Record<string, { sig: string; deadline: Deadline | null }>;
	onProgress?: (done: number, total: number) => void;
}

const signature = (files: string[]) =>
	files
		.map((f) => {
			try {
				return `${f}@${statSync(f).mtimeMs}`;
			} catch {
				return f;
			}
		})
		.join("|");

export async function discover(o: DiscoverOptions): Promise<BoardRow[]> {
	const today = (o.today ?? new Date()).toISOString().slice(0, 10);
	const out: BoardRow[] = [];
	let names: string[];
	try {
		names = readdirSync(o.root, { withFileTypes: true }).filter((d) => d.isDirectory() && /^\d{6}_/.test(d.name)).map((d) => d.name);
	} catch {
		return [];
	}
	const assigned = assignTracker(names.map((f) => ({ folder: f, date: folderDate(f) })), o.tracker);
	let done = 0;
	for (const folder of names.sort()) {
		// let the window breathe between folders
		await new Promise((r) => setImmediate(r));
		o.onProgress?.(done++, names.length);
		const path = join(o.root, folder);
		const date = folderDate(folder);
		const [, code = "", ...rest] = folder.split("_");
		const tracker = assigned.get(folder) ?? null;
		const found: Deadline[] = [];
		const docs = o.readDocs === false ? { readable: [] as string[], unreadable: [] as string[] } : ruleDocs(path);
		const sig = signature(docs.readable);
		const cached = o.cache?.[folder];
		if (cached && cached.sig === sig) {
			if (cached.deadline) found.push(cached.deadline);
		} else {
			let hit: Deadline | null = null;
			for (const f of docs.readable) {
				try {
					hit = deadlineIn(docxPlainText(readDocx(f)), f);
				} catch {
					docs.unreadable.push(f);
				}
				if (hit) break;
			}
			if (hit) found.push(hit);
			if (o.cache) o.cache[folder] = { sig, deadline: hit };
		}
		const row = tracker ? o.tracker.find((r) => r.sheet === tracker.sheet && r.row === tracker.row) : undefined;
		if (row?.deadline) found.push({ date: row.deadline, time: null, source: "uzskaite", cite: { file: `02_Iepirkumi_BD_jauns.xlsx › ${row.sheet} › ${row.row}. rinda`, quote: row.title } });
		if (date) found.push({ date, time: null, source: "mapes nosaukums", cite: null });
		// a later wrong date is the dangerous mistake: the earliest of the cited dates is shown, every other one is a conflict
		const cited = found.filter((d) => d.source !== "mapes nosaukums");
		const deadline = (cited.length ? cited : found).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
		const conflicts = found.filter((d) => deadline && d.date !== deadline.date).map((d) => ({ date: d.date, source: d.source }));
		const project = o.projects.find((p) => fold(p.sourceDir).startsWith(fold(path)));
		const submission = existsSync(path) && statSync(path).isDirectory() ? submissionOf(path) : { files: 0, builders: [] };
		const base = { deadline, tracker, submission, projectId: project?.id ?? null };
		const d = decide(base, today, o.manual[folder]);
		out.push({ folder, path, folderDate: date, code: /^[A-Z0-9]{2,8}$/.test(code) ? code : "", title: (/^[A-Z0-9]{2,8}$/.test(code) ? rest : [code, ...rest]).join(" ").trim(), ...base, ...d, conflicts, note: o.manual[folder]?.note ?? "", unreadable: docs.unreadable.map((f) => f.slice(path.length + 1)) });
	}
	return out.sort((a, b) => (a.deadline?.date ?? "9999").localeCompare(b.deadline?.date ?? "9999"));
}
