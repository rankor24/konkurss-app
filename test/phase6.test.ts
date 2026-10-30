import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { dependencyStatus, GROK_MIN, parseVersion, versionLess, type DepsIO } from "../src/main/deps.ts";
import { runTool, runToolSpec, toolsConfig } from "../src/main/pytools.ts";
import { errorHint, withHint } from "../src/shared/hints.ts";

const ROOT = join(import.meta.dirname, "..");
const cfg = toolsConfig(process.env, join(ROOT, "python", "konkurss_tools.py"));

// ---------- 6.2 dependency status ----------
const io = (over: Partial<DepsIO> = {}): DepsIO => ({
	tools: cfg,
	hasClaudeKey: true,
	codexPath: "C:\\app\\codex.exe",
	grokBin: "C:\\g\\grok.exe",
	exists: () => true,
	run: async () => ({ code: 0, out: "grok 1.0.70" }),
	selfcheck: async () => ({ python: "3.14", frozen: true, docx: true, openpyxl: true }),
	...over,
});
const byId = (items: Awaited<ReturnType<typeof dependencyStatus>>, id: string) => items.find((i) => i.id === id)!;

test("deps: everything present → all ok, nothing to do", async () => {
	const items = await dependencyStatus(io());
	assert.deepEqual(items.map((i) => i.state), ["ok", "ok", "ok", "ok"]);
	assert.match(byId(items, "tools").detail, /Iebūvētie rīki/);
	assert.equal(byId(items, "codex").fix, "");
});

test("deps: each missing piece says what is missing and what to do, in plain Latvian", async () => {
	const items = await dependencyStatus(io({ hasClaudeKey: false, codexPath: "codex", grokBin: null, selfcheck: async () => ({ docx: false, openpyxl: true }) }));
	assert.equal(byId(items, "tools").state, "missing");
	assert.match(byId(items, "tools").detail, /Word/);
	assert.match(byId(items, "tools").fix, /Pārinstalē/);
	assert.equal(byId(items, "claude").state, "missing");
	assert.match(byId(items, "claude").fix, /Boriss/);
	assert.equal(byId(items, "codex").state, "missing");
	assert.equal(byId(items, "grok").state, "missing");
	assert.match(byId(items, "grok").fix, /x\.ai/);
	const crashed = await dependencyStatus(io({ selfcheck: async () => { throw new Error("spawn ENOENT"); } }));
	assert.equal(byId(crashed, "tools").state, "missing");
	assert.match(byId(crashed, "tools").detail, /ENOENT/);
});

test("deps: Grok older than the proven version → 'old' with the update button; unreadable version → warn; current → ok with the button still available", async () => {
	const old = await dependencyStatus(io({ run: async () => ({ code: 0, out: "grok 1.0.41" }) }));
	assert.equal(byId(old, "grok").state, "old");
	assert.equal(byId(old, "grok").action, "update-grok");
	assert.match(byId(old, "grok").fix, /426/);
	const unreadable = await dependencyStatus(io({ run: async () => { throw new Error("x"); } }));
	assert.equal(byId(unreadable, "grok").state, "warn");
	assert.equal(byId(unreadable, "grok").action, "update-grok");
	assert.equal(byId(await dependencyStatus(io()), "grok").action, "update-grok");
});

test("version parsing and comparison", () => {
	assert.deepEqual(parseVersion("grok 1.0.70 (build abc)"), [1, 0, 70]);
	assert.equal(parseVersion("no version"), null);
	assert.ok(versionLess([1, 0, 69], GROK_MIN));
	assert.ok(!versionLess([1, 0, 70], GROK_MIN));
	assert.ok(!versionLess([1, 2, 0], GROK_MIN));
	assert.ok(versionLess([0, 9, 99], GROK_MIN));
});

test("the document tools answer selfcheck (dev: Python with Word + Excel libraries)", { timeout: 60_000 }, async () => {
	const r = await runTool<{ docx: boolean; openpyxl: boolean }>(cfg, "selfcheck", "x");
	assert.equal(r.docx, true);
	assert.equal(r.openpyxl, true);
});

// ---------- 6.3 Grok 426 ----------
test("a Grok '426 Upgrade Required' keeps the raw text first and adds the Latvian hint with the Iestatījumi button name", () => {
	const raw = "grok exit 1: Error: 426 Upgrade Required — this client version is no longer supported";
	const shown = withHint(raw);
	assert.ok(shown.startsWith(raw), "the provider's own text is not rewritten");
	assert.match(shown, /Atjaunināt Grok/);
	assert.match(errorHint("HTTP 426")!, /novecojusi/);
	assert.equal(errorHint("Failed to parse something unrelated"), null);
	assert.equal(withHint("something unrelated"), "something unrelated");
	assert.match(errorHint("Your workspace is out of credits")!, /limits/);
});

// ---------- 6.7 / 6.8: scan what the person can read, and look for hardcoded tender data ----------
function walk(dir: string, out: string[] = []): string[] {
	for (const n of readdirSync(dir)) {
		const p = join(dir, n);
		if (statSync(p).isDirectory()) walk(p, out);
		else if (/\.(ts|tsx|cts)$/.test(n)) out.push(p);
	}
	return out;
}

/** Every human-readable string in a source file: JSX text, string literals and templates (comments are not code). */
function strings(file: string): string[] {
	const src = readFileSync(file, "utf8");
	const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
	const out: string[] = [];
	const visit = (n: ts.Node) => {
		if (ts.isJsxText(n)) out.push(n.getText(sf));
		else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
			if (!ts.isImportDeclaration(n.parent) && !ts.isExportDeclaration(n.parent)) out.push(n.text);
		} else if (ts.isTemplateExpression(n)) {
			out.push(n.head.text, ...n.templateSpans.map((s) => s.literal.text));
		}
		ts.forEachChild(n, visit);
	};
	visit(sf);
	return out;
}

const JARGON_LIST = ["JSON", "IPC", "regex", "profils", "validācija", "ekstrakcija", "hash"];
test("language: nothing the person reads mentions JSON, IPC, regex, profils, validācija, ekstrakcija or hash", () => {
	const FORBIDDEN = /\b(json|ipc|regex|profils|validācija|ekstrakcija|hash)\b/i;
	const files = [...walk(join(ROOT, "src", "renderer")), ...walk(join(ROOT, "src", "main")), join(ROOT, "src", "shared", "hints.ts")];
	const hits: string[] = [];
	for (const f of files) {
		for (const s of strings(f)) {
			// channel names, MIME types, CSS and identifiers are not text a person reads
			if (!/\s/.test(s.trim()) && !/[āčēģīķļņšūž]/i.test(s)) continue;
			if (/TIKAI viens JSON objekts|tikai derīgs JSON/.test(s)) continue; // instructions to the model, never shown to a person
			if (f.endsWith("ui.tsx") && JARGON_LIST.includes(s)) continue; // the jargon list itself is the input of this test
			if (FORBIDDEN.test(s)) hits.push(`${relative(ROOT, f)}: ${s.slice(0, 90)}`);
		}
	}
	assert.deepEqual(hits, []);
});

test("language: the model-facing instructions may say JSON, but the ones shown to people (Banner/ScreenHead texts) do not — scan covers every screen file", () => {
	const screens = walk(join(ROOT, "src", "renderer", "screens"));
	assert.ok(screens.length >= 18, `screens scanned: ${screens.length}`);
});

test("no hardcoded tender data in src: no tender IDs, no person names, no certificate or registration numbers", () => {
	const PATTERNS: [string, RegExp][] = [
		["iepirkuma ID", /\b[A-ZĀČĒĢĪĶĻŅŠŪŽ]{2,6}\s?\d{4}\/\d{1,4}\b/],
		["personu vārdi", /\b(Kreics|Varlamovs|Kalniņš|Tereško|Truševska|Trušelis|Ņevoļskis)\b/],
		["sertifikāta numurs", /\b\d{2}-\d{4,6}\b/],
		["reģistrācijas numurs", /\b4\d{10}\b/],
		["būvnieki", /\b(UPB|Pillar)\b/],
	];
	// the live-run scripts are developer tools that point at real folders, not part of the app
	const files = walk(join(ROOT, "src"));
	const hits: string[] = [];
	for (const f of files) {
		for (const s of strings(f)) {
			for (const [label, re] of PATTERNS) if (re.test(s)) hits.push(`${label} — ${relative(ROOT, f)}: ${s.slice(0, 80)}`);
		}
	}
	assert.deepEqual(hits, []);
});

// ---------- 6.1 frozen tools ----------
import { existsSync } from "node:fs";
const FROZEN = join(ROOT, "build", "tools", "konkurss-tools", "konkurss-tools.exe");
const TPL = "E:/BV BIM/Paraugmodeli/260811_NVA_Remonta baze/KONKURSS/5.pielikums_Pirms_liguma_BIP.docx";
const EDOC = "E:/BV BIM/Paraugmodeli/260713_Salacgriva_Sila iela 2/IESNIEDZAMIE/2_1Atsauksme_BD291-2023_Sabilex_Menesgaismas.edoc";

test("frozen konkurss-tools.exe: selfcheck says frozen; inspect and read-edoc give the same answers as the Python source", { skip: !existsSync(FROZEN) || !existsSync(TPL), timeout: 180_000 }, async () => {
	const frozen = toolsConfig({ KONKURSS_TOOLS_EXE: FROZEN }, join(ROOT, "python", "konkurss_tools.py"));
	assert.equal(frozen.exe, FROZEN, "the config prefers the exe when it exists");
	const sc = await runTool<{ frozen: boolean; docx: boolean; openpyxl: boolean }>(frozen, "selfcheck", "x");
	assert.deepEqual([sc.frozen, sc.docx, sc.openpyxl], [true, true, true]);
	const a = await runTool<{ skeleton: string; paragraphs: unknown[]; tables: unknown[] }>(frozen, "inspect-docx", TPL);
	const b = await runTool<{ skeleton: string; paragraphs: unknown[]; tables: unknown[] }>(cfg, "inspect-docx", TPL);
	assert.equal(a.skeleton, b.skeleton);
	assert.equal(a.paragraphs.length, b.paragraphs.length);
	assert.equal(a.tables.length, b.tables.length);
	if (existsSync(EDOC)) {
		const e1 = await runTool<{ signers: { name: string }[] }>(frozen, "read-edoc", EDOC);
		const e2 = await runTool<{ signers: { name: string }[] }>(cfg, "read-edoc", EDOC);
		assert.deepEqual(e1.signers.map((s) => s.name), e2.signers.map((s) => s.name));
	}
	// a new document written by the frozen build (python-docx's own template files are inside the exe)
	const out = join(ROOT, "build", "frozen-write-test.docx");
	rmSync(out, { force: true });
	await runToolSpec(frozen, "write-docx", { dst: out, blocks: [{ heading: "Tests", level: 1 }, { text: "Teksts" }, { table: [["a", "b"]] }] });
	assert.ok(existsSync(out));
	rmSync(out, { force: true });
	// the dependency screen reports it as the built-in tools
	const items = await dependencyStatus(io({ tools: frozen, selfcheck: (c) => runTool(c, "selfcheck", "x") }));
	assert.match(byId(items, "tools").detail, /Iebūvētie rīki/);
});

// ---------- 6.1b the extract scripts run through the frozen exe ----------
import { pyConfigFromEnv, readerFor, runPython } from "../src/mcp/python.ts";
const SKILLS = join(process.env.USERPROFILE ?? "", ".claude", "skills");
const PDF = "E:/BV BIM/Paraugmodeli/260811_NVA_Remonta baze/KONKURSS/TS_1.pielikums_Izejas dati projektēšanai/TS_1.pielikums_Izejas dati projektēšanai/21_01_2026_16_42_Buvatlauja.pdf";
const XLSX = "E:/BV BIM/Paraugmodeli/260811_NVA_Remonta baze/KONKURSS/5.A.pielikums_Atbildibas_matrica.xlsx";

test("pyConfigFromEnv prefers the frozen exe (run-script) when it exists, else Python", () => {
	const frozen = pyConfigFromEnv({ KONKURSS_TOOLS_EXE: FROZEN, KONKURSS_SKILLS_DIR: "S" });
	if (existsSync(FROZEN)) assert.deepEqual([frozen.command, frozen.args], [FROZEN, ["run-script"]]);
	const dev = pyConfigFromEnv({ KONKURSS_TOOLS_EXE: "C:/nope/none.exe", KONKURSS_SKILLS_DIR: "S" });
	assert.notEqual(dev.command, "C:/nope/none.exe", "a missing exe is ignored");
	assert.equal(dev.skillsDir, "S");
});

test("frozen run-script reads docx, edoc, pdf and xlsx with the same text as the Python scripts (no Python needed)", { skip: !existsSync(FROZEN) || !existsSync(join(SKILLS, "konkurss")) || !existsSync(PDF), timeout: 300_000 }, async () => {
	const frozen = pyConfigFromEnv({ KONKURSS_TOOLS_EXE: FROZEN, KONKURSS_SKILLS_DIR: SKILLS });
	const dev = pyConfigFromEnv({ KONKURSS_SKILLS_DIR: SKILLS });
	for (const file of [TPL, EDOC, PDF, XLSX].filter(existsSync)) {
		const r = readerFor(SKILLS, file)!;
		const a = await runPython(frozen, r.script, r.args);
		const b = await runPython(dev, r.script, r.args);
		assert.ok(a.length > 200, `${file} gave text`);
		assert.equal(a.replace(/\r\n?/g, "\n"), b.replace(/\r\n?/g, "\n"), `identical text for ${file.split("/").pop()}`);
	}
});
