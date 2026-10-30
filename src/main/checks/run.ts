// 8. Pārbaude orchestration: gather what we produced, run the exact rules, store the result.
// Nothing here changes a document — it only reads and reports.
import { existsSync } from "node:fs";
import { basename, extname } from "node:path";
import type { CheckRun, Finding } from "../../shared/checks.js";
import type { DocKind, ProjectState } from "../../shared/state.js";
import type { Project } from "../../shared/types.js";
import type { LeakReport } from "../../shared/leaks.js";
import type { Registers } from "../../shared/registers.js";
import { checkDocument, foreignTerms, otherBuilderTerms } from "../fill/leaks.js";
import type { MatricaState } from "../fill/run.js";
import { loadState, updateState } from "../project-state.js";
import { inspectDocx, inspectXlsx, type ToolsConfig } from "../pytools.js";
import { runRules, summary, type CheckInput, type MatrixDoc, type OutDoc } from "./rules.js";

const KIND_OF: Partial<Record<DocKind, OutDoc["kind"]>> = { bip_veidne: "bip", matrica: "matrica", pieteikums: "form", kvalifikacija: "form", finansu: "form", apliecinajums: "form", vertesanas_veidlapa: "form", tehniskais_piedavajums: "tech" };

export interface CheckDeps {
	project: Project;
	tools: ToolsConfig;
	registers: Registers;
	otherProjects: Project[];
	extraForeign: string[];
	today?: Date;
}

async function readDoc(tools: ToolsConfig, file: string, label: string, builder: string, kind: OutDoc["kind"]): Promise<OutDoc | null> {
	if (!existsSync(file) || extname(file).toLowerCase() !== ".docx") return null;
	const i = await inspectDocx(tools, file);
	const tables = i.tables.map((t) => t.cells);
	const text = [...i.paragraphs.map((p) => p.text), ...tables.flatMap((t) => t.flatMap((r) => r))].join("\n");
	return { file, label, builder, kind, text, paragraphs: i.paragraphs.map((p) => ({ text: p.text, italic: p.italic })), tables };
}

/** Every output file we wrote, newest version per builder, with what kind of document it is. */
export function outputFiles(state: ProjectState): { file: string; label: string; builder: string; kind: OutDoc["kind"] }[] {
	const out: { file: string; label: string; builder: string; kind: OutDoc["kind"] }[] = [];
	for (const [key, sheet] of Object.entries(state.fills)) {
		const entry = state.files.find((f) => `${f.root}:${f.rel}` === key);
		const kind = (entry && KIND_OF[entry.kind]) || "other";
		for (const [builder, file] of Object.entries(sheet.outputs)) out.push({ file, label: basename(file, extname(file)), builder, kind });
	}
	if (state.tech?.output) out.push({ file: state.tech.output, label: basename(state.tech.output, extname(state.tech.output)), builder: "", kind: "tech" });
	return out;
}

export async function gather(d: CheckDeps): Promise<{ input: CheckInput; unreadable: string[] }> {
	const state = loadState(d.project.outputDir);
	const docs: OutDoc[] = [];
	const unreadable: string[] = [];
	const leaks: Record<string, LeakReport> = {};
	for (const o of outputFiles(state)) {
		const doc = await readDoc(d.tools, o.file, o.label, o.builder, o.kind).catch(() => null);
		if (doc) docs.push(doc);
		else if (existsSync(o.file) && extname(o.file).toLowerCase() === ".docx") unreadable.push(o.label);
		else if (!existsSync(o.file)) unreadable.push(`${o.label} (fails vairs nav atrodams)`);
	}
	const matrices: MatrixDoc[] = [];
	const ms = state.matrica as MatricaState | undefined;
	for (const [builder, file] of Object.entries(ms?.outputs ?? {})) {
		if (!existsSync(file)) {
			unreadable.push(`${basename(file)} (fails vairs nav atrodams)`);
			continue;
		}
		const x = await inspectXlsx(d.tools, file).catch(() => null);
		const sheet = x?.sheets.find((s) => Object.keys(s.cells).length > 0);
		if (x && sheet) {
			matrices.push({ file, builder, sheet: x.sheets.find((s) => /matric|atbild/i.test(s.name)) ?? sheet });
			docs.push({ file, label: basename(file, extname(file)), builder, kind: "matrica", text: Object.values(sheet.cells).join("\n"), paragraphs: [], tables: [] });
		}
	}
	for (const doc of docs) {
		const terms = [...foreignTerms({ project: d.project, state }, d.otherProjects, d.extraForeign), ...(doc.builder ? otherBuilderTerms(state, d.project.builders, doc.builder) : [])];
		leaks[doc.file] = await checkDocument(d.tools, doc.file, terms).catch(() => ({ clean: false, foreign: [], notes: [], unreadable: [doc.file] }) as unknown as LeakReport);
	}
	return {
		input: {
			state,
			registers: d.registers,
			builders: d.project.builders,
			docs,
			matrices,
			leaks,
			projectCode: (state.projectCode as string | null | undefined) ?? null,
			pipLod: ms?.lod ?? [],
			today: d.today ?? new Date(),
		},
		unreadable,
	};
}

export async function runChecks(d: CheckDeps): Promise<CheckRun & { unreadable: string[]; summary: ReturnType<typeof summary> }> {
	const { input, unreadable } = await gather(d);
	let findings: Finding[] = runRules(input);
	// substance findings from an earlier run stay until they are re-run (they cost a model call)
	const prev = (input.state.checks as CheckRun | undefined)?.findings.filter((f) => f.kind === "satura") ?? [];
	findings = [...findings, ...prev];
	if (unreadable.length) findings.unshift({ id: "unreadable", kind: "precīza", status: "fail", title: "Daži dokumenti nav nolasāmi", detail: `${unreadable.join("; ")}. Pārbaude nevar apgalvot, ka tajos viss kārtībā — atver un pārbaudi ar aci vai izveido no jauna.`, where: unreadable, step: "aizpildit" });
	const run: CheckRun = { ranAt: new Date().toISOString(), findings };
	updateState(d.project.outputDir, (s) => void (s.checks = run));
	return { ...run, unreadable, summary: summary(findings) };
}

export function setProjectCode(p: Project, code: string | null): void {
	updateState(p.outputDir, (s) => void (s.projectCode = code && code.trim() ? code.trim().toUpperCase() : null));
}
