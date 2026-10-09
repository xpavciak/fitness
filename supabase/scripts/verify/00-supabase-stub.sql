-- Minimal stand-in for the parts of a Supabase database the migrations depend on.
-- Used only by verify-migrations.sh against a plain postgres image; never apply this to a
-- real Supabase project (which already has all of it).

\set ON_ERROR_STOP on

-- API roles. service_role bypasses RLS, as on Supabase.
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

-- auth schema with the columns the migrations reference.
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  created_at timestamptz not null default now()
);

-- Same contract as Supabase's auth.uid(): the JWT `sub`, read from request settings.
create function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Supabase's default privileges: API roles get ALL on new public objects. The migration
-- must narrow these itself, so the stub reproduces the permissive default.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
