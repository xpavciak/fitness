# apps/mobile

Placeholder for the Expo (React Native + TypeScript) app (decision D2, task T9).

The app will consume the planning engine from `packages/engine` via the pnpm workspace
(`"@fitness/engine": "workspace:*"`). It is intentionally empty in batch 1; there is no
`package.json` yet, so pnpm does not treat it as a workspace package.

## Resolving the engine

`@fitness/engine` exports compiled output from `dist/` by default. Two options for the app:

1. **Build first (default, used by CI):** the root `typecheck` script and the CI workflow run
   `pnpm build:packages` before linting and typechecking, so `dist/*.d.ts` exists.
2. **Source condition:** the engine also exports a `@fitness/source` condition pointing at
   `src/index.ts`. Add `"customConditions": ["@fitness/source"]` to the app's `tsconfig.json`
   (and the same condition to Metro's `resolver.unstable_conditionNames`) to consume the
   TypeScript sources directly without a prior build.
