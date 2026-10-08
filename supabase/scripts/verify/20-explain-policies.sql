-- Plan check for the RLS policies (run by verify-migrations.sh after 10-rls-tests.sql).
--
-- For every user table, EXPLAINs a SELECT and a DELETE as an authenticated user (B) with
-- seq scans disabled, prints the plans, and fails if:
--   - a filter runs a correlated (per-row) SubPlan instead of a hashed one, or calls a
--     function per row (the policies must stay inlinable), or
--   - the table itself is still read by a Seq Scan, i.e. no index can serve the policy.
-- The tables are tiny here, so `enable_seqscan = off` is what makes index paths visible.

\set ON_ERROR_STOP on
set client_min_messages = warning;

create function rls_test.explain_lines(sql text)
returns setof text
language plpgsql
as $$
declare
  line text;
begin
  for line in execute 'explain (costs off) ' || sql loop
    return next line;
  end loop;
end;
$$;

create function rls_test.policy_plans()
returns table (statement text, plan_line text)
language plpgsql
as $$
declare
  tbl text;
  stmt text;
  problems text := '';
begin
  foreach tbl in array array['profiles', 'goals', 'plans', 'plan_weeks', 'planned_sessions',
                             'planned_exercises', 'workout_logs', 'set_logs',
                             'schedule_changes'] loop
    foreach stmt in array array[
      format('select * from public.%I', tbl),
      format('delete from public.%I', tbl)
    ] loop
      for plan_line in select l from rls_test.explain_lines(stmt) as l loop
        statement := stmt;
        return next;
        if plan_line ~ '(Filter|Cond): ' and plan_line ~ 'SubPlan'
           and plan_line !~ 'hashed SubPlan' then
          problems := problems || format(E'\n  %s: per-row SubPlan: %s', stmt, btrim(plan_line));
        end if;
        if plan_line ~ '(Filter|Cond): ' and plan_line ~ '(owns_|private\.)' then
          problems := problems || format(E'\n  %s: per-row function: %s', stmt, btrim(plan_line));
        end if;
        if plan_line ~ format('Seq Scan on %s\M', tbl) then
          problems := problems || format(E'\n  %s: no index path: %s', stmt, btrim(plan_line));
        end if;
      end loop;
    end loop;
  end loop;
  if problems <> '' then
    raise exception 'FAIL [policy plans]:%', problems;
  end if;
end;
$$;

grant execute on function rls_test.explain_lines(text), rls_test.policy_plans()
  to authenticated;

select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', false)
\g /dev/null
set role authenticated;
set enable_seqscan = off;

\pset footer off
select statement, plan_line as "plan (costs off, enable_seqscan = off)"
from rls_test.policy_plans();

reset enable_seqscan;
reset role;
\echo 'Policy plans OK: no per-row subplans or functions, every table reachable by index.'
