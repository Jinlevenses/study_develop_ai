// ported-from: spikes/sp7-static-gates/fixture/clean/services/a/src/blank-note/draft.ts (audit-fixed: 규칙 ID DS-01 §13)
// Pre-submit path: the learner writes alone. No AI generation call is reachable from here.
export interface Draft { text: string; ambiguousRanges: [number, number][] }

export function appendText(draft: Draft, text: string): Draft {
  return { ...draft, text: draft.text + text };
}
