// ported-from: spikes/sp7-static-gates/fixture/violations/packages/contracts/src/post-submit/item-result.ts
import { z } from "zod";

// Post-submit reveal: answer_key and explanation are allowed here.
export const ItemResultPostSubmit = z.object({
  item_id: z.string(),
  is_correct: z.boolean(),
  answer_key: z.string(),
  explanation: z.string(),
});
export type UnitKey = `u${number}`;
