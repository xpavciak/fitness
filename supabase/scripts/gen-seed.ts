/**
 * Generates supabase/seed.sql (the exercise catalog) from the engine catalog.
 *
 *   node supabase/scripts/gen-seed.ts           # write supabase/seed.sql
 *   node supabase/scripts/gen-seed.ts --check   # exit 1 if seed.sql is out of date
 *
 * Reads the built engine (`packages/engine/dist`), so run `pnpm build:packages` first.
 * Runs on Node >= 22.18 without a build step (native type stripping).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EXERCISE_CATALOG, ExerciseCatalogSchema } from '../../packages/engine/dist/index.js';
import type { ExerciseRow } from '../../packages/engine/dist/index.js';

const SEED_PATH = fileURLToPath(new URL('../seed.sql', import.meta.url));

/** Columns in table order; every ExerciseRow key, so a new schema field breaks the build. */
const COLUMNS = [
  'id',
  'name',
  'pattern',
  'primary_muscles',
  'secondary_muscles',
  'equipment',
  'level',
  'contraindication_tags',
  'substitutes',
  'cues',
  'measure',
  'loadable',
  'unilateral',
  'low_stimulus',
] as const satisfies readonly (keyof ExerciseRow)[];

// Compile-time guard: fails the typecheck if ExerciseRow gains a column missing from COLUMNS.
type AssertNever<T extends never> = T;
export type MissingSeedColumns = AssertNever<Exclude<keyof ExerciseRow, (typeof COLUMNS)[number]>>;

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlValue(value: ExerciseRow[keyof ExerciseRow]): string {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'string') {
    return sqlString(value);
  }
  if (value.length === 0) {
    return `'{}'::text[]`;
  }
  return `array[${value.map(sqlString).join(', ')}]::text[]`;
}

function renderSeed(catalog: readonly ExerciseRow[]): string {
  const rows = [...catalog]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((exercise) => `  (${COLUMNS.map((column) => sqlValue(exercise[column])).join(', ')})`);
  const updates = COLUMNS.filter((column) => column !== 'id').map(
    (column) => `  ${column} = excluded.${column}`,
  );
  return [
    '-- GENERATED FILE, DO NOT EDIT.',
    '-- Source: packages/engine/src/catalog (EXERCISE_CATALOG).',
    '-- Regenerate with `pnpm db:seed`; `pnpm db:verify` fails if this file is stale.',
    '--',
    `-- ${String(catalog.length)} exercises, sorted by id.`,
    '-- Idempotent upsert: safe to re-run on an existing database. Catalog rows removed from',
    '-- the engine are NOT deleted here (logs may reference them); retire them in a migration.',
    '',
    `insert into public.exercises (${COLUMNS.join(', ')})`,
    'values',
    rows.join(',\n'),
    'on conflict (id) do update set',
    `${updates.join(',\n')};`,
    '',
  ].join('\n');
}

function main(argv: readonly string[]): number {
  const catalog = ExerciseCatalogSchema.parse(EXERCISE_CATALOG);
  const expected = renderSeed(catalog);
  if (argv.includes('--check')) {
    let actual: string;
    try {
      actual = readFileSync(SEED_PATH, 'utf8');
    } catch (error) {
      console.error(`Cannot read ${SEED_PATH}: ${String(error)}`);
      return 1;
    }
    if (actual !== expected) {
      console.error(
        'supabase/seed.sql is out of date with the engine catalog. Run `pnpm db:seed`.',
      );
      return 1;
    }
    console.log(`seed.sql matches the engine catalog (${String(catalog.length)} exercises).`);
    return 0;
  }
  writeFileSync(SEED_PATH, expected);
  console.log(`Wrote ${SEED_PATH} (${String(catalog.length)} exercises).`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
