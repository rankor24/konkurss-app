# Implementation checklist

Every task from PLAN.md (v2) and the v1 screen spec it inherits (`docs/plan-v1-electron-pi-2026-08.md` §III–§V).
A task is ✅ only with **evidence**: a test name, a command output, or a file:line. "Looks done" is not evidence.
Status: ✅ done+verified · 🟡 done, not verifiable here (reason given) · ⬜ open.

Rule (Boris, 2026-10-30): phases in sequence, no task skipped, commit after each phase, final audit re-checks every row.

## Phase 0 — spike

| ID | Task | Acceptance | Status | Evidence |
|---|---|---|---|---|
| 0.1 | Electron shell + preload bridge | typecheck clean, packaged exe built | ✅ | `npm run typecheck`; `release\win-unpacked\Konkursu App.exe` |
| 0.2 | konkurss-tools MCP server (4 tools) | listed over MCP | ✅ | test `exposes exactly the four konkurss tools` |
| 0.3 | Path guard: read only tender folders, write only output, never source, never .edoc | guard + server tests | ✅ | `test/guard.test.ts`, `test/mcp.test.ts` |
| 0.4 | Backup before overwrite, audit log | tests | ✅ | `overwriting keeps a backup…`, `every call…audit log` |
| 0.5 | Claude engine (API key, no built-in file/shell tools, settingSources []) | option tests | 🟡 | options tested; live run needs an API key |
| 0.6 | Codex engine (bundled codex.exe, ChatGPT login, MCP approve) | live run | ✅ | smoke: "337 faili", audit line |
| 0.7 | Grok engine (CLI 1.0.70, --trust, deny-by-default, command tools removed) | live + containment | ✅ | smoke: 337; Solibri/shell/outside read refused |
| 0.8 | Skills synced as plugin | get_skill from packaged resources | ✅ | `scripts/packaged-mcp-check.mts` output |
| 0.9 | Real-tender read, folder byte-identical | fixture test | ✅ | `test/fixture-nva.test.ts` |

## Phase 1 — shell, first run, projects, 1. Dokumenti

| ID | Task | Acceptance | Status | Evidence |
|---|---|---|---|---|
| 1.1 | Visual tokens per v1 §III (light+dark, state icons ○◐●⚠⊘, quote mark, 🔒) | CSS tokens present, both themes | ✅ | `ui-render.test.tsx` › theme tokens (12 colours × 2 themes, Segoe UI, Consolas); `StateIcon`, `CitedValue` quote mark; `.secret` class ready for phase 4 |
| 1.2 | Layout: rail with 10 numbered steps + status icon, Konkursi/Reģistri/Iestatījumi, top bar (tender, ID, deadline countdown, čeklists x/y), status bar safety line | renders from state; step status computed from project state (unit test) | ✅ | `state.test.ts` step status (nav→proc→gatavs/problema, template mismatch, D6 conflict); `format.test.ts` countdown + checklist; `ui-render.test.tsx` rail/status-bar strings. Reģistri item is disabled until phase 3. Window not opened by Claude |
| 1.3 | Every screen opens with 2-line "what / why" | each screen component has intro | ✅ | `ui-render.test.tsx` › every screen renders its two-line intro (Konkursi, NewProject, Settings, FirstRun, Dokumenti, Stub) |
| 1.4 | First run: Sveicināti → atslēga/pieslēgšanās → pirmā mape | shown when no projects + never dismissed; skippable | 🟡 | `FirstRun.tsx` (3 steps, Izlaist) renders in test; shown by `App.tsx` when `projects.length === 0 && !firstRunDone`. Flow not clicked through — Boris to look |
| 1.5 | Project list: name, ID, deadline, progress n/10, last change, ⚠ count, [×] forget with "faili paliek" | store test + UI | 🟡 | `store.test.ts` forget never touches folders; `projects:summaries` + `Konkursi.tsx` built, typecheck + build clean. List with data not viewed |
| 1.6 | Wizard: 2 folder pickers + counts + empty/Desktop warning, variant, builders, name | folder summaries, creation | 🟡 | `store.test.ts` folder summary + validation; `phase1-logic.test.ts` creation on NVA/VUGD; `NewProject.tsx` renders. Native folder dialog not exercised |
| 1.7 | Variant detection by model with verbatim quote (grounded) | grounding unit test; live: NVA → V2 | ✅ | `grounding.test.ts`, `runner.test.ts` (fabricated quote dropped). **Live via Codex:** NVA → V2 (quote from NOLIKUMS_14_07_2026.docx), VUGD 2 → V2 (Projektēšanas uzdevums), Salacgrīva → V1 (nolikums96_28_05_2.docx); each quote verified in full text |
| 1.8 | Project state file `<output>\.konkurss\project.json`, atomic write, backup on change | state tests | ✅ | `state.test.ts`: atomic save + project.prev.json, old-version upgrade keeps unknown keys, corrupt file reported, failed change leaves file intact |
| 1.9 | Dokumenti: [Pārskatīt mapi] scan both folders, Kur, Veids guessed + editable + persisted | classify tests on NVA + VUGD names | ✅ | `classify.test.ts` (19 real names + diacritics + folder-decides); `fixture-extract.test.ts`: key docs classified on both tenders, user correction survives rescan, unchanged file keeps text |
| 1.10 | [Nolasīt tekstu]: extract all files to cache, ✓ / ⚠ (scanned, unreadable, .edoc not openable) | N of M read, list of failures | ✅ | `fixture-extract.test.ts` (real run): NVA 315/328 read, 13 flagged (all scanned PDFs, named); VUGD 52/52. Found + fixed: single `.xlsx` failed everywhere and only sheet 1 was read → `extract_docs.py` now reads every sheet with cell refs (backup in work/skill-backups) |
| 1.11 | Filters (Kur, Veids, nenolasītie), search over names, preview panel with in-text search | UI | 🟡 | `Dokumenti.tsx` built; renders in `ui-render.test.tsx` (table, corrections marked, scanned warning). Filtering/preview interaction not clicked |
| 1.12 | Warnings strip: scanned PDFs, unreadable .edoc | computed list test | ✅ | `phase1-logic.test.ts` › warnings; real scanned-PDF list from NVA run |
| 1.13 | Both fixtures (NVA, VUGD 2) create projects; builders added | fixture test | ✅ | `phase1-logic.test.ts`: NVA [SB, Pillar, UPB], VUGD [MARPIBUVE, UPB], V2; plus scan+extract on both |

Also done in phase 1 (not separate plan rows): Grok prompt via file (Windows 32k command-line limit); preload channel allowlist for all later phases; IPC split into `ipc/*`; excerpts for model tasks (`docs.ts` `excerpt`) keep quotes checkable against full text.

## Phase 2 — 2. Kura versija spēkā, 3. Ko konkurss prasa

| ID | Task | Acceptance | Status | Evidence |
|---|---|---|---|---|
| 2.1 | Model-task framework: JSON output, zod validation, verbatim-quote grounding, 1 retry, raw error otherwise (D6, D11), atomic commit | unit tests with fake engine: ungrounded → „nav atrasts", malformed twice → error, state untouched | ⬜ | |
| 2.2 | Edition diff: pick original/amended, paragraph diff in code, model classifies each change (kritērijs/prasība/redakcionāla), person confirms; choose edition in force | diff unit test; UI | ⬜ | |
| 2.3 | Q&A: list question/answer from komisijas atbildes with quotes; impact proposed by model, confirmed by person | task + UI | ⬜ | |
| 2.4 | Template comparison: distributed vs nolikumā iekļautā (table row counts + labels, in code) | unit test: 4 vs 5 rows flagged | ⬜ | |
| 2.5 | Deadline: date + time + source (IUB/EIS/manual), model proposal with quote, second pass | UI + task | ⬜ | |
| 2.6 | Requirements: 6 blocks (konkursa dati; kas jāiesniedz; uzņēmuma pieredze; speciālisti; vērtēšana; apakšuzņēmēji+ESPD), [Izlasīt] + ☑ Pārbaudīts per block, quote mark per value, „nav atrasts" | task schemas + UI | ⬜ | |
| 2.7 | Second pass (D6) on deadline, criteria, thresholds: independent re-extraction, disagreement shown as conflict | unit test with fake engine | ⬜ | |
| 2.8 | Criteria sum check = 100 in code; manual add/edit rows | unit test | ⬜ | |
| 2.9 | Source priority shown (Q&A > grozījumi > nolikumā iekļautā > izplatītā > PIP > TS/PU) | screen text | ⬜ | |

## Phase 3 — 5. Kas ko dara (two-sided), 6. BIP + matrica, per-builder copies

| ID | Task | Acceptance | Status | Evidence |
|---|---|---|---|---|
| 3.1 | Registers (uzņēmums, speciālisti, objekti) as forms; seeded from skill `data/*.md`; certificate expiry warning ≤3 months; "Jomas, kurām nav neviena" | import test (counts match md), UI forms | ⬜ | |
| 3.2 | Kas ko dara V2: Projektēšana (mēs) / Būvdarbi (būvnieks) role tables; builder side per builder | state + UI | ⬜ | |
| 3.3 | Template inspection (python): tables/rows/cells/italic paragraphs → skeleton + hash | test on NVA BIP template | ⬜ | |
| 3.4 | BIP fill: model proposes value + quote per slot from PIP/TS/PU; grounded; legend (zaļš/sarkans/pelēks); never into original; new version | test: docx written in output, source hash unchanged, colours applied | ⬜ | |
| 3.5 | Copy-paste detector before fill (other tenders' names/IDs/addresses, `[` notes) | unit test on VUGD-copied-from-NVA text | ⬜ | |
| 3.6 | Atbildības matrica (.xlsx) fill: authors + LOD per phase into cells, from roles + PIP 1. pielikums | test writes xlsx copy | ⬜ | |
| 3.7 | Per-builder copies + leak grep = 0 (other builders' names) | test: injected name caught | ⬜ | |
| 3.8 | Builder-side markers `BŪVNIEKS` + comment what to input | test | ⬜ | |

## Phase 4 — V1 path: 4. Vai varam, 5. Kas ko dara (V1), prices, 6. value sheets + forms, tehniskais diff, 7. Pierādījumi

| ID | Task | Acceptance | Status | Evidence |
|---|---|---|---|---|
| 4.1 | Feasibility: specialists covered n/m, experience slots, realistic max points, decision + reason | computed from requirements + registers (unit test, no hardcoding) | ⬜ | |
| 4.2 | Kas ko dara V1: specialist per field with cert + validity, "rada dokumentus" (subcontractor → 2 docs), objects per slot with greyed reasons (type, energy class, 3-year window from akcepts date) | unit tests for exclusion reasons | ⬜ | |
| 4.3 | BPV consistency warning (Kvalifikācija BPV = scoring forms BPV = autoruzraugs) | unit test reproduces Tereško/Kalniņš | ⬜ | |
| 4.4 | 🔒 Prices in separate `finanses.json`, VAT + totals in code, EIS amount | unit test arithmetic | ⬜ | |
| 4.5 | Value sheet for every document (D5): field, source, value; missing → yellow and blocks file creation | test | ⬜ | |
| 4.6 | Native fill .docx/.xlsx from value sheet (label-based, first-match caveat handled by explicit cell refs) | test on a template | ⬜ | |
| 4.7 | Mapping memory keyed by template skeleton hash; reused on a similar form | unit test | ⬜ | |
| 4.8 | Tehniskais piedāvājums: boilerplate + model-adapted paragraphs, per-paragraph Pieņemt/Atmest diff (D9) | task + UI | ⬜ | |
| 4.9 | Pierādījumi: per chosen object, evidence files from register locations; [Atnest] copies with numbering, BPV subfolder by surname; missing = red | test copies into temp output with right names | ⬜ | |

## Phase 5 — 8. Pārbaude, 9. Paraksti, 10. Rezultāts, precizējums

| ID | Task | Acceptance | Status | Evidence |
|---|---|---|---|---|
| 5.1 | Exact checks (code), each returns ✗/⚠/✓/⊘ with consequence + where + fix target; ⊘ when tender doesn't require it | unit tests: pass / fail / not applicable for each rule | ⬜ | |
| 5.2 | Rules: BPV consistency, specialist fields all covered, role consistency BIP↔matrica per phase, LOD BIP=matrica, project code, company name, leftover template italics, other-tender leak, cross-builder leak, criteria sum, deadline, required files present | one test per rule | ⬜ | |
| 5.3 | Substance checks (model): tech proposal answers spec; atsauksme proves claim — cite both sides | task schema + grounding | ⬜ | |
| 5.4 | Paraksti: expected signer from doc type + mapping (never from file text); actual signer read from .edoc; manual entry shown yellow „ievadīts ar roku" | test on real .edoc signers | ⬜ | |
| 5.5 | Deadline warning ("sāc prasīt parakstus"), ESPD ticks, EIS amount ticks | UI | ⬜ | |
| 5.6 | Rezultāts: submitted, result, points, lessons, computed post-win deadlines, [Pievienot objektu reģistram] | UI + state | ⬜ | |
| 5.7 | Precizējums flow: paste commission question → draft answer only from submitted docs, "negrozot saturu", one-PDF structure, komercnoslēpums line (catalogue §C) | task + UI | ⬜ | |
| 5.8 | Fixture NVA reproduces commission's 3 findings (B12–B14) as checks before submission | test on NVA filled BIP + matrica | ⬜ | |

## Phase 6 — distribution

| ID | Task | Acceptance | Status | Evidence |
|---|---|---|---|---|
| 6.1 | Frozen `konkurss-tools.exe` (PyInstaller) for extract/fill scripts; app prefers it, falls back to `py -3.14` | build + test with frozen exe | ⬜ | |
| 6.2 | Dependency check screen (Python/tools, Codex bundled, Grok installed + version) with plain-Latvian fix steps | status function tests | ⬜ | |
| 6.3 | Grok "426 Upgrade Required" → „Atjaunini Grok" with button | unit test on error text | ⬜ | |
| 6.4 | Audit log viewer in Iestatījumi | UI | ⬜ | |
| 6.5 | `npm run dist` → Setup.exe (NSIS per-user) | file exists | ⬜ | |
| 6.6 | SmartScreen first-run guide (docs/UZSTADISANA.md, Latvian) | file | ⬜ | |
| 6.7 | Language test: UI strings contain none of JSON, IPC, regex, profils, validācija, ekstrakcija, hash | test | ⬜ | |
| 6.8 | Hardcoded-data test: no tender data (IDs, person names, cert numbers) in src outside fixtures | test | ⬜ | |
| 6.9 | Colleague trial | 🟡 Boris | ⬜ | |
