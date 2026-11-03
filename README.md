# Konkursu App

Desktop app for BŪVDIZAINS tender work (konkursi, BIP, paraugmodeļi) for colleagues who don't use AI agents directly. Plan and status: [PLAN.md](PLAN.md).

## Commands

| Command | What it does |
|---|---|
| `npm run sync-skills` | Copies the 4 konkurss skills from `~/.claude/skills` into `resources/plugin` |
| `npm run build` | sync-skills + compile main/tool server + build UI |
| `npm start` | build and open the app |
| `npm test` | unit + tool-server tests (28), incl. read-only NVA fixture if `E:\BV BIM` is present |
| `npm run typecheck` | TypeScript, main + renderer |
| `npm run pack` | `release\win-unpacked\Konkursu App.exe` |
| `npm run dist` | `release\Konkursu App Setup <ver>.exe` (NSIS, per-user) |

Dev helpers (make real model calls on your own account):

```bash
node --import tsx scripts/engine-smoke.mts codex "E:\BV BIM\Paraugmodeli\<konkurss>\KONKURSS" "Izsauc list_files un pasaki failu skaitu."
```

## Layout

```
src/main/        Electron main: window, IPC, store (projects, settings, encrypted Claude key)
src/main/engines Claude (Agent SDK + API key), Codex (codex-sdk + ChatGPT login), Grok (grok CLI + SuperGrok login), pi (own agent loop on pi 1.4: Claude key, ChatGPT or SuperGrok sign-in)
src/agent-pi        the pi agent loop, tender-neutral (liftable into a shared package): models, sign-in, MCP tools, run, event mapper
src/mcp/         konkurss-tools stdio MCP server + path guard + audit — the only way any engine touches files
src/renderer/    React UI (Latvian)
resources/plugin build-time copy of the skills (not committed)
```

Safety rules live in `src/mcp/guard.ts`: read only in the tender folders, write only in the output folder, never in izejas dati, never `.edoc`, nothing deleted, backup before overwrite.
