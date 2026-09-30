import { z } from "zod";

export const ItemViewPreSubmitResponse = z.object({
  item_id: z.string(),
  stem: z.string(),
  options: z.record(z.string(), z.string()),
  hint_ladder_steps: z.number().int(),
  answer_key: z.string(), // EXPECT[ng-g3/presubmit-field]
  explanation: z.string().optional(), // EXPECT[ng-g3/presubmit-field]
});
export type ItemViewPreSubmitResponse = z.infer<typeof ItemViewPreSubmitResponse>;

// A file under pre-submit/ is scanned as a whole even when the schema name lacks "PreSubmit".
export const HintPayload = z.object({
  hint: z.object({ model_answer: z.string() }), // EXPECT[ng-g3/presubmit-field]
});
