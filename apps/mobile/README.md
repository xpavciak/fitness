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
- **Coach texts (D5).** `explainPlan` (Plan screen, "Why this plan?") and `weeklyReflection`
  (Progress screen) come from the engine's `TemplateCoachProvider` through `engine-service.ts`.
  No network is used. The Claude proxy provider stays unwired. `toCoachText` accepts both a plain
  string and `{ text, source }`, and the UI labels `source: 'ai'` texts as "AI-generated".
- `src/storage/`: the `Repository` interface and `LocalRepository` on top of a `KeyValueStore`.
  The app uses AsyncStorage, which falls back to `localStorage` on web. Every save and load is
  validated with the engine Zod schemas, using the catalog-aware validators for plans and logs.
  Invalid stored data raises `StoredDataError`, and the app shows a "could not be read" screen
  that offers to retry or delete. It never discards data silently.
- `src/sync/`: the `SyncAdapter` interface and `NoopSyncAdapter` (the default). See below.
- `src/state/`: `AppController` (framework-free, unit-tested) holds the loaded data and runs every
  action through one promise-chain mutex (`src/lib/serial-queue.ts`). Each action reads the
  latest data when it starts and publishes the result when it finishes; after a failure it
  re-reads the repository. It exposes `busy`, and screens disable their action buttons while
  it is set. `store.tsx` binds the controller to React with `useSyncExternalStore`. It also
  bumps a clock, so "today" is recomputed when the app returns to the foreground (`AppState`)
  and when a tab gains focus. IDs come from `expo-crypto` `randomUUID`; on insecure web origins
  they fall back to `getRandomValues`. The device time zone comes from `expo-localization`.
- **Time zone.** The profile's IANA `timezone` is captured from the device at onboarding and
  then **frozen**: "today", missed sessions and adherence weeks are all computed in that zone,
  even after travel. Editing the answers keeps it.

## Data model on the device

AsyncStorage keys (`fitness/v1/...`):

- `profile`
- `goal`
- `plan` (the active plan)
- `plan_notes`: `{ plan_id, warnings }`, the generator's warnings for the active plan, shown on
  the Plan screen. Notes with another `plan_id` are ignored.
- `workout_logs`
- `schedule_changes`: an append-only audit trail of accepted rescheduling proposals.

Onboarding saves through `saveSetup`, which validates the profile, goal and plan first and then
writes the plan (or removes it) before the goal and profile. Regenerating the plan replaces
`plan` and keeps the logs and the changes. Settings → "Export my
data" writes all keys as one JSON document (`format: "fitness-app-export"`, `version: 1`). On web
the document is downloaded (`share-json.web.ts`). On native it is written to a cache file with
`expo-file-system` and shared as a file with `expo-sharing` (`share-json.ts`). "Delete all local data" removes
every key and reports any key it could not delete (`ClearDataError`).

When onboarding hits a PAR-Q+ red flag, or the user may be under 18, the app shows the engine's
"consult a doctor" message:

- **First onboarding:** nothing is stored.
- **Edited answers (a profile exists):** the updated, consented profile is saved and the plan
  is **removed**. The Plan tab then shows the doctor message, and Workout has nothing to open.
  Regenerate re-screens the profile, so the plan cannot come back until the answers pass.

A session that is already done opens read-only with its log, so it is never logged twice.

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
