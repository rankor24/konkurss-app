# Konkursu App uzstādīšana

Šī instrukcija ir tev, ja Konkursu App tev iedeva kolēģis (Boriss) kā failu **Konkursu App Setup.exe**.
Uzstādīšana aizņem ~3 minūtes. Administratora tiesības nav vajadzīgas.

## 1. Palaid uzstādīšanas failu

Veic dubultklikšķi uz **Konkursu App Setup.exe**.

### Windows rāda zilu logu „Windows aizsargāja jūsu datoru”

Tas ir normāli. Programma ir iekšējs uzņēmuma rīks, un tai nav maksas „izdevēja paraksta”,
tāpēc Windows (SmartScreen) vienmēr brīdina par jaunu programmu.

1. Logā spied **Papildu informācija** (More info). Teksts „Nezināms izdevējs” parādīsies.
2. Spied **Tik un tā palaist** (Run anyway).

Ja pogas „Tik un tā palaist” nav, failu bloķē Windows lejupielādes aizsardzība:

1. Ar peles labo pogu uz **Konkursu App Setup.exe** → **Rekvizīti** (Properties).
2. Apakšā atzīmē **Atbloķēt** (Unblock) → **Labi**.
3. Palaid failu vēlreiz.

Ja uzņēmuma pretvīrusu programma failu izdzēš vai bloķē — nekādus iestatījumus nemaini pats, bet raksti Borisam.

## 2. Uzstādīšanas soļi

1. Izvēlies uzstādīšanas mapi (var atstāt, kā piedāvā) → **Install**.
2. Kad pabeigts, atstāj atzīmi **Palaist Konkursu App** → **Finish**.
3. Darbvirsmā un Start izvēlnē parādīsies ikona **Konkursu App**.

Atinstalēšana: Windows iestatījumi → Programmas → Konkursu App. Tavi konkursi, iestatījumi un atslēga **netiek dzēsti**.

## 3. Pirmā palaišana

App parāda trīs īsus soļus (augšā rakstīts „Solis 1 no 3”):

1. **Kā tas strādā.** Īss paskaidrojums: oriģināli netiek mainīti, jaunie faili iet atsevišķā mapē, pie katras nolasītās vērtības redzams teikums, no kura tā nolasīta.
2. **Aģenti.** Tas ir veids, kā app lasa dokumentus. Pieslēdz vismaz vienu (var arī vēlāk Iestatījumos):
   - **Codex** — iebūvēts; spied „Pieslēgties” un ienāc ar savu kontu.
   - **Grok** — vispirms jābūt uzstādītai Grok programmai (x.ai); tad „Pieslēgties”.
   - **Claude** — vajag API atslēgu; atslēgu tev iedod Boriss. Ievadi to un spied „Saglabāt atslēgu”.
3. **Pirmais konkurss.** Spied „+ Jauns konkurss no mapes”, izvēlies mapi, kur ir konkursa dokumenti (parasti KONKURSS), un mapi, kur likt jaunos dokumentus. Tad app nolasa visus failus. Ja kāds fails nav lasāms, tas tiek parādīts sarkanā — to neignorē.

## 4. Ja kaut kas nestrādā

Atver **Iestatījumi → Vai dators ir gatavs**. Tur katrai programmai ir rinda ar teikumu, ko darīt.

| Ko redzi | Ko darīt |
|---|---|
| „Grok programma ir novecojusi” / kļūda 426 | Iestatījumi → **Atjaunināt Grok**, tad mēģini vēlreiz |
| „Aģenta konta limits ir izsmelts” | Iestatījumos izvēlies citu aģentu |
| „Aģents nav pieslēgts” | Iestatījumi → Pieslēgties |
| „Dokumentu rīki neatbild” | Pārinstalē Konkursu App ar jaunāko uzstādīšanas failu |
| Fails nav nolasāms (skenēts PDF) | Atver to pats un pārbaudi ar aci; app neizlasīs to, ko nevar redzēt |

**Ko app nekad nedara:** nemaina un neizdzēš tavus oriģinālos failus, nesūta neko uz EIS un neparaksta. Visi jaunie faili tiek saglabāti izvades mapē ar jaunu versijas numuru.
Visu, ko palīgs mapēs lasīja vai rakstīja, var redzēt **Iestatījumi → Darbību žurnāls**.
