// ported-from: spikes/sp7-static-gates/fixture/violations/services/a/src/routing/prereq.ts (audit-fixed: 규칙 ID DS-01 §13)
export function guardPrereq(prereqMissing: boolean, redirect: (to: string) => never) {
  if (prereqMissing) redirect("/roadmap"); // EXPECT[ng-g4/prereq-redirect]
}
