import type { Exercise } from '../schemas/index.js';

/** Returns an exercise lookup that throws on unknown ids (engine inputs are validated first). */
export function createCatalogLookup(catalog: readonly Exercise[]): (id: string) => Exercise {
  const byId = new Map(catalog.map((exercise) => [exercise.id, exercise]));
  return (id) => {
    const exercise = byId.get(id);
    if (!exercise) {
      throw new Error(`Unknown exercise_id "${id}" (not in the exercise catalog)`);
    }
    return exercise;
  };
}
