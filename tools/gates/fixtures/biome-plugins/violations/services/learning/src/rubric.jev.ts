// ported-from: spikes/sp7-static-gates/fixture/violations/services/a/src/rubric.jev.ts
export const PROMPT = "Grade answer 2 against the rubric"; // EXPECT[jev/index-string]
export function last(answers: string[]) {
  return answers[0]; // EXPECT[jev/index-literal]
}
