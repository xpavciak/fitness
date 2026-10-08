# Fitness app: training plan generation and follow-through (options analysis)

*Status: research and planning. English translation of `fitness-app-moznosti.md` (Slovak original). Date: 2026-10-08.*

> **Note on data:** The market overview, prices and API parameters come from the author's knowledge (to mid-2026). They were not verified by live research. Subscription and API prices change often, so check them before making business decisions. Approximate figures are marked "approx."

---

## 0. Summary

- **The market is saturated with workout loggers** (Strong, Hevy, JEFIT) and **plan generators** (Fitbod, Freeletics, Future, Runna). None of them solves the core problem, which is **following the plan in real life**: missed sessions, travel, fatigue, and less time than planned. When a session is missed, most apps either do nothing or just shift the plan.
- **Recommended niche:** busy people (approx. 25–45 years old), beginners to early intermediates, who train in a gym or at home 2–4 times a week and keep falling off. Core promise: *"A plan that adapts to your week, not the other way around."*
- **Plan generation:** a hybrid approach. A **deterministic rules engine** (templates, periodization, progressive overload, RIR autoregulation) sets the structure and load. An **LLM (Claude API)** interprets the intake questionnaire, explains the plan and proposes changes. It always works inside a validated JSON schema and the exercise catalog. The LLM never sets load without a rules check.
- **MVP technology:** Expo (React Native) + TypeScript and Supabase (Postgres, Auth, RLS, Edge Functions). The planning engine is a separate pure TS package with unit tests. Apple Health and Health Connect integration comes in phase 2.
- **Monetization:** freemium (free logging and one basic plan) plus a Pro subscription (approx. EUR 8–10 per month or EUR 50–70 per year) for adaptive plans, the AI coach and advanced stats. A coach marketplace comes later.

---

## 1. Market landscape

| App | Focus | Strengths | Weaknesses / gaps |
|---|---|---|---|
| **Fitbod** | Gym, generated workouts | Its algorithm generates each workout from equipment, muscle fatigue and history. Excellent onboarding. | Workouts are generated on the spot, with no long-term periodization or clear goal. Advanced lifters don't trust it. It doesn't know *why* a session was missed. |
| **Strong** | Workout logger | Fast, clean logging, templates, 1RM estimate, Apple Watch. | Almost no plan generation or coaching. Motivation is left to the user. |
| **Hevy** | Logger plus social network | Generous free tier, social feed, routines, fast-growing community. | Users build (or copy) plans themselves. Weak adaptivity. |
| **JEFIT** | Logger plus exercise database | Huge exercise and plan library, community. | Dated, cluttered UX and many ads in the free tier. |
| **Freeletics** | Calisthenics, HIIT, AI "Coach" | Strong brand. The AI coach adjusts the week from feedback. No-equipment workouts. | Intensity is often too high for beginners. Less suited to classic strength training. |
| **Nike Training Club** | Video workouts | High-quality trainer content, programs, free. | Almost no personalization and no load progression tracking. |
| **Caliber** | Strength training, human and AI coaching | Evidence-based programming, human coaches available. | Human coaching is expensive. The free tier is limited. |
| **Future** | Remote personal trainer | A real coach adjusts the plan every week, which gives high adherence. | Approx. USD 150–200 per month, so it doesn't scale to the mass market. |
| **TrainingPeaks** | Endurance sports (running, cycling, triathlon) | The coaches' standard, with TSS/CTL/ATL metrics and a plan marketplace. | Complex for regular users, coach-oriented. |
| **Runna** (now part of Strava) | Running plans | Personalized race plans, great UX, watch integrations, pace adaptation. | Running only. Strength is an add-on. |

**Other relevant players:** Ladder (team programs with a coach), Alpha Progression and RP Hypertrophy (hypertrophy autoregulation, RIR, volume), Apple Fitness+, Peloton, Garmin Coach, Strava (social network, Runna acquisition), Whoop (recovery).

### Gaps and opportunities
1. **Adaptive response to real life.** When a session is missed, most apps either do nothing or just shift the plan. What's missing is smart rescheduling: merging sessions, cutting a session to 20 minutes, or protecting key sessions.
2. **A bridge between "logger" and "coach".** Strong and Hevy are great for logging but don't advise. Future and Caliber advise but are expensive. A cheap "AI coach with human rules" remains underserved.
3. **Transparency.** Fitbod and similar apps are black boxes. Users want to know *why* today is 3×8 at 60 kg.
4. **Hybrid athletes.** Combining strength and running (for example HYROX, or a half marathon alongside the gym) is poorly covered. Runna is running only and Fitbod is gym only.
5. **Localization.** Almost no quality app offers Slovak or Czech. The small SK/CZ market is a good starting point for a beta community, but the app should plan for English long term.
6. **Returning after a break.** People "starting again" are a huge segment, but apps assume either a complete beginner or continuous training.

---

## 2. Plan generation approaches

### 2.1 Rule-based templates
- **Principle:** a library of proven templates, for example Full Body 3×/week, Upper/Lower 4×, PPL, 5/3/1, GZCLP, and running plans such as Couch-to-5K. Templates are parameterized by goal, days, equipment and level.
- **Periodization:** linear (beginners), undulating (DUP) and block. A **deload** every 4th to 6th week.
- **Progressive overload:** add load (+2.5 kg upper body and +5 kg lower body once all sets are completed), double progression (first reps across an 8–12 range, then load), gradual volume increases.
- **Pros:** predictable, safe, testable, no API cost, explainable.
- **Cons:** limited personalization, combinatorial template explosion, feels generic.

### 2.2 Algorithmic autoregulation
- **RPE/RIR:** after a set, the user enters reps in reserve (RIR). The engine adjusts the load of the next set or session (for example, with a target of RIR 2: +5% if RIR was ≥ 4; −5% if RIR was 0 or the set failed).
- **1RM estimate:** Epley `1RM = w × (1 + r/30)` or Brzycki `1RM = w × 36 / (37 − r)`. Reliable for r ≤ 10. The working load is derived from e1RM and the target RIR (Tuchscherer's RPE chart).
- **Volume management:** effective sets per muscle group per week (approx. 10–20 for hypertrophy), adjusted for recovery (soreness, sleep, performance).
- **Running:** training zones from race times (VDOT, Daniels) or from heart rate. Weekly volume rises by at most approx. 10%. Treat the acute:chronic workload ratio (ACWR) as a rough guide only.
- **Pros:** real personalization from data, evidence-based.
- **Cons:** depends on input quality (beginners misjudge RIR) and needs enough data.

### 2.3 LLM-generated plans (e.g. Claude API)
- **Principle:** the questionnaire and history go into the prompt, and the model returns a structured plan (JSON via tool use or structured output).
- **Pros:** handles free text ("my left shoulder hurts", "I only have a kettlebell and 25 minutes"), explains the plan naturally and adapts its tone to the person. This is what makes it feel like a coach.
- **Cons and risks:** hallucinations (non-existent exercises, nonsensical loads), inconsistency between runs, hard to test, cost and latency, and the risk of unsafe advice around injuries.
- **Mandatory guardrails:**
  1. Output is validated with a JSON schema (e.g. Zod). Exercises may be picked **only from the catalog** by `exercise_id`.
  2. A **rules validator** runs after the LLM. It checks the volume cap per muscle group, the maximum weekly load increase, deloads, rep ranges and the exclusion of contraindicated exercises.
  3. If validation fails, retry with the error message, then fall back to a deterministic template.
  4. An input safety filter: if the user mentions chest pain, dizziness, pregnancy, surgery or an acute injury, the app shows a "see a doctor" recommendation instead of a plan.
  5. No diagnoses and no advice on medication or extreme diets.

### 2.4 Hybrid (recommended)
```
Questionnaire ─► [LLM: normalize free text → structured profile]
              ─► [Rules engine: template choice, periodization, volume, load]
              ─► [LLM (optional): pick exercise variants from the catalog + explanation]
              ─► [Rules validator] ─► Plan (versioned)
Workout logs  ─► [Autoregulation (deterministic)] ─► adjust upcoming sessions
Missed session ─► [Scheduler (deterministic)] ─► proposals ─► [LLM: plain-language wording]
```
The core is deterministic, testable and cheap. The LLM adds personalization and a human feel. The app keeps working when the LLM is unavailable.

### 2.5 Safety
- **PAR-Q+ questionnaire** during onboarding (the standard physical activity readiness screen). On a positive answer, the app recommends seeing a doctor and offers a conservative mode.
- **Beginners:** 2–4 weeks focused on technique at low load (RIR 3–4), no training to failure, simple exercise variants (goblet squat instead of back squat), and technique videos and cues.
- **Limitations:** the user flags problem areas (knee, lower back, shoulder), and the engine removes or substitutes risky exercises using catalog tags.
- **Legal:** a clear "not medical advice" disclaimer, consent in the terms of service, and no health claims, so the app stays outside medical device regulation (EU MDR). Health data is a special category under GDPR (Art. 9), which requires explicit consent, data minimization, export and deletion. AI use also brings AI Act transparency requirements.
- **Overtraining protection:** a cap on weekly volume increases, mandatory deloads, and an automatic load reduction after a long break (for example −10 to −20% after more than 2 weeks).

---

## 3. Tracking and adherence

### 3.1 Basics (hygiene)
- **Workout logging:** set, reps, load, RIR. Prefilled from the plan and the last session. One-tap set completion. Rest timer. **Works offline** (gyms often have no signal).
- **Progress charts:** e1RM for key lifts, weekly volume per muscle group, personal records, body weight, measurements, photos (optional and private).
- **Calendar:** planned, done, missed and moved sessions.

### 3.2 Adherence (the core differentiator)
- **Adaptive rescheduling of missed sessions:**
  - *Move:* to the next free day, respecting recovery (never two hard leg days in a row).
  - *Merge:* two sessions into one, keeping only the key exercises.
  - *Shorten:* a 20–30 minute version when time is short (priority exercises, supersets).
  - *Skip:* close the week guilt-free without stalling progression.
  - *Protect key sessions:* for example, the long run or the main strength session takes priority.
- **"Minimum dose" (minimum viable workout):** when the user says "no time", the app offers a 10–15 minute version that keeps the streak alive. This applies a key habit-research principle: never miss twice in a row.
- **Quick check-ins:** pre-workout (sleep, energy, soreness, each on a 1–5 scale) that adjust session intensity. A short weekly reflection with a proposal for next week.
- **Implementation intentions:** during onboarding, the user decides *when, where and how*, for example "Mon, Wed, Fri at 7:00, the gym near work". This has been shown to raise adherence (Gollwitzer).
- **Reminders:** at the time the user chose, with frequency that adapts over time. They must not feel like spam. If the user ignores them, they become less frequent.
- **Streaks and milestones:** a **weekly** streak (for example "3 of 3 sessions this week") instead of a daily one, because a daily streak encourages overtraining in strength training. "Joker" days (streak freeze).
- **Progress feedback:** "Your squat is 18% higher than 6 weeks ago." Visible progress is a strong motivator.

### 3.3 Habit-science techniques
Implementation intentions, habit stacking, friction reduction (a one-tap workout start), commitment devices (an optional "deposit" or a pact with a partner), positive reinforcement instead of guilt, identity ("you are someone who trains"), starting small (Fogg's Tiny Habits) and the fresh-start effect (Monday, a new month). Self-determination theory (autonomy, competence, relatedness) matters here too: give users choice and control instead of orders.

### 3.4 Wearable integrations
| Integration | What it brings | Note |
|---|---|---|
| **Apple HealthKit** | Write workouts; read steps, heart rate, HRV and sleep | Native or via a React Native/Expo module only, not from a PWA |
| **Google Health Connect** | The Android equivalent | Replaces the shut-down Google Fit APIs |
| **Garmin** | Health API and Training/Courses API (push workouts to watches) | Requires partner approval |
| **Strava** | Activity import (running, cycling), sharing | OAuth, API limits and the 2024 data-use restrictions |
| **Apple Watch / Wear OS** | Logging from the watch | Expensive to build, planned for later |

For the MVP, either no integration or a one-way one (writing workouts to Apple Health and Health Connect) is enough. Reading recovery data (HRV, sleep) makes sense later.

### 3.5 Social and accountability
- **Accountability buddy:** 1–3 friends see whether you completed your week. This is simpler and more effective than a public feed.
- Small groups and challenges (for example a team from work), sharing personal records.
- A full social network (like Hevy) is expensive to moderate, so I recommend it for later.

---

## 4. Target segments

| Segment | Size | Willingness to pay | Competition | Adherence problem | Assessment |
|---|---|---|---|---|---|
| Complete beginners | Very large | Low to medium | Medium (NTC, Freeletics) | Very high | Good, but high churn and a need for content (videos) |
| Gym goers (intermediate) | Large | Medium to high | **High** (Fitbod, Hevy, Strong) | Medium | Hard to stand out with logging alone |
| Runners | Large | High | High (Runna/Strava, Garmin Coach) | Medium | Runna is very strong |
| Home workouts | Large | Low | High (YouTube, free NTC) | High | Hard to monetize |
| **Busy professionals / people returning to training** | Large | **High** | **Low** (no one targets exactly them) | **Highest** | **Most promising** |
| Hybrid athletes (strength + running, HYROX) | Medium, growing | High | Low | Medium | A good second wave |

### Recommendation
**Primary niche: "busy people who finally want to stick with it".** These are people approx. 25–45 years old, beginners to early intermediates, doing 2–4 sessions a week of 30–60 minutes in a gym or at home with basic equipment. Their calendars are unpredictable, they keep falling off, and they are willing to pay for results.

- **Positioning:** *"A training plan that accounts for your life."* The differentiator is not a better hypertrophy algorithm. It is **adaptive rescheduling, the minimum dose, weekly streaks and transparent explanations**.
- **Natural extension:** a hybrid strength + running module (1–2 runs a week) that targets the gap between Fitbod and Runna.
- **Go-to-market:** an SK/CZ beta community (little local-language competition), with i18n and English supported from the start.

---

## 5. Technical options

### 5.1 Platform
| Option | Pros | Cons |
|---|---|---|
| **PWA / web (Next.js)** | Fastest to build, one codebase, no app store review | Weaker push on iOS (only since iOS 16.4 and only after adding to the home screen), **no HealthKit**, weaker App Store presence, worse offline experience |
| **React Native (Expo)** | One TS codebase for iOS, Android and web; HealthKit and Health Connect access; OTA updates; EAS Build; large ecosystem | Native modules sometimes complicate development; harder to test than the web |
| **Flutter** | Performance, consistent UI | Dart (a different language from the backend), less code sharing with a TS backend |
| **Native (Swift/Kotlin)** | Best UX, watches, widgets | Two codebases, double the cost |

**Recommendation: Expo (React Native) + TypeScript.** Notifications and health data integration are key to adherence, and a PWA lags on iOS in both. Expo Router also allows a web build (for example for admin or a landing page). If the priority is validating the hypothesis as fast as possible without the app stores, a PWA prototype is the alternative, knowing it will be rewritten later.

### 5.2 Backend
| Option | Pros | Cons |
|---|---|---|
| **Supabase** | Postgres (relational data fits plans and logs), Auth, Row Level Security, Edge Functions, Realtime, storage, open source (self-hosting possible), EU hosting | Edge Functions run on Deno and have limits. More complex logic needs well-designed RLS. |
| **Firebase** | Fast start, Firestore offline sync, FCM | NoSQL is poorly suited to analytical queries (volume, e1RM trends), vendor lock-in |
| **Custom Node (Fastify/NestJS) or Python (FastAPI)** + Postgres | Full control; Python is strong for data analysis | More work on infrastructure, auth and deployment |

**Recommendation: Supabase (EU region, for GDPR).** The planning engine is a **pure TS package** (`packages/engine`) with no I/O dependencies, so it can run on the client (offline rescheduling), in Edge Functions and in tests. LLM calls happen **only on the server** (an Edge Function), and the API key never reaches the client. For offline mode, a local DB (expo-sqlite, or WatermelonDB or PowerSync) syncs with Postgres.

**Monorepo layout (proposal):**
```
apps/mobile      # Expo app
packages/engine  # deterministic engine (templates, progression, rescheduling): pure TS + tests
supabase/        # migrations, RLS policies, seed, edge functions (ai-plan, ai-explain)
docs/
```

### 5.3 Data model (sketch)
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
AiInteraction(id, user_id, purpose, model, input_tokens, output_tokens, cost, created_at)  -- audit + cost
```
Key decisions:
- **Plans are versioned.** Changes don't overwrite. They create new versions or `ScheduleChange` records, which preserves history and explainability.
- `SetLog` is separate from `PlannedExercise`, so the user can substitute or add exercises.
- All loads are stored in kg. Unit conversion happens in the UI.
- RLS: every row belongs to a user via `user_id`. The exercise catalog and templates are publicly readable.

### 5.4 AI integration and cost
- **Uses:** (a) normalizing free-text onboarding input, (b) picking exercise variants from the catalog and explaining the plan, (c) a weekly reflection with suggested changes, (d) later, a chat "coach" with tools (tool use) that call the engine, for example `reschedule_week` or `swap_exercise`. That way the LLM acts only through verified functions.
- **Models:** a smaller, cheaper model (Claude Haiku class) for normalization and short texts, and a Sonnet-class model for plan generation and explanation. Output via tool use or a JSON schema.
- **Optimization:** prompt caching (the system prompt and exercise catalog are stable), sending only the relevant subset of the catalog, and the batch API for nightly weekly summaries.
- **Cost estimate** (rough, at approx. USD 3 per million input tokens and USD 15 per million output tokens for the Sonnet class, and much less for Haiku; **check the current price list**):
  - Generating a plan: approx. 6k input and 3k output tokens, so approx. USD 0.06–0.07.
  - Weekly reflection: approx. 3k input and 0.8k output tokens, so approx. USD 0.02 (under USD 0.01 with Haiku).
  - An active user per month (1 plan and 4 reflections, plus occasional changes) comes to approx. **USD 0.10–0.25**, which is negligible against a EUR 8–10 subscription.
  - An unlimited chat coach could cost an order of magnitude more, so set per-user daily limits and track cost in `AiInteraction`.
- **Evaluation:** a set of approx. 50 test profiles (a beginner with knee pain, 2 days a week, dumbbells only, and so on). Every LLM output must pass the validator, and results are tracked on every prompt or model change.

---

## 6. Monetization

| Model | Description | Assessment |
|---|---|---|
| **Freemium + subscription** | Free: logging, 1 rule-based plan, basic charts. **Pro** (approx. EUR 8–10 per month or EUR 50–70 per year, 7–14 day trial): adaptive rescheduling, AI explanations and weekly reflection, advanced stats, more plans and goals, integrations. | **Recommended.** The market standard (Fitbod, Hevy Pro, Strong Pro). |
| **Subscription only (paywall)** | Pay upfront or after the trial | Higher paid conversion but slower growth. A good A/B test later. |
| **One-off programs** | Selling specific programs ("8 weeks to your first pull-up") | An add-on, good for content marketing |
| **Coach marketplace** | Coaches sell programs or coaching through the platform (15–30% commission) | Strong long-term potential (TrainingPeaks, Future), but needs a two-sided market, so phase 3 or later |
| **B2B / corporate wellness** | Company licenses, team challenges | Interesting for the busy-professional segment, phase 3 |
| **Ads** | | Not recommended. They hurt UX and trust (JEFIT as the cautionary example). |

Payments: RevenueCat on top of StoreKit and Google Play Billing (subscription management, analytics, paywall experiments). For web payments, Stripe, within the app stores' rules (anti-steering rules are changing in the EU and US, so check the current state).

---

## 7. Recommended MVP scope and roadmap

### 7.1 MVP must-haves
1. **Onboarding:** goal, experience, available days and time, equipment, limitations, PAR-Q+ screening, disclaimer, health data consent, implementation intention (when and where).
2. **Exercise catalog:** approx. 80–120 exercises with tags (muscles, movement pattern, equipment, difficulty, contraindications, substitutes). Text technique cues are enough. Videos come later.
3. **Rule-based plan generator:** 4–6 templates (Full Body 2× and 3×, Upper/Lower 4×, a home version with dumbbells or bodyweight), 6–8 week blocks with a deload, double progression and simple RIR autoregulation.
4. **Workout logging:** prefilled from the plan, RIR, rest timer, exercise substitution, **works offline**.
5. **Adaptive rescheduling (core feature):** move, shorten (30-minute version), skip with a recomputed week, and the "minimum dose" (10–15 minutes).
6. **Adherence:** weekly streak, calendar (planned, done, missed), push reminders at the chosen time, weekly summary.
7. **Progress:** e1RM chart for 3–5 key lifts, personal records, weekly volume.
8. **Accounts and privacy:** Supabase Auth (email, Apple, Google), data export and deletion.
9. **AI (limited):** a server-side plan explanation ("why it's built this way") and the weekly reflection. The app works without AI.

### 7.2 Later
- Phase 2: writing to Apple Health and Health Connect, reading sleep and HRV for check-ins, AI exercise variant selection, a chat coach using engine tools, an accountability partner, the Pro paywall via RevenueCat, English.
- Phase 3: the hybrid module (running), Garmin and Strava, Apple Watch, group challenges and B2B, technique videos, the coach marketplace, advanced periodization.

### 7.3 Phased roadmap
| Phase | Duration (approx.) | Goal | Output / metric |
|---|---|---|---|
| **0: Foundations** | 1–2 weeks | Monorepo, CI, Supabase schema, exercise catalog, engine skeleton | Green CI, migrations, catalog seed, engine unit tests |
| **1: Core MVP** | 4–6 weeks | Onboarding, generation, logging, offline, calendar | Internal test: a user completes onboarding and logs 1 week |
| **2: Adherence** | 3–4 weeks | Rescheduling, minimum dose, streaks, notifications, weekly summary, AI explanations | Closed beta (30–100 people in SK/CZ). Metrics: **weekly adherence rate (done / planned)**, W4 and W8 retention |
| **3: Monetization and integrations** | 4–6 weeks | Pro paywall, HealthKit and Health Connect, partner, English | Trial-to-paid conversion, public launch |
| **4: Expansion** | Ongoing | Hybrid and running, coach with tools, B2B, marketplace | |

**North star metric:** the share of active users who complete at least 80% of planned sessions in 4 of the last 6 weeks.

### 7.4 First concrete tasks for the developer agent
Each task is independently verifiable and goes through review and QA.

1. **T1: Monorepo skeleton and CI.** pnpm workspaces, strict TypeScript, ESLint and Prettier, Vitest, GitHub Actions (lint, typecheck, test).
   *Acceptance criteria:* `pnpm install && pnpm lint && pnpm typecheck && pnpm test` passes locally and in CI, with a sample test in each package.
2. **T2: Domain types and Zod schemas** (Profile, Goal, Exercise, Plan, PlanWeek, PlannedSession, PlannedExercise, WorkoutLog, SetLog, ScheduleChange).
   *Acceptance criteria:* the schemas accept valid samples and reject invalid ones (for example negative reps, `rep_min > rep_max`, an unknown `exercise_id`), with tests.
3. **T3: Exercise catalog (seed).** Approx. 80 exercises as JSON with tags and substitutes.
   *Acceptance criteria:* validated by the schema, every substitute references an existing exercise, and every movement pattern has at least 1 variant per equipment type (bodyweight, dumbbells, gym).
4. **T4: Plan engine v1 (generation).** `generatePlan(profile, goal) → Plan` for the Full Body 2×/3× and Upper/Lower 4× templates, a 6-week block with a deload in week 6, filtered by equipment and limitations.
   *Acceptance criteria:* deterministic output (the same input gives the same output), the weekly set cap per muscle group holds, no exercise contraindicated for the profile's limitations, and session duration within `session_minutes` ±10%. Snapshot and property tests.
5. **T5: Plan engine v1 (progression and autoregulation).** `nextTargets(plannedExercise, setLogs) → targets`: double progression, RIR adjustment, e1RM (Epley/Brzycki), load reduction after a break.
   *Acceptance criteria:* table-driven tests for edge cases (a failed set, RIR 0, missing RIR, a break of more than 14 days, increments rounded to available plates).
6. **T6: Plan engine v1 (rescheduling).** `rescheduleWeek(week, event: missed|shorten|skip, constraints) → ScheduleChange[]`.
   *Acceptance criteria:* never two sessions for the same muscle group on consecutive days, key sessions take priority, a shortened version lasts at most 30 minutes and contains the priority exercises, and the output includes a plain-language reason.
7. **T7: Supabase schema.** Migrations from the data model, RLS policies (users see only their own data) and the catalog seed.
   *Acceptance criteria:* RLS tests (user A can't see user B's data), and `supabase db reset` passes.

T1, T2 and T3 can partly run in parallel (T2 and T3 after T1). T4–T6 depend on T2 and T3. T7 can run in parallel with T4–T6. The mobile UI (onboarding, logging) comes after the engine stabilizes.

### 7.5 Open decisions for the user
1. Confirm the niche (busy people and returning to training) and the launch language (SK/CZ first, or English right away).
2. Expo (native apps) versus a PWA for quick hypothesis validation.
3. Supabase (EU hosting) as the backend.
4. AI scope in the MVP: explanations and reflection only (recommended), or a chat coach right away.
5. Budget for the API and app stores (Apple Developer approx. USD 99 per year, Google Play a one-off USD 25).

### 7.6 Main risks
- **Churn:** fitness apps have very low retention (usually only single-digit percentages still active after 30 days). The product's whole value rests on whether adaptivity actually improves adherence, so measure it from the beta onward.
- **Safety and liability:** an injury caused by a recommendation. Mitigation: conservative rules, the validator, PAR-Q+, the disclaimer, and no unverified load from the LLM.
- **Commoditization:** big players (Strava/Runna, Apple, Fitbod) can add similar AI features. The defense is UX quality in the niche, community and the local market.
- **GDPR:** health data is a special category. It requires EU hosting, DPAs with vendors (Supabase, Anthropic) and minimizing the data sent to the LLM (no names or emails).
