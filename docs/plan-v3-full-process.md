# Konkursu App — plan v3: every new konkurss, start to finish

**Status (2026-11-06):** phases 7–12 implemented on branch `feat/v3-full-process`, not committed. See §12 for what is verified and what is not. Builds on `PLAN.md` (v2: engines, guard, 10 steps, BIP), which stays valid.
**Evidence:** `docs/full-process-gaps-2026-11.md` (scan of 402 submissions on `B:\01_Konkursi`, 2026-11-06).
**Language rule:** English prose; Latvian for UI strings, domain terms and file names.
**Date:** 2026-11-06.

---

## 1. Goal

Any new tender folder that appears in `B:\01_Konkursi` can be opened in the app and carried from "is it worth it?" to "result recorded". This covers every type we actually bid on: projektēšana, projektē un būvē for 1–8 builders, BIM daļa, daļas, cenu aptauja, privāts cenu pieprasījums, mets, vispārīgā vienošanās. The reusable library (objects, people, builders, standard statements, prices) should produce most of each pack, so a person's time goes into judgement rather than copying.

Measured target: a typical V1 or V2 pack (~33 files, ~12 `.edoc`) is produced as reviewed drafts in under an hour. Today it is a hand-copied folder from the previous tender.

## 2. What stays

v2 rules are unchanged: model reads and proposes with a verbatim quote, code writes, counts and compares (D3); `Cited<T>` everywhere; the path guard; originals never modified; outputs are drafts reviewed in Word (decision 4); prices in `finanses.json`, never in a prompt; no browser testing.

Code that already fits and is extended, not replaced:

| Existing | Reused for |
|---|---|
| `v1/bindings.ts` closed vocabulary | new `builder:`, `lot:`, `sub:` bindings |
| `FillSheet.outputs` keyed per builder | builder copies of *every* form, not only BIP |
| `v1/objects.ts` code-decided object fit | fit against the larger harvested library |
| `v1/evidence.ts` plan + numbered copy | pack manifest items of kind `evidence` |
| `shared/leaks.ts` cross-builder grep | identity check per builder copy; mets anonymity check |
| `StepStatus "neattiecas"` | steps switched off by the tender profile |
| `v1/feasibility.ts` | go/no-go card on the portfolio board |

## 3. Target architecture — three layers

```
┌ Portfolio ───────────────────────────────────────────────────────────┐
│ Konkursu tāfele: every folder under the tenders root, deadline,      │
│ status, next action, go/no-go · tracker import · price history       │
└───────────────┬──────────────────────────────────────────────────────┘
                │ opens
┌ One tender ───▼──────────────────────────────────────────────────────┐
│ Profile (veids · priekšmets · mūsu loma · daļas · iesniegšana)       │
│ steps 1–10 (existing) → Pack manifest: every document to submit,     │
│ per recipient (bāze / būvnieks X / daļa n), source, signer, number   │
└───────────────┬──────────────────────────────────────────────────────┘
                │ reads / proposes back
┌ Library ──────▼──────────────────────────────────────────────────────┐
│ Uzņēmums · Speciālisti (+pierādījumi) · Objekti (+pierādījumi) ·     │
│ Būvnieki/partneri · Apakšuzņēmēji · Standarta apliecinājumi ·        │
│ Veidlapu atmiņa (exists) · Cenu vēsture                              │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.1 Library (registers v2)

| Register | New or changed | Fields (from real forms) | Seed |
|---|---|---|---|
| Objekti | changed: typed fields instead of free KV | pasūtītājs (nosaukums, reģ. Nr., kontaktpersona, tālr., e-pasts), objekta nosaukums + adrese, jaunbūve/pārbūve/atjaunošana, publiska ēka + grupa, būves kods, daļas (AR, BK, …), līguma periods, būvvaldes atzīme, nodots ekspluatācijā, BPV, ABDV, platība, energoklase, mūsu loma, līgumcena | harvester (§5) from `07_IESNIEGTI` + `atsauces_objekti.md` |
| Objekta pierādījumi | changed: typed | atsauksme (.edoc), būvatļauja, PN atzīme, ekspluatācijas akts, GP, energosertifikāts, lēmumi/pilnvaras — each a file path + date + signer | harvester |
| Speciālisti | extended | + sertifikāta fails, CV, apdrošināšana, valodas, pieredzes objekti (links to Objekti with role) | `specialisti.md` + `04_Speciālistu reģistrs` |
| Būvnieki / partneri | **new** | nosaukums, reģ. Nr., juridiskā adrese, paraksttiesīgā persona + amats, kontakts, biežums | builder subfolder names in IESNIEDZAMIE (Pillar, Nord SW, KUUM, INO, Bildberg, …) |
| Apakšuzņēmēji | **new** | firma, joma (daļa), kontaktpersona, e-pasts, tālr. | `00_Specialistu un apaksuznemeju reg..xlsx` (import, read-only) |
| Standarta apliecinājumi | **new** | office's own texts for spec. apliecinājums, apakšuzņēmēja apliecinājums, IP neizpaušana, sankcijas, aizvietotājs — used only when the tender gives no form | best recent submitted versions |
| Cenu vēsture | **new** | konkurss, pasūtītājs, priekšmets, mūsu cena, uzvarētājs, uzvarētāja cena, rezultāts | `02_Iepirkumi_BD_jauns.xlsx` 2024–2025 (240 rows) |

One company record: today the address differs between documents (Ģertrūdes iela 2-9B, Rīga vs Kalnciema ceļš 126A, Jelgava). The register keeps juridiskā and biroja adrese as separate named fields, and a check flags a pack that uses either one inconsistently.

### 3.2 Tender profile (replaces `variant`)

`Variant V1|V2|V3` mixes three independent things. Split them:

| Axis | Values | Seen in |
|---|---|---|
| procedūra | atklāts konkurss · sarunu procedūra · cenu aptauja / uzaicinājums · privāts cenu pieprasījums · metu konkurss · vispārīgā vienošanās / partnerība | all folders |
| priekšmets | projektēšana + AU · projektē un būvē · BIM daļa · tehniskā apsekošana | |
| mūsu loma | pretendents · apakšuzņēmējs pie N būvniekiem · persona, uz kuras spējām balstās | 46 % are apakšuzņēmējs |
| daļas | none · list of lots, each with own requirements, price, pack | LVP 3, MNP 4, ONP 2, BNP Rundāle 2 |
| iesniegšana | EIS · e-pasts · papīrs/aploksnes · anonīms (devīze) | Tilde: e-pasts; mets: aploksnes |

The profile is proposed by the model with a quote (like the variant today) and confirmed by a person. It drives which steps are `neattiecas`, which checks run (mets → anonymity, not leak), and the folder layout. Migration: V1 → pretendents + projektēšana; V2 → apakšuzņēmējs + projektē un būvē; V3 → BIM daļa.

### 3.3 Pack manifest (new state key `pack`)

The single list of what goes into the submission. It unifies today's steps 6 (forms), 7 (evidence) and 9 (signatures).

```ts
interface PackItem {
  id: string;
  /** what the tender asks for, with its quote (from requirements.dokumenti) */
  required: Cited<string>;
  source: "form" | "generated" | "evidence" | "external" | "manual";
  /** form/template key, register object/specialist id, or the party that supplies it */
  ref: string;
  recipient: "" | `builder:${string}` | `lot:${number}`;   // "" = base pack
  number: string;            // office convention: "3_1", "2_0"
  fileName: string;          // "3_1Atsauksme_Cigorinu 3.edoc"
  signer: string | null;     // who signs the .edoc
  status: "nav" | "melnraksts" | "parbaudits" | "parakstits";
}
```

The manifest renders as the IESNIEDZAMIE tree. `external` items (e.g. the builder's own ESPD) are tracked but never produced by us.

## 4. Builder replication (V2, 46 % of tenders)

- The base design pack is made once. Each builder gets a copy of every item whose text names the pretendents, with `builder:nosaukums|regNr|adrese|paraksttiesigais` bindings resolved from the Būvnieki register.
- **Identity check (new, code):** in a builder copy, a builder slot holding *our* identifiers fails. Real case: `B:\01_Konkursi\261110_BNP_Bauskas patvertnes\IESNIEDZAMIE\5_Apaksuzn apliec. BUVDIZAINS.docx` gives SIA "FF" BŪVDIZAINS's reg. Nr. 43603011124. Plus the existing cross-builder leak grep.
- Evidence files are shared, not duplicated in the manifest. They are copied per builder folder only when the builder submits separately (the usual case).

## 5. Harvester — building the library from what was already submitted

Read-only over `07_IESNIEGTI` and open folders:

1. **Code:** cluster evidence files by normalised stem (`atsauksme_cigorinu 3`, `buvatlauja_anninmuiza`) → candidate objects with file lists, usage count and latest version per file (prefer `.edoc`, newest mtime).
2. **Model:** for each candidate, read the newest "Pieredzes apraksts" rows and the atsauksme text → propose typed fields, each with a quote; code rejects quotes not found in the text.
3. **Person:** confirms in Reģistri (accept / edit / merge two candidates). Nothing enters the library unconfirmed.

Re-run monthly or on demand. New candidates and new versions of known files come up as proposals.

## 6. Pricing

A price sheet per tender, shaped like `BD_P_*.xlsx`: rows per daļa/marka (AR, BK, AVK-A…), own price or subcontractor quote (file attached from `Apaksnieki/`), AU separately, totals in cents (existing `finance.ts`). Outputs: the tender's finanšu piedāvājums form values (`price:` bindings), and our offer to a builder as an xlsx in the office layout. A side panel shows the price history range for similar priekšmets / pasūtītājs, from the tracker. Advice only, never written into a form.

## 7. Portfolio board (Konkursu tāfele)

- **Discover:** every folder under the tenders root matching `YYMMDD_*` → card. The folder date is a hint; the deadline comes from the EIS notice `*_PD.ANY_*.pdf`, the uzaicinājums or the nolikums (cited), else „nav atrasts".
- **Status:** Jauns → Izvērtē → Gatavo → Iesniegts → Rezultāts, plus Atteikts (go/no-go = no, with reason). People still move folders to `07_IESNIEGTI` themselves. The app follows the move and never moves it.
- **Go/no-go card:** profile + requirement summary + `feasibility.ts` against the library ("pieredze: 3 no 3 objektiem atrasti; speciālists ESS: nav reģistrā").
- **Tracker:** import 2024–2025 rows; on Rezultāts, produce the row for the tracker (copy to clipboard / export xlsx). Writing into the shared xlsx is decision D5.

## 8. Lightweight tender types

| Type | Steps used | Special |
|---|---|---|
| Cenu aptauja / uzaicinājums (Tilde TAA, LDZ) | 1, 3, 6, 7, 8 | e-pasts submission; 3–5 forms; criterion = zemākā cena |
| Privāts cenu pieprasījums (LIDL, Bildberg, 00_Piedavajumi) | 1, 3, pricing, 8 | output = our offer xlsx + konfidencialitātes līgums; no EIS |
| Metu konkurss | 1–3, 6, 8 | two envelopes; **anonymity check**: no company/person names in the meta part, devīze consistent |
| Vispārīgā vienošanās / partnerība | full | qualification once, then mini-tenders reuse it |

## 9. Phases

Each phase ships on its own and is verified against **real past submissions as oracles**: regenerate a pack that was actually submitted and diff it against the folder on `B:\`. All fixture reads are read-only; outputs go to a C: scratch folder.

| # | Content | Done when |
|---|---|---|
| 7 | Library v2: typed Objekti + pierādījumi, Būvnieki, Apakšuzņēmēji import, specialist evidence; harvester (§5); Reģistri confirm UI | ≥ 20 confirmed objects, each with ≥ 1 evidence file found on disk; step 7 for `261105_RNP_Ulbrokas sporta kompleksa gerbtuves` proposes the same evidence files as its real IESNIEDZAMIE (oracle) |
| 8 | Tender profile (+ migration from variant), daļas, pack manifest view with numbering and signer | Profiles proposed with quotes for 6 type fixtures (RNP Ulbroka, SN VSAC Zemgale, MNP 4 daļas, Tilde TAA Lielā 19, LIDL Slokas 161, METS Matīsa 8); manifest for `261110_BNP_Bauskas patvertnes` lists the same 19 items as the real folder |
| 9 | Builder replication of all items + `builder:` bindings + identity check; standard apliecinājumi generator | `261113_IE67_Dienas centrs Marupe BIM` regenerated for AIDACO + BILDBERG matches the real file set; identity check flags the real FF reg. Nr. error |
| 10 | Portfolio board: discovery, deadlines, statuses, go/no-go, tracker import | All open folders listed with a cited deadline or „nav atrasts"; 240 tracker rows imported; no file on B:\ changed (hash before/after) |
| 11 | Pricing sheet, subcontractor quotes, finanšu values, builder offer xlsx, price history panel | LIDL Slokas 161 v2 totals reproduced to the cent; price-history range shown for NVA IDA |
| 12 | Lightweight types (§8) incl. mets anonymity check | Tilde TAA pack produced end-to-end; anonymity check flags a company name injected into a Matīsa 8 copy |

Order rationale: the library is what every later phase consumes. The portfolio board is valuable early, but it only needs read-only discovery, so it can run in parallel with 8–9 if wanted.

## 10. Decisions for Boris

| # | Question | Default proposed |
|---|---|---|
| D1 | May the app write IESNIEDZAMIE inside tender folders on `B:\`, or only into a C: working copy that people move? | App writes only into `<tender>\IESNIEDZAMIE\` on B:, never elsewhere on B:. Development and tests never write to B:. |
| D2 | Library location: per PC (`%APPDATA%`, today) or one shared folder for all colleagues? | Shared folder (one library, backup before every write, simple file lock), because all three people reuse the same objects |
| D3 | Where is 2026 tracked? `02_Iepirkumi_BD_jauns.xlsx` sheet "2026" has no header in the 2024/2025 layout | — |
| D4 | Company address truth: Ģertrūdes iela 2-9B, Rīga vs Kalnciema ceļš 126A, Jelgava (juridiskā vs biroja?) | Two named fields; Boris fills them |
| D5 | Tracker: app reads the xlsx and exports rows, or the app becomes the tracker? | Read + export rows; xlsx stays the office record |
| D6 | Phase order 7 → 12 as above? | Yes; board (10) may run in parallel |

## 11. Not in v3

EIS automation · signing `.edoc` from the app (people sign in eParaksts; the app only checks signers) · moving or deleting tender folders · automatic price decisions.

## 12. Implementation status (2026-11-06)

| Phase | Code | Verified against real data (read-only, B:\ unchanged) |
|---|---|---|
| 7 Library | `main/zip.ts`, `main/office.ts` (Node xlsx/docx reading), `main/library/{harvest,accept,imports}.ts`, `ipc/library.ts`, Reģistri tabs | 488 submissions → ~110 object proposals; step 7 plans every named evidence file RNP Ulbroka submitted; 25 builders, most with a cited reg. Nr.; tracker 2022–2026 incl. the 2026 triage sheet; 200+ subcontractor rows |
| 8 Profile + pack | `shared/profile.ts`, `main/profile.ts` (code rules, no model), `shared/pack.ts`, `main/pack/manifest.ts`, `ipc/pack.ts`, Paka screen | 7 tender types read correctly with quotes; Bauska (19 files) and IE67 (two builders) round-trip exactly |
| 9 Builders | `builder:` bindings, `builderSheet` / `generateBuilderCopies`, `checks/identity.ts` (step 8 rule), `library/statements.ts`, Teksti tab | finds the FF error in Bauska; silent on SANART; a 2026 sweep found 6 packs with problems (FF; our name misspelt "BŪVDZIAINS" in 4; NORD SW copy naming INO) |
| 10 Board | `board/discover.ts`, `ipc/board.ts`, Tāfele screen | all 53 open folders with a deadline; tracker rows assigned one-to-one; Tilde deadline cited from the uzaicinājums |
| 11 Pricing | `shared/pricing.ts`, `v1/pricing.ts`, `ipc/pricing.ts`, Cenas screen | LIDL Slokas 161: 179 233,66 / 253 983,66 to the cent; flags the Demontāža row (7 176 ≠ 3 980 × 1,2) |
| 12 Light types | `checks/anonymity.ts` (step 8 rule), submission panel, framework inherit | Matīsa 8 clean, devīze NES718; an injected name caught; Tilde cenu aptauja end to end in code |

Tests: 387 — 346 pass, 0 fail, 41 skip (the `E:\BV BIM` fixtures are not on this PC). Run with `KONKURSS_PY=<repo>\.build-venv\Scripts\python.exe` so the Python-side tests have their libraries.

**Build (2026-11-06, v0.2.0):** `release\Konkursu App Setup 0.2.0.exe` and `release\win-unpacked\`. The document tools were frozen with the PC's Python 3.13.17 (`KONKURSS_BUILD_PY=…\Python313\python.exe npm run build:tools`; the default stays `py -3.14`). `scripts/packaged-mcp-check.mts` on RNP Ulbroka: the packaged tool server reads docx, pdf and .edoc with Python unreachable.

**Word writing verified through the frozen tools:** builder copies of the real Bauska 9. pielikums (each builder's own reg. Nr. in the sentence where the submitted copy had ours — `fill/blanks.ts` fills blanks by their bracket hint), a statement from the real Bauska wording, the builder price offer.

**Not verified here:** the GUI — not run (Boris playtests).

**Deviations from the plan:**
- The builder price offer is a Word document (`write_docx` table), not an xlsx in the office layout.
- The profile is read by code rules, not by the model.
- D1 default taken: "Pievienot app" from the board pre-fills the output folder as `<tender>\IESNIEDZAMIE` (on B:\). It is shown in the wizard and can be changed; switch the default in `ipc/board.ts` → `board:projectFolders` if B:\ must stay untouched.
- D2: the shared library folder is a setting (Iestatījumi › Mapes), empty by default = per-PC as before.
- D3 answered by the data: 2026 is in the same workbook in a new layout, now imported.
