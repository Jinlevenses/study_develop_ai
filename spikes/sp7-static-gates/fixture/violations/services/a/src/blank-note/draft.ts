import { generate } from "@fathom/shared-kernel/ai-gateway-client.ts"; // EXPECT[ng-g7/presubmit-ai-call]

export interface Draft { text: string; ambiguousRanges: [number, number][] }

export async function autoWriteNote(draft: Draft): Promise<Draft> { // EXPECT[ng-g7/presubmit-ai-call]
  const text = await generate({ task: "blank_note.generate", prompt: draft.text }); // EXPECT[ng-g7/presubmit-ai-call]
  return { ...draft, text };
}
