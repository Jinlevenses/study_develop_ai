// ported-from: spikes/sp7-static-gates/fixture/violations/services/a/src/blank-note/post-submit/feedback.ts
import { generate } from "@fathom/shared-kernel/ai-gateway-client.ts";

// Post-submit: comparison / feedback generation is allowed.
export async function feedback(noteText: string): Promise<string> {
  return generate({ task: "blank_note.feedback", prompt: noteText });
}
