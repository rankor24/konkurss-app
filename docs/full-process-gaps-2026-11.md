# Full tender process — what the folders show vs what the app covers

**Date:** 2026-11-06. **Status:** analysis, not approved. No code changed.
**Source:** read-only scan of `B:\01_Konkursi` (55 open tender folders) and `B:\01_Konkursi\07_IESNIEGTI` (579 submitted), plus `02_Iepirkumi_BD_jauns.xlsx` and `00_Specialistu un apaksuznemeju reg..xlsx`. Counts come from file and folder names, so they are approximate.

## 1. Volume

| Metric | Value |
|---|---|
| Folders with IESNIEDZAMIE / PIEDAVAJUMS | 402 (12,417 files) |
| Of those, 2024+ | 322 — 2024: 87, 2025: 68, 2026: 167 |
| Avg files per submission (2025–26) | 33, of which 12 `.edoc` |
| Multi-builder submissions (2025–26) | 109 of 235 (46 %), avg 1.8 builders, max 8 |
| Most frequent builders | Pillar 12, Nord SW 12, KUUM 12, INO 10, Bildberg 8, Arcers 5, UPB 4 |
| Tracker 2024 | 133 rows — 31 won, ~74 lost |
| Tracker 2025 | 107 rows — 18 won, ~69 lost |
| Tracker 2026 sheet | no header in the expected layout — `no data` (ask where 2026 is tracked) |

Almost every "Zaudēts" comment records the winner and their price, so the tracker already holds a price history.

## 2. What a submission contains (share of 322 tenders, 2024+)

| Group | Document | % |
|---|---|---|
| Evidence | Atsauksme | 80 |
| Evidence | Būvatļauja / PN atzīme | 80 |
| Evidence | Ekspluatācijas akts | 45 |
| Evidence | Ģenerālplāns / rasējumi | 41 |
| Evidence | Sertifikāti / reģistri | 23 |
| Evidence | Energosertifikāts | 21 |
| Per person / firm | Speciālista pieredze / izziņa | 47 |
| Per person / firm | Speciālista apliecinājums | 43 |
| Per person / firm | Apakšuzņēmēja apliecinājums | 41 |
| Per person / firm | Speciālistu saraksts | 29 |
| Forms | Finanšu piedāvājums | 60 |
| Forms | Pieteikums / vēstule | 48 |
| Forms | Pretendenta pieredzes saraksts | 38 |
| Forms | Tehniskais piedāvājums | 34 |
| Forms | Apakšuzņēmēju saraksts | 25 |
| Forms | Laika grafiks | 19 |
| Forms | Neatkarīgi izstrādāta piedāvājuma apliec. | 18 |
| BIM | BIP / matrica / paraugmodelis | 8 |

Also seen, unclassified: IP informācijas neizpaušanas apliecinājums (per person), sankciju apliecinājums, BPV aizvietotāja apliecinājums, konfidencialitātes līgums, pilnvaras, lēmums par nosaukuma maiņu, `.msg` threads with the builder.

## 3. Evidence reuse — the same ~25 objects every time

Top evidence files by number of tenders they were submitted in (2024+, 266 tenders with evidence):

| # | File stem |
|---|---|
| 90 | Atsauksme BD291-2023 Sabilex Mēnesgaismas |
| 89 | Būvatļauja Mēnesgaismas |
| 88 | Būvatļauja Cigoriņu 1 |
| 87 | Būvatļauja Anniņmuiža |
| 82 | Atsauksme Cigoriņu iela |
| 57 | Atsauksme RAKUS aptiekas ēka |
| 51 | Atsauksme Anniņmuiža |
| 47 | VAMOIC atsauksme Ernestīnes 34 |
| 37 | RAKUS ekspluatācijas akts II–III kārta |
| 34 | Atsauksme Saulkrastu sporta ēka |
| 31 | Atsauksme PSKUS 15. korpuss |
| 28 | Izziņa BD303-2024 BAM Kuldīga · Būvatļauja Balvu muiža · Atsauksme BB31A |
| 21 | Būvatļauja Siguldas 20 Daugavpils · Būvatļauja SAAC |

The app's register (`konkurss` skill `data/atsauces_objekti.md`) has **5** objects. Specialists most named in apliecinājumi / pieredze files: A. Kalniņš 21, P. Bērziņš 12, M. Suhihs 8, A. Gaile 7, A. Tereško 7, A. Vulāns 6, J. Dupats 5.

## 4. Tender types seen

| Type | Example folders | App today |
|---|---|---|
| V1 projektēšana, we are pretendents | RNP Ulbrokas ģērbtuves, BNP Bauskas patversmes | covered (forms, finance, evidence) |
| V2 projektē un būvē, 1–8 builders | SN VSAC Zemgale (SANART), IE67 Mārupe (AIDACO, BILDBERG), IDA NVA (BCC, Pillar, RTS) | BIP copies + roles only |
| V3 BIM part only | Magnums Mārupe BIM | BIP covered |
| Multi-lot (daļas) | LVP Liepāja 3 daļas, MNP 4 daļas, ONP, BNP Rundāle | not modelled |
| Private price request | LIDL Slokas 161, Bildberg Mūrnieku 1, 00_Piedavajumi/* | not modelled |
| Invitation / survey (TAA) | Tilde TAA Tukums ×3, LDZ Konduktori | not modelled |
| Design competition (mets) | `00_Metu Konkursi/*` | not modelled |
| Framework / partnership | VNI Partnerības līgums, VAMOIC vispārīgās vienošanās | not modelled |

## 5. Gaps, in proposed order

1. **Pieredzes bibliotēka (evidence library).** Harvest objects + evidence files from `07_IESNIEGTI` into the objects register: object → atsauksme `.edoc`, būvatļauja, PN atzīme, ekspluatācijas akts, GP, energosertifikāts, plus attributes the nolikumi ask for (būves grupa, klasifikācijas kods, platība, līguma summa, gads, BPV, our role). Feeds step 4 (Vai varam) and step 7 (Pierādījumi). Reason: 80 % of tenders, and today each pack is hand-copied from the last one.
2. **Builder pack replicator (V2).** One design-side pack → N builder folders, with each builder's name and reg. Nr. put into the apakšuzņēmēja apliecinājums, specialist apliecinājumi and pieredze forms, and a leak check across builders (the leak check already exists). Reason: 46 % of tenders, up to 8 builders.
3. **Apliecinājumu ģenerators.** Specialist × tender statements (pieejamība, IP neizpaušana, sankcijas, aizvietotājs, apakšuzņēmēja apliecinājums) from the specialist and company registers, ready to sign as `.edoc`.
4. **Portfolio board.** Import `02_Iepirkumi_BD_jauns.xlsx`; list every tender folder with its deadline (from the EIS `*_PD.ANY_*.pdf` notice or the nolikums), status and next action; intake + go/no-go before step 1.
5. **Price history.** Winner + price from tracker comments → reference range in the finance step.
6. **More tender types.** Daļas inside one konkurss; cenu pieprasījums and uzaicinājums as lightweight variants; mets and vispārīgā vienošanās later.

## 6. Constraint to resolve before (1) and (2)

`PLAN.md` puts izejas dati in `E:\BV BIM\Paraugmodeli\...` and the output in `...\IESNIEDZAMIE`. On this PC tenders live on `B:\01_Konkursi`, which is read-only for agents. People do write IESNIEDZAMIE there by hand. Boris decides whether the app may write IESNIEDZAMIE on `B:\`, or works in a C: copy that people move over themselves.
