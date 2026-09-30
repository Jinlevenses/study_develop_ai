// Pre-submit path: the learner writes alone. No AI generation call is reachable from here.
export interface Draft { text: string; ambiguousRanges: [number, number][] }

export function appendText(draft: Draft, text: string): Draft {
  return { ...draft, text: draft.text + text };
}
