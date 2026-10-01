// ported-from: spikes/sp7-static-gates/fixture/violations/services/a/src/routing/route.ts (audit-fixed: 규칙 ID DS-01 §13)
export interface Concept { id: string; prerequisites: string[]; locked?: boolean } // EXPECT[ng-g4/hard-lock]

export function isLocked(concept: Concept, mastered: Set<string>): boolean { // EXPECT[ng-g4/hard-lock]
  return concept.prerequisites.some((p) => !mastered.has(p));
}

export function guard(concept: Concept, mastered: Set<string>, redirect: (to: string) => never) {
  if (isLocked(concept, mastered)) redirect("/locked"); // EXPECT[ng-g4/hard-lock]
}
