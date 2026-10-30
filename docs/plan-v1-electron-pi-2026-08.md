# Tender App (Konkursu App) — implementation plan

**Language rule for this document:** English throughout. Latvian is retained only where it is content rather than prose — interface strings shown inside wireframes, Latvian domain terms with no clean English equivalent (nolikums, būvatļauja, atsauksme, energosertifikāts, būvprojekta vadītājs / BPV, pretendents, lietvede), and real file names.

---

## Context

Chain of work: (1) a completed tender (LNP 2026/96, Salacgrīva) was analysed file by file → (2) that produced the `konkurss` skill, tender-agnostic → (3) **now: an app so the same knowledge can be used by people who do not work with AI agents.**

The skill is the Claude-side interface — I read markdown and run scripts. The app is the same knowledge for the **BŪVDIZAINS office**.

**Primary user: the lietvede.** She knows tenders, būvatļaujas, atsauksmes and deadlines. She has **zero AI-agent knowledge** — no prompts, no terminal, no markdown, and no way to tell when a model is confidently wrong. Boris is the power user and can do anything; the app is designed for her.

Salacgrīva is a **test fixture with a known-correct answer**, not the design target. No tender data may live in the code.

**Why scripts alone cannot do this:** most tender information does not arrive in fixed templates parseable the same way every time. Nolikums prose, evaluation criteria, Q&A impact and form field labels differ per procurer. That requires a language model inside the app, not regex.

---

## The goal, stated concretely

The finished product is the submitted package. Counted from the real one:

**36 files — 9 we author, 27 we collect.**

| Block | Files | What it is | Who produces it |
|---|---|---|---|
| `1_` | 2 | Pieteikums, Apliecinājums par neatkarību | **we fill** |
| `2_0` | 1 | Kvalifikācija (company experience + specialists + subcontractors) | **we fill** |
| `2_1…2_7` | 6 | Company experience evidence — atsauksmes, būvatļaujas, energosertifikāti | **we collect** |
| `3_0`, `3_1` (root) | 2 + 2 signed | Specialist declaration, subcontractor declaration | **we fill**, they sign |
| `3_x` in `Kalnins\` | 2 + 2 signed + 14 | BPV experience form, scoring form, and the BPV's evidence dossier | **we fill** 2, **collect** 14 |
| `4_0` | 1 + 1 signed | Saimnieciski izdevīgākā piedāvājuma veidlapa | **we fill**, BPV signs |
| `5_` | 1 | Tehniskais piedāvājums | **we write** |
| separate folder | 1 | Finanšu piedāvājums — kept outside `IESNIEDZAMIE\` | **we fill** |

Two consequences I had underweighted:

**1. Collecting and correctly naming evidence is the bulk of the work.** Nine documents are authored; twenty-three are hunted down in previous tender folders, renamed to the right number, and placed in the right folder — including a subfolder named after the BPV's surname so that person can sign their own dossier. That is where a lietvede spends her time and where mistakes are silent. The app's evidence step is therefore not a minor feature; it is one of the two main reasons the app exists.

**2. The signature pattern is visible in the file set and must be derived from the mapping, not the documents.**

| Signed by | Result in package | Files |
|---|---|---|
| Kreics via EIS unified signature | plain `.docx`, no twin | Pieteikums, Apliecinājums, Kvalifikācija, Tehniskais, Finanšu |
| Someone else, with eParaksts | `.docx` draft **plus** returned `.edoc` | specialist declaration, subcontractor declaration, BPV experience, scoring form |

Verified wrinkle: `3_0EL_ESS proj. apliecinajums.docx` carries an EIS-signature footer, yet its `.edoc` twin was signed by Musijenko with a secure e-signature. The boilerplate footer is unreliable. **Expected signer must come from the document type and the mapping — never from text inside the document.**

---

## Decisions taken

| # | Question | Decision | Consequence |
|---|---|---|---|
| D1 | Confidentiality boundary for model calls | **Everything may go to the model** | I flagged that pre-deadline bid prices reaching a cloud provider is a real exposure; the decision stands. The network-blocking design is dropped and price redaction is no longer a hard gate. |
| D2 | Roles and permissions | **No roles — same app, same rights** | Nobody is gated, so error containment must come from the interface (D6), not from permissions. |
| D3 | Where the model stops and code starts | **Model reads, maps, drafts and performs substance checks. Code writes files, does all arithmetic and all exact comparisons.** | They fail in opposite directions. Model: what does this clause require, which field is this label, write this paragraph, does our text answer the specification, does this atsauksme prove this claim. Code: docx/xlsx writing, sums, string and number equality, file presence. |
| D4 | Machines and data location | **Local app, local files** | No sync, no locking, no shared-path design. Not to be reintroduced. |
| D5 | Documents that are not fillable .docx tables | **A value sheet is the primary output**; files are generated where the format allows | Value sheet: every required value, where it goes, where it came from, copyable. Native filling for .docx and .xlsx, boilerplate generation for free-form documents, copy-from-sheet for PDF forms and EIS web fields. |
| D6 | How a non-expert catches a wrong reading | **A citation for every value, plus an independent second pass on the critical few** | Every model-asserted value shows the exact source sentence and jumps to it in the document. Ungrounded output is never displayed as a value — it becomes an empty field marked „nav atrasts, jāaizpilda pašai". Deadline, evaluation criteria and qualification thresholds are re-extracted independently and disagreements surface as conflicts. |
| D7 | Where the app's job begins | **A feasibility verdict** after requirements are read; **no EIS monitoring** | The verdict answers: can we qualify at all, what is missing, what score is realistically reachable. It reuses the mapping logic. EIS has no stable interface to watch. |
| D8 | Model providers and credentials | **The BIM-Crew pattern** — subscription providers over OAuth (Anthropic, OpenAI Codex) plus API-key providers (OpenRouter, DeepSeek, others), switchable in settings at any time | Verified against the real implementation; see "Provider layer". |
| D9 | Free-form documents (tehniskais piedāvājums) | **Boilerplate base, model adapts only the tender-specific parts, every touched paragraph marked** | Never generated from nothing. Untouched text stays byte-identical to what has already been submitted successfully. A human reviews a short diff, not a wall of new text. |

### Open

- What the app does when the provider is unavailable or returns something unusable
- Whether output is a draft reviewed in Word or treated as final *(question was dismissed — unresolved)*
- Where the app stops relative to EIS submission
- How much should accumulate across tenders (recurring requirement patterns, what wins)
- What happens to the `konkurss` skill once the registers live in the app

---

## Provider layer — copied from BIM-Crew, not invented

Read from `D:\Code\BIM\BIM Crew\apps\server\src\agent.ts` and `cli/login-*.ts`.

- Library: `@earendil-works/pi-ai` with `pi-agent-core` — model registry, OAuth flows, credential refresh. Upstream mirrored at `.opensrc\repos\github.com\earendil-works\pi`.
- **Subscription providers** authenticate over OAuth and use the existing Claude or ChatGPT subscription instead of metered API billing: `loginAnthropic`, `loginOpenAICodex`. Credentials live in an OAuth file and rotated credentials are written back (`resolveOAuthKey`, `agent.ts:104`).
- **API-key providers**: OpenRouter, DeepSeek, OpenAI, Google, xAI, plus a `custom` OpenAI-compatible base URL.
- Resolution order (`resolveApiKey`, `agent.ts:128`): key entered in settings → OAuth file → environment variable.
- A provider catalogue (`KNOWN_PROVIDERS`, `agent.ts:303`) drives a settings screen showing each provider's status and offering a login action where relevant.
- Active provider and model live in settings, are overridable per call, and resolve in one place (`resolveAgentModel`).

In this app: one settings screen, a `[Pieslēgties]` action for subscription providers, key fields for the rest, and a model choice per task class — a strong model for reading the nolikums, a cheap one for bulk extraction. The lietvede never sees a key; Boris configures it once.

---

# I. WHO IT IS FOR, AND WHAT THAT CHANGES

| | Lietvede (primary) | Boris (power user) |
|---|---|---|
| Knows | Tenders, construction, documents | The same, plus code and agents |
| Does not know | File paths as a concept, JSON, scripts, what a model can be trusted with | — |
| Expects | The app to say what comes next | The app not to hide detail |

Seven consequences:

1. **No computer vocabulary in the interface.** Not "extraction", "validation", "profile", "JSON", but „nolasīt dokumentu tekstu", „pārbaude", „veidlapas sasaiste". Domain words stay — that is her language.

2. **Errors state the consequence, not a rule number.**
   Not: `R6: BPV mismatch`
   But: „Kvalifikācijā kā atbildīgais būvprojekta vadītājs norādīts Aigars Tereško, bet punktus prasi par Anda Kalniņa pieredzi. Komisija punktus piešķir tam vadītājam, kurš norādīts kvalifikācijā — šie 35 punkti var netikt piešķirti." plus a `[Salāgot]` button.

3. **Every screen states what it is for and why it matters** — two lines, not a manual. The content already exists in the skill (`krustparbaude.md` traps, the form recipes) and only needs translating into plain Latvian.

4. **No JSON editing anywhere.** Registers get real forms. If the app ever asks someone to edit a file, that is a design defect.

5. **Setup is a screen, not a README.** A missing dependency produces „Datorā trūkst rīka, ko app izmanto dokumentu lasīšanai", a download button, four illustrated steps, `[Pārbaudīt vēlreiz]`, and a bundled `uzstadit.bat`. Never a stack trace.

6. **Nothing can be broken.** Originals are never modified, nothing is ever deleted, drafts are backed up before being overwritten. The app states this on screen — a person afraid of pressing a button will not use it.

7. **Model output is always traceable** (D6). She cannot judge a model, but she can read one Latvian sentence and say whether it matches.

**Tone:** Latvian, short, no exclamation marks. Buttons are verbs. Warnings open with what will happen, not with what the app detected.

---

# II. HOW IT IS USED

A tender takes **one to three weeks with interruptions**. Two modes: deep work of one to two hours, and a two-to-five-minute check. The main value is therefore **restoring context** — opening the app after five days and immediately seeing where work stopped.

## Full cycle

**Day 1 — tender found on EIS.** `[+ Jauns konkurss]` takes date, place, object and where to create the folder. The app creates it with three subfolders and lists what to download from EIS. Files get dropped in.
→ **1. Dokumenti**: `[Pārskatīt mapi]` recognises 24 files by type. `[Nolasīt tekstu]` takes about ninety seconds. Two PDFs are marked „šie ir skenēti attēli, tekstu nolasīt nevar".

**Day 1, continued.** → **2. Kura versija spēkā**: two nolikums editions found. „Nolikumu drīkst grozīt pēc publicēšanas. Ja strādāsi ar veco, vari izpildīt prasību, kas vairs nav spēkā." One substantive change is found and she marks the amended edition as being in force. Nine Q&A items, each tagged for whether it changes a requirement or the scope. The template comparison turns red: **the separately issued qualification form has four specialist rows, the nolikums has five.** The deadline is entered from the IUB notice.

**Day 2.** → **3. Ko konkurss prasa**: `[Izlasīt no nolikuma]` per block. The model proposes and each value carries the sentence it came from; she reads the quote and confirms. Fifteen minutes later there is a structured register — documents to submit, experience requirement, specialist fields, evaluation criteria, subcontractor threshold.

**Day 2, immediately after.** → **4. Vai varam pieteikties**: „Atbilstam 4 no 5 speciālistu prasībām. Trūkst elektronisko sakaru projektētāja. Pieredzes objekti: 3 no 3. Reālais punktu maksimums 96 no 100." The decision to bid is made on evidence, before any filling work starts.

**Day 3.** → **5. Kas ko dara**: four fields match our own people, the fifth is empty with „Reģistrā nav neviena ar šo sfēru". Choosing a subcontractor shows „Šī izvēle prasa vēl divus dokumentus" and those appear in step 6. Experience dropdowns grey out non-qualifying objects **with the reason**: `rūpnieciska ēka — prasa publisku`, `apkure E — nav energoefektīvs`, `akcepts 2024 — ārpus 3 gadu loga`. Prices go in the 🔒 section; VAT and totals are computed by code.

**Days 5–7.** → **6. Aizpildīt**: each document gets a **value sheet** — every value, where it goes, where it came from. Where the format allows, the file is filled natively. The tehniskais piedāvājums is adapted from our boilerplate with changed paragraphs highlighted. Empty fields with no data are yellow and **block file creation** — the app does not invent data.

**Day 8.** → **7. Pierādījumi**: the app knows which objects were chosen and, from the register, where their evidence lives in previous tender folders. `[Savākt visu]` copies twenty-three files in with correct numbering and the BPV subfolder. One missing file shows as a red row.

**Day 9.** → **8. Pārbaude**: exact checks in code, substance checks by the model — does our tehniskais piedāvājums actually answer the specification, does this atsauksme actually prove the claimed experience. Two errors, each with a consequence and a button that goes to the fix.
→ **9. Paraksti**: three external signers, deadline in four days, so „Sāc prasīt parakstus tagad — pēdējā dienā cilvēki mēdz nebūt pieejami."

**Day 12.** Signed `.edoc` files arrive; the app reads who actually signed each one and compares against the expected signer from the mapping. ESPD and EIS are ticked. Submitted.

**A month later.** → **10. Rezultāts**: points, lessons, `[Pievienot objektu reģistram]`.

## Quick tasks

| Situation | Path |
|---|---|
| "Anything due this week?" | Open the app — top bar shows the deadline, the rail shows ⚠ |
| An atsauksme arrived by email | Step 7 → drop the file in → the row turns ✓ |
| "Is Musijenko's certificate still valid?" | Reģistri → Speciālisti |
| The procurer asks for a clarification | Step 10 → add it |

---

# III. VISUAL LANGUAGE

A tool for a construction office, sitting beside Revit and BIS — not a SaaS product. Its world is the technical drawing, the official stamp, the building-permit form.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F6F7F9` | `#15181D` | Window background |
| `--panel` | `#FFFFFF` | `#1C2027` | Cards, tables |
| `--rail` | `#EDEFF3` | `#12151A` | Left rail, top bar |
| `--ink` | `#1B2028` | `#E7EAEF` | Body text |
| `--ink-2` | `#5C6675` | `#96A0AF` | Secondary text |
| `--line` | `#D7DCE3` | `#2A2F38` | 1px borders |
| `--accent` | `#2B5C8A` | `#5B94C9` | Active step, primary buttons |
| `--critical` | `#B4342C` | `#E06B62` | Errors, deadline under 24 h |
| `--warning` | `#9A6B0C` | `#D9A22B` | Warnings, missing data |
| `--good` | `#2E6B4F` | `#5FA37E` | Done |
| `--secret` | `#6B4E8A` | `#A98BD1` | 🔒 prices |
| `--model` | `#3F6E5A` | `#7FB79C` | Model-derived value carrying a citation |

Neutrals carry a blue bias — a chosen grey rather than an inherited one. The accent is drafting blue.

**Type.** Segoe UI, because this is a Windows tool and should look like one: 13px body, 12px in tables, 11px hints. Consolas for data — paths, BIS numbers, certificates, sums — with `tabular-nums`. Headings 15px/600 and 13px/600. Table rows 28px.

**States — always shape plus colour plus text:**

| State | Icon | Colour |
|---|---|---|
| Not started | `○` | `--ink-2` |
| In progress | `◐` | `--accent` |
| Done | `●` | `--good` |
| Problems | `⚠` | `--critical` |
| Not applicable | `⊘` | `--ink-2` |
| Missing data | dotted border, yellow fill | `--warning` |
| Confidential | `🔒` plus a left bar | `--secret` |
| Read by the model | quote mark; click reveals the source sentence | `--model` |

The quote mark is load-bearing: it is how a non-expert distinguishes "the app read this in the document" from "a person typed this".

**Grid.** Minimum window 1280×800. Left rail 220px. Context panel 320px, collapsible. Spacing 16/12/8px.

---

# IV. SCREENS

Rail labels are named after the work, not after modules. Interface strings below are the actual Latvian text.

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ Konkursi  [260713_Salacgriva_Sila iela 2 ▾]  LNP 2026/96   ⏱ 3d 4h   [Čeklists 24/41]│
├─────────────────────┬────────────────────────────────────────────────────────────────┤
│ ● 1 Dokumenti       │                                                                │
│ ◐ 2 Kura versija    │                                                                │
│ ○ 3 Ko prasa        │              A C T I V E   S C R E E N                          │
│ ○ 4 Vai varam       │                                                                │
│ ○ 5 Kas ko dara     │                                                                │
│ ○ 6 Aizpildīt       │                                                                │
│ ○ 7 Pierādījumi     │                                                                │
│ ⚠ 8 Pārbaude        │                                                                │
│ ○ 9 Paraksti        │                                                                │
│ ○ 10 Rezultāts      │                                                                │
│ ───────────────     │                                                                │
│   Konkursi          │                                                                │
│   Reģistri          │                                                                │
│   Iestatījumi       │                                                                │
├─────────────────────┴────────────────────────────────────────────────────────────────┤
│ Gatavs ✓ · Nekas netiek dzēsts, oriģināli netiek mainīti · E:\BV BIM\…                │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

Every screen opens with two lines: what happens here, and why it matters. The status bar repeats the safety guarantee, which is there for the person afraid of breaking something.

## Konkursi — project list

> Šeit ir visi konkursi, pie kuriem strādā. Katram redzams, cik tālu tas ir un cik laika atlicis.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│  Konkursi                                        [+ Jauns konkurss] [+ Pievienot]│
├──────────────────────────────────────────────────────────────────────────────────┤
│  Salacgrīva, Sila iela 2            LNP 2026/96   13.07 10:00   ⚠ 2 jālabo       │
│  ▓▓▓▓▓▓░░░░  6 no 10 soļiem         mainīts vakar                           [×]  │
│ ─────────────────────────────────────────────────────────────────────────────────│
│  Limbaži, skolas pārbūve            LNP 2026/141  02.09 12:00   ◐ ko prasa       │
│  ▓░░░░░░░░░  1 no 10 soļiem         mainīts pirms 3 dienām                       │
└──────────────────────────────────────────────────────────────────────────────────┘
```
The human-readable name is primary; the folder path sits small underneath. `[×]` removes it from the list, with a note that the files stay on disk.

**"Jauns konkurss" dialog:** Datums (YYMMDD, defaulting to today) · Vieta · Objekts · where to create it, through a native folder dialog · three subfolder checkboxes, all on · a path preview. After creation, the EIS download reminder list.

## 1. Dokumenti

> Šeit app pārskata konkursa mapi un nolasa visu dokumentu tekstu, lai tālāk varētu meklēt un salīdzināt.
> Skenētos PDF nolasīt nevar — tos jāpārbauda ar aci.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ [Pārskatīt mapi] [Nolasīt tekstu]   Kur ▾  Veids ▾  ☐ nenolasītie   [meklēt…]    │
├───────────────────────────────────────────────────────────┬──────────────────────┤
│ Dokuments                    Kur       Veids ▾     Teksts │  nolikums96_26_06…   │
│ nolikums96_26_06_groz….docx  Konkursa  Nolikums    ✓ [·]  │  [meklēt tekstā…]    │
│ Atbilde_uz_jaut…_26_06.edoc  Konkursa  Kom. atbilde ✓ [·] │  APSTIPRINĀTS        │
│ 2_1Atsauksme_…Menesg….edoc   Mūsu      Atsauksme   ✓ [·]  │  Limbažu novada…     │
│ 2_6Sakotnejais EEN.pdf       Mūsu      Energosert. ⚠ [·]  │                      │
├───────────────────────────────────────────────────────────┴──────────────────────┤
│ ⚠ Divi dokumenti ir skenēti attēli — tekstu nolasīt nevar. Pārbaudi tos ar aci.  │
│ ⚠ Nosaukumu kārtība: 3_0BPV Pieredze.docx parasti liek apakšmapē  [Pārvietot]    │
└──────────────────────────────────────────────────────────────────────────────────┘
```
"Kur" is Konkursa dokumenti / Mūsu piedāvājums / Darba faili. "Veids" is **editable** — the app guesses, the person corrects.

## 2. Kura versija spēkā

> Nolikumu drīkst grozīt pēc publicēšanas, un komisijas atbildes var mainīt vērtēšanas kritērijus.
> Ja strādāsi ar veco redakciju, vari izpildīt prasību, kas vairs nav spēkā.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ NOLIKUMA REDAKCIJAS                                                              │
│ Sākotnējā [nolikums96_28_05_2.docx ▾]  Grozītā [nolikums96_26_06….docx ▾] [Salīdz]│
│ ┌──────────────────────────────────────────────────────────────────────────────┐ │
│ │ Bija:  …par pabeigtu projektu izmērīto energoefektivitāti…                   │ │
│ │ Kļuva: …par pabeigtu projektu aprēķinātajiem vai izmērītajiem…               │ │
│ │        ● maina vērtēšanas kritēriju ○ maina prasību ○ redakcionāla            │ │
│ └──────────────────────────────────────────────────────────────────────────────┘ │
│ Strādājam ar:  ○ sākotnējo   ● grozīto redakciju                                 │
├──────────────────────────────────────────────────────────────────────────────────┤
│ KOMISIJAS ATBILDES                                                 9 jautājumi   │
│ 1 │ Vai fasādes siltināšana visai ēkai? │ Visai ēkai │ maina apjomu ▾  │ ☑       │
│ 9 │ Par kritēriju Nr.3…                 │ Groza…     │ maina kritēriju▾│ ☑       │
│   Ietekmi piedāvā app „ ", tu apstiprini                                         │
├──────────────────────────────────────────────────────────────────────────────────┤
│ VEIDLAPU SALĪDZINĀJUMS                                                           │
│ ⚠ Kvalifikācijas veidlapa: atsevišķi izsniegtajā 4 speciālistu rindas, nolikumā 5│
│   Aizpildi pēc nolikuma — tur ir pilnākā versija.    Pieteikums: vienādas ✓      │
├──────────────────────────────────────────────────────────────────────────────────┤
│ IESNIEGŠANAS TERMIŅŠ  [13.07.2026] [10:00]  ● IUB paziņojums ○ EIS kartīte  „ "  │
│ Termiņš nav nolikumā — to skatās IUB paziņojumā par līgumu vai EIS.              │
└──────────────────────────────────────────────────────────────────────────────────┘
```
Q&A impact is model-proposed and human-confirmed. The deadline is one of the three values that receive the D6 second pass.

## 3. Ko konkurss prasa

> App izlasa nolikumu un piedāvā, ko tas prasa. Pie katras vērtības redzams teikums, no kura tā nolasīta — izlasi un apstiprini.
> Visi turpmākie soļi balstās uz šo.

An accordion of six blocks, each with `[Izlasīt no nolikuma]` and `☑ Pārbaudīts`. Every model-derived value carries the quote mark; clicking it opens the source sentence in context.

```
│ ▸ Konkursa dati (pasūtītājs, ID, termiņi)                          ☑ Pārbaudīts │
│ ▸ Kas jāiesniedz (11 dokumenti)                                    ☑ Pārbaudīts │
│ ▸ Uzņēmuma pieredze                                                ☑ Pārbaudīts │
│ ▾ Kādi speciālisti vajadzīgi (5)                  [Izlasīt]        ☐ Pārbaudīts │
│   Joma                          Kāds sertifikāts vajadzīgs    Obl.  Avots       │
│   Atbildīgais būvprojekta vad.  arhitekta prakses sertifikāts   ☑   „ 2.2.1.   │
│   Ūdensapgāde un kanalizācija   attiecīgās jomas sertifikāts    ☑   „ 2.2.2.   │
│   Elektroietaišu projektēšana   attiecīgās jomas sertifikāts    ☑   „ 2.2.3.   │
│   Elektronisko sakaru sistēmas  attiecīgās jomas sertifikāts    ☑   „ 2.2.4.   │
│   Siltumapgāde, ventilācija     attiecīgās jomas sertifikāts    ☑   „ 2.2.5.   │
│   ✓ Skaits sakrīt ar nolikuma veidlapu                  [+ Pievienot jomu]     │
│ ▾ Kā vērtē piedāvājumus (3 kritēriji)             [Izlasīt]        ☐ Pārbaudīts │
│   Kritērijs              Punkti  Kā rēķina          Cik objektu   Avots         │
│   Piedāvājuma cena         65    lētākais = 65 p.   —             „ 3.5.       │
│   BPV pieredze             30    3 obj.=30, 2=20…   [3]           „ 3.5.       │
│   Energoefektīva pieredze   5    ir / nav           [1]           „ 3.5.       │
│                                                     Kopā 100 ✓                 │
│ ⚠ Vienu vērtību app neatrada: apakšuzņēmēju slieksnis — ievadi pati            │
```

## 4. Vai varam pieteikties — feasibility verdict (D7)

> Pirms sāc aizpildīt, app salīdzina konkursa prasības ar mūsu reģistriem un pasaka, vai vispār varam kvalificēties un cik punktus reāli varam iegūt.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ SPECIĀLISTI            4 no 5 prasībām                                           │
│ ✓ Atbildīgais BPV · ✓ Ūdensapgāde · ✓ Elektroietaišu · ✓ Siltumapgāde            │
│ ✗ Elektronisko sakaru sistēmas — reģistrā nav neviena. Vajag apakšuzņēmēju.      │
├──────────────────────────────────────────────────────────────────────────────────┤
│ PIEREDZE               3 no 3 vietām                                             │
│ ✓ Uzņēmuma pieredze 1/1 · ✓ BPV pieredze 3/3 · ✓ Energoefektīva 1/1              │
├──────────────────────────────────────────────────────────────────────────────────┤
│ REĀLAIS PUNKTU MAKSIMUMS                                                         │
│ Cena 65 (atkarīgs no konkurentiem) + BPV pieredze 30 + Energoefektīva 5 = 100    │
│ Ja neatrisina elektronisko sakaru speciālistu — piedāvājumu var noraidīt         │
├──────────────────────────────────────────────────────────────────────────────────┤
│ Lēmums:  ○ Pieteiksimies   ○ Nepieteiksimies   [Pamatojums……………]  [Saglabāt]     │
└──────────────────────────────────────────────────────────────────────────────────┘
```

## 5. Kas ko dara

> Šeit savieno konkursa prasības ar mūsu cilvēkiem un objektiem. Katra izvēle var radīt papildu dokumentus — app pateiks, kādus.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ⚠ Kvalifikācijā kā atbildīgais būvprojekta vadītājs būs Aigars Tereško, bet      │
│   punktus prasi par Anda Kalniņa pieredzi. Punktus piešķir tam vadītājam, kurš   │
│   norādīts kvalifikācijā — šie 35 punkti var netikt piešķirti.      [Salāgot]    │
├──────────────────────────────────────────────────────────────────────────────────┤
│ SPECIĀLISTI                                                                      │
│ Joma                 Kurš               Sertifikāts  Derīgs   Rada dokumentus    │
│ Atbildīgais BPV      [Andis Kalniņš ▾]  1-00619      2027-03  —                  │
│ Ūdensapgāde/kanaliz. [Aija Gaile ▾]     3-00104      2028-01  —                  │
│ Elektroietaišu       [Igors Musijenko▾] 3-00620      2027-11  ⊕ 2 dokumenti      │
│                      apakšuzņēmējs SIA „3D Vājstrāvu Sistēmas"                   │
│ Elektronisko sakaru  [— nav neviena ▾]  —            —        ⚠                  │
│ Siltumapgāde         [Jānis Jurševskis▾] 3-01706     2026-09  —                  │
├──────────────────────────────────────────────────────────────────────────────────┤
│ PIEREDZES OBJEKTI                                                                │
│ Uzņēmuma pieredze — prasa 1 objektu (der iesniegt 1–2, vairāk nevajag)           │
│   1 [Mēnesgaismas, Mārupe ▾]   ✓ atsauksme ✓ būvatļauja ✓ energosertifikāts      │
│ BPV pieredze — 3 objekti dod 30 punktus                                          │
│   1 [Mēnesgaismas ▾]  2 [Anniņmuiža ▾]  3 [Saulkrastu sporta centrs ▾]           │
│      sarakstā pelēks: BAM Kuldīga — rūpnieciska ēka, prasa publisku              │
│ Energoefektīva pieredze — 1 objekts dod 5 punktus                                │
│   1 [Mēnesgaismas ▾]  pelēks: Saulkrasti — apkure E, nav energoefektīvs          │
├──────────────────────────────────────────────────────────────────────────────────┤
│ 🔒 CENAS                                                                         │
│ Būvniecības ieceres dokumentācija   75 000,00   +21% 15 750,00   90 750,00       │
│ Autoruzraudzība                      5 000,00   +21%  1 050,00    6 050,00       │
│ KOPĀ                                80 000,00        16 800,00   96 800,00       │
│ Summa, ko ievadīsi EIS sistēmā      [80 000,00]                                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```
Greyed-out objects with a stated reason are the core value of this screen: the person sees **why** an object does not qualify instead of guessing. All arithmetic is code, never the model (D3).

## 6. Aizpildīt

> App saliek katram dokumentam sarakstu, kas kur jāieraksta un no kurienes tas nāk. Kur formāts ļauj, app aizpilda failu pati.
> Oriģinālās veidlapas netiek mainītas. Ja kāda vieta nav zināma, app to atstāj tukšu un pasaka — tā neizdomā datus.

```
┌───────────────────────────┬──────────────────────────────────────────────────────┐
│ DOKUMENTI          7 no 9 │ Kvalifikācijas veidlapa                              │
│ ● Pieteikums              │ Veidlapa: Kvalifikacija_96_1.docx  [Apskatīt oriģ.]  │
│ ● Apliecinājums par neatk.│ ┌──────────────────────────────────────────────────┐ │
│ ◐ Kvalifikācija        ◀  │ │ Kas jāieraksta      No kurienes ▾  Kas tur būs   │ │
│ ● Finanšu piedāvājums     │ │ 1. spec. vārds      5. solis      Andis Kalniņš  │ │
│ ● Vērtēšanas veidlapa     │ │ 1. spec. sertifikāts Reģistrs     1-00619        │ │
│ ● BPV pieredze            │ │ 4. spec. vārds      5. solis      ⚠ nav izvēlēts │ │
│ ○ Tehniskais piedāvājums  │ │ Apakšuzņ. apjoms    Lēmums        ≥ 10 000,00    │ │
│ ○ Spec. apliecinājums     │ └──────────────────────────────────────────────────┘ │
│ ○ Apakšuzņ. apliecinājums │ ⚠ Viena vieta bez datiem — failu neizveidos, līdz    │
│                           │   izvēlies elektronisko sakaru speciālistu (5. solis)│
│                           │ [Aizpildīt] [Kopēt sarakstu] [Izveidot failu]        │
├───────────────────────────┴──────────────────────────────────────────────────────┤
│ Vērtību saraksti 9 no 9 · Faili 7 no 9 · Oriģināli nav mainīti ✓                 │
└──────────────────────────────────────────────────────────────────────────────────┘
```
The value sheet exists for **every** document (D5); `[Izveidot failu]` is enabled only where the format allows. "No kurienes" is changeable — when the model maps a field wrongly the person repoints it, and the correction is remembered for the next similar form.

For the tehniskais piedāvājums this screen switches to a diff view (D9): boilerplate on the left, model-adapted paragraphs highlighted, `[Pieņemt]` and `[Atmest]` per paragraph.

## 7. Pierādījumi

> Katram pieredzes objektam vajag pierādījumus. App zina, kur tie glabājas no iepriekšējiem konkursiem, un var tos atnest.

This is one of the two screens that justify the app — twenty-three of the thirty-six submitted files pass through here.

```
│ Objekts             atsauksme būvatļauja energosert. akts pilnvara   Darbība    │
│ Mēnesgaismas            ✓         ✓          ✓        –      –      [Atnest]   │
│ Anniņmuiža              ✓         ✓          ✓        ✓      ✓      [Atnest]   │
│ Saulkrastu sp. centrs   ✗         ✓          ✓        ✓      –      [Meklēt]   │
│                      trūkst — atsauksmes fails nav atrasts norādītajā vietā     │
├─────────────────────────────────────────────────────────────────────────────────│
│ KUR TOS LIKS                                                                    │
│ Uzņēmuma pieredzei →  Mūsu piedāvājums\    2_1Atsauksme…  2_2Buvatlauja…        │
│ BPV pieredzei      →  Mūsu piedāvājums\[Kalnins]\  3_1Atsauksme…                │
│                       apakšmape, lai BPV var parakstīt savu komplektu           │
│ Finanšu piedāvājums →  atsevišķā mapē (ne kopā ar pārējiem)                     │
```

## 8. Pārbaude

> Pārbaudes pirms iesniegšanas. Tās atrod tieši tās kļūdas, kas iepriekš maksājušas punktus.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ [Pārbaudīt]     ✗ 2 jālabo   ⚠ 3 jāpaskatās   ✓ 7 kārtībā   ⊘ 2 neattiecas       │
├──────────────────────────────────────────────────────────────────────────────────┤
│ ✗ Būvprojekta vadītājs nesakrīt                                       precīza   │
│   Kvalifikācijā norādīts Aigars Tereško (1-00076), bet punktus prasi par Anda    │
│   Kalniņa (1-00619) pieredzi. Komisija punktus piešķir tam vadītājam, kurš       │
│   norādīts kvalifikācijā — 35 punkti var netikt piešķirti.                       │
│   Kur redzams: Kvalifikācija, 17. rinda · Vērtēšanas veidlapa, 5. rinda          │
│                                                          [Salāgot] [Apskatīt]    │
├──────────────────────────────────────────────────────────────────────────────────┤
│ ⚠ Tehniskais piedāvājums neatbild uz vienu spec. prasību              satura    │
│   Specifikācija prasa zibensaizsardzību visai ēkai (komisijas atbilde Nr.7), bet │
│   tehniskajā piedāvājumā par to nav nekā.                     [Apskatīt vietu]   │
├──────────────────────────────────────────────────────────────────────────────────┤
│ ⊘ NEATTIECAS (2)                                                    [izvērst ▾]  │
│   Energoklašu salīdzinājums — šis konkurss energoefektivitāti nevērtē            │
└──────────────────────────────────────────────────────────────────────────────────┘
```
Two labelled kinds of check: **precīza**, done in code — numbers, strings, files present — and **satura**, done by the model, which asks whether our text answers the specification and whether an atsauksme proves the claim it is offered for. Substance findings always cite both sides. Every finding gives what will happen, where it is visible, and a button to the fix. No rule numbers.

## 9. Paraksti

> Katru dokumentu paraksta noteikta persona. App nolasa, kas tos patiešām parakstījis, un salīdzina.

```
│ Dokuments              Kam jāparaksta     Kā          Kas parakstījis   Statuss  │
│ Pieteikums             Jānis Kreics       EIS         Jānis Kreics      ✓        │
│ Vērtēšanas veidlapa    Andis Kalniņš      eParaksts   A. KALNIŅŠ 10.07  ✓        │
│ Apakšuzņ. apliecinājums Ieva Musijenko    eParaksts   —                 ○ nav    │
├─────────────────────────────────────────────────────────────────────────────────│
│ ⚠ Līdz termiņam 3 dienas. Sāc prasīt parakstus tagad.                           │
│   Ieva Musijenko (apakšuzņēmēja apliecinājums)      [Sagatavot vēstuli]         │
├─────────────────────────────────────────────────────────────────────────────────│
│ ESPD (aizpilda EIS sistēmā)  ☑ II ☑ III ☑ IV ☑ VI  ☑ apakšuzņēmējiem III        │
│ EIS summa 80 000,00  ☑ Ievadīta   ☐ Piedāvājums iesniegts                       │
```
"Kam jāparaksta" comes from the document type and the mapping, never from text inside the file — the boilerplate footer is unreliable, as verified in the real package.

## 10. Rezultāts

> Ko iesniedza, kas notika, un ko no tā paņemt nākamajam konkursam.

Iesniegts (datetime) · Rezultāts ▾ · Mūsu punkti · Uzvarētāja punkti · Komisijas pieprasījumi · Mācības.
If won, computed deadlines: līgums within 7 working days, sabiedrības līgums within 10 days.
`[Pievienot objektu reģistram]`, with a reminder to collect the atsauksme, būvatļauja and energosertifikāts immediately while the client is still responsive.

## Reģistri

> Mūsu pastāvīgie dati — uzņēmums, speciālisti, iepriekšējie objekti. Tos aizpilda vienreiz un lieto visos konkursos.

Three sub-tabs, all **forms, never JSON**. The specialists table has a validity column that warns when a certificate expires within three months, plus a „Jomas, kurām nav neviena" panel. Objects get a list plus a detail form containing every field the forms need and the locations of the evidence files.

## Iestatījumi

Provider list with per-provider status from the BIM-Crew catalogue: `[Pieslēgties]` for Anthropic and OpenAI Codex over OAuth, key fields for OpenRouter, DeepSeek and the rest, and a model choice per task class. Also the dependency check with its friendly install screen, and the audit log viewer.

---

# V. TENDER-AGNOSTICISM

The next tender will have a different procurer, different nolikums wording, different annex numbering, and possibly a different subject — būvdarbi rather than projektēšana.

| Layer | Changes? | Where |
|---|---|---|
| Company, specialists, objects, boilerplate | no | `<app>/data/` |
| Form field mapping memory | accumulates | `<app>/data/profiles/` |
| Requirements, criteria, fields, deadline, prices | per tender | `<tender>/workflow/` |
| Check logic | no | `rules/` |
| Check parameters | per tender | requirements register |

**Three consequences:**

1. **No hardcoded lists of fields, criteria or documents.** Everything comes from step 3, confirmed by a human. A hardcoded field list would work for Salacgrīva and silently mislead on a būvdarbi tender.

2. **Every check first asks whether this tender requires it.** If not, `⊘ neattiecas` with an explanation — not an error, and not silence.
   - "are the five known fields present" becomes **"does every confirmed field have a person, and does it appear in the filled form"**
   - "find Tereško or Kalniņš" becomes **"the person holding the BPV role in step 5 equals the person in the scoring forms equals the autoruzraugs in the tehniskais piedāvājums"**

3. **Field mapping is learned, not guessed.** Labels differ between procurers — „Pretendenta nosaukums", „Pretendents (nosaukums)", „Piegādātājs". The model proposes a mapping, the person corrects it, and the correction is saved against the **form's skeleton** — its table, row and column structure plus the label strings — rather than the file name. The next similar form then fills correctly straight away.

---

# VI. TECHNICAL

## Stack

Electron 43 on Node 24 · React 19 with Vite · `contextIsolation: true`, `nodeIntegration: false`, a narrow preload IPC surface · no HTTP port · JSON and JSONL files, no native modules · a Python 3.14 sidecar (`python-docx`, PyMuPDF, `openpyxl`, antiword) behind a friendly install screen and `uzstadit.bat` · `@earendil-works/pi-ai` for the provider layer · electron-builder producing a portable .exe.

**Safety.** Originals are never modified — output goes to `workflow/melnraksti/`, with `.backup/<timestamp>/` written before any overwrite. Nothing is ever deleted. `data/audit.jsonl` records every write and every model call with provider, model and cost. Prices live in their own file.

## Model layer

- `llm/tasks/*.js` — one module per model task, each carrying its prompt, an expected output schema, and a **citation requirement**: every value must arrive with a verbatim quote from the source or be returned as `not_found`.
- Tasks: `readRequirements`, `classifyQaImpact`, `compareTemplates`, `mapFormFields`, `adaptTechnicalProposal`, `checkSubstance`.
- `llm/verify.js` — the D6 second pass over deadline, evaluation criteria and qualification thresholds: re-extract independently, compare, and surface disagreement as a visible conflict rather than a silent choice.
- Grounding is enforced in code, not requested in a prompt: a returned value whose quote is not found verbatim in the source text is rejected and displayed as „nav atrasts".

## IPC surface (`preload.js` → `window.konkurss`)

```
projects.list/create/add/remove/get
files.scan/read/text/setKind/rename
versions.diff/setActive/qa/setQaImpact/compareTemplates/setDeadline
requirements.get/read/save/confirmBlock
feasibility.compute/saveDecision
mapping.get/save/candidates          // candidates returns exclusion reasons
finance.get/save
fill.docs/valueSheet/autofill/generate/saveProfile
proofs.plan/collect/verify
checks.run/ack
signatures.read/expected/setEspd/setEis
closeout.get/save/addObjectToRegister
registers.get/save
settings.providers/login/setKey/setModel/diagnostics/auditTail
```

## Data

`<tender>/workflow/project.json` — files, versions, requirements with citations, feasibility, mapping, value sheets, fills, proofs, checks, signatures, closeout, checklist
`<tender>/workflow/finanses.json` — rows, total, EIS amount
`<app>/data/registers/{uznemums,specialisti,objekti}.json`
`<app>/data/profiles/<skeletonHash>.json` — label, skeleton signature, bindings, seen-in list
`<app>/data/audit.jsonl`

## Files

```
main/index.js · main/ipc/*.js · main/lib/{audit,backup,paths,pyrun,classify,providers}.js
llm/tasks/*.js · llm/verify.js
rules/*.js (exact checks) · recipes/*.js (nine form recipes)
python/{read_all,read_docx,read_pdf,inspect_template,fill_docx,fill_xlsx,docx_from_template,read_signers}.py
renderer/App.jsx · renderer/screens/*.jsx · renderer/components/*
preload.js · data/registers/*.json · data/templates/*.docx · uzstadit.bat
```

## Phases

Each phase is verified against **two fixtures**: A is the completed tender with a known-correct answer, B is a different tender with a different procurer, different criteria and no energy-efficiency criterion.

| # | Content | Done when |
|---|---|---|
| 1 | Shell, install screen, provider settings and login, audit, project list, **1. Dokumenti** | Folder created; A reads 61 files; B's different structure is recognised; type corrections persist; provider login works |
| 2 | **2. Kura versija** and **3. Ko prasa**, with citations and the second pass | A finds the criterion change and the four-versus-five row difference; B's requirements are read from a different nolikums; ungrounded values appear as „nav atrasts" |
| 3 | **4. Vai varam**, **5. Kas ko dara**, prices | Verdict computed from requirements rather than hardcoded; greyed objects state their reason; a subcontractor choice creates two documents; the BPV warning fires |
| 4 | **6. Aizpildīt** — value sheets, docx and xlsx filling, mapping memory, technical proposal diff | A value sheet exists for every document; missing data blocks file creation; a profile is reused on B; source file hashes unchanged |
| 5 | **7. Pierādījumi** | Twenty-three evidence files collected with correct numbering and the BPV subfolder; missing ones flagged |
| 6 | **8. Pārbaude** and **9. Paraksti** | Both check kinds run; A catches both known errors; B returns ⊘ for non-applicable checks; signers read from `.edoc`; deadline warning fires |
| 7 | **10. Rezultāts**, Reģistri, portable .exe | Result recorded; object added to the register; .exe runs on a clean machine |

## Verification

1. `node --test` per rule and per recipe, with three cases each: passes, fails, **not applicable**
2. Fixture A — full cycle; **must** catch the BPV mismatch and the missing specialist field; reads all eight signers
3. Fixture B — requirements from a different nolikums; non-applicable checks return ⊘; a mapping profile is built from scratch. If no real second tender exists, a synthetic folder is used and that is **stated explicitly** as a mock
4. Hardcoded-data test — grep `main/`, `rules/`, `recipes/`, `llm/` for tender data (LNP 2026/96, person names, certificate numbers, object names): zero matches outside fixtures
5. Grounding test — give the model a nolikums that does not contain a threshold; the app must report „nav atrasts" and never a number
6. SHA-256 of every source file before and after a full cycle: identical
7. Language test — interface strings contain none of "JSON, IPC, regex, profils, validācija, ekstrakcija, hash"
8. `npm run build` and `npm run dist`; runs on a machine without development tools
9. No browser testing — Boris playtests
