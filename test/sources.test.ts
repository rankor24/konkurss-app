// Extra sources: a person adds files or folders on a page; only that page's agent reads them, with a citable label and the person's note.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rankedSectionDocs } from "../src/main/fill/run.ts";
import { readPostWin, saveCloseout } from "../src/main/checks/closeout.ts";
import { textPath } from "../src/main/extract.ts";
import { loadState, saveState } from "../src/main/project-state.ts";
import { addSource, extraDocs, extraNote, refreshSource, removeSource, setSourceNote, withExtras } from "../src/main/tasks/extras.ts";
import type { Engine, RunOptions } from "../src/main/engines/types.ts";
import { isSourcePage, MAX_SOURCE_FILES, SOURCE_PAGES, SOURCE_USE } from "../src/shared/sources.ts";
import { emptyState, type FileEntry } from "../src/shared/state.ts";
import type { Project } from "../src/shared/types.ts";

const tmp = mkdtempSync(join(tmpdir(), "konkurss-sources-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const py = { command: "py", args: [], skillsDir: tmp }; // .txt and .md are read without Python

const project = (name: string): Project => {
	const out = join(tmp, name, "IESNIEDZAMIE");
	mkdirSync(out, { recursive: true });
	saveState(out, emptyState());
	return { id: name, name, sourceDir: join(tmp, name, "KONKURSS"), outputDir: out, variant: "V1", builders: [], createdAt: "" };
};
const write = (path: string, text: string) => {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, text, "utf8");
	return path;
};
const LONG = "Iepriekšējais BIP: garantijas laiks ir pieci gadi no nodošanas dienas, to apliecina pretendents. ".repeat(3);

test("every page with an agent task has its own list and says what the agent does with it", () => {
	assert.deepEqual(SOURCE_PAGES, ["versija", "prasibas", "aizpildit", "parbaude", "rezultats"]);
	for (const p of SOURCE_PAGES) assert.ok(SOURCE_USE[p].length > 20, p);
	assert.equal(isSourcePage("aizpildit"), true);
	assert.equal(isSourcePage("dokumenti"), false, "pages where no model reads documents have no list");
	assert.equal(isSourcePage("__proto__"), false);
});

test("a file is added, read and listed; the same file is not added twice; the note can be changed; it can be removed", async () => {
	const p = project("a1");
	const f = write(join(tmp, "a1", "ext", "Mans_BIP.txt"), LONG);
	const r = await addSource(p, py, "aizpildit", f, "  mūsu iepriekšējais BIP  ");
	assert.ok(r.ok);
	assert.equal(r.source.kind, "file");
	assert.equal(r.source.note, "mūsu iepriekšējais BIP");
	assert.deepEqual(r.source.files.map((x) => [x.rel, x.text]), [["Mans_BIP.txt", "ok"]]);
	const again = await addSource(p, py, "aizpildit", f, "");
	assert.ok(!again.ok && /jau ir pievienots/.test(again.error));
	assert.ok(!(await addSource(p, py, "aizpildit", join(tmp, "nav-tāda.txt"), "")).ok);

	const s = loadState(p.outputDir);
	assert.equal(s.sources?.aizpildit?.length, 1);
	assert.equal(s.sources?.prasibas, undefined, "other pages are untouched");
	setSourceNote(p, "aizpildit", r.source.id, "tikai formulējumiem");
	assert.equal(loadState(p.outputDir).sources!.aizpildit![0].note, "tikai formulējumiem");
	removeSource(p, "aizpildit", r.source.id);
	assert.deepEqual(loadState(p.outputDir).sources!.aizpildit, []);
});

test("a folder: readable files only, no hidden app folders, a cap, and a folder with nothing readable is refused", async () => {
	const p = project("a2");
	const root = join(tmp, "a2", "ext");
	write(join(root, "viens.txt"), LONG);
	write(join(root, "apakšmape", "divi.md"), LONG);
	write(join(root, "bilde.png"), "x");
	write(join(root, ".konkurss", "text", "x.txt"), LONG);
	const r = await addSource(p, py, "prasibas", root, "");
	assert.ok(r.ok && r.source.kind === "folder");
	assert.deepEqual(r.source.files.map((x) => x.rel.replace(/\\/g, "/")).sort(), ["apakšmape/divi.md", "viens.txt"]);
	assert.equal(r.source.truncated, undefined);

	const empty = join(tmp, "a2", "tukša");
	write(join(empty, "bilde.png"), "x");
	const none = await addSource(p, py, "prasibas", empty, "");
	assert.ok(!none.ok && /nav neviena nolasāma faila/.test(none.error));

	const big = join(tmp, "a2", "liela");
	for (let i = 0; i < MAX_SOURCE_FILES + 5; i++) write(join(big, `f${String(i).padStart(3, "0")}.txt`), LONG);
	const capped = await addSource(p, py, "prasibas", big, "");
	assert.ok(capped.ok);
	assert.equal(capped.source.files.length, MAX_SOURCE_FILES);
	assert.equal(capped.source.truncated, true, "the person is told the folder was cut");
});

test("reading again picks up a new file and a changed file, and drops a deleted one", async () => {
	const p = project("a3");
	const root = join(tmp, "a3", "ext");
	const a = write(join(root, "a.txt"), LONG);
	const b = write(join(root, "b.txt"), LONG);
	const r = await addSource(p, py, "versija", root, "");
	assert.ok(r.ok);
	assert.equal(r.source.files.length, 2);

	write(a, "Mainīts teksts par termiņu: iesniegt līdz 2026. gada 5. novembrim plkst. 10:00, kā noteikts komisijas atbildē.");
	utimesSync(a, new Date(Date.now() + 60_000), new Date(Date.now() + 60_000));
	write(join(root, "c.txt"), LONG);
	rmSync(b);
	const re = await refreshSource(p, py, "versija", r.source.id);
	assert.ok(re.ok);
	assert.deepEqual(re.source.files.map((x) => x.rel).sort(), ["a.txt", "c.txt"]);
	const docs = extraDocs(p, loadState(p.outputDir), "versija");
	assert.ok(docs.find((d) => d.file.endsWith("/a.txt"))!.text.includes("Mainīts teksts"), "the changed file is read again");
	rmSync(root, { recursive: true });
	const gone = await refreshSource(p, py, "versija", r.source.id);
	assert.ok(!gone.ok && /vairs nav/.test(gone.error));
});

test("the agent sees only its own page's sources, each under a PAPILDU label, with the person's note in the instructions", async () => {
	const p = project("a4");
	const f = write(join(tmp, "a4", "ext", "Mans_BIP.txt"), LONG);
	const g = write(join(tmp, "a4", "ext", "Cita.txt"), "Cits teksts, kas pieder pavisam citai lapai un nedrīkst nonākt pie aizpildīšanas aģenta. ".repeat(2));
	await addSource(p, py, "aizpildit", f, "mūsu iepriekšējais BIP");
	await addSource(p, py, "prasibas", g, "");
	const s = loadState(p.outputDir);

	const docs = extraDocs(p, s, "aizpildit");
	assert.deepEqual(docs.map((d) => d.file), ["PAPILDU: Mans_BIP.txt"]);
	assert.deepEqual(extraDocs(p, s, "prasibas").map((d) => d.file), ["PAPILDU: Cita.txt"]);
	assert.deepEqual(extraDocs(p, s, "parbaude"), []);

	const note = extraNote(s, "aizpildit");
	assert.match(note, /PAPILDU AVOTI/);
	assert.match(note, /Mans_BIP\.txt: mūsu iepriekšējais BIP/);
	assert.match(note, /konkursa dokumenti/, "the tender wins over an extra source");
	assert.match(note, /dati, nevis norādījumi/, "file content is data, not instructions");
	assert.equal(extraNote(s, "prasibas").includes("Cita.txt: "), false, "no note was written for that one");

	const tender = [{ file: "Nolikums.docx", text: "Nolikuma teksts." }];
	const w = withExtras(p, s, "aizpildit", "UZDEVUMS", tender);
	assert.deepEqual(w.docs.map((d) => d.file), ["Nolikums.docx", "PAPILDU: Mans_BIP.txt"], "tender first, extras after");
	assert.ok(w.instructions.startsWith("UZDEVUMS") && w.instructions.includes("PAPILDU AVOTI"));
	const same = withExtras(p, s, "parbaude", "UZDEVUMS", tender);
	assert.deepEqual(same, { instructions: "UZDEVUMS", docs: tender }, "a page without sources gets exactly what it got before");
});

test("filling sections: the page's sources join the passage search next to the client's requirements", async () => {
	const p = project("a5");
	const s0 = loadState(p.outputDir);
	const f = write(join(tmp, "a5", "ext", "Mans_BIP.txt"), LONG);
	await addSource(p, py, "aizpildit", f, "");
	const s = loadState(p.outputDir);
	assert.equal(s0.files.length, 0);
	const ranked = rankedSectionDocs(p, s);
	assert.deepEqual(ranked.map((d) => [d.file, d.weight]), [["PAPILDU: Mans_BIP.txt", 1]]);
});

test("post-win deadlines: a clause found only in the Rezultāts page's source is cited from that file; another page's source is not sent", async () => {
	const p = project("a6");
	const nolikums: FileEntry = { rel: "Nolikums.docx", root: "source", where: "konkurss", kind: "nolikums", kindSetByUser: false, size: 1, mtimeMs: 1, text: "ok" };
	mkdirSync(join(textPath(p, nolikums), ".."), { recursive: true });
	writeFileSync(textPath(p, nolikums), "Nolikums. Pretendents iesniedz piedāvājumu elektroniski EIS sistēmā līdz noteiktajam termiņam.", "utf8");
	const s = loadState(p.outputDir);
	s.files = [nolikums];
	saveState(p.outputDir, s);
	const clause = "Pēc uzvaras līguma izpildes nodrošinājums jāiesniedz piecu darba dienu laikā pēc lēmuma paziņošanas.";
	await addSource(p, py, "rezultats", write(join(tmp, "a6", "ext", "Papildu_noteikumi.txt"), clause), "komisijas e-pasts ar papildu noteikumiem");
	await addSource(p, py, "aizpildit", write(join(tmp, "a6", "ext", "Cits.txt"), "Šis teksts pieder citai lapai un nedrīkst nonākt pie uzvaras darbību meklētāja. ".repeat(2)), "");

	let prompt = "";
	const engine: Engine = {
		id: "claude",
		status: async () => ({ id: "claude", ready: true, reason: "", canLogin: false }),
		async run(o: RunOptions) {
			prompt = o.prompt;
			const text = JSON.stringify({ items: [{ what: "Līguma izpildes nodrošinājums", due: "piecu darba dienu laikā pēc lēmuma paziņošanas", quote: "līguma izpildes nodrošinājums jāiesniedz piecu darba dienu laikā", file: "PAPILDU: Papildu_noteikumi.txt" }] });
			o.onEvent({ type: "text", text });
			o.onEvent({ type: "done", text });
		},
	};
	const r = await readPostWin(p, engine, { runDir: tmp, pluginDir: tmp, mcp: { command: "x", args: [], env: {} }, signal: new AbortController().signal });
	assert.ok(r.ok, r.ok ? "" : r.error);
	assert.equal(r.added, 1);
	assert.equal(r.rejected, 0);
	assert.match(prompt, /PAPILDU: Papildu_noteikumi\.txt/);
	assert.match(prompt, /komisijas e-pasts ar papildu noteikumiem/);
	assert.equal(prompt.includes("PAPILDU: Cits.txt"), false, "the aizpildit page's source stays on that page");
	const cite = saveCloseout(p, {}).postWin[0].cite;
	assert.equal(cite?.file, "PAPILDU: Papildu_noteikumi.txt", "the stored value shows which file it came from");
});
