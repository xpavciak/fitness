# fitness – Tréningový plán

A static website that shows a generated, coach-style **one-month training plan** with concrete
tasks for every day. The UI is in Slovak.

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

The build uses a relative base and hash routing (`#/den/2026-11-16`,
`#/den/2026-11-16/cvik/back-squat`), so `dist/` can be hosted on any static host. Only hashes
starting with `#/` are routes; other hashes (the "Preskočiť na obsah" skip link) are ignored by
the router. A top-level error boundary shows a message instead of a blank page.

## Deploy

Every push to `main` builds the site and publishes it to GitHub Pages
(`.github/workflows/deploy.yml`) at <https://xpavciak.github.io/fitness/>.
One-time setup: in the repository settings, set **Pages → Build and deployment → Source** to
**GitHub Actions**. Hash routing and the relative Vite `base` make deep links work on Pages.

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
  hologram/          3D figure (three.js via @react-three/fiber, lazy-loaded)
    orbitCamera.ts   three's OrbitControls configured for a scrollable page + button rotation
    webgl.ts         cached WebGL detection (probe context is released)
    pose.ts          framework-free pose model + keyframe sampling
    clips.ts         keyframed clips per animation id (squat, hinge, bench, press, row, ...)
    rig.ts           procedural jointed humanoid + props (barbell, dumbbells, bench, seat)
    materials.ts     holographic shaders (fresnel glow, scanlines, flicker, base disc, beam)
    controller.ts    owns three.js objects and advances the animation each frame
    HologramStage.tsx  R3F canvas with orbit controls
  components/        Overview (start control), DayView, ExerciseView, Hologram wrapper
                     (WebGL fallback), AppErrorBoundary, ...
  hooks/             hash routing, plan persistence, live "today", media queries
  routing.ts         hash route parsing/building
docs/screenshots/    desktop and 390 px mobile screenshots (overview, day, exercise)
.github/workflows/ci.yml  install → lint → typecheck → test → build
```

The hologram is built procedurally from capsules and spheres; no external models or assets.
three.js and the scene live in a separate chunk that is only loaded when an exercise is opened.

Note: `three` is pinned to `0.182.x` because `@react-three/fiber` 9 still uses `THREE.Clock`,
which logs a deprecation warning from three r183 on.
