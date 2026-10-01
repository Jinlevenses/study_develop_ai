// ported-from: spikes/sp7-static-gates/fixture/violations/services/a/src/routing/prereq.ts
export function guardPrereq(prereqMissing: boolean, redirect: (to: string) => never) {
  if (prereqMissing) redirect("/roadmap"); // EXPECT[ng-g4/prereq-redirect]
}
