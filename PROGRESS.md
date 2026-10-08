# PROGRESS

Fitness app MVP: generates training plans and helps users follow through on them.
Source analysis: `docs/research/fitness-app-moznosti.md`.

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

| D8 | Delegation mechanism for T1–T11 | **Open, needs user decision** | The boss session that received the go-ahead has no Agent tool. Options: (a) rerun as the main thread with `claude --agent boss` so that `Agent(developer, reviewer, qa)` is available; (b) the user allows the boss to start `claude -p --agent <name>` subprocesses via Bash (this needs a non-interactive permission mode, which only the user can grant); (c) the user explicitly waives the role split and C5. |

## Tasks

| ID | Task | Status | Notes |
|----|------|--------|-------|
| T0 | Translate the research doc to English (`docs/research/fitness-app-options.md`) | done (no agent review) | Translated by the boss agent (documentation, not production code). Reviewer/QA were not run because no agent-delegation tool was available. |
| T1 | Monorepo, tooling (TS, lint, test runner) and CI workflow | blocked | Blocker B1: the boss session has no Agent/Task tool, so it can't delegate to the developer/reviewer/qa agents. |
| T2 | Zod schemas for the domain model | todo | |
| T3 | Exercise catalog (~80–120 exercises) | todo | |
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
