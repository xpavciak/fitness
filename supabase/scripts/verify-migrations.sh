#!/usr/bin/env bash
# Verifies the Supabase migrations, RLS policies and seed against plain Postgres in Docker
# (no Supabase CLI needed). Run from anywhere: `pnpm db:verify`.
#
# Steps:
#   1. Check that supabase/seed.sql matches the engine catalog (builds the engine first).
#   2. Start a throwaway postgres container (PG_IMAGE, default postgres:16).
#   3. Apply the Supabase stub (auth schema, auth.uid(), API roles), every migration in
#      order, the seed, then the seed again (must be a no-op: no row rewritten).
#   4. Run the SQL RLS/constraint tests. Any violation aborts with a non-zero exit code.
#   5. EXPLAIN every table's policies and fail on per-row subplans or missing index paths.
#   6. Remove the container (also on failure).
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
# Prints the single value returned by a SQL query.
sql_value() {
  docker exec "${CONTAINER}" psql -h 127.0.0.1 -U postgres -d fitness -XAtc "$1"
}

log "$(sql_value 'select version()')"

# Runs a SQL file from the host through psql in the container; stops on the first error.
# Options: --single-transaction, --show (print query results; hidden by default).
run_sql() {
  local file="$1"
  shift
  local args=(-h 127.0.0.1 -U postgres -d fitness -X -q -v ON_ERROR_STOP=1)
  local show=false
  for option in "$@"; do
    case "${option}" in
      --single-transaction) args+=(--single-transaction) ;;
      --show) show=true ;;
      *) fail "run_sql: unknown option ${option}" ;;
    esac
  done
  # -o /dev/null hides query results; \echo output, notices and errors still show.
  [[ "${show}" == true ]] || args+=(-o /dev/null)
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
catalog_state="select count(*) || ' exercises, last updated_at ' || max(updated_at)
  from public.exercises"
before="$(sql_value "${catalog_state}")"
run_sql "${SUPABASE_DIR}/seed.sql" --single-transaction
after="$(sql_value "${catalog_state}")"
[[ "${before}" == "${after}" ]] \
  || fail "re-running seed.sql rewrote rows (before: ${before}; after: ${after})"
log "Catalog: ${after} (unchanged by the second run)"

log "Checking that RLS is enabled on every public table"
missing_rls="$(sql_value \
  "select string_agg(relname, ', ') from pg_class
   where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity")"
[[ -z "${missing_rls}" ]] || fail "RLS is disabled on: ${missing_rls}"

log "Running RLS and constraint tests"
run_sql "${SCRIPT_DIR}/verify/10-rls-tests.sql"

log "Checking RLS policy plans (EXPLAIN as an authenticated user)"
run_sql "${SCRIPT_DIR}/verify/20-explain-policies.sql" --show

log "db:verify passed"
