# fitness – Tréningový plán

A static website that shows a generated, coach-style **one-month training plan** with concrete
tasks for every day. The UI is in Slovak.

- The home screen (`#/`) shows only **today's** workout (or a note when the plan has not
  started yet / has ended, with the start choice). "Celý mesiac" in the top bar and above the
  workout opens the month overview (`#/mesiac`).
- **Replacing exercises:** every main exercise on a gym day has "Zmazať a nahradiť". It offers
  curated alternatives for the same muscles and the same kind of prescription (reps, hold or
  carried distance), leaving out exercises already used in that session. The swap applies to
  every day of the plan, keeps sets/reps/rest, is stored in `localStorage`
  (`treningovy-plan:vymeny`) and can be undone ("Vrátiť pôvodný").
- 4 weeks starting on a Monday. By default the next Monday on/after today; on the overview the
  user can choose "Začať tento týždeň" (this week's Monday, earlier days are shown as past) or
  "Začať budúci pondelok". The choice is stored in `localStorage`; after a plan ends it stays
  visible for a week with a restart prompt. "Today" refreshes at local midnight and when the tab
  becomes visible again.
- Weekly layout: **Mon legs** (Nohy), **Tue easy zone 2 run**, **Wed push** (Tlak),
  **Thu rest + 15–20 min mobility**, **Fri pull** (Ťah), **Sat intervals**, **Sun rest**.
- Gym days are a split; together with the mobility day they train the whole body every week
  (quads, hamstrings, glutes, calves, chest, back/lats, shoulders, biceps, triceps, core,
  mobility). One accessory slot per split rotates its variant in weeks 2 and 4.
- Each gym session 50–65 min: 10 min warm-up, 5 exercises with sets × reps, rest, RIR and tempo,
  5 min cool-down. Duration is computed from sets, reps, tempo and rest.
- Periodisation: week 1 base (RIR 3), week 2 volume (+1 set on main lifts, RIR 2), week 3 peak
  (same sets as week 2, 4–6 reps on main lifts, 180 s rest on squat/bench, RIR 1–2), week 4
  deload (~40 % fewer sets, RIR 4, extra mobility).
- Click a day for the workout, click an exercise for technique steps, muscles, common mistakes,
  easier/harder alternatives, safety setup for heavy barbell lifts and a **3D hologram**
  demonstrating the movement with matching equipment (barbell, dumbbells, benches).
  The hologram rotates by horizontal drag or the ←/→ buttons, has play/pause, starts paused
  with `prefers-reduced-motion`, renders on demand while paused, never captures the mouse
  wheel (the page scrolls) and allows vertical page scrolling on touch (`touch-action: pan-y`).

> The plan is general guidance, not medical advice. Consult a doctor if you have health problems.

## Run

Requires Node 22+ and pnpm 10.

```bash
pnpm install
pnpm dev          # http://localhost:5173
pnpm lint         # ESLint + Prettier check
pnpm typecheck    # tsc -b (strict)
pnpm test         # Vitest + Testing Library
pnpm build        # static build into dist/
pnpm preview      # serve dist/ on http://localhost:4173
```

The build uses a relative base and hash routing (`#/` today, `#/mesiac`, `#/den/2026-11-16`,
`#/den/2026-11-16/cvik/back-squat`), so `dist/` can be hosted on any static host. Only hashes
starting with `#/` are routes; other hashes (the "Preskočiť na obsah" skip link) are ignored by
the router. A top-level error boundary shows a message instead of a blank page.

## Deploy (Cloudflare Workers static assets)

The site is deployed by Cloudflare **Workers Builds** connected to this repository. `wrangler.jsonc`
tells it what to do: `npx wrangler deploy` runs `pnpm build` and uploads `dist/` as static assets
(no Worker script). Node comes from `.node-version`, pnpm from `packageManager`.

Dashboard settings (Workers & Pages → `fitness` → Settings → Build): build command empty, deploy
command `npx wrangler deploy`, production branch `main`. Every push to `main` deploys to
production; other branches get preview versions. Custom domain: **Settings → Domains & Routes →
Add → Custom domain**.

`public/_headers` sets security headers (CSP etc.) and long caching for hashed assets. Hash routing
and the relative Vite `base` keep deep links working.

## Structure

```
src/
  plan/              framework-free domain module (reusable by a future mobile app)
    types.ts         plan, day, exercise and prescription types
    exercises.ts     exercise library (Slovak names, steps, mistakes, alternatives, animation id)
    templates.ts     periodisation, legs/push/pull templates, cardio progression, safety note
    generator.ts     deterministic generatePlan(startDate) and helpers
    duration.ts      session duration estimate from sets × (reps × tempo + setup + rest)
    dates.ts         UTC-safe ISO date helpers, Slovak date formatting
    schedule.ts      plan start options (this/next Monday), status, start resolution
    swaps.ts         curated exercise alternatives and swap validation
  hologram/          3D figure (three.js via @react-three/fiber, lazy-loaded)
    orbitCamera.ts   three's OrbitControls configured for a scrollable page + button rotation
    webgl.ts         cached WebGL detection (probe context is released)
    humanSkeleton.ts generated rest skeleton, hand/foot contacts, skin landmarks of human.glb
    skeleton.ts      typed access to the skeleton data (bone indices, limb lengths, reach)
    solver.ts        full-body pose solver: FK trunk, two-bone IK arms/legs, grips, feet, gaze
    motion.ts        eased keyframe tracks (seconds), loop splines
    clipKit.ts       clip/frame types, stances, centre-of-mass balance, contacts
    clips.ts         one clip per animation id (tempo, bar path, contacts, breathing)
    layout.ts        real-world equipment dimensions shared by clips and props
    props.ts         barbell, dumbbells, benches, half rack, cable stations, treadmill, bike, mat
    rig.ts           skinned human from public/models/human.glb + depth pre-pass twin
    materials.ts     holographic shaders (skinned fresnel/contours/breathing, disc, beam)
    controller.ts    owns three.js objects and advances the animation each frame
    HologramStage.tsx  R3F canvas with orbit controls, loads the model (Suspense)
  components/        TodayView (home), Overview (start control), DayView, SwapControl,
                     ExerciseView, Hologram wrapper
                     (WebGL fallback), AppErrorBoundary, ...
  hooks/             hash routing, plan persistence, live "today", media queries
  routing.ts         hash route parsing/building
public/models/       human.glb (CC0, see docs/ASSETS.md)
scripts/             build-human-model.mjs (MakeHuman CC0 sources -> human.glb + humanSkeleton.ts)
docs/ASSETS.md       sources and licences of third-party assets
docs/screenshots/    desktop and 390 px mobile screenshots (overview, day, exercise, holograms)
.github/workflows/ci.yml  install → lint → typecheck → test → build
```

### Hologram

The figure is a skinned, anatomically proportioned human (CC0 MakeHuman base mesh, 13.5 k
vertices, 33 bones, ~480 KB `public/models/human.glb`; source and licence in
[docs/ASSETS.md](docs/ASSETS.md)). It is drawn with a holographic shader – fresnel rim, soft key
light shading, rest-space contour lines that follow the skin, scanlines, flicker – after a
depth-only pre-pass, so only the front surface glows and the body reads as a solid volume.

Motion is not keyframed joint angles but a small full-body solver (`solver.ts`): clips say where
the hips are, how the spine bends, where the hands grip (bar, handles, floor) and where the feet
stand; two-bone IK turns that into bone rotations, so feet stay planted and hands stay on the
bar. Clips (`clips.ts`) follow the coaching tempo of each exercise (e.g. squat: 3 s down, 1 s
pause, explosive drive, breath at the top), balance the centre of mass (or the bar) over the
mid-foot, and add breathing, weight shift and gaze. Walking clips travel across the projector
and re-materialise; running uses a treadmill. Tests in `src/hologram/*.test.ts` check contacts
(feet ≤ 1 cm, hands ≤ 2 cm), bar paths, tempo and gait for every animation id.

`GLTFLoader` reads the model natively (`KHR_mesh_quantization`, no Draco/meshopt WASM), so the
CSP needs no `'wasm-unsafe-eval'`. The model URL carries a content hash and `/models/*` is cached
as immutable. three.js, the loader and the scene live in a separate chunk that is only loaded
when an exercise is opened.

Note: `three` is pinned to `0.182.x` because `@react-three/fiber` 9 still uses `THREE.Clock`,
which logs a deprecation warning from three r183 on.
