-- RLS and constraint tests, run by verify-migrations.sh after the migrations and seed.
-- Every assertion raises an exception on failure; psql runs with ON_ERROR_STOP, so the
-- first violation aborts the run with a non-zero exit code.
--
-- Users: A and B each own a full set of rows (one per table, two planned sessions).
-- C exists in auth.users but has no profile yet.

\set ON_ERROR_STOP on
set client_min_messages = warning;

\set uid_a '''aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'''
\set uid_b '''bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'''
\set uid_c '''cccccccc-cccc-4ccc-8ccc-cccccccccccc'''

-- ---------------------------------------------------------------------------
-- Test helpers (owned by the superuser, executable by the API roles)
-- ---------------------------------------------------------------------------

create schema rls_test;
grant usage on schema rls_test to anon, authenticated;
create sequence rls_test.assertions;
grant usage on sequence rls_test.assertions to anon, authenticated;

-- Deterministic fixture ids: rls_test.id('a', 3) = 'a0000003-0000-4000-8000-000000000000'.
create function rls_test.id(owner text, n int)
returns uuid
language sql
immutable
as $$ select (owner || lpad(n::text, 7, '0') || '-0000-4000-8000-000000000000')::uuid $$;

create function rls_test.pass()
returns void
language sql
as $$ select nextval('rls_test.assertions') $$;

-- Asserts that `sql` fails with SQLSTATE `expected_state`. Deferred constraints are forced
-- to fire inside the block (as they would at commit), so their violations are caught too.
create function rls_test.expect_error(sql text, expected_state text, label text)
returns void
language plpgsql
as $$
declare
  succeeded boolean := false;
begin
  begin
    execute sql;
    set constraints all immediate;
    succeeded := true;
  exception when others then
    if sqlstate <> expected_state then
      raise exception 'FAIL [%]: expected SQLSTATE %, got % (%)',
        label, expected_state, sqlstate, sqlerrm;
    end if;
  end;
  if succeeded then
    raise exception 'VIOLATION [%]: statement succeeded but should fail with %: %',
      label, expected_state, sql;
  end if;
  perform rls_test.pass();
end;
$$;

-- Asserts that the query returns exactly `expected` rows.
create function rls_test.expect_count(sql text, expected bigint, label text)
returns void
language plpgsql
as $$
declare
  actual bigint;
begin
  execute format('select count(*) from (%s) as q', sql) into actual;
  if actual <> expected then
    raise exception 'FAIL [%]: expected % rows, got %', label, expected, actual;
  end if;
  perform rls_test.pass();
end;
$$;

-- Asserts that the DML statement affects exactly `expected` rows.
create function rls_test.expect_affected(sql text, expected bigint, label text)
returns void
language plpgsql
as $$
declare
  actual bigint;
begin
  execute sql;
  get diagnostics actual = row_count;
  if actual <> expected then
    raise exception 'FAIL [%]: expected % affected rows, got %', label, expected, actual;
  end if;
  perform rls_test.pass();
end;
$$;

-- Asserts that the current user can neither SELECT, UPDATE nor DELETE the row.
create function rls_test.expect_no_access(tbl text, key_col text, key text)
returns void
language plpgsql
as $$
declare
  label text := format('%s %s.%s=%s', auth.uid(), tbl, key_col, key);
begin
  perform rls_test.expect_count(
    format('select 1 from public.%I where %I::text = %L', tbl, key_col, key), 0,
    'SELECT other user row ' || label);
  perform rls_test.expect_affected(
    format('update public.%I set updated_at = now() where %I::text = %L', tbl, key_col, key), 0,
    'UPDATE other user row ' || label);
  perform rls_test.expect_affected(
    format('delete from public.%I where %I::text = %L', tbl, key_col, key), 0,
    'DELETE other user row ' || label);
end;
$$;

-- The rows each fixture owner has, as (table, key column, fixture number).
create function rls_test.owned_rows()
returns table (tbl text, key_col text, n int)
language sql
immutable
as $$
  values
    ('goals', 'id', 1), ('plans', 'id', 2), ('plan_weeks', 'id', 3),
    ('planned_sessions', 'id', 4), ('planned_sessions', 'id', 5),
    ('planned_exercises', 'id', 6), ('workout_logs', 'id', 7), ('set_logs', 'id', 8),
    ('schedule_changes', 'id', 9)
$$;

-- Inserts the full fixture set for the current user (exercises the INSERT policies).
create function rls_test.create_fixtures(owner text)
returns void
language plpgsql
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'create_fixtures: no authenticated user';
  end if;
  insert into public.profiles (
    user_id, birth_year, sex, height_cm, weight_kg, timezone, experience_level, equipment,
    limitations, days_per_week, available_days, session_minutes, training_slots, parq,
    consent_health_at
  ) values (
    me, 1990, 'prefer_not_to_say', 178, 80.5, 'Europe/Bratislava', 'beginner',
    '{dumbbells,bench}', '{knee}', 3, '{mon,wed,fri}', 45,
    '[{"day": "mon", "start_time": "07:00", "location": "Home"}]',
    '{"heart_condition_or_high_blood_pressure": false, "chest_pain": false,
      "dizziness_or_loss_of_consciousness": false, "other_chronic_condition": false,
      "prescribed_medication_for_chronic_condition": false,
      "bone_joint_or_soft_tissue_problem": false, "medically_supervised_activity_only": false,
      "answered_at": "2026-10-05T07:00:00Z"}',
    now()
  );
  insert into public.goals (id, user_id, type, target, status, created_at)
  values (rls_test.id(owner, 1), me, 'strength', '10 push-ups in a row', 'active', now());
  insert into public.plans (id, user_id, goal_id, template_id, version, status, start_date,
                            generated_by, created_at)
  values (rls_test.id(owner, 2), me, rls_test.id(owner, 1), 'full_body_3x', 1, 'active',
          '2026-10-05', 'rules', now());
  insert into public.plan_weeks (id, plan_id, index, start_date, phase)
  values (rls_test.id(owner, 3), rls_test.id(owner, 2), 0, '2026-10-05', 'accumulation');
  insert into public.planned_sessions (id, plan_week_id, day_index, scheduled_date, title,
                                       est_minutes, priority, status, variant)
  values
    (rls_test.id(owner, 4), rls_test.id(owner, 3), 0, '2026-10-05', 'Full body A', 45, 'key',
     'done', 'full'),
    (rls_test.id(owner, 5), rls_test.id(owner, 3), 2, '2026-10-08', 'Full body B', 45, 'normal',
     'moved', 'full');
  insert into public.planned_exercises (id, planned_session_id, exercise_id, "order", sets,
                                        measure, rep_min, rep_max, target_rir, target_load_kg,
                                        rest_sec, is_key)
  values (rls_test.id(owner, 6), rls_test.id(owner, 4), 'goblet_squat', 0, 3, 'reps', 8, 12, 2,
          16, 90, true);
  insert into public.workout_logs (id, user_id, planned_session_id, started_at, ended_at,
                                   pre_checkin, session_rpe)
  values (rls_test.id(owner, 7), me, rls_test.id(owner, 4), '2026-10-05T07:00:00Z',
          '2026-10-05T07:45:00Z', '{"sleep": 4, "energy": 3, "soreness": 2, "stress": 2}', 7);
  insert into public.set_logs (id, workout_log_id, exercise_id, planned_exercise_id, set_index,
                               measure, reps, load_kg, rir, is_warmup, completed, performed_at)
  values (rls_test.id(owner, 8), rls_test.id(owner, 7), 'goblet_squat', rls_test.id(owner, 6),
          0, 'reps', 10, 16, 2, false, true, '2026-10-05T07:10:00Z');
  insert into public.schedule_changes (id, plan_id, planned_session_id, kind, reason, from_date,
                                       to_date, created_by, created_at)
  values (rls_test.id(owner, 9), rls_test.id(owner, 2), rls_test.id(owner, 5), 'move',
          'Wednesday was missed; moved to Thursday.', '2026-10-07', '2026-10-08', 'system',
          now());
end;
$$;

grant execute on all functions in schema rls_test to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  (:uid_a, 'a@example.test'), (:uid_b, 'b@example.test'), (:uid_c, 'c@example.test');

select set_config('request.jwt.claim.sub', :uid_a, false) \g /dev/null
set role authenticated;
select rls_test.create_fixtures('a');
reset role;

select set_config('request.jwt.claim.sub', :uid_b, false) \g /dev/null
set role authenticated;
select rls_test.create_fixtures('b');
reset role;

-- Superuser snapshot of B's rows; compared at the end to prove nothing changed them.
create table rls_test.snapshot_b (tbl text, n int, row_data jsonb);

create function rls_test.row_json(tbl text, key_col text, key text)
returns jsonb
language plpgsql
as $$
declare
  result jsonb;
begin
  execute format('select to_jsonb(t) from public.%I t where %I::text = %L', tbl, key_col, key)
    into result;
  return result;
end;
$$;

insert into rls_test.snapshot_b
select r.tbl, r.n, rls_test.row_json(r.tbl, r.key_col, rls_test.id('b', r.n)::text)
from rls_test.owned_rows() r
union all
select 'profiles', 0, rls_test.row_json('profiles', 'user_id', :uid_b);

-- ---------------------------------------------------------------------------
-- 1. Each user sees exactly their own rows; the catalog is readable
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', :uid_a, false) \g /dev/null
set role authenticated;

select rls_test.expect_count('select 1 from public.profiles', 1, 'A sees own profile only');
select rls_test.expect_count('select 1 from public.goals', 1, 'A sees own goals only');
select rls_test.expect_count('select 1 from public.plans', 1, 'A sees own plans only');
select rls_test.expect_count('select 1 from public.plan_weeks', 1, 'A sees own weeks only');
select rls_test.expect_count('select 1 from public.planned_sessions', 2, 'A sees own sessions only');
select rls_test.expect_count('select 1 from public.planned_exercises', 1, 'A sees own planned exercises only');
select rls_test.expect_count('select 1 from public.workout_logs', 1, 'A sees own workout logs only');
select rls_test.expect_count('select 1 from public.set_logs', 1, 'A sees own set logs only');
select rls_test.expect_count('select 1 from public.schedule_changes', 1, 'A sees own schedule changes only');
select rls_test.expect_count('select 1 from public.exercises where id = ''goblet_squat''', 1, 'catalog readable');

-- ---------------------------------------------------------------------------
-- 2. A cannot select, update or delete any of B's rows (and vice versa)
-- ---------------------------------------------------------------------------

select rls_test.expect_no_access('profiles', 'user_id', :uid_b);
select rls_test.expect_no_access(r.tbl, r.key_col, rls_test.id('b', r.n)::text)
from rls_test.owned_rows() r;

select set_config('request.jwt.claim.sub', :uid_b, false) \g /dev/null
select rls_test.expect_no_access('profiles', 'user_id', :uid_a);
select rls_test.expect_no_access(r.tbl, r.key_col, rls_test.id('a', r.n)::text)
from rls_test.owned_rows() r;

-- ---------------------------------------------------------------------------
-- 3. Inserting rows for another user, or pointing at another user's rows, fails
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', :uid_a, false) \g /dev/null

select rls_test.expect_error(format(
  $q$insert into public.profiles (user_id, birth_year, timezone, experience_level,
       days_per_week, available_days, session_minutes, parq, consent_health_at)
     select %L, birth_year, timezone, experience_level, days_per_week, available_days,
       session_minutes, parq, now() from public.profiles$q$, :uid_c),
  '42501', 'A inserts a profile for C');

select rls_test.expect_error(format(
  $q$insert into public.goals (user_id, type, status) values (%L, 'general', 'active')$q$,
  :uid_b), '42501', 'A inserts a goal for B');

select rls_test.expect_error(format(
  $q$insert into public.plans (user_id, goal_id, version, status, start_date, generated_by)
     values (%L, %L, 2, 'active', '2026-10-12', 'rules')$q$, :uid_b, rls_test.id('b', 1)),
  '42501', 'A inserts a plan for B');

select rls_test.expect_error(format(
  $q$insert into public.plans (user_id, goal_id, version, status, start_date, generated_by)
     values (%L, %L, 2, 'active', '2026-10-12', 'rules')$q$, :uid_a, rls_test.id('b', 1)),
  '23503', 'A attaches own plan to B''s goal (composite FK)');

select rls_test.expect_error(format(
  $q$insert into public.plan_weeks (plan_id, index, start_date, phase)
     values (%L, 1, '2026-10-12', 'accumulation')$q$, rls_test.id('b', 2)),
  '42501', 'A inserts a week into B''s plan');

select rls_test.expect_error(format(
  $q$insert into public.planned_sessions (plan_week_id, day_index, scheduled_date, title,
       est_minutes, priority, status, variant)
     values (%L, 4, '2026-10-09', 'X', 30, 'normal', 'planned', 'full')$q$,
  rls_test.id('b', 3)),
  '42501', 'A inserts a session into B''s week');

select rls_test.expect_error(format(
  $q$insert into public.planned_exercises (planned_session_id, exercise_id, "order", sets,
       measure, rep_min, rep_max, target_rir, rest_sec, is_key)
     values (%L, 'push_up', 5, 3, 'reps', 8, 12, 2, 60, false)$q$, rls_test.id('b', 4)),
  '42501', 'A inserts a planned exercise into B''s session');

select rls_test.expect_error(format(
  $q$insert into public.workout_logs (user_id, started_at) values (%L, now())$q$, :uid_b),
  '42501', 'A inserts a workout log for B');

select rls_test.expect_error(format(
  $q$insert into public.workout_logs (user_id, planned_session_id, started_at)
     values (%L, %L, now())$q$, :uid_a, rls_test.id('b', 4)),
  '42501', 'A links own workout log to B''s session');

select rls_test.expect_error(format(
  $q$insert into public.set_logs (workout_log_id, exercise_id, set_index, measure, reps,
       load_kg, is_warmup, completed, performed_at)
     values (%L, 'push_up', 0, 'reps', 10, 0, false, true, now())$q$, rls_test.id('b', 7)),
  '42501', 'A inserts a set into B''s workout log');

select rls_test.expect_error(format(
  $q$insert into public.set_logs (workout_log_id, exercise_id, planned_exercise_id, set_index,
       measure, reps, load_kg, is_warmup, completed, performed_at)
     values (%L, 'goblet_squat', %L, 5, 'reps', 10, 16, false, true, now())$q$,
  rls_test.id('a', 7), rls_test.id('b', 6)),
  '42501', 'A links own set to B''s planned exercise');

select rls_test.expect_error(format(
  $q$insert into public.schedule_changes (plan_id, planned_session_id, kind, reason,
       from_date, created_by)
     values (%L, %L, 'skip', 'x', '2026-10-05', 'user')$q$,
  rls_test.id('b', 2), rls_test.id('b', 4)),
  '42501', 'A inserts a schedule change into B''s plan');

select rls_test.expect_error(format(
  $q$insert into public.schedule_changes (plan_id, planned_session_id, kind, reason,
       from_date, created_by)
     values (%L, %L, 'skip', 'x', '2026-10-05', 'user')$q$,
  rls_test.id('a', 2), rls_test.id('b', 4)),
  '42501', 'A references B''s session from own plan');

select rls_test.expect_error(format(
  $q$insert into public.schedule_changes (plan_id, planned_session_id, kind, reason,
       from_date, merged_into_session_id, created_by)
     values (%L, %L, 'merge', 'x', '2026-10-05', %L, 'user')$q$,
  rls_test.id('a', 2), rls_test.id('a', 4), rls_test.id('b', 4)),
  '42501', 'A merges own session into B''s session');

-- Re-parenting own rows to another user fails the policies' WITH CHECK.
select rls_test.expect_error(format(
  $q$update public.profiles set user_id = %L$q$, :uid_c), '42501', 'A re-assigns own profile');
select rls_test.expect_error(format(
  $q$update public.goals set user_id = %L$q$, :uid_b), '42501', 'A gives own goal to B');
select rls_test.expect_error(format(
  $q$update public.plans set user_id = %L$q$, :uid_b), '42501', 'A gives own plan to B');
select rls_test.expect_error(format(
  $q$update public.plan_weeks set plan_id = %L$q$, rls_test.id('b', 2)),
  '42501', 'A moves own week into B''s plan');
select rls_test.expect_error(format(
  $q$update public.planned_sessions set plan_week_id = %L$q$, rls_test.id('b', 3)),
  '42501', 'A moves own session into B''s week');
select rls_test.expect_error(format(
  $q$update public.planned_exercises set planned_session_id = %L$q$, rls_test.id('b', 4)),
  '42501', 'A moves own planned exercise into B''s session');
select rls_test.expect_error(format(
  $q$update public.workout_logs set user_id = %L$q$, :uid_b), '42501', 'A gives own log to B');
select rls_test.expect_error(format(
  $q$update public.set_logs set workout_log_id = %L$q$, rls_test.id('b', 7)),
  '42501', 'A moves own set into B''s log');
select rls_test.expect_error(format(
  $q$update public.schedule_changes set plan_id = %L$q$, rls_test.id('b', 2)),
  '42501', 'A moves own schedule change into B''s plan');

-- ---------------------------------------------------------------------------
-- 4. The exercise catalog is read-only; TRUNCATE is never allowed
-- ---------------------------------------------------------------------------

select rls_test.expect_error(
  $q$insert into public.exercises (id, name, pattern, primary_muscles, equipment, level, cues,
       measure, loadable, unilateral, low_stimulus)
     values ('evil_lift', 'Evil', 'squat', '{quads}', '{bodyweight}', 'beginner', '{x}',
             'reps', false, false, false)$q$,
  '42501', 'authenticated inserts into the catalog');
select rls_test.expect_error(
  $q$update public.exercises set name = 'Hacked' where id = 'goblet_squat'$q$,
  '42501', 'authenticated updates the catalog');
select rls_test.expect_error(
  $q$delete from public.exercises where id = 'goblet_squat'$q$,
  '42501', 'authenticated deletes from the catalog');
select rls_test.expect_error('truncate public.exercises', '42501', 'authenticated truncates the catalog');
select rls_test.expect_error('truncate public.goals cascade', '42501', 'authenticated truncates goals');
select rls_test.expect_error('truncate public.set_logs', '42501', 'authenticated truncates set_logs');

-- ---------------------------------------------------------------------------
-- 5. Own rows remain writable; updated_at is maintained by the trigger
-- ---------------------------------------------------------------------------

select rls_test.expect_affected(
  $q$update public.goals set status = 'achieved', updated_at = '2000-01-01'$q$, 1,
  'A updates own goal');
select rls_test.expect_count(
  $q$select 1 from public.goals where status = 'achieved' and updated_at > '2001-01-01'$q$, 1,
  'updated_at trigger overrides the client value');
select rls_test.expect_affected(
  $q$update public.set_logs set rir = 1$q$, 1, 'A updates own set');

-- The server also owns updated_at on INSERT (sync pulls rely on server arrival time).
insert into public.goals (id, user_id, type, status, updated_at)
values (rls_test.id('a', 20), auth.uid(), 'general', 'active', '2000-01-01');
select rls_test.expect_count(format(
  $q$select 1 from public.goals where id = %L and updated_at > '2001-01-01'$q$,
  rls_test.id('a', 20)), 1, 'updated_at trigger overrides the client value on insert');
delete from public.goals where id = rls_test.id('a', 20);

-- Position keys are deferrable: one batch upsert may swap two positions.
insert into public.planned_exercises (id, planned_session_id, exercise_id, "order", sets,
                                      measure, rep_min, rep_max, target_rir, rest_sec, is_key)
values (rls_test.id('a', 10), rls_test.id('a', 4), 'push_up', 1, 3, 'reps', 8, 12, 2, 60, false);
select rls_test.expect_affected(format(
  $q$insert into public.planned_exercises (id, planned_session_id, exercise_id, "order", sets,
       measure, rep_min, rep_max, target_rir, target_load_kg, rest_sec, is_key)
     values (%L, %L, 'goblet_squat', 1, 3, 'reps', 8, 12, 2, 16, 90, true),
            (%L, %L, 'push_up', 0, 3, 'reps', 8, 12, 2, null, 60, false)
     on conflict (id) do update set "order" = excluded."order"$q$,
  rls_test.id('a', 6), rls_test.id('a', 4), rls_test.id('a', 10), rls_test.id('a', 4)),
  2, 'batch upsert swaps planned exercise order');
select rls_test.expect_count(format(
  $q$select 1 from public.planned_exercises
     where (id = %L and "order" = 1) or (id = %L and "order" = 0)$q$,
  rls_test.id('a', 6), rls_test.id('a', 10)), 2, 'planned exercise order swapped');

insert into public.set_logs (id, workout_log_id, exercise_id, set_index, measure, reps, load_kg,
                             is_warmup, completed, performed_at)
values (rls_test.id('a', 11), rls_test.id('a', 7), 'goblet_squat', 1, 'reps', 9, 16, false, true,
        '2026-10-05T07:13:00Z');
select rls_test.expect_affected(format(
  $q$insert into public.set_logs (id, workout_log_id, exercise_id, set_index, measure, reps,
       load_kg, is_warmup, completed, performed_at)
     values (%L, %L, 'goblet_squat', 1, 'reps', 10, 16, false, true, '2026-10-05T07:10:00Z'),
            (%L, %L, 'goblet_squat', 0, 'reps', 9, 16, false, true, '2026-10-05T07:13:00Z')
     on conflict (id) do update set set_index = excluded.set_index$q$,
  rls_test.id('a', 8), rls_test.id('a', 7), rls_test.id('a', 11), rls_test.id('a', 7)),
  2, 'batch upsert swaps set_index');

-- A batch that leaves a real duplicate still fails (at commit; forced here).
select rls_test.expect_error(format(
  $q$update public.set_logs set set_index = 0 where id = %L$q$, rls_test.id('a', 8)),
  '23505', 'deferred set_index duplicate fails at commit');

-- Remove the extra rows so later per-table counts stay at the fixture baseline.
delete from public.planned_exercises where id = rls_test.id('a', 10);
delete from public.set_logs where id = rls_test.id('a', 11);
update public.planned_exercises set "order" = 0 where id = rls_test.id('a', 6);
update public.set_logs set set_index = 0 where id = rls_test.id('a', 8);

-- ---------------------------------------------------------------------------
-- 6. Constraints mirror the Zod schemas
-- ---------------------------------------------------------------------------

select rls_test.expect_error(format(
  $q$insert into public.set_logs (workout_log_id, exercise_id, set_index, measure, reps,
       load_kg, is_warmup, completed, performed_at)
     values (%L, 'goblet_squat', 0, 'reps', 8, 16, false, true, now())$q$, rls_test.id('a', 7)),
  '23505', 'duplicate (workout_log_id, exercise_id, set_index)');
select rls_test.expect_error(format(
  $q$insert into public.set_logs (workout_log_id, exercise_id, set_index, measure, reps,
       load_kg, is_warmup, completed, performed_at)
     values (%L, 'push_up', 0, 'reps', 0, 0, false, true, now())$q$, rls_test.id('a', 7)),
  '23514', 'completed set with 0 reps');
select rls_test.expect_error(format(
  $q$insert into public.set_logs (workout_log_id, exercise_id, set_index, measure, reps,
       load_kg, is_warmup, completed, performed_at)
     values (%L, 'push_up', 0, 'reps', 301, 0, false, true, now())$q$, rls_test.id('a', 7)),
  '23514', 'more than 300 reps');
select rls_test.expect_error(format(
  $q$insert into public.set_logs (workout_log_id, exercise_id, set_index, measure, reps,
       load_kg, is_warmup, completed, performed_at)
     values (%L, 'no_such_exercise', 0, 'reps', 5, 0, false, true, now())$q$,
  rls_test.id('a', 7)),
  '23503', 'set for an unknown exercise');
select rls_test.expect_error(
  $q$insert into public.goals (user_id, type, status)
     values (auth.uid(), 'endurance', 'active')$q$,
  '23514', 'goal type outside the Zod enum');
select rls_test.expect_error(format(
  $q$insert into public.plans (user_id, goal_id, version, status, start_date, generated_by)
     values (auth.uid(), %L, 2, 'active', '2026-10-06', 'rules')$q$, rls_test.id('a', 1)),
  '23514', 'plan start_date not a Monday');
select rls_test.expect_error(format(
  $q$insert into public.planned_exercises (planned_session_id, exercise_id, "order", sets,
       measure, rep_min, rep_max, target_rir, rest_sec, is_key)
     values (%L, 'push_up', 1, 3, 'reps', 12, 8, 2, 60, false)$q$, rls_test.id('a', 4)),
  '23514', 'rep_min > rep_max');
select rls_test.expect_error(format(
  $q$insert into public.schedule_changes (plan_id, planned_session_id, kind, reason,
       from_date, created_by)
     values (%L, %L, 'move', 'x', '2026-10-05', 'user')$q$,
  rls_test.id('a', 2), rls_test.id('a', 4)),
  '23514', 'move without to_date');
select rls_test.expect_error(
  $q$update public.profiles set days_per_week = 4$q$,
  '23514', 'available_days shorter than days_per_week');
select rls_test.expect_error(
  $q$update public.profiles set equipment = '{dumbbells,dumbbells}'$q$,
  '23514', 'duplicate equipment');

-- JSON columns are type-checked: PAR-Q+ answers are booleans, check-ins integers 1-5.
select rls_test.expect_error(
  $q$update public.profiles set parq = jsonb_set(parq, '{chest_pain}', '"no"')$q$,
  '23514', 'parq answer is a string');
select rls_test.expect_error(
  $q$update public.profiles set parq = jsonb_set(parq, '{chest_pain}', 'null')$q$,
  '23514', 'parq answer is null');
select rls_test.expect_error(
  $q$update public.profiles set parq = parq - 'chest_pain'$q$,
  '23514', 'parq answer missing');
select rls_test.expect_error(
  $q$update public.profiles set parq = jsonb_set(parq, '{answered_at}', '0')$q$,
  '23514', 'parq answered_at is not a string');
select rls_test.expect_error(
  $q$update public.profiles set parq = '[]'$q$, '23514', 'parq is not an object');
select rls_test.expect_affected(
  $q$update public.profiles set parq = jsonb_set(parq, '{chest_pain}', 'true')$q$, 1,
  'parq accepts a boolean answer');
select rls_test.expect_error(
  $q$update public.workout_logs
     set pre_checkin = '{"sleep": 6, "energy": 3, "soreness": 2, "stress": 2}'$q$,
  '23514', 'pre_checkin value above 5');
select rls_test.expect_error(
  $q$update public.workout_logs
     set pre_checkin = '{"sleep": 0, "energy": 3, "soreness": 2, "stress": 2}'$q$,
  '23514', 'pre_checkin value below 1');
select rls_test.expect_error(
  $q$update public.workout_logs
     set pre_checkin = '{"sleep": 2.5, "energy": 3, "soreness": 2, "stress": 2}'$q$,
  '23514', 'pre_checkin value not an integer');
select rls_test.expect_error(
  $q$update public.workout_logs
     set pre_checkin = '{"sleep": "3", "energy": 3, "soreness": 2, "stress": 2}'$q$,
  '23514', 'pre_checkin value is a string');
select rls_test.expect_error(
  $q$update public.workout_logs set pre_checkin = '{"sleep": 3, "energy": 3, "soreness": 2}'$q$,
  '23514', 'pre_checkin key missing');
select rls_test.expect_affected(
  $q$update public.workout_logs
     set pre_checkin = '{"sleep": 1, "energy": 5, "soreness": 3, "stress": 4.0}'$q$, 1,
  'pre_checkin accepts integers 1-5');

-- Consent can't be dated in the future (beyond one day of clock-skew leeway).
select rls_test.expect_error(
  $q$update public.profiles set consent_health_at = now() + interval '2 days'$q$,
  '23514', 'consent_health_at in the future');
select rls_test.expect_affected(
  $q$update public.profiles set consent_health_at = now() + interval '12 hours'$q$, 1,
  'consent_health_at within the clock-skew leeway');

-- Consent is mandatory: C cannot create a profile without consent_health_at.
select set_config('request.jwt.claim.sub', :uid_c, false) \g /dev/null
select rls_test.expect_error(
  $q$insert into public.profiles (user_id, birth_year, timezone, experience_level,
       days_per_week, available_days, session_minutes, parq)
     values (auth.uid(), 1990, 'Europe/Vienna', 'beginner', 2, '{mon,thu}', 30,
       '{"heart_condition_or_high_blood_pressure": false, "chest_pain": false,
         "dizziness_or_loss_of_consciousness": false, "other_chronic_condition": false,
         "prescribed_medication_for_chronic_condition": false,
         "bone_joint_or_soft_tissue_problem": false,
         "medically_supervised_activity_only": false, "answered_at": "2026-10-05T07:00:00Z"}')$q$,
  '23502', 'profile without consent_health_at');
-- ... and C has no profile, so it cannot store any other data either.
select rls_test.expect_error(
  $q$insert into public.goals (user_id, type, status) values (auth.uid(), 'general', 'active')$q$,
  '23503', 'goal without a profile (no consent)');
reset role;

select rls_test.expect_error(
  $q$insert into public.exercises (id, name, pattern, primary_muscles, equipment, level, cues,
       measure, loadable, unilateral, low_stimulus)
     values ('bad_combo', 'Bad', 'squat', '{quads}', '{bodyweight,dumbbells}', 'beginner',
             '{x}', 'reps', true, false, false)$q$,
  '23514', 'catalog: bodyweight combined with other equipment');

-- ---------------------------------------------------------------------------
-- 7. anon sees and changes nothing
-- ---------------------------------------------------------------------------

set role anon;
select rls_test.expect_error(format('select * from public.%I', t), '42501', 'anon reads ' || t)
from unnest(array['profiles', 'goals', 'exercises', 'plans', 'plan_weeks', 'planned_sessions',
                  'planned_exercises', 'workout_logs', 'set_logs', 'schedule_changes']) as t;
select rls_test.expect_error('select public.export_my_data()', '42501', 'anon exports');
select rls_test.expect_error('select public.delete_my_account()', '42501', 'anon deletes an account');
select rls_test.expect_error($q$select private.is_unique_array('{a}')$q$, '42501',
  'anon calls a private helper');
reset role;

-- ---------------------------------------------------------------------------
-- 8. GDPR export returns only the caller's data
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', :uid_a, false) \g /dev/null
set role authenticated;
create temp table export_a as select public.export_my_data() as doc;
reset role;

do $$
declare
  doc jsonb := (select doc from export_a);
  key text;
begin
  if doc ->> 'user_id' <> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     or doc -> 'profile' ->> 'user_id' <> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' then
    raise exception 'FAIL [export]: wrong user in export: %', doc -> 'profile';
  end if;
  foreach key in array array['goals', 'plans', 'plan_weeks', 'planned_exercises',
                              'workout_logs', 'set_logs', 'schedule_changes'] loop
    if jsonb_array_length(doc -> key) <> 1 then
      raise exception 'FAIL [export]: expected 1 % row, got %', key, doc -> key;
    end if;
  end loop;
  if jsonb_array_length(doc -> 'planned_sessions') <> 2 then
    raise exception 'FAIL [export]: expected 2 planned_sessions';
  end if;
  if doc::text like '%bbbbbbbb-bbbb%' or doc::text like '%b0000001-%' then
    raise exception 'VIOLATION [export]: export of A contains B data';
  end if;
  perform rls_test.pass();
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Account deletion cascades through everything A owns and nothing else
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claim.sub', :uid_a, false) \g /dev/null
set role authenticated;
select public.delete_my_account();
reset role;

select rls_test.expect_count(
  $q$select 1 from auth.users where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$q$, 0,
  'auth user A deleted');
select rls_test.expect_count(
  $q$select 1 from public.profiles where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$q$, 0,
  'profile A cascaded');
select rls_test.expect_count(
  format('select 1 from public.%I where %I = %L', r.tbl, r.key_col, rls_test.id('a', r.n)), 0,
  format('%s row of A cascaded', r.tbl))
from rls_test.owned_rows() r;

-- B's rows are byte-for-byte unchanged after every attack above and A's deletion.
do $$
declare
  changed text;
begin
  select string_agg(s.tbl || '#' || s.n, ', ') into changed
  from rls_test.snapshot_b s
  where s.row_data is null
     or s.row_data is distinct from (
       case when s.tbl = 'profiles'
         then rls_test.row_json('profiles', 'user_id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
         else rls_test.row_json(s.tbl, 'id', rls_test.id('b', s.n)::text)
       end
     );
  if changed is not null then
    raise exception 'VIOLATION: B rows changed or missing: %', changed;
  end if;
  perform rls_test.pass();
end;
$$;

select format('RLS tests passed: %s assertions', last_value) as result
from rls_test.assertions \gset
\echo :result
