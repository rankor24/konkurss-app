// 9. Paraksti — who must sign what, and who actually signed (read from the .edoc, never guessed).
// Company documents are signed inside EIS by the authorised user, so they have no .edoc to read.
// Scoring forms and specialist/subcontractor statements are signed outside with eParaksts and uploaded.
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { SignatureRow, SignatureVerdict } from "../../shared/checks.js";
import type { DocKind, ProjectState } from "../../shared/state.js";
import type { Project } from "../../shared/types.js";
import type { Registers } from "../../shared/registers.js";
import { readEdoc, type ToolsConfig } from "../pytools.js";
import { loadState, updateState } from "../project-state.js";

type Rule = { via: SignatureRow["via"]; role: string };
/** by document kind; kinds not listed here are not signed separately */
export const SIGN_RULES: Partial<Record<DocKind, Rule>> = {
	pieteikums: { via: "EIS", role: "Pretendenta paraksttiesīgā persona" },
	apliecinajums: { via: "EIS", role: "Pretendenta paraksttiesīgā persona" },
	kvalifikacija: { via: "EIS", role: "Pretendenta paraksttiesīgā persona" },
	finansu: { via: "EIS", role: "Pretendenta paraksttiesīgā persona" },
	tehniskais_piedavajums: { via: "EIS", role: "Pretendenta paraksttiesīgā persona" },
	vertesanas_veidlapa: { via: "eParaksts", role: "Būvprojekta vadītājs" },
};

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const tokens = (s: string) => norm(s).split(" ").filter((t) => t.length >= 2);

/** Same person regardless of order („KALNIŅŠ JĀNIS" = „Jānis Kalniņš"). Every expected word must be present. */
export function sameName(expected: string, actual: string): boolean {
	const e = tokens(expected);
	const a = new Set(tokens(actual));
	return e.length > 0 && e.every((t) => a.has(t));
}

export function companySigner(reg: Registers): string | null {
	const p = reg.company.persons.find((x) => /parakst|valdes loc|pārstāv/i.test(x.role)) ?? reg.company.persons[0];
	return p?.person?.trim() || null;
}

export function bpvName(state: ProjectState, reg: Registers): string | null {
	const idx = state.requirements.specialisti.findIndex((x) => /b[uū]vprojekta vad[iī]t[aā]j/i.test(x.field.value ?? ""));
	const id = idx >= 0 ? state.choices.specialists[String(idx)] : undefined;
	return reg.specialists.find((x) => x.id === id)?.name ?? null;
}

export function verdict(row: SignatureRow): SignatureVerdict {
	if (row.via === "EIS") return "eis";
	if (row.manual) return row.manual.name && row.expected.name && sameName(row.expected.name, row.manual.name) ? "manual" : "wrong";
	if (!row.file) return "unsigned";
	if (row.actual.length === 0) return "unread";
	if (!row.expected.name) return "unread";
	return row.actual.some((a) => sameName(row.expected.name!, a.name)) ? "ok" : "wrong";
}

function findEdocs(dir: string, out: string[] = []): string[] {
	if (!existsSync(dir)) return out;
	for (const n of readdirSync(dir)) {
		if (n === ".konkurss") continue;
		const p = join(dir, n);
		if (statSync(p).isDirectory()) findEdocs(p, out);
		else if (extname(n).toLowerCase() === ".edoc") out.push(p);
	}
	return out;
}

/** Best .edoc for a template: its file name starts with the template's name (a version suffix is fine). */
export function matchEdoc(templateRel: string, edocs: string[]): string | null {
	const stem = norm(basename(templateRel, extname(templateRel)));
	if (!stem) return null;
	const hits = edocs.filter((e) => norm(basename(e, extname(e))).startsWith(stem));
	return hits.sort().at(-1) ?? null;
}

export interface SignaturesStored {
	files: Record<string, string | null>;
	manual: Record<string, { name: string; at: string }>;
}

export async function buildRows(project: Project, tools: ToolsConfig, reg: Registers): Promise<SignatureRow[]> {
	const state = loadState(project.outputDir);
	const stored = (state.signatures as SignaturesStored | undefined) ?? { files: {}, manual: {} };
	const edocs = findEdocs(project.outputDir);
	const rows: SignatureRow[] = [];
	for (const f of state.files) {
		const rule = SIGN_RULES[f.kind];
		if (!rule || f.root !== "source" || f.where === "darba" || !f.rel.toLowerCase().endsWith(".docx")) continue;
		const id = `${f.root}:${f.rel}`;
		const name = rule.via === "EIS" ? companySigner(reg) : bpvName(state, reg);
		const file = rule.via === "EIS" ? null : (stored.files[id] ?? matchEdoc(f.rel, edocs));
		let actual: SignatureRow["actual"] = [];
		if (file && existsSync(file)) {
			try {
				actual = (await readEdoc(tools, file)).signers.map((s) => ({ name: s.name, time: s.time }));
			} catch {
				actual = [];
			}
		}
		rows.push({ id, label: basename(f.rel, extname(f.rel)), via: rule.via, expected: { role: rule.role, name }, file, actual, manual: stored.manual[id] ?? null });
	}
	return rows;
}

export function saveSignature(project: Project, id: string, change: { file?: string | null; manual?: { name: string; at: string } | null }): void {
	updateState(project.outputDir, (s) => {
		const cur = (s.signatures as SignaturesStored | undefined) ?? { files: {}, manual: {} };
		if (change.file !== undefined) cur.files[id] = change.file;
		if (change.manual !== undefined) {
			if (change.manual === null) delete cur.manual[id];
			else cur.manual[id] = change.manual;
		}
		s.signatures = cur;
	});
}
