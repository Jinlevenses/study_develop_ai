// ported-from: spikes/sp7-static-gates/fixture/clean/services/a/src/routing/route.ts
// NG-G4: recommended-path highlight + soft gate warning. Never a hard lock.
export interface Concept { id: string; prerequisites: string[] }

export function softGateWarning(concept: Concept, mastered: Set<string>): string | null {
  const missing = concept.prerequisites.filter((p) => !mastered.has(p));
  return missing.length ? `추천: 먼저 ${missing.join(", ")}` : null;
}

export function highlight(concepts: Concept[], mastered: Set<string>): string[] {
  return concepts.filter((c) => softGateWarning(c, mastered) === null).map((c) => c.id);
}
