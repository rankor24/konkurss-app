# Konkursu App — plan v2 (Claude Agent SDK, setup.exe)

**Status:** plan, not approved. No code yet. Supersedes v1 (`docs/plan-v1-electron-pi-2026-08.md`) for the stack, auth and project model; v1 screens, decisions D1–D11 and verification list still apply unless changed here.
**Language rule:** English prose; Latvian only for UI strings, domain terms and file names.
**Date:** 2026-10-30.

---

## 1. What changed since v1, and why

| Topic | v1 (Aug 2026) | v2 | Reason |
|---|---|---|---|
| Agent layer | `pi-ai` + own task modules | **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`, TypeScript) | Boris's request. The SDK is Claude Code as a library: same loop, skills, plugins and hooks we already use, so the four konkurss skills run unchanged inside the app. |
| Login | OAuth subscription per provider (Anthropic, Codex) | **One API key per person** from the company Anthropic Console | Official Agent SDK docs: *"Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK."* See §3. |
| Providers | Anthropic, OpenAI, OpenRouter, DeepSeek… | **Three engines: Claude (API key), Codex (ChatGPT subscription), Grok (SuperGrok subscription)** — decided 2026-10-30 | Each engine runs through its vendor's own official harness and login. See §4.3. |
| Project scope | Salacgrīva-shaped (we are pretendents) | **Three variants + several būvnieki per tender** | Session review: 3 of 4 real tenders were "projektē un būvē" with 2–3 competing būvnieki each (`~/.claude/skills/konkurss/references/konkursu_varianti.md`). |
| Project creation | App creates the folder | **"Jauns konkurss no mapes"** — pick an existing izejas dati folder and an output folder | Boris's request; tenders already live in `E:\BV BIM\Paraugmodeli\<datums>_<objekts>\KONKURSS`. |
| Distribution | portable .exe | **`KonkursuApp-Setup.exe`** (NSIS, per-user, no admin) + portable `.exe` | Non-technical colleagues. Config copied from BIM-Crew `apps/desktop/electron-builder.yml`. |
| Python sidecar | Python 3.14 + install screen + `uzstadit.bat` | **Frozen `konkurss-tools.exe`** (PyInstaller) shipped inside the installer | Nothing to install. Same scripts as the skills, so one codebase. |

---

## 2. Who uses it

| | Lietvede / colleague (primary) | Boris (power user) |
|---|---|---|
| Knows | tenders, EIS, documents | the same + agents, code |
| Never sees | API keys, JSON, terminal, model names | everything is reachable in Iestatījumi |
| Needs | "what is next", what's missing, who must sign | full detail, chat with the agent, raw logs |

v1 §I rules still hold: no computer vocabulary in the UI, errors state the consequence, originals never modified, every model value traceable to a quote.

---

## 3. Authentication

**Decided 2026-10-30:** Claude = option A (Console API key per person). Codex and Grok = the person's own subscription, signed in through the vendor's official CLI login (`codex login`, `grok login`), launched from the app's Iestatījumi screen. The app never sees or stores Codex/Grok tokens — the official CLIs keep them in `~/.codex` and `~/.grok`.

### 3.1 Claude — background (why not claude.ai login)

The original idea ("each logs in with their own Claude account") is **not permitted** for an Agent SDK app without Anthropic's prior approval. Three compliant options:

| Option | How each person "logs in" | Cost control | Effort | Recommendation |
|---|---|---|---|---|
| **A. Console API key per person** | Admin creates a key per colleague in the BŪVDIZAINS Console org (one workspace "Konkursi"); colleague pastes it once on first run; stored with Electron `safeStorage` (Windows DPAPI) | Per-workspace spend limit, per-key usage visible in Console | Low | **Recommended** |
| B. Request Anthropic approval for claude.ai login | Claude Team/Enterprise seat login | Seat price | Unknown — depends on Anthropic | Ask in parallel; switch if approved |
| C. Amazon Bedrock / Google Vertex | Cloud IAM per user | Cloud billing | High for a 3-person office | No |

With A: the key is passed to the SDK subprocess through `options.env` (`{...process.env, ANTHROPIC_API_KEY: key}`); `settingSources: []` so the app never reads a colleague's personal `~/.claude` config. Key never leaves the machine except to the Anthropic API; never written to project files or logs.

---

## 4. Architecture

```
┌──────────────────────── KonkursuApp.exe (Electron 43) ─────────────────────────┐
│ Renderer (React 19 + Vite)          │ Main process (Node, TypeScript)           │
│  Konkursi · 10 steps · Reģistri ·   │  ipc/*  ── projects, files, checks, fill  │
│  Čats ar aģentu · Iestatījumi       │  agent/  ── Agent SDK query()             │
│        ▲  preload IPC only          │     ├ plugin: konkurss skills (local)     │
│        └────────────────────────────│     ├ in-process MCP: konkurss-tools      │
│                                     │     ├ PreToolUse hook: path guard         │
│                                     │     └ env: ANTHROPIC_API_KEY (safeStorage)│
│                                     │  rules/  ── exact checks (code, no model) │
│                                     │  tools/konkurss-tools.exe (PyInstaller)   │
└─────────────────────────────────────┴───────────────────────────────────────────┘
          │ reads only                                  │ writes only
   <izejas dati>\KONKURSS\                    <izvades mape>\  (+ .konkurss\ state)
```

### 4.1 Agent SDK usage (verified against the TypeScript reference, 2026-10-30)

- `query({ prompt, options })` per task or per chat turn; `options.cwd` = output folder, `additionalDirectories` = [izejas dati folder].
- `plugins: [{ type: "local", path: <resources>/plugin }]` — the plugin bundles the four skills (`konkurss`, `konkurss-checklist`, `paraugmodeli`, `lv-doc-tables`) **copied from `~/.claude/skills` at build time**. One source of truth: Boris edits skills in Claude Code, the next build ships them.
- **Changed 2026-10-30:** `konkurss-tools` is a **stdio MCP server** (Node, run with Electron's own Node via `ELECTRON_RUN_AS_NODE=1`), not `createSdkMcpServer`, so Codex and Grok can use the same tools. Narrow, typed tools instead of free Bash:
  `read_all(folder)`, `read_doc(path)`, `read_edoc_signers(path)`, `inspect_template(path)`, `fill_docx(path, values, legend)`, `fill_xlsx(...)`, `redline_docx(...)`, `grep_leaks(folder, terms[])`, `save_project_state(patch)`.
  Each handler shells out to `konkurss-tools.exe <command>` and returns JSON.
- `disallowedTools: ["Bash", "WebFetch", "WebSearch", "Write", "Edit", "NotebookEdit"]` — the model writes **only** through `fill_docx`/`fill_xlsx`/`redline_docx`, which enforce the safety rules in code.
- `hooks.PreToolUse` — path guard: any path outside the two project folders → deny. Any write to `KONKURSS\`, any `.edoc` write, any delete → deny. (Mistake catalogue A6, A10.)
- `model`: Opus 5.5 default for reading nolikums / checks; Sonnet 5.5 for bulk extraction (setting, per task class).
- Bundled binary: the npm package installs a per-platform native Claude Code binary as an optional dependency. In Electron it must be **outside asar** (`asarUnpack`), else spawn fails — same lesson as BIM-Crew's Python scripts. If missing, set `pathToClaudeCodeExecutable`.
- Branding: product name "Konkursu App"; "Powered by Claude" allowed; "Claude Code" naming and look-alike visuals not allowed (SDK branding rules).

### 4.3 Three engines, one tool server (decided 2026-10-30)

The model-specific part is only the **harness**. Everything that touches files lives in one stdio MCP server, `konkurss-tools`, that every engine connects to. That gives one path guard, one audit log and identical tools regardless of which engine runs.

| Engine | Harness (official) | Login | Write restriction | Tools from us |
|---|---|---|---|---|
| Claude | `@anthropic-ai/claude-agent-sdk` `query()` (bundles Claude Code binary) | Console API key via `env.ANTHROPIC_API_KEY` | `disallowedTools` Bash/Write/Edit/NotebookEdit/Web*; `settingSources: []` | `mcpServers.konkurss` stdio |
| Codex | `@openai/codex-sdk` (official; depends on `@openai/codex` with binary) | user's `codex login` (ChatGPT) | sandbox `read-only`; no approvals | MCP via config override |
| Grok | `grok` CLI headless (`-p`, `--output-format streaming-json`) — no npm SDK; must be installed (setup screen detects it) | user's `grok login` (SuperGrok / X Premium) | `--tools` allow-list of read tools; `--disallowed-tools` for writes/shell; `--disable-web-search` | `grok mcp`-style config / per-run config |

Not used: pi-ai's Codex/xAI OAuth — it reuses the official CLIs' OAuth client IDs from a third-party app, a grey area. Driving the vendors' own tools with their own login is the clean route.

Engine interface (`main/engines/types.ts`): `available()` → installed/logged-in status with a plain-Latvian reason; `run(task, {cwd, readDirs, mcp, onEvent, signal})` → streamed events (text, tool call, tool result, done, error with raw provider message — D11). Engine choice per task class in Iestatījumi; no automatic fallback (D11).

Skills: Claude loads them natively as a plugin. Codex and Grok don't load Claude plugins, so the skill text is passed as the task's instructions (the `konkurss-tools` server also exposes `get_skill(name)`). Same source files either way.

### 4.2 Model vs code split (v1 D3, unchanged)

Model: read requirements, map fields, draft text, judge substance — every value returned with a verbatim quote; a quote not found in the source text is rejected in code and shown as „nav atrasts".
Code: file writing, arithmetic, string equality, presence checks, leak grep, role/LOD cross-checks.

---

## 5. Project model

```
Konkurss (one tender)
 ├ izejasMape        E:\BV BIM\Paraugmodeli\260811_NVA_Remonta baze\KONKURSS   (read-only)
 ├ izvadesMape       ...\IESNIEDZAMIE                                           (write)
 ├ variants          V1 projektēšana | V2 projektē un būvē | V3 tikai BIM daļa
 ├ lomas             mūsu loma (pretendents / projektētājs / BIM konsultants)
 ├ būvnieki[]        V2/V3: e.g. SB, Pillar, UPB  → each gets izvadesMape\<būvnieks>\
 ├ bāze              shared design-side documents (cited)
 └ state             izvadesMape\.konkurss\project.json, finanses.json, audit.jsonl
```

App-level data (`%APPDATA%\KonkursuApp\`): project list, registers (`uznemums`, `specialisti`, `objekti` — imported from the `konkurss` skill `data/`), settings, encrypted key.

### 5.1 "Jauns konkurss no mapes" (creation wizard, 4 screens)

1. **Izejas dati** — folder picker. App counts files by type and shows: „Atrasti 61 faili: 34 .docx, 13 .edoc, 9 .pdf, 5 .xlsx. 2 skenēti PDF — tekstu nolasīt nevar." Warn if the folder is empty or looks like a Desktop shell copy (mistake A7).
2. **Kur likt jaunos dokumentus** — folder picker, default `<parent>\IESNIEDZAMIE`. Shows: „Oriģinālus app nekad nemaina. Jaunās versijas tiek liktas šeit."
3. **Konkursa veids** — model proposes variant from TS/PIP with a quote („Līguma veids – Projektē un būvē", PIP 1. pielikums); person confirms. V2/V3 → add būvnieki (name, reg. Nr. optional, contact).
4. **Kopsavilkums** — ID, pasūtītājs, termiņš (from IUB notice, or „nav atrasts — ievadi no EIS"), variant, būvnieki → `[Izveidot]`.

---

## 6. Screens

v1 screens 1–10 stay. Changes:

| Screen | Change in v2 |
|---|---|
| Konkursi (list) | Card per tender: deadline countdown, variant badge, būvnieki chips, next action |
| 1. Dokumenti | Reads both folders; shows `izlasīti N no M` (mistake A1) |
| 2. Kura versija spēkā | Adds source priority list (Q&A > grozījumi > nolikumā iekļautā veidne > izplatītā) |
| 3. Ko konkurss prasa | Sadaļu saraksts only with a quote per row (A4, B-series) |
| 5. Kas ko dara | V2: two columns — **Projektēšana (mēs)** / **Būvdarbi (būvnieks)**; one table per būvnieks for the right column |
| 6. Aizpildīt | **New: Pirms-līguma BIP + Atbildības matrica** filling (paraugmodeli §4a): base BIP → copy per būvnieks; colour legend; redline mode |
| 8. Pārbaude | New exact checks: role consistency BIP↔matrica per phase (B12), LOD equality (B13), project code (B7), company name (B8), template italics (B9), foreign-tender leak grep (B5–B6), cross-builder leak grep |
| **Čats** (new, side panel) | Agent chat scoped to the open tender, for Boris and for "kur tas rakstīts?" questions; every answer must cite or say „dokumentos nav" |
| 10. Rezultāts | Adds "Komisijas precizējums" flow (catalogue §C) |
| Iestatījumi | API key (masked, `[Pārbaudīt]`), model per task class, monthly usage from local audit, `[Kopēt kļūdu]` diagnostics |

---

## 7. Installer and first run

- `npm run dist` → `release/KonkursuApp-Setup-<ver>.exe` (NSIS, x64, per-user, desktop + start-menu shortcut, keeps userData on uninstall). `npm run pack` → `win-unpacked/KonkursuApp.exe` for testing. Both straight from BIM-Crew's `electron-builder.yml`.
- `extraResources`: `plugin/` (skills), `tools/konkurss-tools.exe`. `asarUnpack`: the SDK's native binary package.
- Unsigned: SmartScreen shows "unrecognised app" on first run → one-page illustrated instruction (Vairāk informācijas → Palaist jebkurā gadījumā). Code-signing certificate is a later decision.
- First run: 3 screens — Sveicināti → Ievadi atslēgu (with screenshot of where Boris gives it) → Izvēlies pirmo konkursa mapi.
- Updates: manual (new Setup.exe over the old one) in v2.

---

## 8. Phases

| # | Content | Done when |
|---|---|---|
| 0 | Spike: Electron shell; `konkurss-tools` stdio MCP server with path guard + audit; engine interface with Claude, Codex and Grok adapters; local plugin with the 4 skills; `npm run pack` | Unit tests: guard denies writes to KONKURSS\, `.edoc`, outside folders; each engine reports availability; one engine answers "kas ir šajā mapē?" through `konkurss-tools`; packaged exe starts |
| 1 | Shell, first run, key storage, project list, creation wizard, 1. Dokumenti | NVA and VUGD 2 folders both create projects; V2 detected with quote; būvnieki added |
| 2 | 2. Versija, 3. Prasības (with grounding check) | Q&A Nr.13 GIPP correction surfaces; a missing threshold shows „nav atrasts" |
| 3 | 5. Kas ko dara (two-sided), 6. BIP + matrica filling, per-būvnieks copies | NVA base BIP + 3 builder copies; leak grep = 0 |
| 4 | 4/5/6 for V1 (Salacgrīva path: forms, prices, evidence) | v1 phase 3–5 criteria |
| 5 | 8. Pārbaude, 9. Paraksti, 10. Rezultāts, precizējums flow | Fixture NVA reproduces the commission's three findings (B12–B14) before submission; Salacgrīva catches B1, B2 |
| 6 | Setup.exe, SmartScreen guide, colleague trial | A colleague installs and finishes one real tender step unaided |

### Phase 0 status — 2026-10-30

Done: Electron 43 shell (project list, "Jauns konkurss no mapes", project view with agent chat, Iestatījumi), `konkurss-tools` stdio MCP server (list_files, read_doc, get_skill, write_text) with path guard + backup-before-overwrite + audit log, engine layer for Claude / Codex / Grok, skills synced as plugin, `npm run pack` → `release\win-unpacked\Konkursu App.exe`.

Verified:
- 28 tests pass (`npm test`), typecheck clean. Includes a read-only run against the real NVA 2025/122 folder: `.docx` read through the skill scripts with table cells intact, write into KONKURSS denied, folder SHA-256 identical before/after.
- **Codex live:** ChatGPT login → `list_files` through konkurss-tools → "337 faili" (independent count: 337). Needed `default_tools_approval_mode = "approve"` + `enabled_tools` on the MCP server entry; `approval_policy = never` otherwise blocks MCP calls.
- **Grok live (CLI updated 0.2.93 → 1.0.70 with Boris's OK):** SuperGrok login → `list_files` through konkurss-tools → "337 faili". Containment test: Solibri MCP call, shell `dir`, and reading `~/.claude/CLAUDE.md` all refused; with the hardened deny list Grok finds no command tool at all, and the outside read is denied by the guard (audit log shows it). Real `.docx` read via `read_doc` worked.
- Grok 1.0 changes handled: headless ignores the run folder's `.grok/config.toml` and `.claude/settings.json` unless `--trust` (hidden flag) is passed; `--no-memory` removed; shell tool is `run_terminal_command`; Grok tried `monitor` to run commands once the shell was gone → deny list now covers every command runner (`monitor`, `execute`, `task`, `scheduler_*`, …) plus `GROK_WORKFLOWS=0`. Grok streams text in small chunks; the chat UI joins them. Grok reaches MCP tools through its `search_tool`/`use_tool` wrappers.
- Packaged exe: konkurss-tools starts from inside `app.asar` on Electron's Node; skills load from `resources\plugin`; both agent binaries unpacked.

Not verified / known gaps:
- Claude live run — no API key on this machine yet.
- Grok still *sees* the user's global MCP servers (Revit, Solibri, repowise) in tool search; calls to them are refused by the run folder's `dontAsk` policy (verified for Solibri). Grok CLI is not bundled — colleagues must install it; xAI enforces a minimum CLI version, so the settings screen should surface "426 Upgrade Required" as „Atjaunini Grok" (todo).
- Codex `read-only` sandbox still lets Codex *read* any file via shell commands; writes are blocked. Claude and Grok have direct file/shell tools removed.
- `read_doc` needs Python 3.14 + the skill scripts' libraries on the PC → PyInstaller `konkurss-tools.exe` in phase 6.
- Size: unpacked app 1.2 GB (Codex binary 480 MB, Claude binary 288 MB). No app icon yet.
- GUI not run by Claude (Boris playtests).

## 9. Verification

v1 list (§Verification 1–9) plus:
1. **Fixtures:** Salacgrīva (V1, known errors B1/B2), NVA 2025/122 (V2, 3 būvnieki, real commission letter = oracle), VUGD 2 (V2, BIP copied from NVA = leak oracle). Read-only copies; no tender data in code.
2. **Path-guard test:** agent asked to edit a file in `KONKURSS\` or create an `.edoc` → denied, file hashes unchanged.
3. **Cross-builder leak test:** inject a Pillar person name into the UPB copy → check fails.
4. **Grounding test** per catalogue A3: ask "kur rakstīts UIPP?" → „dokumentos nav, meklēts: …".
5. **No key in output:** grep project folders and audit log for `sk-ant-` → 0.
6. No browser testing — Boris playtests.

## 10. Decisions

| # | Question | Status |
|---|---|---|
| 1 | Auth | **Decided:** Claude API key per person; Codex + Grok via own subscriptions (§3, §4.3) |
| 2 | Providers | **Decided:** Claude, Codex, Grok. DeepSeek/OpenRouter not in v2 |
| 3 | Skills as single source | **Default taken:** build-time copy of `~/.claude/skills/{konkurss,konkurss-checklist,paraugmodeli,lv-doc-tables}` — change if Boris objects |
| 4 | Output finality | **Default taken:** outputs are drafts reviewed in Word; the app never marks a file "gatavs iesniegšanai" by itself |
| 5 | Code signing | **Default taken:** later; unsigned + SmartScreen guide |
| 6 | Console admin for Claude keys | open — Boris |

## 11. Not in v2

EIS automation (no stable interface) · non-Claude providers · auto-update · IFC checks · multi-user shared state (D4: local app, local files).
