// 5. Kas ko dara: roles the tender asks for are suggested with a verified quote; the table is only ever changed by a person.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { textPath } from "../src/main/extract.ts";
import { loadState, saveState } from "../src/main/project-state.ts";
import { addSource } from "../src/main/tasks/extras.ts";
import { decideRole, groundRoles, partFrom, suggestRoles } from "../src/main/tasks/roles-run.ts";
import type { Engine, RunOptions } from "../src/main/engines/types.ts";
import { emptyState, type FileEntry, type Roles } from "../src/shared/state.ts";
import type { Project } from "../src/shared/types.ts";

const tmp = mkdtempSync(join(tmpdir(), "konkurss-roles-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const py = { command: "py", args: [], skillsDir: tmp };

const PIP =
	"5.3. Pretendents nodrošina Projekta informācijas vadītāju / BIM koordinatoru un VDV pārvaldnieku visā projektēšanas laikā.\n" +
	"5.4. BIM modeļa autori tiek norīkoti pa būvprojekta daļām: AR, BK, ŪKT un EL.\n" +
	"5.5. Būvdarbu laikā būvnieks nodrošina 4D speciālistu un tāmētāju.\n" +
	"5.6. Dalībnieki: VDV pārvaldnieks | SIA Digitālā Vide | Jānis Bērziņš; BIM modeļa autors | SIA Modelis | Anna Ozola; BIM modeļa autors | SIA Modelis | Pēteris Liepa.";

function setup(name: string, roles?: Roles) {
	const out = join(tmp, name, "IESNIEDZAMIE");
	mkdirSync(out, { recursive: true });
	const project: Project = { id: name, name, sourceDir: join(tmp, name, "K"), outputDir: out, variant: "V2", builders: ["Pillar", "UPB"], createdAt: "" };
	const f: FileEntry = { rel: "PIP.docx", root: "source", where: "konkurss", kind: "pip", kindSetByUser: false, size: 1, mtimeMs: 1, text: "ok" };
	mkdirSync(join(textPath(project, f), ".."), { recursive: true });
	writeFileSync(textPath(project, f), PIP, "utf8");
	const s = emptyState();
	s.files = [f];
	if (roles) s.roles = roles;
	saveState(out, s);
	return project;
}

const reply = (items: object[]) => ({
	items: items.map((i) => ({ part: null, side: "nav_skaidrs", file: "PIP.docx", ...i })),
});
const engineWith = (data: unknown, seen: { prompt: string } = { prompt: "" }): Engine => ({
	id: "claude",
	status: async () => ({ id: "claude", ready: true, reason: "", canLogin: false }),
	async run(o: RunOptions) {
		seen.prompt = o.prompt;
		const text = JSON.stringify(data);
		o.onEvent({ type: "text", text });
		o.onEvent({ type: "done", text });
	},
});
const base = { runDir: tmp, pluginDir: tmp, mcp: { command: "x", args: [], env: {} }, signal: new AbortController().signal };

test("part codes are kept only when they are capital codes that stand in the quote itself", () => {
	const q = "BIM modeļa autori tiek norīkoti pa būvprojekta daļām: AR, BK, ŪKT un EL.";
	assert.equal(partFrom("AR, BK, ŪKT", q), "AR, BK, ŪKT");
	assert.equal(partFrom("AR, VK", q), "", "VK is not in the quote — all codes are dropped, none invented");
	assert.equal(partFrom("arhitektūra", q), "", "words are not codes");
	assert.equal(partFrom(null, q), "");
	assert.equal(partFrom("A", "ABC un tikai tā"), "", "a letter inside another word is not the code");
});

test("roles: a quote that is not in the documents is rejected; the same role twice counts once; the table's roles are not offered again", () => {
	const docs = [{ file: "PIP.docx", text: PIP }];
	const roles: Roles = { design: [{ id: "1", role: "VDV pārvaldnieks", part: "BIM", company: "", person: "Boriss Varlamovs" }], build: {} };
	const g = groundRoles(
		reply([
			{ role: "Projekta informācijas vadītājs / BIM koordinators", side: "projektesana", quote: "Pretendents nodrošina Projekta informācijas vadītāju / BIM koordinatoru" },
			{ role: "VDV pārvaldnieks", side: "projektesana", quote: "un VDV pārvaldnieku visā projektēšanas laikā" },
			{ role: "BIM modeļa autors", part: "AR, BK, ŪKT, EL", side: "projektesana", quote: "BIM modeļa autori tiek norīkoti pa būvprojekta daļām: AR, BK, ŪKT un EL" },
			{ role: "BIM modeļa autors", side: "projektesana", quote: "BIM modeļa autori tiek norīkoti pa būvprojekta daļām" },
			{ role: "Drona pilots", side: "buvdarbi", quote: "Būvnieks nodrošina drona pilotu visā būvniecības laikā" },
		]),
		docs,
		roles,
	);
	assert.deepEqual(g.items.map((i) => i.role), ["Projekta informācijas vadītājs / BIM koordinators", "BIM modeļa autors"]);
	assert.equal(g.items[1].part, "AR, BK, ŪKT, EL", "every code the model lists stands in the quote");
	assert.equal(g.already, 1, "VDV pārvaldnieks is already in the table, so it is not offered again");
	assert.equal(g.rejected, 1, "the drone pilot has no quote in the text");
	assert.ok(g.items.every((i) => i.cite.file === "PIP.docx" && !i.decision));
	assert.equal(JSON.stringify(g.items).includes("Varlamov"), false, "a person who is only in the table is never copied into a suggestion");
});

test("reading again keeps a role dismissed earlier dismissed, with the same id", async () => {
	const p = setup("r1");
	const data = reply([
		{ role: "4D speciālists", side: "buvdarbi", quote: "būvnieks nodrošina 4D speciālistu un tāmētāju" },
		{ role: "Tāmētājs", side: "buvdarbi", quote: "4D speciālistu un tāmētāju" },
	]);
	const r1 = await suggestRoles(p, engineWith(data), base);
	assert.ok(r1.ok && r1.added === 2);
	const first = loadState(p.outputDir).rolePicks!.items;
	decideRole(p, first[0].id, "rejected");
	decideRole(p, first[1].id, "added");
	const r2 = await suggestRoles(p, engineWith(data), base);
	assert.ok(r2.ok);
	const again = loadState(p.outputDir).rolePicks!.items;
	assert.equal(again.find((i) => i.role === "4D speciālists")!.decision, "rejected", "a dismissed role stays dismissed");
	assert.equal(again.find((i) => i.role === "4D speciālists")!.id, first[0].id);
	assert.equal(again.find((i) => i.role === "Tāmētājs")!.decision, null, "a role that was copied but is no longer in the table can be offered again");
});

test("the task never touches the roles table and refuses without documents", async () => {
	const p = setup("r2");
	const before = JSON.stringify(loadState(p.outputDir).roles);
	const r = await suggestRoles(p, engineWith(reply([{ role: "4D speciālists", side: "buvdarbi", quote: "būvnieks nodrošina 4D speciālistu" }])), base);
	assert.ok(r.ok);
	assert.equal(JSON.stringify(loadState(p.outputDir).roles), before);

	const empty = join(tmp, "r3", "IESNIEDZAMIE");
	mkdirSync(empty, { recursive: true });
	saveState(empty, emptyState());
	const none = await suggestRoles({ id: "r3", name: "r3", sourceDir: "", outputDir: empty, variant: "V2", builders: [], createdAt: "" }, engineWith({ items: [] }), base);
	assert.ok(!none.ok && /Nav nolasītu konkursa dokumentu/.test(none.error));
});

test("a role found only in the page's own source is cited from that file, and the person's note reaches the agent", async () => {
	const p = setup("r4");
	const list = join(tmp, "r4", "ext", "Kolegu_lomas.txt");
	mkdirSync(join(list, ".."), { recursive: true });
	writeFileSync(list, "Iepriekšējā projektā papildus bija nepieciešams lāzerskenēšanas speciālists mākoņpunktu iegūšanai un apstrādei.", "utf8");
	await addSource(p, py, "kas", list, "kolēģa lomu saraksts no līdzīga projekta");
	const seen = { prompt: "" };
	const r = await suggestRoles(
		p,
		engineWith(reply([{ role: "Lāzerskenēšanas speciālists", side: "nav_skaidrs", quote: "bija nepieciešams lāzerskenēšanas speciālists mākoņpunktu iegūšanai", file: "PAPILDU: Kolegu_lomas.txt" }]), seen),
		base,
	);
	assert.ok(r.ok && r.added === 1);
	assert.match(seen.prompt, /kolēģa lomu saraksts no līdzīga projekta/);
	assert.equal(loadState(p.outputDir).rolePicks!.items[0].cite.file, "PAPILDU: Kolegu_lomas.txt");
});

test("a company and a person are offered only when the document names them: in the quote, per person, and not twice", () => {
	const docs = [{ file: "PIP.docx", text: PIP }];
	const row = "VDV pārvaldnieks | SIA Digitālā Vide | Jānis Bērziņš";
	const authors = "BIM modeļa autors | SIA Modelis | Anna Ozola; BIM modeļa autors | SIA Modelis | Pēteris Liepa";
	const empty: Roles = { design: [], build: {} };
	const g = groundRoles(
		reply([
			{ role: "VDV pārvaldnieks", company: "SIA Digitālā Vide", person: "Jānis Bērziņš", side: "projektesana", quote: row },
			{ role: "BIM modeļa autors", company: "SIA Modelis", person: "Anna Ozola", side: "projektesana", quote: authors },
			{ role: "BIM modeļa autors", company: "SIA Modelis", person: "Pēteris Liepa", side: "projektesana", quote: authors },
			{ role: "BIM modeļa autors", company: "SIA Modelis", person: "Pēteris Liepa", side: "projektesana", quote: authors },
			{ role: "Tāmētājs", company: "SIA Izdomātā", person: "Juris Izdomātais", side: "buvdarbi", quote: "Būvdarbu laikā būvnieks nodrošina 4D speciālistu un tāmētāju" },
		]),
		docs,
		empty,
	);
	assert.deepEqual(
		g.items.map((i) => [i.role, i.company, i.person]),
		[
			["VDV pārvaldnieks", "SIA Digitālā Vide", "Jānis Bērziņš"],
			["BIM modeļa autors", "SIA Modelis", "Anna Ozola"],
			["BIM modeļa autors", "SIA Modelis", "Pēteris Liepa"],
			["Tāmētājs", "", ""],
		],
		"two authors are two entries, a repeat is dropped, and names that are not in the quote are left out while the role stays",
	);

	const inTable: Roles = { design: [{ id: "1", role: "BIM modeļa autors", part: "AR", company: "SIA Modelis", person: "Anna Ozola" }], build: {} };
	const g2 = groundRoles(reply([{ role: "BIM modeļa autors", company: "SIA Modelis", person: "Anna Ozola", side: "projektesana", quote: authors }, { role: "BIM modeļa autors", company: "SIA Modelis", person: "Pēteris Liepa", side: "projektesana", quote: authors }]), docs, inTable);
	assert.deepEqual(g2.items.map((i) => i.person), ["Pēteris Liepa"], "the person already in the table is not offered again, the other one is");
	assert.equal(g2.already, 1);
});

test("the names reach the table row only through the stored suggestion", async () => {
	const p = setup("r5");
	const r = await suggestRoles(p, engineWith(reply([{ role: "VDV pārvaldnieks", company: "SIA Digitālā Vide", person: "Jānis Bērziņš", side: "projektesana", quote: "VDV pārvaldnieks | SIA Digitālā Vide | Jānis Bērziņš" }])), base);
	assert.ok(r.ok);
	const [s] = loadState(p.outputDir).rolePicks!.items;
	assert.deepEqual([s.company, s.person], ["SIA Digitālā Vide", "Jānis Bērziņš"]);
	assert.deepEqual(loadState(p.outputDir).roles.design, [], "the table itself is untouched");
});
