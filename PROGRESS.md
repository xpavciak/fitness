# PROGRESS

Fitness app MVP: generates training plans and helps users follow through on them.
Source analysis: `docs/research/fitness-app-options.md` (English; original Slovak: `docs/research/fitness-app-moznosti.md`).

## Definition of done (all must hold)

- **C1 Build:** `pnpm install && pnpm build` passes with no errors. This covers the typecheck of all packages and the Expo web export of the app.
- **C2 Tests and lint:** `pnpm test` is green and `pnpm lint` passes.
- **C3 Features work.** Each is verified by automated tests and a QA pass:
  - **A Plan generation:** onboarding profile → plan. A PAR-Q+ red flag blocks plan generation and shows a "see a doctor" message instead.
  - **B Logging and progression:** workout logging, `nextTargets` (double progression and RIR), e1RM and personal records.
  - **C Adaptive rescheduling:** a missed session is moved, merged, shortened or skipped, and the week is recomputed. A "minimum dose" session of 10–15 minutes is available.
  - **D Adherence:** weekly streaks and the adherence percentage.
  - **E App UI (English):** onboarding → plan → log workout → progress, with offline local storage.
- **C4 Backend schema:** the Supabase SQL migrations, including RLS, apply cleanly to Postgres 15+ in Docker.
- **C5 Quality gate:** the reviewer agent returns APPROVE and the QA agent returns READY for every task.

## Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Language | English for the UI, code and docs | Set by the user. |
| D2 | Platform | Expo (React Native) + TypeScript, with a web target used for build verification | Boss agent recommendation. A PWA lacks HealthKit and has weak notifications on iOS. |
| D3 | Repo layout | pnpm monorepo: `packages/engine` (pure TS planning engine), `apps/mobile` (Expo), `supabase/` (migrations) | The boss agent recommended keeping the engine as a pure, testable package. |
| D4 | Backend | Supabase, EU region. The MVP is local-first. Supabase sync goes behind an interface and stays unwired until credentials exist. | No Supabase project or credentials are available in this environment. |
| D5 | AI | Limited. The plan explanation and weekly reflection sit behind an interface with a deterministic, template-based fallback. The Claude API is called server-side only and is optional. It is not required for done. | No API key is available. The rules engine stays the source of truth. |
| D6 | Budget | Free tiers only | Default until the user says otherwise. |
| D7 | Wearables, chat coach, running module, marketplace | Out of MVP scope (later phases) | Per the research roadmap. |
| D8 | Delegation mechanism for T1–T11 | The main session acts as orchestrator and delegates to the developer, reviewer and qa agents directly, following the boss agent's plan and order. | Subagents cannot spawn subagents. This keeps the role split and the C5 quality gate without changing any permissions. Tasks are batched: (T1–T3), then (T4–T7 alongside T8), then (T9–T10), then T11. Each batch gets a reviewer pass and a QA pass. |

## Tasks

| ID | Task | Status | Notes |
|----|------|--------|-------|
| T0 | Translate the research doc to English (`docs/research/fitness-app-options.md`) | done (no agent review) | Translated by the boss agent (documentation, not production code). Reviewer/QA were not run because no agent-delegation tool was available. |
| T1 | Monorepo, tooling (TS, lint, test runner) and CI workflow | done | pnpm workspaces (`packages/*`, `apps/*`); strict `tsconfig.base.json`; ESLint flat config (typescript-eslint strictTypeChecked) + Prettier (docs/agent files excluded); Vitest. CI: frozen install, `build:packages`, lint, format check, typecheck, test, build; concurrency group, 15-min timeout. Root `typecheck` builds library packages first; the engine also exports a `@fitness/source` condition (src) for T9. TypeScript pinned to 6.0.x (typescript-eslint supports `<6.1`). |
| T2 | Zod schemas for the domain model | done | `packages/engine/src/schemas` (Zod 4, snake_case). Flat unrefined `*RowSchema` per table plus nested refined schemas; `checkX` helpers are exported for form reuse. Entity ids are client-generated UUIDs; exercise ids stay slugs. Profile: PAR-Q+, `training_slots`, IANA `timezone`, `birth_year` not in the future, `ageOn()`. Invariants: Monday-aligned consecutive weeks, sessions stay within their week (no cross-week rescheduling in the MVP), unique ids at every level, unique (exercise_id, set_index), no completed 0-rep sets. `measure` on prescriptions and logs (seconds up to 3600). `is_key` on PlannedExercise. Catalog validators check id, measure and loadability. Goal types are limited to strength/hypertrophy/fat_loss/general (D7). Load convention and plate increments in `src/loads.ts`; adherence semantics documented on `SESSION_STATUSES`. |
| T3 | Exercise catalog (~80–120 exercises) | done | 119 exercises in `packages/engine/src/catalog/exercises.ts`; 11 patterns; tiers bodyweight / dumbbells (+bench) / full_gym. Contraindications reworked (hip on loaded squat/lunge/hinge and plyometrics, neck, shoulder and ankle fixes) and tested per region with known-risk ids. New `rack` equipment for rack-dependent barbell lifts and inverted row. `low_stimulus` flag (prone pulldown/row, new towel pulldown). Tests also check that substitutes share the pattern and that isolation substitutes share a primary muscle. |
| T4 | `generatePlan`, templates and the PAR-Q+ gate | todo | Feature A |
| T5 | `nextTargets`, e1RM and PRs | todo | Feature B |
| T6 | `rescheduleWeek` and minimum dose | todo | Feature C |
| T7 | Adherence and weekly streaks | todo | Feature D |
| T8 | Supabase migrations and RLS, verified in Docker | todo | C4 |
| T9 | Expo app screens, local storage and engine wiring | todo | Feature E |
| T10 | AI explanation and reflection interface with fallback | todo | D5 |
| T11 | Final verification of C1–C5 | todo | |

## Log

- 2026-10-08: Research done (boss agent). The user chose English. Decisions D2–D7 follow the boss agent's recommendations.
- 2026-10-08: T0 done (English research doc). T1–T11 blocked: the boss session has no agent-delegation tool and must not write production code itself. Escalated to the user (D8).
- 2026-10-08: B1 resolved (D8): the main session orchestrates. Starting batch 1 (T1–T3).
- 2026-10-08: Batch 1 (T1–T3) implemented by the developer agent: monorepo + CI, domain Zod schemas, 118-exercise catalog. `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build` green (178 tests). Awaiting reviewer and QA.
- 2026-10-08: Batch 1 rework after review (REQUEST CHANGES) and QA (READY, 3 minor gaps): fixed B1 (timed caps) and B2 (contraindication tags), should-fix items 1–14 and the nits; QA `it.fails` gap tests converted to passing tests. Checks green (273 tests). Awaiting re-review.
- 2026-10-08: Batch 1 (T1–T3) passed. Reviewer: APPROVE after one fix round (b1b70d7). QA: READY. 273 tests. Starting batch 2 (T4–T7 engine alongside T8 Supabase).
