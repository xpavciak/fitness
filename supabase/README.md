# supabase

SQL schema, row level security (RLS) and the exercise catalog seed for the fitness app (task T8,
decision D4: Supabase in the **EU region**, the MVP stays local-first and sync is not wired yet).

| Path                                     | What                                                                        |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| `migrations/20261008120000_init.sql`     | Tables, constraints, indexes, `updated_at` triggers, RLS, GDPR functions    |
| `seed.sql`                               | Exercise catalog (generated, do not edit)                                   |
| `scripts/gen-seed.ts`                    | Generates `seed.sql` from the engine catalog; `--check` detects drift       |
| `scripts/verify-migrations.sh`           | Applies everything to plain Postgres in Docker and runs the RLS tests       |
| `scripts/verify/00-supabase-stub.sql`    | Test-only stand-in for Supabase's `auth` schema, `auth.uid()` and roles     |
| `scripts/verify/10-rls-tests.sql`        | RLS, privilege, constraint, export and deletion tests (fail on violation)   |
| `scripts/verify/20-explain-policies.sql` | EXPLAINs every table's policies; fails on per-row subplans or no index path |

## Commands

```sh
pnpm db:verify   # seed drift check + migrations + seed + RLS tests + policy plans (Docker)
pnpm db:seed     # regenerate seed.sql after changing packages/engine/src/catalog
```

`db:verify` needs Docker and no Supabase CLI. It uses `postgres:16` by default; set `PG_IMAGE`
to test another image, e.g. `PG_IMAGE=postgres:15 pnpm db:verify` (or
`PG_IMAGE=mirror.gcr.io/library/postgres:15` if Docker Hub rate-limits you). Verified on 15 and 16. The container is always removed afterwards. `gen-seed.ts` needs Node >= 22.18 (native type
stripping); `pnpm typecheck` also type-checks it.

## Schema

Each table maps 1:1 to a Zod `*RowSchema` in `packages/engine/src/schemas` (same snake_case
column names), plus `created_at`/`updated_at`. `updated_at` is always set by the server: a
`before insert or update` trigger overwrites any client value with the transaction time.

| Table               | Row schema           | Owner column / parent                    |
| ------------------- | -------------------- | ---------------------------------------- |
| `profiles`          | `ProfileRow`         | `user_id` (PK, FK `auth.users`)          |
| `goals`             | `GoalRow`            | `user_id`                                |
| `plans`             | `PlanRow`            | `user_id` (+ goal of the same user)      |
| `plan_weeks`        | `PlanWeekRow`        | `plan_id` -> plans                       |
| `planned_sessions`  | `PlannedSessionRow`  | `plan_week_id` -> plan_weeks             |
| `planned_exercises` | `PlannedExerciseRow` | `planned_session_id` -> planned_sessions |
| `workout_logs`      | `WorkoutLogRow`      | `user_id`                                |
| `set_logs`          | `SetLogRow`          | `workout_log_id` -> workout_logs         |
| `schedule_changes`  | `ScheduleChangeRow`  | `plan_id` -> plans                       |
| `exercises`         | `ExerciseRow`        | global catalog (read-only for users)     |

Design choices:

- **Ids.** UUIDs generated on the client (offline-first); `gen_random_uuid()` is only a default.
  Exercise ids are snake_case slugs, checked by a regex.
- **Enums** are `text` + `CHECK` constraints listing the Zod enum values, so adding a value is a
  one-line constraint change. Numeric and length bounds from the Row schemas are mirrored too.
- **Cross-field rules within one row** are mirrored (e.g. `rep_min <= rep_max`, max 300 reps for
  `measure = 'reps'`, no completed 0-rep sets, `ended_at >= started_at`, the per-kind required
  fields of a schedule change, Monday-aligned plan/week start dates, no duplicate array entries,
  `bodyweight` alone in exercise equipment, `available_days` covering `days_per_week`).
- **JSON columns are type-checked:** every PAR-Q+ answer in `parq` must be a JSON boolean and
  `answered_at` a string; `pre_checkin` must hold `sleep`, `energy`, `soreness` and `stress` as
  integers 1-5. `training_slots` is checked as an array of at most 7 entries.
- **Left to the engine (Zod):** rules spanning rows (a session stays inside its week, weeks are
  consecutive, `measure` matches the catalog exercise), IANA time zone validity, `birth_year` not in
  the future, the element shape of `training_slots`, and the date format of `parq.answered_at`.
- **Unique keys:** `set_logs (workout_log_id, exercise_id, set_index)`,
  `planned_exercises (planned_session_id, "order")`, `plan_weeks (plan_id, index)`. These
  position keys are `deferrable initially deferred`, so one batch upsert can swap two positions
  (checked at commit). `ON CONFLICT` can't target a deferrable constraint, so upserts must use
  `on conflict (id)`. `order` is a reserved word, so it is quoted in SQL (PostgREST handles this).
- **Deletion.** `auth.users` -> `profiles` -> everything else cascades. Deleting a plan cascades to
  its weeks, sessions, prescriptions and schedule changes; workout logs and set logs survive
  (`planned_session_id`/`planned_exercise_id` become `NULL`), so training history is kept.
- **Goals are archived, not deleted.** A finished or dropped goal gets `status = 'achieved'` or
  `'abandoned'`. Deleting a goal that a plan still references fails (the FK is `NO ACTION`), which
  protects plan history; only account deletion removes goals together with their plans.
- **`schedule_changes.merged_into_session_id` cascades** rather than `set null`: a merge record
  without its target is meaningless, `set null` would violate the "merge needs a target" check, and
  sessions are only deleted with their plan, which removes its schedule changes anyway.
- **Indexes** cover every FK used by RLS joins plus the expected queries: plans and goals by
  user and status, workout logs by user and date, set logs by exercise and date (PRs, progression).

## Row level security

RLS is enabled on every table; `db:verify` fails if any `public` table has it disabled.

- **Owner roots** (`profiles`, `goals`, `plans`, `workout_logs`): `user_id = auth.uid()` for
  select, insert, update and delete. `with check` on update stops users from handing rows to
  someone else.
- **Child tables** check ownership **through the parent chain** instead of a denormalized
  `user_id`. This keeps every table 1:1 with its Zod Row schema, so the sync layer can upsert rows
  unchanged. The policies are plain inlinable SQL in the form
  `fk = any (array(select id from parent where ...))`: Postgres runs the subquery once per
  statement (an InitPlan) and uses the id array as an index condition on the child's FK index.
  (The `fk in (select ...)` form also runs once, as a hashed SubPlan, but only as a filter over a
  sequential scan, so it can't use the index.) `scripts/verify/20-explain-policies.sql` prints the
  plan of a SELECT and a DELETE on every table and fails on per-row subplans or functions, or a
  table without an index path. If profiling ever shows the chain is too slow, add a `user_id`
  column filled by a trigger and switch the policies to it.
- **Cross-references are checked too.** A plan's goal must belong to the same user (composite FK
  `(goal_id, user_id)`); a workout log may only link the user's own planned session; a set log only
  the user's own planned exercise; a schedule change only sessions in its own plan.
- **Catalog:** `exercises` is readable by `authenticated` only, with no write policy and no write
  grant. It is maintained through `seed.sql` (as `postgres`/`service_role`).
- **Privileges.** Supabase grants `ALL` on new tables to `anon` and `authenticated` by default.
  The migration revokes that: `anon` gets nothing, `authenticated` gets
  `select/insert/update/delete` only (no `TRUNCATE`, which RLS does not cover).
- Policies use `(select auth.uid())` so Postgres evaluates it once per statement.

The tests (`scripts/verify/10-rls-tests.sql`) create users A and B with a full set of rows and
check, for every table, that A can't select, update or delete B's rows (and vice versa); that
inserting rows for another user or pointing at another user's rows fails; that re-parenting own
rows to another user fails; that the catalog is read-only; that `TRUNCATE` and `anon` access are
denied; that batch upserts may swap positions; and that the constraints (including the JSON type
checks), export and deletion behave as described. At the end B's rows must be byte-for-byte
unchanged.

## GDPR (health data, Art. 9)

- **Consent:** `profiles.consent_health_at` is `NOT NULL`, as in `ProfileRow`, and may not be
  more than one day in the future (leeway for device clock skew). Every other user table hangs off
  `profiles`, so no health data can be stored before consent is recorded.
  Withdrawing consent = deleting the account (below), or a future flow that deletes the profile.
- **Export (Art. 15/20):** `select public.export_my_data();` (RPC:
  `supabase.rpc('export_my_data')`) returns one JSON document with the caller's profile, goals,
  plans, weeks, sessions, prescriptions, workout logs, set logs and schedule changes. It runs as
  the caller (RLS applies) and returns nothing for `anon`/`service_role`.
- **Deletion (Art. 17):** `select public.delete_my_account();` (RPC:
  `supabase.rpc('delete_my_account')`) deletes the caller's `auth.users` row, and the cascade
  removes all of their data. It is `SECURITY DEFINER` and only ever deletes `auth.uid()`.
  An Edge Function calling `supabase.auth.admin.deleteUser(id)` with the service role works the
  same way (same cascade) and is the alternative if direct `auth.users` deletes are restricted on
  your Supabase plan. Any future Storage objects must be deleted separately.

## Applying to a real Supabase project (EU region)

1. Create the project in an **EU region** (e.g. `eu-central-1` Frankfurt) in the Supabase
   dashboard. The region can't be changed later.
2. Install the Supabase CLI and link the project:

   ```sh
   supabase login
   supabase link --project-ref <project-ref>
   ```

3. Apply the migrations: `supabase db push` (records them in `supabase_migrations`).
4. Load the catalog, which must happen before any client syncs a workout:
   `psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/seed.sql`
   (the connection string is under Project Settings -> Database), or
   `supabase db push --include-seed` on CLI versions that support it. Plain `supabase db push`
   doesn't run `seed.sql`; `supabase db reset` (local only) does. The seed is an idempotent
   upsert that only rewrites rows whose data changed (`where ... is distinct from`), so re-run it
   after every catalog change; unchanged exercises keep their `updated_at`.
5. Check in the dashboard (Authentication -> Policies) that RLS shows as enabled on all tables, and
   run the Security Advisor.
6. Don't apply `scripts/verify/*.sql` to a real project; they're for the Docker check only.

For local development with the CLI, `supabase start` followed by `supabase db reset` applies the
migrations and `seed.sql` to the local stack.

## How sync plugs in later

The app is local-first (D4): the engine and local storage are the source of truth on the device,
and Supabase is an optional replica behind a sync interface that stays unwired until a project and
credentials exist.

- **Interface.** A `SyncAdapter` (in the app, T9 or later) with `push(changes)` / `pull(since)`.
  The default implementation is a no-op. The Supabase implementation uses `@supabase/supabase-js`
  with the anon key and the user's session, so every request runs as `authenticated` under RLS.
- **Push.** Rows are already in Row-schema shape with client UUIDs, so pushing is
  `upsert(rows, { onConflict: 'id' })` per table (`user_id` for profiles), in parent-to-child order:
  profiles, goals, plans, plan_weeks, planned_sessions, planned_exercises, workout_logs, set_logs,
  schedule_changes. Validate with the Zod schemas before sending; the DB constraints are the
  backstop. Send a reordering (e.g. swapped exercise `order` or `set_index`) in one batch; the
  deferred unique keys are checked at commit.
- **Pull.** `select ... where updated_at > :cursor` per table, where
  `cursor = last_pulled_at - overlap` and `last_pulled_at` is the largest `updated_at` the client
  has seen (a server time, never the device clock). The overlap window (start with 5 minutes) is
  needed because `updated_at` is the _transaction start_ time: a transaction that started earlier
  but committed after the previous pull has an `updated_at` below that pull's high-water mark and
  would otherwise be skipped. Rows seen twice are de-duplicated by `id` (keep the newer
  `updated_at`).
- **Normalize before parsing.** PostgREST returns absent optional columns as `null`, while the Zod
  Row schemas use `.optional()` (which rejects `null`). The pull path must turn `null` into
  `undefined` (drop the key) before `XRowSchema.parse`. Extra columns (`created_at`, `updated_at`
  where the Row schema lacks them) are stripped by Zod's default object parsing; keep `updated_at`
  separately as sync metadata.
- **Conflicts.** Last write wins, and "last" means the latest **server arrival** time: the trigger
  stamps `updated_at` when the write reaches the server, so an edit made offline earlier but
  synced later wins over one synced in between. That is acceptable for a single user on a few
  devices. Plans are versioned and schedule changes are append-only, which limits real conflicts
  to workout/set logs edited on two devices.
- **Deletes.** Not replicated in the MVP. When needed, add `deleted_at` tombstones in a new
  migration instead of hard deletes, so pulls can see them.
- **Catalog.** The app ships the catalog in the engine; the server copy exists so FKs from
  `planned_exercises`/`set_logs` hold. Deploy the seed before releasing an app version with new
  exercise ids.
- **AI (D5).** Server-side Claude calls (Edge Functions) read data with the user's JWT, so the
  same RLS policies apply.
