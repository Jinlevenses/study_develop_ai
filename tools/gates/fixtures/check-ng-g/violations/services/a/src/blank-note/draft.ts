// ported-from: spikes/sp7-static-gates/fixture/violations/services/a/src/blank-note/draft.ts (audit-fixed: 규칙 ID DS-01 §13)
import { generate } from "@fathom/shared-kernel/ai-gateway-client.ts"; // EXPECT[ng-g7/blank-note-ai]

export interface Draft { text: string; ambiguousRanges: [number, number][] }

export async function autoWriteNote(draft: Draft): Promise<Draft> { // EXPECT[ng-g7/blank-note-ai]
  const text = await generate({ task: "blank_note.generate", prompt: draft.text }); // EXPECT[ng-g7/blank-note-ai]
  return { ...draft, text };
}
