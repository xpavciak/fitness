#!/usr/bin/env bash
# Verifies the Supabase migrations, RLS policies and seed against plain Postgres in Docker
# (no Supabase CLI needed). Run from anywhere: `pnpm db:verify`.
#
# Steps:
#   1. Check that supabase/seed.sql matches the engine catalog (builds the engine first).
#   2. Start a throwaway postgres container (PG_IMAGE, default postgres:16).
#   3. Apply the Supabase stub (auth schema, auth.uid(), API roles), every migration in
#      order, the seed, then the seed again (must be idempotent).
#   4. Run the SQL RLS/constraint tests. Any violation aborts with a non-zero exit code.
#   5. Remove the container (also on failure).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_DIR="$(cd "${SUPABASE_DIR}/.." && pwd)"
PG_IMAGE="${PG_IMAGE:-postgres:16}"
CONTAINER="fitness-db-verify-$$"

log() { printf '==> %s\n' "$*"; }
fail() { printf 'db:verify FAILED: %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || fail "docker is not installed"
docker info >/dev/null 2>&1 || fail "cannot reach the Docker daemon"

log "Building the engine and checking seed.sql against the catalog"
pnpm --dir "${REPO_DIR}" --filter @fitness/engine run build >/dev/null
node "${SCRIPT_DIR}/gen-seed.ts" --check

cleanup() {
  docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

log "Starting ${PG_IMAGE} (${CONTAINER})"
docker run -d --rm --name "${CONTAINER}" \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=fitness \
  "${PG_IMAGE}" >/dev/null

# The image runs a temporary server (socket only) during init; TCP readiness means the
# final server is up.
for _ in $(seq 1 60); do
  if docker exec "${CONTAINER}" pg_isready -q -h 127.0.0.1 -U postgres -d fitness 2>/dev/null; then
    break
  fi
  sleep 1
done
docker exec "${CONTAINER}" pg_isready -q -h 127.0.0.1 -U postgres -d fitness \
  || { docker logs "${CONTAINER}" >&2 || true; fail "postgres did not become ready"; }
log "$(docker exec "${CONTAINER}" psql -h 127.0.0.1 -U postgres -d fitness -XAtc 'select version()')"

# Runs a SQL file from the host through psql in the container; stops on the first error.
run_sql() {
  local file="$1"
  local single_tx="${2:-}"
  # -o /dev/null hides query results; \echo output, notices and errors still show.
  local args=(-h 127.0.0.1 -U postgres -d fitness -X -q -v ON_ERROR_STOP=1 -o /dev/null)
  if [[ "${single_tx}" == "--single-transaction" ]]; then
    args+=(--single-transaction)
  fi
  docker exec -i "${CONTAINER}" psql "${args[@]}" <"${file}" \
    || fail "error while running ${file#"${REPO_DIR}/"}"
}

log "Applying the Supabase stub (auth schema, auth.uid(), anon/authenticated roles)"
run_sql "${SCRIPT_DIR}/verify/00-supabase-stub.sql"

shopt -s nullglob
migrations=("${SUPABASE_DIR}"/migrations/*.sql)
shopt -u nullglob
[[ ${#migrations[@]} -gt 0 ]] || fail "no migrations found in supabase/migrations"
for migration in "${migrations[@]}"; do
  log "Applying migration $(basename "${migration}")"
  run_sql "${migration}" --single-transaction
done

log "Applying seed.sql (twice, to prove it is idempotent)"
run_sql "${SUPABASE_DIR}/seed.sql" --single-transaction
run_sql "${SUPABASE_DIR}/seed.sql" --single-transaction
log "$(docker exec "${CONTAINER}" psql -h 127.0.0.1 -U postgres -d fitness -XAtc \
  "select count(*) || ' exercises in the catalog' from public.exercises")"

log "Checking that RLS is enabled on every public table"
missing_rls="$(docker exec "${CONTAINER}" psql -h 127.0.0.1 -U postgres -d fitness -XAtc \
  "select string_agg(relname, ', ') from pg_class
   where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity")"
[[ -z "${missing_rls}" ]] || fail "RLS is disabled on: ${missing_rls}"

log "Running RLS and constraint tests"
run_sql "${SCRIPT_DIR}/verify/10-rls-tests.sql"

log "db:verify passed"
