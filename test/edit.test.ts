import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { listOpenFields, overview, projectFor, setDeadline, setField, setRole } from "../src/mcp/edit.ts";
import { textPath } from "../src/main/extract.ts";
import { loadState, saveState } from "../src/main/project-state.ts";
import { emptyState, type FileEntry, type SheetItem } from "../src/shared/state.ts";

const tmp = mkdtempSync(join(tmpdir(), "konkurss-edit-"));
const src = join(tmp, "KONKURSS");
const out = join(tmp, "IESNIEDZAMIE");
const p = projectFor(src, out);
const KEY = "source:BIP.docx";
const PIP_TEXT = ["PIP 7.3. Garantijas laiks ir 60 mēneši no pieņemšanas akta parakstīšanas.", "Iesniegšanas termiņš ir 20.09.2026 plkst. 10:00."].join("\n");
const WORK_TEXT = "Darba piezīme: garantija 10 gadi.";

const item = (slotId: string, over: Partial<SheetItem> = {}): SheetItem => ({ slotId, kind: "section", label: slotId, heading: `A › ${slotId}`, value: "", status: "missing", cites: [], by: null, ...over });

before(() => {
	mkdirSync(src, { recursive: true });
	const s = emptyState();
	const file = (rel: string, kind: FileEntry["kind"], where: FileEntry["where"], text: string): FileEntry => {
		const f: FileEntry = { rel, root: "source", where, kind, kindSetByUser: false, size: 1, mtimeMs: 1, text: "ok" };
		mkdirSync(dirname(textPath(p, f)), { recursive: true });
		writeFileSync(textPath(p, f), text, "utf8");
		return f;
	};
	s.files = [file("PIP.docx", "pip", "konkurss", PIP_TEXT), file("piezimes.docx", "cits", "darba", WORK_TEXT)];
	s.roles = { design: [], build: { UPB: [] } };
	s.fills[KEY] = {
		template: KEY,
		skeleton: "x",
		inspectedAt: "t",
		outputs: {},
		items: [item("s:garantija"), item("s:cits"), item("s:cilveks", { value: "Cilvēka teksts", status: "manual", by: "manual" }), item("s:kods", { kind: "cell", value: "Uzņēmuma nosaukums", status: "source", by: "code" })],
	};
	saveState(out, s);
});
after(() => rmSync(tmp, { recursive: true, force: true }));

const val = (id: string) => loadState(out).fills[KEY].items.find((i) => i.slotId === id)!;

test("overview shows the form and how many fields are open; list shows only fields the agent may fill", () => {
	const o = overview(p);
	assert.ok(o.ok && o.text.includes(`${KEY} → 2 / 4`) && /Dokumenti nolasīti: 2 no 2/.test(o.text));
	const l = listOpenFields(p);
	assert.ok(l.ok);
	if (l.ok) {
		assert.match(l.text, /s:garantija/);
		assert.match(l.text, /s:cits/);
		assert.doesNotMatch(l.text, /s:cilveks|s:kods/, "a person's entry and a register value are not offered");
	}
	assert.equal(listOpenFields(p, "source:nav.docx").ok, false);
});

test("set_field: verified quote → written with its source; the state shows it as read by the app", () => {
	const r = setField(p, { template: KEY, slotId: "s:garantija", value: "Garantijas laiks — 60 mēneši no pieņemšanas akta.", quote: "Garantijas laiks ir 60 mēneši no pieņemšanas akta parakstīšanas", file: "PIP.docx" });
	assert.ok(r.ok, JSON.stringify(r));
	const i = val("s:garantija");
	assert.deepEqual([i.status, i.by, i.cites[0].file], ["source", "model", "PIP.docx"]);
	assert.match(i.value, /60 mēneši/);
});

test("set_field refuses: invented quote, a quote only found in a work file, a person's entry, a register value, an unknown field, an empty value — and changes nothing", () => {
	const snapshot = () => JSON.stringify(loadState(out).fills[KEY].items.filter((i) => i.slotId !== "s:garantija"));
	const before = snapshot();
	const bad = (a: Partial<Parameters<typeof setField>[1]>) => setField(p, { template: KEY, slotId: "s:cits", value: "x", quote: PIP_TEXT.slice(0, 40), ...a });
	const invented = bad({ quote: "Garantijas laiks ir 99 gadi" });
	assert.ok(!invented.ok && /burtiski/.test(invented.reason));
	assert.ok(!bad({ quote: "garantija 10 gadi" }).ok, "work files are not tender documents");
	const manual = bad({ slotId: "s:cilveks" });
	assert.ok(!manual.ok && /cilvēks/.test(manual.reason));
	const code = bad({ slotId: "s:kods" });
	assert.ok(!code.ok && /reģistra/.test(code.reason));
	assert.ok(!bad({ slotId: "s:nav" }).ok);
	assert.ok(!bad({ value: "  " }).ok);
	assert.ok(!bad({ template: "source:nav.docx" }).ok);
	assert.equal(snapshot(), before);
});

test("set_deadline needs the date inside the quote; set_role adds, updates, and refuses an unknown side", () => {
	assert.ok(!setDeadline(p, { date: "21.09.2026", quote: "Iesniegšanas termiņš ir 20.09.2026 plkst. 10:00" }).ok, "date not in quote");
	assert.ok(!setDeadline(p, { date: "20-09-2026", quote: "x" }).ok);
	const d = setDeadline(p, { date: "20.09.2026", time: "10:00", quote: "Iesniegšanas termiņš ir 20.09.2026 plkst. 10:00" });
	assert.ok(d.ok);
	const dl = loadState(out).deadline;
	assert.deepEqual([dl.date.value, dl.time.value, dl.source, dl.date.status], ["20.09.2026", "10:00", "nolikums", "model"]);

	assert.ok(setRole(p, { side: "design", role: "BIM koordinators", person: "Jānis Kreics", company: "SIA BŪVDIZAINS" }).ok);
	assert.ok(setRole(p, { side: "design", role: "BIM koordinators", person: "Cits Cilvēks" }).ok);
	const rows = loadState(out).roles.design;
	assert.equal(rows.length, 1, "same role and part updates the row");
	assert.deepEqual([rows[0].person, rows[0].company], ["Cits Cilvēks", "SIA BŪVDIZAINS"]);
	assert.ok(setRole(p, { side: "UPB", role: "4D speciālists", part: "", person: "P" }).ok);
	assert.ok(!setRole(p, { side: "Nezināms", role: "x" }).ok);
});

test("through the real MCP server (the way Claude, Codex and Grok call it): overview, fill with a quote, refusal with a bad one, audit trail", { timeout: 60_000 }, async () => {
	const appRoot = join(import.meta.dirname, "..");
	const audit = join(out, ".konkurss", "audit.jsonl");
	const client = new Client({ name: "t", version: "0" });
	await client.connect(
		new StdioClientTransport({
			command: process.execPath,
			args: ["--import", "tsx", join(appRoot, "src", "mcp", "server.ts")],
			cwd: appRoot,
			env: { ...(process.env as Record<string, string>), KONKURSS_READ_DIRS: src, KONKURSS_WRITE_DIR: out, KONKURSS_SKILLS_DIR: "", KONKURSS_AUDIT: audit, KONKURSS_ENGINE: "test" },
		}),
	);
	type R = { content: { text: string }[]; isError?: boolean };
	const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as R;
	const ov = await call("project_overview", {});
	assert.match(ov.content[0].text, /source:BIP\.docx/);
	const bad = await call("set_field", { template: KEY, slot_id: "s:cits", value: "x", quote: "izdomāts citāts" });
	assert.equal(bad.isError, true);
	const good = await call("set_field", { template: KEY, slot_id: "s:cits", value: "Garantijas laiks 60 mēneši.", quote: "Garantijas laiks ir 60 mēneši", file: "PIP.docx" });
	assert.ok(!good.isError, good.content[0].text);
	assert.equal(val("s:cits").by, "model");
	await client.close();
	const log = readFileSync(audit, "utf8").trim().split("\n").map((l) => JSON.parse(l));
	assert.deepEqual(log.filter((l) => l.tool === "set_field").map((l) => l.ok), [false, true], "the refusal and the write are both in the audit log");
});
