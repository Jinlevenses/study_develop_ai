// ported-from: spikes/sp7-static-gates/fixture/clean/packages/contracts/src/pre-submit/item-view.ts
import { z } from "zod";

// NG-G3: before submission the client only sees the stem and the option texts.
// (answer_key / explanation are deliberately absent -- see post-submit/item-result.ts)
export const ItemViewPreSubmitResponse = z.object({
  item_id: z.string(),
  stem: z.string(),
  options: z.record(z.string(), z.string()),
  hint_ladder_steps: z.number().int(),
});
export type ItemViewPreSubmitResponse = z.infer<typeof ItemViewPreSubmitResponse>;
