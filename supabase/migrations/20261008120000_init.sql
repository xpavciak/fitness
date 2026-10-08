-- =============================================================================
-- Fitness app MVP: initial schema, RLS and GDPR helpers (task T8).
--
-- Source of truth for columns: the Zod `*RowSchema`s in packages/engine/src/schemas.
-- Every table maps 1:1 to a Row schema (snake_case), plus `created_at`/`updated_at`
-- bookkeeping columns where the Row schema does not already define `created_at`.
--
-- Conventions
-- - Ids are UUIDs generated on the client (offline-first). A server default exists only
--   as a convenience. Catalog exercise ids are snake_case slugs.
-- - Enums from Zod are mirrored as `text` + CHECK constraints (not Postgres enum types):
--   adding or removing a value is a one-line constraint change.
-- - Zod numeric bounds and the cross-field rules that only involve one row are mirrored
--   as CHECK constraints. Rules that span rows (e.g. a session stays within its week)
--   and deep JSON validation stay in the engine (Zod) and are documented in README.md.
-- - Ownership: user-owned roots (`profiles`, `goals`, `plans`, `workout_logs`) carry
--   `user_id`. Child tables do NOT have a denormalized `user_id` (so they stay 1:1 with
--   the Row schemas); their RLS policies check ownership through the parent chain using
--   the `private.owns_*` helpers below.
-- - Deleting the auth user cascades: auth.users -> profiles -> everything else.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Private helpers (not exposed through the Data API)
-- -----------------------------------------------------------------------------

create schema if not exists private;
revoke all on schema private from public;
-- `authenticated` needs USAGE so RLS policies can call the ownership helpers.
grant usage on schema private to authenticated;

-- Keeps `updated_at` current on every UPDATE.
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- True when the array has no NULLs and no duplicates (Zod `uniqueArray`).
create function private.is_unique_array(values_ text[])
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select array_position(values_, null) is null
     and not exists (
       select 1 from unnest(values_) as v group by v having count(*) > 1
     );
$$;

-- True when every element matches the regex (vacuously true for an empty array).
create function private.all_match(values_ text[], pattern text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(bool_and(v ~ pattern), true) from unnest(values_) as v;
$$;

-- True when every element is non-NULL and its trimmed length is within [min_len, max_len].
create function private.all_lengths_between(values_ text[], min_len int, max_len int)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select array_position(values_, null) is null
     and coalesce(
       bool_and(char_length(btrim(v)) >= min_len and char_length(v) <= max_len),
       true
     )
  from unnest(values_) as v;
$$;

-- -----------------------------------------------------------------------------
-- profiles (ProfileRow) - one row per auth user, the root of all user data
-- -----------------------------------------------------------------------------

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  birth_year integer not null check (birth_year between 1900 and 2100),
  sex text check (sex in ('female', 'male', 'other', 'prefer_not_to_say')),
  height_cm numeric check (height_cm between 100 and 250),
  weight_kg numeric check (weight_kg between 25 and 350),
  timezone text not null check (char_length(timezone) between 1 and 64),
  experience_level text not null
    check (experience_level in ('beginner', 'intermediate', 'advanced')),
  equipment text[] not null default '{}'
    check (
      equipment <@ array['bodyweight', 'dumbbells', 'kettlebell', 'barbell', 'bench', 'rack',
                         'pullup_bar', 'cable', 'machine', 'bands']::text[]
      and private.is_unique_array(equipment)
    ),
  limitations text[] not null default '{}'
    check (
      limitations <@ array['knee', 'lower_back', 'shoulder', 'wrist', 'elbow', 'hip', 'ankle',
                           'neck']::text[]
      and private.is_unique_array(limitations)
    ),
  limitation_notes text check (char_length(limitation_notes) <= 500),
  days_per_week integer not null check (days_per_week between 1 and 7),
  available_days text[] not null
    check (
      cardinality(available_days) >= 1
      and available_days <@ array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']::text[]
      and private.is_unique_array(available_days)
    ),
  session_minutes integer not null check (session_minutes between 10 and 180),
  -- Array of {day, start_time, location}; element shape is validated by Zod (TrainingSlotSchema).
  training_slots jsonb not null default '[]'
    check (jsonb_typeof(training_slots) = 'array' and jsonb_array_length(training_slots) <= 7),
  -- PAR-Q+ answers; all seven questions plus answered_at must be present.
  parq jsonb not null
    check (
      jsonb_typeof(parq) = 'object'
      and parq ?& array['heart_condition_or_high_blood_pressure', 'chest_pain',
                        'dizziness_or_loss_of_consciousness', 'other_chronic_condition',
                        'prescribed_medication_for_chronic_condition',
                        'bone_joint_or_soft_tissue_problem',
                        'medically_supervised_activity_only', 'answered_at']
    ),
  -- Explicit consent to process health data (GDPR Art. 9). Required, as in ProfileRow.
  consent_health_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- checkProfile: the user must offer at least days_per_week days.
  constraint profiles_available_days_cover_days_per_week
    check (cardinality(available_days) >= days_per_week)
);

comment on table public.profiles is
  'ProfileRow. Health data (GDPR Art. 9): rows exist only with consent_health_at set.';
comment on column public.profiles.consent_health_at is
  'When the user gave explicit consent to process health data. Required.';

-- -----------------------------------------------------------------------------
-- goals (GoalRow)
-- -----------------------------------------------------------------------------

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  type text not null check (type in ('strength', 'hypertrophy', 'fat_loss', 'general')),
  target text check (char_length(btrim(target)) >= 1 and char_length(target) <= 200),
  deadline date,
  status text not null check (status in ('active', 'achieved', 'abandoned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Target of the composite FK from plans, which guarantees a plan's goal has the same owner.
  constraint goals_id_user_id_key unique (id, user_id)
);

create index goals_user_id_status_idx on public.goals (user_id, status);

-- -----------------------------------------------------------------------------
-- exercises (ExerciseRow) - global catalog, seeded from the engine (seed.sql)
-- -----------------------------------------------------------------------------

create table public.exercises (
  id text primary key check (id ~ '^[a-z0-9]+(_[a-z0-9]+)*$'),
  name text not null check (char_length(btrim(name)) >= 1 and char_length(name) <= 80),
  pattern text not null
    check (pattern in ('squat', 'lunge', 'hinge', 'push_h', 'push_v', 'pull_h', 'pull_v',
                       'carry', 'core', 'cardio', 'isolation')),
  primary_muscles text[] not null
    check (
      cardinality(primary_muscles) >= 1
      and primary_muscles <@ array['chest', 'lats', 'upper_back', 'traps', 'front_delts',
                                   'side_delts', 'rear_delts', 'biceps', 'triceps', 'forearms',
                                   'abs', 'obliques', 'lower_back', 'glutes', 'quads',
                                   'hamstrings', 'adductors', 'calves']::text[]
      and private.is_unique_array(primary_muscles)
    ),
  secondary_muscles text[] not null default '{}'
    check (
      secondary_muscles <@ array['chest', 'lats', 'upper_back', 'traps', 'front_delts',
                                 'side_delts', 'rear_delts', 'biceps', 'triceps', 'forearms',
                                 'abs', 'obliques', 'lower_back', 'glutes', 'quads',
                                 'hamstrings', 'adductors', 'calves']::text[]
      and private.is_unique_array(secondary_muscles)
    ),
  equipment text[] not null
    check (
      cardinality(equipment) >= 1
      and equipment <@ array['bodyweight', 'dumbbells', 'kettlebell', 'barbell', 'bench', 'rack',
                             'pullup_bar', 'cable', 'machine', 'bands']::text[]
      and private.is_unique_array(equipment)
      -- checkExercise: "bodyweight" means no equipment and must be the only entry.
      and (not ('bodyweight' = any (equipment)) or cardinality(equipment) = 1)
    ),
  level text not null check (level in ('beginner', 'intermediate', 'advanced')),
  contraindication_tags text[] not null default '{}'
    check (
      contraindication_tags <@ array['knee', 'lower_back', 'shoulder', 'wrist', 'elbow', 'hip',
                                     'ankle', 'neck']::text[]
      and private.is_unique_array(contraindication_tags)
    ),
  -- Ids of catalog exercises (array: no FK; resolvability is tested in the engine).
  substitutes text[] not null default '{}'
    check (
      private.is_unique_array(substitutes)
      and private.all_match(substitutes, '^[a-z0-9]+(_[a-z0-9]+)*$')
      and not (id = any (substitutes))
    ),
  cues text[] not null
    check (cardinality(cues) between 1 and 5 and private.all_lengths_between(cues, 1, 120)),
  measure text not null check (measure in ('reps', 'seconds')),
  loadable boolean not null,
  unilateral boolean not null,
  low_stimulus boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- checkExercise: no muscle is both primary and secondary.
  constraint exercises_muscles_disjoint check (not (primary_muscles && secondary_muscles))
);

create index exercises_pattern_idx on public.exercises (pattern);

-- -----------------------------------------------------------------------------
-- plans (PlanRow) - versioned; changes create new versions or schedule_changes
-- -----------------------------------------------------------------------------

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  goal_id uuid not null,
  template_id text check (char_length(btrim(template_id)) >= 1 and char_length(template_id) <= 64),
  version integer not null check (version >= 1),
  status text not null check (status in ('active', 'archived')),
  -- Monday of the first week.
  start_date date not null check (extract(isodow from start_date) = 1),
  generated_by text not null check (generated_by in ('rules', 'llm_hybrid')),
  rationale_text text check (char_length(rationale_text) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The goal must belong to the same user (enforced regardless of RLS).
  -- NO ACTION (not RESTRICT) so deleting a profile can cascade to goals and plans together.
  constraint plans_goal_same_user_fkey foreign key (goal_id, user_id)
    references public.goals (id, user_id) on delete no action
);

create index plans_user_id_status_idx on public.plans (user_id, status);
create index plans_goal_id_user_id_idx on public.plans (goal_id, user_id);

-- -----------------------------------------------------------------------------
-- plan_weeks (PlanWeekRow)
-- -----------------------------------------------------------------------------

create table public.plan_weeks (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete cascade,
  index integer not null check (index >= 0),
  -- Monday of this week.
  start_date date not null check (extract(isodow from start_date) = 1),
  phase text not null check (phase in ('accumulation', 'intensification', 'deload')),
  focus text check (char_length(focus) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plan_weeks_plan_id_index_key unique (plan_id, index)
);

-- -----------------------------------------------------------------------------
-- planned_sessions (PlannedSessionRow)
-- -----------------------------------------------------------------------------

create table public.planned_sessions (
  id uuid primary key default gen_random_uuid(),
  plan_week_id uuid not null references public.plan_weeks (id) on delete cascade,
  day_index integer not null check (day_index between 0 and 6),
  scheduled_date date not null,
  title text not null check (char_length(btrim(title)) >= 1 and char_length(title) <= 80),
  est_minutes integer not null check (est_minutes between 1 and 240),
  priority text not null check (priority in ('key', 'normal', 'optional')),
  status text not null check (status in ('planned', 'done', 'skipped', 'moved', 'merged')),
  variant text not null check (variant in ('full', 'short', 'minimum_dose')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index planned_sessions_plan_week_id_date_idx
  on public.planned_sessions (plan_week_id, scheduled_date);

-- -----------------------------------------------------------------------------
-- planned_exercises (PlannedExerciseRow)
-- -----------------------------------------------------------------------------

create table public.planned_exercises (
  id uuid primary key default gen_random_uuid(),
  planned_session_id uuid not null references public.planned_sessions (id) on delete cascade,
  exercise_id text not null references public.exercises (id) on update cascade,
  "order" integer not null check ("order" >= 0),
  sets integer not null check (sets between 1 and 10),
  measure text not null check (measure in ('reps', 'seconds')),
  rep_min integer not null check (rep_min between 1 and 3600),
  rep_max integer not null check (rep_max between 1 and 3600),
  target_rir integer not null check (target_rir between 0 and 5),
  target_load_kg numeric check (target_load_kg between 0 and 1000),
  rest_sec integer not null check (rest_sec between 0 and 600),
  superset_group text
    check (char_length(btrim(superset_group)) >= 1 and char_length(superset_group) <= 8),
  is_key boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- checkPlannedExercise
  constraint planned_exercises_rep_range check (rep_min <= rep_max),
  constraint planned_exercises_rep_max_per_measure
    check (measure = 'seconds' or rep_max <= 300),
  -- checkPlannedSession: order is unique within a session.
  constraint planned_exercises_session_order_key unique (planned_session_id, "order")
);

create index planned_exercises_exercise_id_idx on public.planned_exercises (exercise_id);

-- -----------------------------------------------------------------------------
-- workout_logs (WorkoutLogRow)
-- -----------------------------------------------------------------------------

create table public.workout_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  -- Absent for ad-hoc workouts; kept (set to NULL) if the plan is deleted.
  planned_session_id uuid references public.planned_sessions (id) on delete set null,
  started_at timestamptz not null,
  ended_at timestamptz,
  -- {sleep, energy, soreness, stress}, each 1-5 (validated by Zod PreCheckinSchema).
  pre_checkin jsonb
    check (
      jsonb_typeof(pre_checkin) = 'object'
      and pre_checkin ?& array['sleep', 'energy', 'soreness', 'stress']
    ),
  session_rpe integer check (session_rpe between 1 and 10),
  notes text check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- checkWorkoutLog
  constraint workout_logs_ended_after_started check (ended_at >= started_at)
);

create index workout_logs_user_id_started_at_idx on public.workout_logs (user_id, started_at desc);
create index workout_logs_planned_session_id_idx on public.workout_logs (planned_session_id);

-- -----------------------------------------------------------------------------
-- set_logs (SetLogRow)
-- -----------------------------------------------------------------------------

create table public.set_logs (
  id uuid primary key default gen_random_uuid(),
  workout_log_id uuid not null references public.workout_logs (id) on delete cascade,
  exercise_id text not null references public.exercises (id) on update cascade,
  -- Absent for substituted or added exercises; kept (set to NULL) if the plan is deleted.
  planned_exercise_id uuid references public.planned_exercises (id) on delete set null,
  set_index integer not null check (set_index >= 0),
  measure text not null check (measure in ('reps', 'seconds')),
  reps integer not null check (reps between 0 and 3600),
  load_kg numeric not null check (load_kg between 0 and 1000),
  rir integer check (rir between 0 and 10),
  is_warmup boolean not null,
  completed boolean not null,
  performed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- checkSetLog
  constraint set_logs_reps_per_measure check (measure = 'seconds' or reps <= 300),
  constraint set_logs_completed_needs_reps check (not (completed and reps = 0)),
  -- checkWorkoutLog: unique (exercise_id, set_index) within a workout.
  constraint set_logs_workout_exercise_set_key unique (workout_log_id, exercise_id, set_index)
);

-- Personal records and progression look up history per exercise.
create index set_logs_exercise_id_performed_at_idx on public.set_logs (exercise_id, performed_at);
create index set_logs_planned_exercise_id_idx on public.set_logs (planned_exercise_id);

-- -----------------------------------------------------------------------------
-- schedule_changes (ScheduleChangeRow) - audit trail of rescheduling
-- -----------------------------------------------------------------------------

create table public.schedule_changes (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete cascade,
  planned_session_id uuid not null references public.planned_sessions (id) on delete cascade,
  kind text not null check (kind in ('move', 'merge', 'shorten', 'skip')),
  reason text not null check (char_length(btrim(reason)) >= 1 and char_length(reason) <= 500),
  from_date date not null,
  to_date date,
  merged_into_session_id uuid references public.planned_sessions (id) on delete cascade,
  new_est_minutes integer check (new_est_minutes between 1 and 240),
  created_by text not null check (created_by in ('user', 'system')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- checkScheduleChange
  constraint schedule_changes_move_needs_new_date
    check (kind <> 'move' or (to_date is not null and to_date <> from_date)),
  constraint schedule_changes_merge_needs_other_session
    check (
      kind <> 'merge'
      or (merged_into_session_id is not null and merged_into_session_id <> planned_session_id)
    ),
  constraint schedule_changes_shorten_needs_minutes
    check (kind <> 'shorten' or new_est_minutes is not null)
);

create index schedule_changes_plan_id_created_at_idx
  on public.schedule_changes (plan_id, created_at);
create index schedule_changes_planned_session_id_idx
  on public.schedule_changes (planned_session_id);
create index schedule_changes_merged_into_session_id_idx
  on public.schedule_changes (merged_into_session_id);

-- -----------------------------------------------------------------------------
-- updated_at triggers
-- -----------------------------------------------------------------------------

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger goals_set_updated_at before update on public.goals
  for each row execute function private.set_updated_at();
create trigger exercises_set_updated_at before update on public.exercises
  for each row execute function private.set_updated_at();
create trigger plans_set_updated_at before update on public.plans
  for each row execute function private.set_updated_at();
create trigger plan_weeks_set_updated_at before update on public.plan_weeks
  for each row execute function private.set_updated_at();
create trigger planned_sessions_set_updated_at before update on public.planned_sessions
  for each row execute function private.set_updated_at();
create trigger planned_exercises_set_updated_at before update on public.planned_exercises
  for each row execute function private.set_updated_at();
create trigger workout_logs_set_updated_at before update on public.workout_logs
  for each row execute function private.set_updated_at();
create trigger set_logs_set_updated_at before update on public.set_logs
  for each row execute function private.set_updated_at();
create trigger schedule_changes_set_updated_at before update on public.schedule_changes
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Ownership helpers for child-table policies
--
-- SECURITY INVOKER: they read parent tables through the caller's own RLS and also
-- compare user_id with auth.uid() explicitly (defense in depth). `(select auth.uid())`
-- lets the planner evaluate auth.uid() once per statement.
-- -----------------------------------------------------------------------------

create function private.owns_plan(p_plan_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.plans p
    where p.id = p_plan_id and p.user_id = (select auth.uid())
  );
$$;

create function private.owns_plan_week(p_plan_week_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.plan_weeks w
    join public.plans p on p.id = w.plan_id
    where w.id = p_plan_week_id and p.user_id = (select auth.uid())
  );
$$;

create function private.owns_planned_session(p_planned_session_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.planned_sessions s
    join public.plan_weeks w on w.id = s.plan_week_id
    join public.plans p on p.id = w.plan_id
    where s.id = p_planned_session_id and p.user_id = (select auth.uid())
  );
$$;

create function private.owns_planned_exercise(p_planned_exercise_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.planned_exercises e
    join public.planned_sessions s on s.id = e.planned_session_id
    join public.plan_weeks w on w.id = s.plan_week_id
    join public.plans p on p.id = w.plan_id
    where e.id = p_planned_exercise_id and p.user_id = (select auth.uid())
  );
$$;

create function private.owns_workout_log(p_workout_log_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.workout_logs l
    where l.id = p_workout_log_id and l.user_id = (select auth.uid())
  );
$$;

-- True when the session belongs to the given plan (and the caller owns that plan).
create function private.session_in_own_plan(p_planned_session_id uuid, p_plan_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.planned_sessions s
    join public.plan_weeks w on w.id = s.plan_week_id
    join public.plans p on p.id = w.plan_id
    where s.id = p_planned_session_id
      and w.plan_id = p_plan_id
      and p.user_id = (select auth.uid())
  );
$$;

revoke all on all functions in schema private from public;
grant execute on function
  private.owns_plan(uuid),
  private.owns_plan_week(uuid),
  private.owns_planned_session(uuid),
  private.owns_planned_exercise(uuid),
  private.owns_workout_log(uuid),
  private.session_in_own_plan(uuid, uuid)
  to authenticated;
-- CHECK constraints call these as the writing role, so writers need EXECUTE.
grant execute on function
  private.is_unique_array(text[]),
  private.all_match(text[], text),
  private.all_lengths_between(text[], int, int)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Privileges
--
-- Supabase grants ALL on new public tables to anon/authenticated/service_role by default.
-- Narrow that: anon gets nothing, authenticated gets plain DML (no TRUNCATE, which RLS
-- does not cover), and only SELECT on the catalog.
-- -----------------------------------------------------------------------------

revoke all on
  public.profiles, public.goals, public.exercises, public.plans, public.plan_weeks,
  public.planned_sessions, public.planned_exercises, public.workout_logs, public.set_logs,
  public.schedule_changes
  from anon, authenticated;

grant select, insert, update, delete on
  public.profiles, public.goals, public.plans, public.plan_weeks, public.planned_sessions,
  public.planned_exercises, public.workout_logs, public.set_logs, public.schedule_changes
  to authenticated;

grant select on public.exercises to authenticated;

-- -----------------------------------------------------------------------------
-- Row level security
-- -----------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.goals enable row level security;
alter table public.exercises enable row level security;
alter table public.plans enable row level security;
alter table public.plan_weeks enable row level security;
alter table public.planned_sessions enable row level security;
alter table public.planned_exercises enable row level security;
alter table public.workout_logs enable row level security;
alter table public.set_logs enable row level security;
alter table public.schedule_changes enable row level security;

-- exercises: read-only catalog for signed-in users. No write policies exist, and
-- authenticated has no write grants; the catalog is maintained via seed.sql.
create policy exercises_select_authenticated on public.exercises
  for select to authenticated using (true);

-- profiles
create policy profiles_select_own on public.profiles
  for select to authenticated using (user_id = (select auth.uid()));
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy profiles_delete_own on public.profiles
  for delete to authenticated using (user_id = (select auth.uid()));

-- goals
create policy goals_select_own on public.goals
  for select to authenticated using (user_id = (select auth.uid()));
create policy goals_insert_own on public.goals
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy goals_update_own on public.goals
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy goals_delete_own on public.goals
  for delete to authenticated using (user_id = (select auth.uid()));

-- plans (the goal's owner is pinned by the composite FK plans_goal_same_user_fkey)
create policy plans_select_own on public.plans
  for select to authenticated using (user_id = (select auth.uid()));
create policy plans_insert_own on public.plans
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy plans_update_own on public.plans
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy plans_delete_own on public.plans
  for delete to authenticated using (user_id = (select auth.uid()));

-- plan_weeks: owned through plans
create policy plan_weeks_select_own on public.plan_weeks
  for select to authenticated using (private.owns_plan(plan_id));
create policy plan_weeks_insert_own on public.plan_weeks
  for insert to authenticated with check (private.owns_plan(plan_id));
create policy plan_weeks_update_own on public.plan_weeks
  for update to authenticated
  using (private.owns_plan(plan_id))
  with check (private.owns_plan(plan_id));
create policy plan_weeks_delete_own on public.plan_weeks
  for delete to authenticated using (private.owns_plan(plan_id));

-- planned_sessions: owned through plan_weeks -> plans
create policy planned_sessions_select_own on public.planned_sessions
  for select to authenticated using (private.owns_plan_week(plan_week_id));
create policy planned_sessions_insert_own on public.planned_sessions
  for insert to authenticated with check (private.owns_plan_week(plan_week_id));
create policy planned_sessions_update_own on public.planned_sessions
  for update to authenticated
  using (private.owns_plan_week(plan_week_id))
  with check (private.owns_plan_week(plan_week_id));
create policy planned_sessions_delete_own on public.planned_sessions
  for delete to authenticated using (private.owns_plan_week(plan_week_id));

-- planned_exercises: owned through planned_sessions -> plan_weeks -> plans
create policy planned_exercises_select_own on public.planned_exercises
  for select to authenticated using (private.owns_planned_session(planned_session_id));
create policy planned_exercises_insert_own on public.planned_exercises
  for insert to authenticated with check (private.owns_planned_session(planned_session_id));
create policy planned_exercises_update_own on public.planned_exercises
  for update to authenticated
  using (private.owns_planned_session(planned_session_id))
  with check (private.owns_planned_session(planned_session_id));
create policy planned_exercises_delete_own on public.planned_exercises
  for delete to authenticated using (private.owns_planned_session(planned_session_id));

-- workout_logs: own user_id; a linked planned session must also be the user's
create policy workout_logs_select_own on public.workout_logs
  for select to authenticated using (user_id = (select auth.uid()));
create policy workout_logs_insert_own on public.workout_logs
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (planned_session_id is null or private.owns_planned_session(planned_session_id))
  );
create policy workout_logs_update_own on public.workout_logs
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (planned_session_id is null or private.owns_planned_session(planned_session_id))
  );
create policy workout_logs_delete_own on public.workout_logs
  for delete to authenticated using (user_id = (select auth.uid()));

-- set_logs: owned through workout_logs; a linked prescription must also be the user's
create policy set_logs_select_own on public.set_logs
  for select to authenticated using (private.owns_workout_log(workout_log_id));
create policy set_logs_insert_own on public.set_logs
  for insert to authenticated
  with check (
    private.owns_workout_log(workout_log_id)
    and (planned_exercise_id is null or private.owns_planned_exercise(planned_exercise_id))
  );
create policy set_logs_update_own on public.set_logs
  for update to authenticated
  using (private.owns_workout_log(workout_log_id))
  with check (
    private.owns_workout_log(workout_log_id)
    and (planned_exercise_id is null or private.owns_planned_exercise(planned_exercise_id))
  );
create policy set_logs_delete_own on public.set_logs
  for delete to authenticated using (private.owns_workout_log(workout_log_id));

-- schedule_changes: owned through plans; referenced sessions must be in that plan
create policy schedule_changes_select_own on public.schedule_changes
  for select to authenticated using (private.owns_plan(plan_id));
create policy schedule_changes_insert_own on public.schedule_changes
  for insert to authenticated
  with check (
    private.owns_plan(plan_id)
    and private.session_in_own_plan(planned_session_id, plan_id)
    and (
      merged_into_session_id is null
      or private.session_in_own_plan(merged_into_session_id, plan_id)
    )
  );
create policy schedule_changes_update_own on public.schedule_changes
  for update to authenticated
  using (private.owns_plan(plan_id))
  with check (
    private.owns_plan(plan_id)
    and private.session_in_own_plan(planned_session_id, plan_id)
    and (
      merged_into_session_id is null
      or private.session_in_own_plan(merged_into_session_id, plan_id)
    )
  );
create policy schedule_changes_delete_own on public.schedule_changes
  for delete to authenticated using (private.owns_plan(plan_id));

-- -----------------------------------------------------------------------------
-- GDPR: data export (Art. 15/20) and account deletion (Art. 17)
-- -----------------------------------------------------------------------------

-- Returns all of the caller's data as one JSON document. SECURITY INVOKER: RLS applies,
-- and every query also filters by auth.uid() explicitly, so it returns nothing for
-- callers without a user (e.g. anon or service_role).
create function public.export_my_data()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'format', 'fitness-export-v1',
    'exported_at', now(),
    'user_id', (select auth.uid()),
    'profile', (
      select to_jsonb(p) from public.profiles p where p.user_id = (select auth.uid())
    ),
    'goals', coalesce((
      select jsonb_agg(to_jsonb(g) order by g.created_at, g.id)
      from public.goals g where g.user_id = (select auth.uid())
    ), '[]'::jsonb),
    'plans', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.created_at, p.id)
      from public.plans p where p.user_id = (select auth.uid())
    ), '[]'::jsonb),
    'plan_weeks', coalesce((
      select jsonb_agg(to_jsonb(w) order by w.plan_id, w.index)
      from public.plan_weeks w where private.owns_plan(w.plan_id)
    ), '[]'::jsonb),
    'planned_sessions', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.scheduled_date, s.id)
      from public.planned_sessions s where private.owns_plan_week(s.plan_week_id)
    ), '[]'::jsonb),
    'planned_exercises', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.planned_session_id, e."order")
      from public.planned_exercises e where private.owns_planned_session(e.planned_session_id)
    ), '[]'::jsonb),
    'workout_logs', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.started_at, l.id)
      from public.workout_logs l where l.user_id = (select auth.uid())
    ), '[]'::jsonb),
    'set_logs', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.performed_at, s.id)
      from public.set_logs s where private.owns_workout_log(s.workout_log_id)
    ), '[]'::jsonb),
    'schedule_changes', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.created_at, c.id)
      from public.schedule_changes c where private.owns_plan(c.plan_id)
    ), '[]'::jsonb)
  );
$$;

-- Deletes the caller's auth user; ON DELETE CASCADE removes the profile and all data.
-- SECURITY DEFINER because the caller cannot write auth.users. It only ever deletes the
-- row whose id equals auth.uid().
create function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'delete_my_account requires an authenticated user'
      using errcode = '42501';
  end if;
  delete from auth.users where id = v_uid;
end;
$$;

revoke all on function public.export_my_data() from public, anon;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.export_my_data() to authenticated;
grant execute on function public.delete_my_account() to authenticated;
