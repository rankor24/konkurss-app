// The tutorial: the whole tender process, in the order a tender actually goes through the office.
// Each step says what the person does and what the app does, and may open a real screen and point at a real
// button (data-tour anchors). No example tender is invented: project steps open the person's own latest tender,
// or are explained without one.
import type { StepId } from "../../shared/state";

export type TourStage = "sakums" | "registri" | "tafele" | "jauns" | StepId | "cenas" | "paka" | "agents" | "iestatijumi" | "beigas";

/** Where a step takes the app before it is shown. "project" opens the latest tender at that step, if there is one. */
export type TourGo =
	| { kind: "list" }
	| { kind: "board" }
	| { kind: "settings" }
	| { kind: "registers"; tab?: string }
	| { kind: "project"; step: StepId | "paka" | "cenas" | "chat" };

export interface TourStep {
	id: string;
	stage: TourStage;
	title: string;
	/** what the person does */
	you: string;
	/** what the app does for them */
	app: string;
	/** a line in yellow: the one thing not to forget */
	note?: string;
	go?: TourGo;
	/** data-tour id of the element to point at */
	anchor?: string;
}

/** The map across the top of every card, grouped the way the work goes. */
export const TOUR_MAP: { group: string; stages: { id: TourStage; label: string }[] }[] = [
	{ group: "Vienreiz", stages: [{ id: "registri", label: "Reģistri" }] },
	{ group: "Atlase", stages: [{ id: "tafele", label: "Tāfele" }, { id: "jauns", label: "Jauns konkurss" }] },
	{
		group: "Konkurss",
		stages: [
			{ id: "dokumenti", label: "1 Dokumenti" },
			{ id: "versija", label: "2 Versija" },
			{ id: "prasibas", label: "3 Ko prasa" },
			{ id: "varam", label: "4 Vai varam" },
			{ id: "kas", label: "5 Kas ko dara" },
			{ id: "aizpildit", label: "6 Aizpildīt" },
			{ id: "pieradijumi", label: "7 Pierādījumi" },
			{ id: "cenas", label: "Cenas" },
			{ id: "paka", label: "Paka" },
		],
	},
	{ group: "Pirms iesniegšanas", stages: [{ id: "parbaude", label: "8 Pārbaude" }, { id: "paraksti", label: "9 Paraksti" }] },
	{ group: "Pēc", stages: [{ id: "rezultats", label: "10 Rezultāts" }] },
];

export const TOUR: TourStep[] = [
	{
		id: "sveiki",
		stage: "sakums",
		title: "Sveicināti Konkursu App",
		you: "Šī apmācība parāda visu ceļu — no jaunas konkursa mapes līdz rezultātam. Ap 3 minūtes. Vari to izlaist un atkārtot jebkurā brīdī no Iestatījumiem.",
		app: "App lasa konkursa dokumentus un mūsu iepriekšējos iesniegumus, aizpilda veidlapas, saliek paku un pārbauda to pirms iesniegšanas.",
		note: "Oriģināli netiek mainīti un nekas netiek dzēsts. Pie katras nolasītās vērtības ir teikums, no kura tā ņemta; ja vērtības nav, app to pasaka — tā neizdomā.",
	},
	{
		id: "karte",
		stage: "sakums",
		title: "Viss process vienā skatā",
		you: "Augšā redzi karti: vienreiz sakārto reģistrus, tad katram konkursam — atlase, desmit soļi, cenas un paka, pārbaude, paraksti, rezultāts. Uz kartes var uzklikšķināt, lai pārlēktu.",
		app: "Katram solim app rāda stāvokli: ○ nav sākts, ◐ procesā, ● gatavs, ⚠ problēma, ⊘ šim konkursam neattiecas.",
	},
	{
		id: "mapes",
		stage: "sakums",
		title: "Kur atrodas faili — un kāpēc konkursa mapi tikai lasa",
		you: "Konkursa mapi (B:) app tikai lasa. Viss, ko tā sagatavo, ir tavā darba mapē: Mani dokumenti\\Konkursi\\<konkursa mape> — katram lietotājam sava. Kad paka gatava un parakstīta, mapes Paka saturu uz konkursa mapes IESNIEDZAMIE pārvieto tu.",
		app: "Konkursa mape ir biroja oficiālā kopija — tie paši faili, ko saņēmām un ko iesniedzam. Ja app tur rakstītu, melnraksts vai kļūda varētu sajaukties ar iesniedzamo vai pārrakstīt oriģinālu. Tāpēc tur tikai lasa, un pārvieto cilvēks, kad ir pārliecināts.",
		note: "Paka ekrāns pateiks „Paka gatava pārvietošanai” tikai tad, kad viss ir pakā, parakstīts un pārbaudīts.",
	},
	{
		id: "registri",
		stage: "registri",
		title: "Reģistri — mūsu bibliotēka",
		you: "Vienreiz pārbaudi uzņēmuma rekvizītus, speciālistus un objektus. Pēc tam tikai papildini.",
		app: "Visi konkursi ņem datus no šejienes — speciālistu sertifikātus, objektu platības, būvvaldes datumus, pierādījumu failus.",
		go: { kind: "registers" },
		anchor: "rail-registri",
	},
	{
		id: "ieteikumi",
		stage: "registri",
		title: "Ieteikumi no jau iesniegtā",
		you: "Nospied „Meklēt iesniegtajos konkursos” un katram ieteikumam izlem: pievienot kā jaunu objektu, pievienot esošam vai atmest.",
		app: "App izskata visas iesniegšanas mapes, sagrupē atsauksmes, būvatļaujas un aktus pa objektiem un no iesniegtajām pieredzes tabulām pārņem datus ar avotu.",
		note: "Nekas nenonāk reģistrā bez tava lēmuma. Faili netiek pārvietoti — reģistrā ir tikai ceļš uz tiem.",
		go: { kind: "registers", tab: "ieteikumi" },
		anchor: "tab-ieteikumi",
	},
	{
		id: "buvnieki",
		stage: "registri",
		title: "Būvnieki, apakšuzņēmēji, standarta teksti, uzskaite",
		you: "Pārbaudi būvnieku rekvizītus un paraksttiesīgos; ielasi apakšuzņēmēju un konkursu uzskaites Excel; pievieno mūsu apliecinājumu tekstus no jau iesniegta faila.",
		app: "Būvnieku reģ. Nr. app nolasa no mūsu apliecinājumiem viņu mapēs. Excel faili netiek mainīti — tos turpina vest kā līdz šim.",
		go: { kind: "registers", tab: "buvnieki" },
		anchor: "tab-buvnieki",
	},
	{
		id: "tafele",
		stage: "tafele",
		title: "Tāfele — visi konkursi un termiņi",
		you: "Šeit katru dienu redzi, kas tuvojas. Izlem, ko liekam, un statusu vari mainīt pati.",
		app: "Katrai konkursa mapei app atrod termiņu — no nolikuma ar citātu, tad no uzskaites, tad no mapes nosaukuma — un parāda nākamo soli.",
		note: "Ja avoti nesakrīt (piem., grozījumi pārcēla termiņu), tiek rādīts agrākais datums ar brīdinājumu.",
		go: { kind: "board" },
		anchor: "rail-tafele",
	},
	{
		id: "jauns",
		stage: "jauns",
		title: "Jauns konkurss",
		you: "Tāfelē nospied „Pievienot app” vai Konkursos „Jauns konkurss no mapes”: izvēlies konkursa dokumentu mapi; darba mapi app piedāvā pati; būvniekus norādi, ja projektējam viņiem.",
		app: "Konkursa mapi app tikai lasa. Viss, ko tā sagatavo, ir darba mapē šajā datorā — Mani dokumenti\\Konkursi\\<konkursa mape>; katram lietotājam sava.",
		note: "Konkursu mapē (B:) app neko neraksta. Gatavo paku tur pārvieto pats.",
		go: { kind: "list" },
		anchor: "rail-konkursi",
	},
	{
		id: "dokumenti",
		stage: "dokumenti",
		title: "1. Dokumenti un konkursa kārtība",
		you: "Pārskati failus un apstiprini konkursa kārtību: procedūra, priekšmets, mūsu loma, daļas, kā iesniegt.",
		app: "Nolasa visu failu tekstu un no nolikuma nosaka kārtību — katrai vērtībai teikums no dokumenta. Kārtība izlemj, kuri soļi attiecas un kam gatavo paketes.",
		go: { kind: "project", step: "dokumenti" },
		anchor: "step-dokumenti",
	},
	{
		id: "versija",
		stage: "versija",
		title: "2. Kura versija ir spēkā",
		you: "Apstiprini komisijas atbildes un grozījumus; pārbaudi termiņu.",
		app: "Salīdzina nolikuma redakcijas un veidlapas, sakārto komisijas atbildes un parāda, kas mainās.",
		go: { kind: "project", step: "versija" },
		anchor: "step-versija",
	},
	{
		id: "prasibas",
		stage: "prasibas",
		title: "3. Ko konkurss prasa",
		you: "Pārbaudi katru bloku — iesniedzamie dokumenti, pieredze, speciālisti, vērtēšana, apakšuzņēmēji — un apstiprini.",
		app: "Izlasa prasības ar citātu. Ko dokumentos neatrod, to atzīmē „nav atrasts”.",
		go: { kind: "project", step: "prasibas" },
		anchor: "step-prasibas",
	},
	{
		id: "varam",
		stage: "varam",
		title: "4. Vai varam pieteikties",
		you: "Izlem — liekam vai ne — un ieraksti iemeslu.",
		app: "Salīdzina prasības ar reģistriem: kuri objekti der un kāpēc, kuram speciālistam beidzas sertifikāts, kuras jomas mums trūkst.",
		go: { kind: "project", step: "varam" },
		anchor: "step-varam",
	},
	{
		id: "kas",
		stage: "kas",
		title: "5. Kas ko dara",
		you: "Izvēlies speciālistus un objektus; „projektē un būvē” konkursā — lomas mums un katram būvniekam.",
		app: "Piedāvā lomas, ko prasa dokumenti, un piedāvā tikai tos objektus, kas atbilst prasībām.",
		go: { kind: "project", step: "kas" },
		anchor: "step-kas",
	},
	{
		id: "aizpildit",
		stage: "aizpildit",
		title: "6. Aizpildīt",
		you: "Pārskati, no kurienes nāk katra vērtība, un izveido failus. Ja projektējam būvniekiem — nospied „Būvnieku kopijas”.",
		app: "Aizpilda veidlapas, BIP un matricu no reģistriem un konkursa datiem. Katrā būvnieka kopijā ieliek viņa nosaukumu un reģ. Nr.",
		note: "Ja kādas vērtības nav, failu neveido — vispirms piesaisti, ievadi pati vai atzīmē „neattiecas”.",
		go: { kind: "project", step: "aizpildit" },
		anchor: "step-aizpildit",
	},
	{
		id: "pieradijumi",
		stage: "pieradijumi",
		title: "7. Pierādījumi",
		you: "Nospied, lai atnestu pierādījumus.",
		app: "Izvēlētajiem objektiem atrod atsauksmes, būvatļaujas un aktus un nokopē tos ar pareizo numerāciju.",
		go: { kind: "project", step: "pieradijumi" },
		anchor: "step-pieradijumi",
	},
	{
		id: "cenas",
		stage: "cenas",
		title: "Cenas pa markām",
		you: "Sāc no iepriekšējā cenu piedāvājuma, pielāgo stundas, apakšuzņēmēju cenas un uzcenojumu; pārnes uz finanšu piedāvājumu.",
		app: "Aprēķina precīzi līdz centam; ja avota lapā kāda rinda nesakrīt ar savu formulu — atzīmē. Līdzīgu konkursu cenas no uzskaites rāda tikai uzziņai.",
		note: "Cenas glabājas atsevišķi un nekad nenonāk aģenta uzdevumā.",
		go: { kind: "project", step: "cenas" },
		anchor: "step-cenas",
	},
	{
		id: "paka",
		stage: "paka",
		title: "Paka — viss iesniedzamais",
		you: "Pārskati sarakstu, izveido apliecinājumus, nospied „Sakārtot paku”. Kad app saka „Paka gatava pārvietošanai”, pārvieto mapes Paka saturu uz konkursa mapes IESNIEDZAMIE.",
		app: "Saliek visu vienā sarakstā ar numuriem, kā to darām (3_0, 3_1 …), katram failam — kas paraksta; katram būvniekam sava mape. Parāda, kur kas atrodas, un saka, kas vēl trūkst līdz pārvietošanai.",
		note: "Pārvietošanu dari pats — app konkursu mapē neraksta. Esošus failus, arī parakstītus .edoc, app nekad nepārraksta.",
		go: { kind: "project", step: "paka" },
		anchor: "step-paka",
	},
	{
		id: "parbaude",
		stage: "parbaude",
		title: "8. Pārbaude",
		you: "Palaid pārbaudi un izlabo sarkanos punktus.",
		app: "Pārbauda: speciālisti un sertifikāti, termiņš, vai katram uzņēmumam ir savs reģ. Nr., vai būvnieka kopijā nav cita būvnieka, vai nav palicis cita konkursa teksts; metu konkursā — anonimitāte un devīze.",
		go: { kind: "project", step: "parbaude" },
		anchor: "step-parbaude",
	},
	{
		id: "paraksti",
		stage: "paraksti",
		title: "9. Paraksti",
		you: "Paraksti eParakstā, ieliec .edoc failus pakā.",
		app: "Nolasa, kas katru .edoc parakstījis, un salīdzina ar to, kam jāparaksta.",
		go: { kind: "project", step: "paraksti" },
		anchor: "step-paraksti",
	},
	{
		id: "rezultats",
		stage: "rezultats",
		title: "10. Rezultāts",
		you: "Ieraksti, kas iesniegts un kā beidzās; uzvaras gadījumā — termiņi līgumam.",
		app: "Palīdz atbildēt uz komisijas precizējumu un pievienot jauno objektu reģistram, lai nākamreiz tas jau būtu bibliotēkā.",
		go: { kind: "project", step: "rezultats" },
		anchor: "step-rezultats",
	},
	{
		id: "agents",
		stage: "agents",
		title: "Aģents — jautā par dokumentiem",
		you: "Jautā saviem vārdiem, piem., „kur rakstīts par apdrošināšanu?”.",
		app: "Atbild ar citātu no dokumenta vai pasaka „dokumentos nav”. Ko aģents dara, redzams sānu panelī.",
		go: { kind: "project", step: "chat" },
		anchor: "step-chat",
	},
	{
		id: "iestatijumi",
		stage: "iestatijumi",
		title: "Iestatījumi",
		you: "Pieslēdz aģentu, pārbaudi konkursu mapi un darba mapi, un, ja strādājam vairāki, norādi kopīgo reģistru mapi. Šo apmācību vari atkārtot šeit.",
		app: "Ja aģents nav pieejams, app to pasaka un pati uz citu nepārslēdzas.",
		go: { kind: "settings" },
		anchor: "tour-replay",
	},
	{
		id: "beigas",
		stage: "beigas",
		title: "Gatavs sākt",
		you: "Sāc ar tāfeli — tur ir visi konkursi — vai uzreiz pievieno jaunu konkursu no mapes.",
		app: "Katrā lapā augšā ir īss paskaidrojums, ko tā dara un kāpēc.",
	},
];

export const tourIndex = (id: string) => TOUR.findIndex((s) => s.id === id);
/** The first step of a stage on the map (clicking the map jumps there). */
export const firstOfStage = (stage: TourStage) => TOUR.findIndex((s) => s.stage === stage);
