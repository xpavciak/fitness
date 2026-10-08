export * from './schemas/index.js';
export * from './equipment.js';
export { EXERCISE_CATALOG, getExerciseById } from './catalog/index.js';
export { createCatalogLookup } from './catalog/lookup.js';
export * from './dates.js';
export * from './loads.js';
export * from './ids.js';
// Feature A: plan generation (T4)
export * from './plan/screening.js';
export * from './plan/templates.js';
export * from './plan/session-time.js';
export * from './plan/select.js';
export * from './plan/rules.js';
export * from './plan/generate.js';
// Feature B: progression, e1RM and personal records (T5)
export * from './progression/next-targets.js';
export * from './progression/one-rep-max.js';
// Feature C: adaptive rescheduling and the minimum dose (T6)
export * from './schedule/session-variants.js';
export * from './schedule/reschedule.js';
export * from './schedule/apply.js';
// Feature D: adherence and weekly streaks (T7)
export * from './adherence/adherence.js';
// D5: coach texts (plan explanation, weekly reflection) with a template fallback (T10)
export * from './coach/template-provider.js';
export * from './coach/claude-provider.js';
