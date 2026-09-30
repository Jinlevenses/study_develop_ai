export function guardPrereq(prereqMissing: boolean, redirect: (to: string) => never) {
  if (prereqMissing) redirect("/roadmap"); // EXPECT[ng-g4/prereq-redirect]
}
