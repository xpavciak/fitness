# apps/mobile

The Expo (React Native + TypeScript) app, feature E (task T9). It runs on Expo SDK 57 with
expo-router, and its UI is in English. It is local-first and works fully offline (decision D4).
The web target is used for build verification (D2).

## Scripts

| Command (in `apps/mobile`) | Root equivalent  | What it does                                                  |
| -------------------------- | ---------------- | ------------------------------------------------------------- |
| `pnpm start` / `pnpm web`  | –                | Expo dev server (native / web)                                |
| `pnpm build`               | `pnpm build`     | `expo export --platform web --output-dir dist`                |
| `pnpm typecheck`           | `pnpm typecheck` | `tsc` for the app (strict) and for the e2e script             |
| `pnpm test`                | `pnpm test`      | Vitest: view-models, repository, sync helpers, smoke render   |
| `pnpm e2e:web`             | `pnpm e2e:web`   | Serves `dist/` and drives Chromium (needs `pnpm build` first) |

`pnpm e2e:web` uses `playwright-core` (pinned to 1.56.1, which matches Chromium build 1194).
When `PLAYWRIGHT_BROWSERS_PATH` is not set and `/opt/pw-browsers` exists, the script uses that
folder. The script never downloads browsers itself; CI installs Chromium first. Set
`E2E_SCREENSHOTS=<dir>` to save screenshots.

## Layout

- `app/`: expo-router routes. These are thin wrappers that pass store data into the screens:
  - `index` redirects to onboarding or the plan;
  - `onboarding`;
  - `(tabs)/plan`, `(tabs)/progress` and `(tabs)/settings`;
  - `workout/[sessionId]`.
- `src/screens/`: the screens: onboarding wizard, plan/today with rescheduling, workout logging
  with a rest timer, progress, and settings.
- `src/logic/`: pure, unit-tested view-models:
  - onboarding → profile/goal mapping;
  - today's session and the display status;
  - the workout draft → `WorkoutLog`;
  - adherence and PR summaries;
  - app actions (`completeOnboarding`, `rescheduleProposals`, `acceptProposal`, `minimumDoseProposal`, ...).
- `src/engine/engine-service.ts`: the **only** module that calls the engine's computational API
  (`generatePlan`, `nextTargets`, `proposeReschedules`, `applyScheduleChanges`,
  `adherenceStats`/`weeklyStreak`, `personalRecords`, ...). Engine API changes are absorbed
  there. Schemas, types, the catalog and date helpers are imported directly.
- `src/storage/`: the `Repository` interface and `LocalRepository` on top of a `KeyValueStore`.
  The app uses AsyncStorage, which falls back to `localStorage` on web. Every save and load is
  validated with the engine Zod schemas, using the catalog-aware validators for plans and logs.
  Invalid stored data raises `StoredDataError`, and the app shows a "could not be read" screen
  that offers to retry or delete. It never discards data silently.
- `src/sync/`: the `SyncAdapter` interface and `NoopSyncAdapter` (the default). See below.
- `src/state/`: the React store (context) that ties together the repository, the clock, ids
  (`expo-crypto` `randomUUID`) and the device time zone (`expo-localization`).

## Data model on the device

AsyncStorage keys (`fitness/v1/...`):

- `profile`
- `goal`
- `plan` (the active plan)
- `workout_logs`
- `schedule_changes`: an append-only audit trail of accepted rescheduling proposals.

Regenerating the plan replaces `plan` and keeps the logs and the changes. Settings → "Export my
data" writes all keys as one JSON document (`format: "fitness-app-export"`, `version: 1`). On web
the document is downloaded; on native it opens the share sheet. "Delete all local data" removes
every key.

When onboarding hits a PAR-Q+ red flag, or the user may be under 18, the app shows the engine's
"consult a doctor" message and stores **nothing**.

## Supabase sync (not wired)

`SyncAdapter` has `push(rows by table)` and `pull(lastPulledAt)`. A `SupabaseSyncAdapter` will
follow `supabase/README.md`:

- **Push.** Flatten the nested objects into Row-schema rows. Then
  `upsert(rows, { onConflict: 'id' })` each table (profiles use `user_id`), in parent-to-child
  order (`SYNC_TABLES`).
- **Pull.** Select `updated_at > pullCursor(lastPulledAt)` per table. The cursor is the server
  high-water mark minus `PULL_OVERLAP_MS` (5 min). De-duplicate rows by `id`.
- **Normalize.** Run `nullsToUndefined` on pulled rows before `XRowSchema.parse`. PostgREST
  returns `null` for absent optional columns, and the Row schemas reject it.
- **Wiring.** Pass the adapter in `app/_layout.tsx` (`services.sync`). It runs with the anon key
  and the user's session, so RLS applies.

## Resolving the engine

The app consumes `@fitness/engine` from its compiled `dist/`, through the default export
condition. Root `pnpm build` runs workspace builds in topological order, so the engine is built
before `expo export`. Root `typecheck` builds the packages first. The `@fitness/source` condition
is deliberately **not** enabled for Metro. The engine's sources import `./x.js` specifiers, and
Metro would have to map them to `.ts`, so consuming `dist` is the safe default.
