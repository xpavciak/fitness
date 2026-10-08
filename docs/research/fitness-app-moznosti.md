# Fitness aplikácia: generovanie tréningových plánov a dodržiavanie tréningu (analýza možností)

*Stav: výskum a plánovanie, zatiaľ bez kódu aplikácie. Dátum: 2026-10-08.*

> **Poznámka k údajom:** Prehľad trhu, ceny a parametre API vychádzajú zo znalostí autora (do polovice 2026) a neboli overené živým prieskumom. Ceny predplatného a API sa často menia, preto ich pred obchodnými rozhodnutiami treba overiť. Kde je údaj len približný, je označený „cca“.

---

## 0. Zhrnutie

- **Trh je nasýtený záznamníkmi tréningov** (Strong, Hevy, JEFIT) a **generátormi plánov** (Fitbod, Freeletics, Future, Runna). Žiadna z týchto aplikácií však nerieši hlavný problém, ktorý je **dodržiavanie plánu v reálnom živote**: vynechané tréningy, cestovanie, únava, menej času, než sa plánovalo. Väčšina aplikácií pri vynechanom tréningu buď nereaguje, alebo plán len posunie.
- **Odporúčaná nika:** zaneprázdnení ľudia (cca 25 až 45 rokov), začiatočníci až mierne pokročilí, ktorí trénujú v posilňovni alebo doma 2 až 4-krát týždenne a opakovane s tréningom prestávajú. Hlavný prísľub: *„Plán, ktorý sa prispôsobí tvojmu týždňu, nie naopak.“*
- **Generovanie plánu:** hybridný prístup. **Deterministický pravidlový engine** (šablóny, periodizácia, progresívne preťaženie, autoregulácia cez RIR) určuje štruktúru a záťaž. **LLM (Claude API)** spracuje vstupný dotazník, vysvetľuje plán a navrhuje úpravy, vždy však len v rámci validovanej JSON schémy a katalógu cvikov. LLM nikdy neurčuje záťaž bez kontroly pravidiel.
- **Technológia pre MVP:** Expo (React Native) + TypeScript, Supabase (Postgres, Auth, RLS, Edge Functions), plánovací engine ako samostatný čistý TS balík s jednotkovými testami. Integrácia s Apple Health a Health Connect prichádza v druhej fáze.
- **Monetizácia:** freemium (zadarmo logovanie a jeden základný plán) a predplatné Pro (cca 8 až 10 € mesačne alebo 50 až 70 € ročne) za adaptívne plány, AI kouča a pokročilé štatistiky. Marketplace trénerov až neskôr.

---

## 1. Prehľad trhu

| Aplikácia | Zameranie | Silné stránky | Slabiny / medzery |
|---|---|---|---|
| **Fitbod** | Posilňovňa, generované tréningy | Algoritmus generuje každý tréning podľa vybavenia, únavy svalových skupín a histórie. Výborný onboarding. | Tréning sa „generuje na mieste“ a chýba dlhodobá periodizácia aj jasný cieľ. Pokročilí mu nedôverujú. Pri vynechaní tréningu nevie, „prečo“ k nemu došlo. |
| **Strong** | Záznamník tréningov | Rýchle a čisté logovanie, šablóny, odhad 1RM, Apple Watch. | Takmer žiadne generovanie ani koučing. Motivácia závisí od používateľa. |
| **Hevy** | Záznamník a sociálna sieť | Veľkorysá bezplatná verzia, sociálny feed, rutiny, rýchly rast komunity. | Plány si tvorí používateľ sám (alebo kopíruje). Adaptivita je slabá. |
| **JEFIT** | Záznamník a databáza cvikov | Obrovská knižnica cvikov a plánov, komunita. | Zastaraný a preplnený UX, veľa reklám v bezplatnej verzii. |
| **Freeletics** | Kalistenika, HIIT, AI „Coach“ | Silná značka, AI coach prispôsobuje týždeň podľa spätnej väzby, tréningy bez náradia. | Intenzita je pre začiatočníkov často privysoká. Menej vhodný pre klasický silový tréning. |
| **Nike Training Club** | Video tréningy | Kvalitný obsah s trénermi, programy, zadarmo. | Takmer žiadna personalizácia ani sledovanie progresu záťaže. |
| **Caliber** | Silový tréning, ľudský aj AI koučing | Kvalitné programovanie založené na dôkazoch, tréneri sú k dispozícii. | Ľudský koučing je drahý. Bezplatná verzia je obmedzená. |
| **Future** | Osobný tréner na diaľku | Skutočný tréner, ktorý každý týždeň upravuje plán, vysoká miera dodržiavania. | Cena cca 150 až 200 USD mesačne, nie je škálovateľný pre masový trh. |
| **TrainingPeaks** | Vytrvalostné športy (beh, cyklistika, triatlon) | Štandard pre trénerov, metriky ako TSS, CTL a ATL, platforma trénerských plánov. | Zložitý pre bežného používateľa, orientovaný na trénerov. |
| **Runna** (teraz súčasť Strava) | Bežecké plány | Personalizované plány na preteky, výborný UX, integrácie s hodinkami, adaptácia tempa. | Len beh. Silový tréning je len doplnok. |

**Ďalší relevantní hráči:** Ladder (tímové programy s trénerom), Alpha Progression a RP Hypertrophy (autoregulácia hypertrofie, RIR, objem), Apple Fitness+, Peloton, Garmin Coach, Strava (sociálna sieť a akvizícia Runna), Whoop (regenerácia).

### Medzery a príležitosti
1. **Adaptívna reakcia na reálny život.** Pri vynechanom tréningu väčšina aplikácií buď nič nespraví, alebo plán len posunie. Chýba inteligentné preplánovanie, napríklad zlúčenie tréningov, skrátenie tréningu na 20 minút alebo ochrana kľúčových tréningov.
2. **Most medzi „záznamníkom“ a „trénerom“.** Strong a Hevy sú výborné na logovanie, no neradia. Future a Caliber radia, no sú drahé. Lacný „AI tréner s ľudskými pravidlami“ je stále nedostatočne obsadený segment.
3. **Transparentnosť.** Fitbod a podobné aplikácie fungujú ako čierna skrinka. Používatelia chcú vedieť, *prečo* majú dnes 3×8 na 60 kg.
4. **Hybridní športovci.** Kombinácia sily a behu (napríklad príprava na HYROX alebo polmaratón popri posilňovni) je slabo pokrytá. Runna je len o behu, Fitbod len o posilňovni.
5. **Lokalizácia.** Takmer žiadna kvalitná aplikácia neponúka slovenčinu ani češtinu. Pre malý trh SK/CZ je to dobrý štartovací bod (beta komunita), dlhodobo však treba myslieť aj na angličtinu.
6. **Návrat po prestávke.** Ľudia, ktorí „začínajú znova“, sú obrovský segment, no aplikácie počítajú buď s úplným začiatočníkom, alebo s nepretržitým tréningom.

---

## 2. Prístupy ku generovaniu plánov

### 2.1 Pravidlové šablóny (rule-based)
- **Princíp:** knižnica overených šablón, napríklad Full Body 3× týždenne, Upper/Lower 4×, PPL, 5/3/1, GZCLP, bežecké plány typu Couch-to-5K. Parametrizujú sa podľa cieľa, dní, vybavenia a úrovne.
- **Periodizácia:** lineárna (začiatočníci), zvlnená (DUP) a bloková. **Deload** každý 4. až 6. týždeň.
- **Progresívne preťaženie:** pridávanie váhy (+2,5 kg pri hornej časti tela a +5 kg pri dolnej po splnení všetkých sérií), dvojitá progresia (najprv opakovania v rozsahu 8 až 12, potom váha), postupné zvyšovanie objemu.
- **Výhody:** predvídateľnosť, bezpečnosť, testovateľnosť, nulové náklady na API, vysvetliteľnosť.
- **Nevýhody:** obmedzená personalizácia, kombinatorická explózia šablón, pôsobí „generickým“ dojmom.

### 2.2 Algoritmická autoregulácia
- **RPE/RIR:** používateľ po sérii zadá, koľko opakovaní mu zostalo v zásobe (RIR). Engine podľa toho upraví váhu nasledujúcej série alebo tréningu (napríklad cieľ RIR 2: ak bol RIR ≥ 4, +5 %; ak bol RIR 0 alebo séria zlyhala, −5 %).
- **Odhad 1RM:** Epley `1RM = w × (1 + r/30)` alebo Brzycki `1RM = w × 36 / (37 − r)`. Spoľahlivé pri r ≤ 10. Z e1RM a cieľového RIR sa určí pracovná váha (tabuľka RPE podľa Tuchscherera).
- **Riadenie objemu:** počet efektívnych sérií na svalovú skupinu za týždeň (cca 10 až 20 pre hypertrofiu) s úpravou podľa regenerácie (bolesť svalov, spánok, výkon).
- **Beh:** tréningové zóny z času na preteky (VDOT, Daniels) alebo zo srdcovej frekvencie. Pravidlo zvyšovania týždenného objemu najviac o cca 10 %. Pomer akútnej a chronickej záťaže (ACWR) treba brať len ako orientačné vodidlo.
- **Výhody:** skutočná personalizácia z dát, vedecky podložený prístup.
- **Nevýhody:** závisí od kvality vstupov (začiatočníci RIR odhadujú zle), vyžaduje dostatočné množstvo dát.

### 2.3 Plány generované LLM (napr. Claude API)
- **Princíp:** dotazník a história idú do promptu, model vráti štruktúrovaný plán (JSON cez tool use alebo structured output).
- **Výhody:** spracuje voľný text („bolí ma ľavé rameno“, „mám len kettlebell a 25 minút“), dokáže plán prirodzene vysvetliť a tón prispôsobiť konkrétnemu človeku. Vďaka tomu pôsobí ako tréner.
- **Nevýhody a riziká:** halucinácie (neexistujúce cviky, nezmyselné váhy), nekonzistentnosť medzi spusteniami, ťažká testovateľnosť, náklady a latencia, riziko nebezpečných odporúčaní pri zraneniach.
- **Povinné ochranné mechanizmy (guardrails):**
  1. Výstup sa validuje JSON schémou (napr. Zod). Cviky sa smú vyberať **len z katalógu** podľa `exercise_id`.
  2. **Pravidlový validátor** po LLM kontroluje strop objemu na svalovú skupinu, maximálny týždenný nárast záťaže, deload, rozsahy opakovaní a vylúčenie kontraindikovaných cvikov.
  3. Ak validácia zlyhá, nasleduje opakovanie s chybovou správou a potom fallback na deterministickú šablónu.
  4. Bezpečnostný filter vstupu: pri zmienke o bolesti na hrudi, závratoch, tehotenstve, operácii alebo akútnom zranení sa namiesto plánu zobrazí odporúčanie navštíviť lekára.
  5. Žiadne diagnózy a žiadne rady o liekoch či extrémnych diétach.

### 2.4 Hybrid (odporúčaný)
```
Dotazník ─► [LLM: normalizácia voľného textu → štruktúrovaný profil]
          ─► [Pravidlový engine: výber šablóny, periodizácia, objem, záťaž]
          ─► [LLM (voliteľne): výber variantov cvikov z katalógu + vysvetlenie]
          ─► [Validátor pravidiel] ─► Plán (verzionovaný)
Logy tréningov ─► [Autoregulácia (deterministická)] ─► úprava ďalších tréningov
Vynechaný tréning ─► [Plánovač (deterministický)] ─► návrhy ─► [LLM: zrozumiteľná formulácia]
```
Jadro je deterministické, testovateľné a lacné. LLM pridáva personalizáciu a „ľudský“ dojem. Aplikácia funguje aj vtedy, keď je LLM nedostupné.

### 2.5 Bezpečnosť
- **PAR-Q+ dotazník** pri onboardingu (štandardný skríning pripravenosti na pohyb). Pri pozitívnej odpovedi aplikácia odporučí konzultáciu s lekárom a ponúkne konzervatívny režim.
- **Začiatočníci:** prvé 2 až 4 týždne technika a nízka záťaž (RIR 3 až 4), žiadne tréningy do zlyhania, jednoduché varianty cvikov (goblet drep namiesto drepu s osou na chrbte), videá a pokyny k technike.
- **Obmedzenia:** používateľ označí problematické oblasti (koleno, krížová oblasť, rameno) a engine vylúči alebo nahradí rizikové cviky podľa tagov v katalógu.
- **Právne:** jasný disclaimer („nie je to lekárska rada“), súhlas v obchodných podmienkach, žiadne zdravotné tvrdenia, aby aplikácia nespadla pod reguláciu zdravotníckych pomôcok (EU MDR). Zdravotné údaje sú podľa GDPR osobitnou kategóriou (čl. 9), preto je potrebný výslovný súhlas, minimalizácia údajov, export a možnosť zmazania. Pri využívaní AI treba sledovať aj požiadavky AI Act na transparentnosť.
- **Ochrana pred pretrénovaním:** strop týždenného nárastu objemu, povinný deload a automatické zníženie záťaže po dlhšej prestávke (napríklad po viac ako 2 týždňoch −10 až −20 %).

---

## 3. Sledovanie a dodržiavanie plánu

### 3.1 Základ (hygiena)
- **Logovanie tréningu:** séria, opakovania, váha, RIR. Predvyplnenie z plánu a z minulého tréningu. Zapísanie série jedným ťuknutím. Časovač prestávky. **Funkčnosť offline** (posilňovne často nemajú signál).
- **Grafy progresu:** e1RM pre kľúčové cviky, týždenný objem na svalovú skupinu, osobné rekordy, telesná hmotnosť, miery, fotky (voliteľne a súkromne).
- **Kalendár:** plánované, splnené, vynechané a presunuté tréningy.

### 3.2 Dodržiavanie plánu (hlavná diferenciácia)
- **Adaptívne preplánovanie pri vynechaní tréningu:**
  - *Presun:* posunie tréning na najbližší voľný deň s ohľadom na regeneráciu (nie dva ťažké tréningy na nohy po sebe).
  - *Zlúčenie:* spojí dva tréningy do jedného a ponechá len kľúčové cviky.
  - *Skrátenie:* pri časovom obmedzení vytvorí 20 až 30-minútovú verziu (prioritné cviky, supersérie).
  - *Vynechanie:* týždeň sa uzavrie bez pocitu viny a progresia sa nezastaví.
  - *Ochrana kľúčových tréningov:* napríklad dlhý beh alebo hlavný silový tréning majú prednosť.
- **„Minimálna dávka“ (minimum viable workout):** pri pocite „nemám čas“ aplikácia ponúkne 10 až 15-minútovú verziu, ktorá zachová sériu splnených tréningov. Ide o kľúčový princíp z výskumu návykov: nevynechať dvakrát po sebe.
- **Rýchle check-iny:** pred tréningom (spánok, energia, bolesť svalov, každé na škále 1 až 5) s úpravou intenzity tréningu. Raz týždenne krátka reflexia a návrh na ďalší týždeň.
- **Plánovanie implementačných zámerov:** pri onboardingu sa používateľ rozhodne *kedy, kde a ako*, napríklad „Po, St, Pi o 7:00, posilňovňa pri práci“. Preukázateľne to zvyšuje mieru dodržiavania (Gollwitzer).
- **Pripomienky:** v čase, ktorý si používateľ zvolil, a ich počet sa časom prispôsobí. Nemajú pôsobiť ako spam. Ak ich človek ignoruje, ich počet sa zníži.
- **Série a míľniky:** **týždenná** séria (napríklad „3 z 3 tréningov tento týždeň“) namiesto dennej, pretože denná séria pri silovom tréningu podporuje pretrénovanie. „Joker“ dni (streak freeze).
- **Spätná väzba o progrese:** „Tvoj drep je o 18 % vyšší než pred 6 týždňami.“ Viditeľný progres je silný motivátor.

### 3.3 Techniky z vedy o návykoch
Implementačné zámery, viazanie návykov (habit stacking), zníženie trenia (tréning pripravený na jedno ťuknutie), záväzok (voliteľný „vklad“ alebo zmluva s partnerom), pozitívne posilnenie namiesto viny, identita („si človek, ktorý trénuje“), začiatok s malými krokmi (Fogg Tiny Habits), efekt nového začiatku (pondelok, nový mesiac). Pri tom je dôležitá teória sebaurčenia (autonómia, kompetencia, spolupatričnosť): dať používateľovi výber a kontrolu namiesto príkazov.

### 3.4 Integrácie s nositeľnou elektronikou
| Integrácia | Čo prináša | Poznámka |
|---|---|---|
| **Apple HealthKit** | Zápis tréningov, čítanie krokov, srdcovej frekvencie, HRV a spánku | Len natívne alebo cez React Native/Expo modul, z PWA nedostupné |
| **Google Health Connect** | Android ekvivalent | Nahrádza ukončené Google Fit API |
| **Garmin** | Health API a Training/Courses API (posielanie tréningov do hodiniek) | Vyžaduje schválenie ako partner |
| **Strava** | Import aktivít (beh, bicykel), zdieľanie | OAuth, limity API, obmedzenia použitia dát z roku 2024 |
| **Apple Watch / Wear OS** | Logovanie priamo z hodiniek | Drahé na vývoj, plánované až neskôr |

Pre MVP stačí žiadna alebo len jednosmerná integrácia (zápis tréningu do Apple Health a Health Connect). Čítanie údajov o regenerácii (HRV, spánok) má zmysel až neskôr.

### 3.5 Sociálne prvky a zodpovednosť
- **Partner pre zodpovednosť (accountability buddy):** 1 až 3 priatelia vidia, či si splnil týždeň. Je to jednoduchšie a efektívnejšie než verejný feed.
- Malé skupiny alebo výzvy (napríklad tím z práce), zdieľanie osobných rekordov.
- Celá sociálna sieť (ako Hevy) je drahá na moderovanie, preto ju odporúčam až neskôr.

---

## 4. Cieľové segmenty

| Segment | Veľkosť | Ochota platiť | Konkurencia | Problém s dodržiavaním | Hodnotenie |
|---|---|---|---|---|---|
| Úplní začiatočníci | Veľmi veľký | Nízka až stredná | Stredná (NTC, Freeletics) | Veľmi vysoký | Dobrý, ale vysoký odliv a potreba obsahu (videá) |
| Návštevníci posilňovne (stredne pokročilí) | Veľký | Stredná až vysoká | **Vysoká** (Fitbod, Hevy, Strong) | Stredný | Ťažké odlíšiť sa samotným logovaním |
| Bežci | Veľký | Vysoká | Vysoká (Runna/Strava, Garmin Coach) | Stredný | Runna je veľmi silná |
| Domáce tréningy | Veľký | Nízka | Vysoká (YouTube, NTC zadarmo) | Vysoký | Ťažká monetizácia |
| **Zaneprázdnení profesionáli / ľudia vracajúci sa k tréningu** | Veľký | **Vysoká** | **Nízka** (nikto sa nezameriava presne na nich) | **Najvyšší** | **Najperspektívnejší** |
| Hybridní športovci (sila + beh, HYROX) | Stredný, rastúci | Vysoká | Nízka | Stredný | Dobrá druhá vlna |

### Odporúčanie
**Primárna nika: „zaneprázdnení ľudia, ktorí chcú konečne vydržať“.** Ide o ľudí vo veku cca 25 až 45 rokov, začiatočníkov až mierne pokročilých, ktorí majú 2 až 4 tréningy týždenne po 30 až 60 minút v posilňovni alebo doma s jednoduchým náradím. Majú nepredvídateľný kalendár, opakovane s tréningom končia a sú ochotní platiť za výsledok.

- **Pozicionovanie:** *„Tréningový plán, ktorý počíta s tvojím životom.“* Diferenciáciou nie je lepší algoritmus na hypertrofiu, ale **adaptívne preplánovanie, minimálna dávka, týždenné série a transparentné vysvetlenia**.
- **Prirodzené rozšírenie:** hybridný modul so silou a behom (1 až 2 behy týždenne), ktorý cieli na medzeru medzi Fitbod a Runna.
- **Go-to-market:** slovenská a česká beta komunita (malá konkurencia v lokálnom jazyku), aplikácia však musí byť od začiatku pripravená na i18n a angličtinu.

---

## 5. Technické možnosti

### 5.1 Platforma
| Možnosť | Výhody | Nevýhody |
|---|---|---|
| **PWA / web (Next.js)** | Najrýchlejší vývoj, jeden kód, žiadne schvaľovanie v obchodoch | Na iOS slabšie push notifikácie (fungujú až od iOS 16.4 a len po pridaní na plochu), **chýba HealthKit**, slabšia pozícia v App Store, horšia offline skúsenosť |
| **React Native (Expo)** | Jeden kód v TS pre iOS, Android aj web, prístup k HealthKit a Health Connect, OTA aktualizácie, EAS Build, veľký ekosystém | Natívne moduly občas komplikujú vývoj, zložitejšie testovanie než na webe |
| **Flutter** | Výkon, konzistentné UI | Dart (iný jazyk než backend), menšia zdieľateľnosť kódu s TS backendom |
| **Natívne (Swift/Kotlin)** | Najlepší UX, hodinky, widgety | Dva kódy, dvojnásobné náklady |

**Odporúčanie: Expo (React Native) + TypeScript.** Notifikácie a integrácia so zdravotnými dátami sú pre dodržiavanie plánu kľúčové a PWA na iOS v nich zaostáva. Expo Router umožňuje aj webový build (napríklad pre administráciu alebo landing page). Ak je prioritou čo najrýchlejšie overenie hypotézy bez obchodov s aplikáciami, alternatívou je PWA prototyp, ale s vedomím, že sa neskôr bude prepisovať.

### 5.2 Backend
| Možnosť | Výhody | Nevýhody |
|---|---|---|
| **Supabase** | Postgres (relačné dáta sedia na plány a logy), Auth, Row Level Security, Edge Functions, Realtime, storage, open source (možnosť self-hostingu), hosting v EÚ | Edge Functions bežia v Deno a majú obmedzenia. Zložitejšia logika potrebuje dobre navrhnuté RLS. |
| **Firebase** | Rýchly štart, offline sync vo Firestore, FCM | NoSQL je nevhodné na analytické dotazy (objem, e1RM trendy), vendor lock-in |
| **Vlastný Node (Fastify/NestJS) alebo Python (FastAPI)** + Postgres | Plná kontrola, Python je silný na dátovú analýzu | Viac práce s infraštruktúrou, autentifikáciou a nasadením |

**Odporúčanie: Supabase (región EÚ, kvôli GDPR).** Plánovací engine je **čistý TS balík** (`packages/plan-engine`) bez závislostí na I/O, aby sa dal použiť na klientovi (offline preplánovanie), v Edge Functions aj v testoch. Volania LLM idú **len zo servera** (Edge Function), API kľúč nikdy nie je na klientovi. Na offline režim slúži lokálna DB (expo-sqlite, prípadne WatermelonDB alebo PowerSync) so synchronizáciou s Postgresom.

**Štruktúra monorepa (návrh):**
```
apps/mobile          # Expo app
packages/plan-engine # deterministický engine (šablóny, progresia, rescheduling) – čisté TS + Vitest
packages/shared      # typy, Zod schémy, katalóg cvikov
supabase/            # migrácie, RLS politiky, seed, edge functions (ai-plan, ai-explain)
docs/
```

### 5.3 Dátový model (náčrt)
```
User(id, email, locale, units, created_at)
Profile(user_id, birth_year, sex?, height, weight, experience_level,
        equipment[], available_days[], session_minutes, limitations[], parq_flags, consent_health_at)
Goal(id, user_id, type[strength|hypertrophy|fat_loss|general|endurance|hybrid],
     target?, deadline?, status)
Exercise(id, slug, name_i18n, primary_muscles[], secondary_muscles[], equipment[],
         pattern[squat|hinge|push_h|push_v|pull_h|pull_v|carry|core|cardio],
         difficulty, contraindication_tags[], substitutes[], media_url)
PlanTemplate(id, name, split, days_per_week, level, goal_types[], definition_json)
Plan(id, user_id, goal_id, template_id?, version, status[active|archived],
     start_date, weeks, generated_by[rules|llm_hybrid], rationale_text, created_at)
PlanWeek(id, plan_id, index, phase[accumulation|intensification|deload], focus)
PlannedSession(id, plan_week_id, day_index, scheduled_date, title, est_minutes,
               priority[key|normal|optional], status[planned|done|skipped|moved|merged])
PlannedExercise(id, planned_session_id, exercise_id, order, sets, rep_min, rep_max,
                target_rir, target_load?, rest_sec, superset_group?)
WorkoutLog(id, user_id, planned_session_id?, started_at, ended_at, pre_checkin_json,
           session_rpe?, notes)
SetLog(id, workout_log_id, exercise_id, set_index, reps, load_kg, rir?, is_warmup, completed)
CheckIn(id, user_id, date, kind[daily|weekly], sleep, energy, soreness, stress, note)
ScheduleChange(id, plan_id, planned_session_id, kind[move|merge|shorten|skip],
               reason, from_date, to_date, created_by[user|system])
AdherenceStat(user_id, week_start, planned, completed, streak_weeks)  -- view/materialized
Reminder(id, user_id, rule_json, channel[push|email], active)
AiInteraction(id, user_id, purpose, model, input_tokens, output_tokens, cost, created_at)  -- audit + náklady
```
Kľúčové rozhodnutia:
- **Plán je verzionovaný.** Úpravy nevytvárajú prepisy, ale nové verzie alebo záznamy `ScheduleChange`, vďaka čomu je k dispozícii história a vysvetliteľnosť.
- `SetLog` je oddelený od `PlannedExercise`, takže používateľ môže cvik nahradiť alebo pridať.
- Všetky váhy sa ukladajú v kg, prevod na jednotky prebieha v UI.
- RLS: každý riadok patrí cez `user_id` používateľovi. Katalóg cvikov a šablóny sú verejne čitateľné.

### 5.4 Integrácia AI a náklady
- **Použitie:** (a) normalizácia onboardingu z voľného textu, (b) výber variantov cvikov z katalógu a vysvetlenie plánu, (c) týždenná reflexia a návrh úprav, (d) neskôr chatový „kouč“ s nástrojmi (tool use) volajúcimi engine, napríklad `reschedule_week` alebo `swap_exercise`. LLM tak koná výlučne cez overené funkcie.
- **Modely:** menší a lacnejší model (trieda Claude Haiku) na normalizáciu a krátke texty, model triedy Sonnet na generovanie a vysvetlenie plánu. Výstup cez tool use alebo JSON schému.
- **Optimalizácia:** prompt caching (systémový prompt a katalóg cvikov sú stabilné), posielanie len relevantnej podmnožiny katalógu, batch API pre nočné týždenné súhrny.
- **Odhad nákladov** (orientačne, pri cenách cca 3 USD za milión vstupných a 15 USD za milión výstupných tokenov pre triedu Sonnet a výrazne nižších pre Haiku; **treba overiť aktuálny cenník**):
  - Vygenerovanie plánu: cca 6k vstupných a 3k výstupných tokenov, teda cca 0,06 až 0,07 USD.
  - Týždenná reflexia: cca 3k vstupných a 0,8k výstupných tokenov, teda cca 0,02 USD (s Haiku menej ako 0,01 USD).
  - Aktívny používateľ mesačne (1 plán a 4 reflexie, k tomu občasné úpravy) vychádza na cca **0,10 až 0,25 USD**, čo pri predplatnom 8 až 10 € predstavuje zanedbateľný podiel.
  - Chatový kouč bez limitov môže stáť rádovo viac, preto treba nastaviť limity na používateľa a deň a evidovať náklady v `AiInteraction`.
- **Evaluácia:** sada cca 50 testovacích profilov (začiatočník s bolesťou kolena, 2 dni týždenne, len jednoručky a podobne). Každý výstup LLM musí prejsť validátorom a výsledky sa sledujú pri každej zmene promptu alebo modelu.

---

## 6. Monetizácia

| Model | Popis | Hodnotenie |
|---|---|---|
| **Freemium + predplatné** | Zadarmo: logovanie, 1 pravidlový plán, základné grafy. **Pro** (cca 8 až 10 € mesačne alebo 50 až 70 € ročne, 7 až 14-dňová skúšobná verzia): adaptívne preplánovanie, AI vysvetlenia a týždenná reflexia, pokročilé štatistiky, viac plánov a cieľov, integrácie. | **Odporúčané.** Štandard trhu (Fitbod, Hevy Pro, Strong Pro). |
| **Iba predplatné (paywall)** | Platba vopred alebo po skúšobnej verzii | Vyššia konverzia na zaplatený účet, ale pomalší rast. Vhodné neskôr na A/B test. |
| **Jednorazové programy** | Predaj konkrétnych programov („8 týždňov na prvý zhyb“) | Doplnok, dobrý na obsahový marketing |
| **Marketplace trénerov** | Tréneri predávajú programy alebo koučing cez platformu (provízia 15 až 30 %) | Silný dlhodobý potenciál (TrainingPeaks, Future), ale vyžaduje dvojstranný trh, preto až vo fáze 3 a neskôr |
| **B2B / firemný wellness** | Licencie pre firmy, tímové výzvy | Zaujímavé pre segment zaneprázdnených profesionálov, vo fáze 3 |
| **Reklama** | | Neodporúčam, poškodzuje UX a dôveru (JEFIT ako negatívny príklad) |

Platby: RevenueCat nad StoreKit a Google Play Billing (správa predplatných, analytika, paywall experimenty). Pri webových platbách Stripe a pravidlá obchodov s aplikáciami (anti-steering pravidlá sa v EÚ a USA menia, treba overiť aktuálny stav).

---

## 7. Odporúčaný rozsah MVP a roadmapa

### 7.1 MVP: nevyhnutné funkcie
1. **Onboarding:** cieľ, skúsenosti, dostupné dni a čas, vybavenie, obmedzenia, PAR-Q+ skríning, disclaimer, súhlas so spracovaním zdravotných údajov, implementačný zámer (kedy a kde).
2. **Katalóg cvikov:** cca 80 až 120 cvikov s tagmi (svaly, vzorec pohybu, vybavenie, náročnosť, kontraindikácie, náhrady). Popis techniky stačí textový, videá prídu neskôr.
3. **Pravidlový generátor plánu:** 4 až 6 šablón (Full Body 2× a 3×, Upper/Lower 4×, domáca verzia s jednoručkami alebo vlastnou váhou), 6 až 8-týždňové bloky s deloadom, dvojitá progresia a jednoduchá RIR autoregulácia.
4. **Logovanie tréningu:** predvyplnené z plánu, RIR, časovač prestávky, náhrada cviku, **funkčnosť offline**.
5. **Adaptívne preplánovanie (hlavná funkcia):** presun, skrátenie (30-minútová verzia), vynechanie s prepočtom týždňa a „minimálna dávka“ (10 až 15 minút).
6. **Dodržiavanie plánu:** týždenná séria, kalendár (plánované, splnené, vynechané), push pripomienky v zvolenom čase, týždenný súhrn.
7. **Progres:** graf e1RM pre 3 až 5 kľúčových cvikov, osobné rekordy, objem za týždeň.
8. **Účty a súkromie:** Supabase Auth (email, Apple, Google), export a zmazanie údajov.
9. **AI (obmedzene):** server-side vysvetlenie plánu („prečo práve takto“) a týždenná reflexia. Aplikácia funguje aj bez AI.

### 7.2 Neskôr
- Fáza 2: zápis do Apple Health a Health Connect, čítanie spánku a HRV pre check-iny, AI výber variantov cvikov, chatový kouč cez nástroje enginu, accountability partner, paywall Pro cez RevenueCat, angličtina.
- Fáza 3: hybridný modul (beh), Garmin a Strava, Apple Watch, skupinové výzvy a B2B, videá techniky, marketplace trénerov, pokročilá periodizácia.

### 7.3 Fázovaná roadmapa
| Fáza | Trvanie (orientačne) | Cieľ | Výstup / metrika |
|---|---|---|---|
| **0: Základy** | 1 až 2 týždne | Monorepo, CI, Supabase schéma, katalóg cvikov, kostra enginu | CI zelené, migrácie, seed katalógu, unit testy enginu |
| **1: Jadro MVP** | 4 až 6 týždňov | Onboarding, generovanie, logovanie, offline, kalendár | Interný test: používateľ dokončí onboarding a odloguje 1 týždeň |
| **2: Dodržiavanie plánu** | 3 až 4 týždne | Preplánovanie, minimálna dávka, série, notifikácie, týždenný súhrn, AI vysvetlenia | Uzavretá beta (30 až 100 ľudí SK/CZ). Metriky: **týždenná miera dodržiavania (splnené / plánované)**, retencia W4 a W8 |
| **3: Monetizácia a integrácie** | 4 až 6 týždňov | Pro paywall, HealthKit a Health Connect, partner, angličtina | Konverzia zo skúšobnej verzie na platenú, verejný launch |
| **4: Rozšírenie** | priebežne | Hybrid a beh, kouč s nástrojmi, B2B, marketplace | |

**Kľúčová metrika úspechu (north star):** podiel aktívnych používateľov, ktorí splnia aspoň 80 % plánovaných tréningov v 4 z posledných 6 týždňov.

### 7.4 Prvé konkrétne úlohy pre developer agenta
Každá úloha je samostatne overiteľná a prechádza cyklom review a QA.

1. **T1: Kostra monorepa a CI.** pnpm workspaces (`apps/mobile`, `packages/plan-engine`, `packages/shared`), TypeScript strict, ESLint a Prettier, Vitest, GitHub Actions (lint, typecheck, test).
   *Akceptačné kritériá:* `pnpm install && pnpm lint && pnpm typecheck && pnpm test` prejde lokálne aj v CI a obsahuje ukážkový test v každom balíku.
2. **T2: Doménové typy a Zod schémy** v `packages/shared` (Profile, Goal, Exercise, Plan, PlanWeek, PlannedSession, PlannedExercise, WorkoutLog, SetLog, ScheduleChange).
   *Akceptačné kritériá:* schémy validujú platné a odmietajú neplatné vzorky (napríklad záporné opakovania, `rep_min > rep_max`, neznámy `exercise_id`), s testami.
3. **T3: Katalóg cvikov (seed).** Cca 80 cvikov ako JSON s tagmi a náhradami, slovenské a anglické názvy.
   *Akceptačné kritériá:* validácia schémou, každá náhrada odkazuje na existujúci cvik, každý vzorec pohybu má aspoň 1 variant pre každé vybavenie (vlastná váha, jednoručky, posilňovňa).
4. **T4: Plan engine v1 (generovanie).** `generatePlan(profile, goal) → Plan` pre šablóny Full Body 2×/3× a Upper/Lower 4×, 6-týždňový blok s deloadom v 6. týždni, filtrovanie podľa vybavenia a obmedzení.
   *Akceptačné kritériá:* deterministický výstup (rovnaký vstup dáva rovnaký výstup), dodržaný strop týždenných sérií na svalovú skupinu, žiadny cvik s kontraindikáciou voči obmedzeniu profilu, trvanie tréningu v rámci `session_minutes` ±10 %. Snapshot a property testy.
5. **T5: Plan engine v1 (progresia a autoregulácia).** `nextTargets(plannedExercise, setLogs) → targets`: dvojitá progresia, úprava podľa RIR, e1RM (Epley/Brzycki), zníženie záťaže po prestávke.
   *Akceptačné kritériá:* tabuľkové testy hraničných prípadov (zlyhanie série, RIR 0, chýbajúci RIR, viac ako 14 dní prestávka, prírastok zaokrúhlený na dostupné kotúče).
6. **T6: Plan engine v1 (preplánovanie).** `rescheduleWeek(week, event: missed|shorten|skip, constraints) → ScheduleChange[]`.
   *Akceptačné kritériá:* nikdy dva tréningy rovnakej svalovej skupiny v po sebe idúcich dňoch, kľúčové tréningy majú prednosť, skrátená verzia trvá najviac 30 minút a obsahuje prioritné cviky, výstup obsahuje zrozumiteľný dôvod.
7. **T7: Supabase schéma.** Migrácie podľa dátového modelu, RLS politiky (používateľ vidí len svoje dáta) a seed katalógu.
   *Akceptačné kritériá:* testy RLS (používateľ A nevidí dáta používateľa B), `supabase db reset` prejde.

Úlohy T1, T2 a T3 sa môžu robiť čiastočne paralelne (T2 a T3 po T1). T4 až T6 závisia od T2 a T3. T7 môže prebiehať paralelne s T4 až T6. Mobilné UI (onboarding, logovanie) prichádza až po stabilizácii enginu.

### 7.5 Otvorené rozhodnutia pre používateľa
1. Potvrdiť nicu (zaneprázdnení ľudia a návrat k tréningu) a jazyk pri spustení (najprv SK/CZ, alebo hneď EN).
2. Expo (natívne aplikácie) verzus PWA na rýchle overenie hypotézy.
3. Supabase (hosting v EÚ) ako backend.
4. Rozsah AI v MVP: len vysvetlenia a reflexia (odporúčané) alebo hneď chatový kouč.
5. Rozpočet na API a obchody s aplikáciami (Apple Developer cca 99 USD ročne, Google Play jednorazovo 25 USD).

### 7.6 Hlavné riziká
- **Odliv používateľov:** fitness aplikácie majú veľmi nízku retenciu (zvyčajne len jednotky percent aktívnych po 30 dňoch). Celá hodnota produktu stojí na tom, či adaptivita skutočne zlepší dodržiavanie plánu, preto ju treba merať od bety.
- **Bezpečnosť a zodpovednosť:** zranenie v dôsledku odporúčania. Mitigácia: konzervatívne pravidlá, validátor, PAR-Q+, disclaimer, žiadna neoverená záťaž z LLM.
- **Komoditizácia:** veľkí hráči (Strava/Runna, Apple, Fitbod) môžu pridať podobné AI funkcie. Obranou je kvalita UX v nike, komunita a lokálny trh.
- **GDPR:** zdravotné údaje predstavujú osobitnú kategóriu. Treba hosting v EÚ, DPA s dodávateľmi (Supabase, Anthropic) a minimalizáciu údajov posielaných do LLM (žiadne mená ani e-maily).
