// ported-from: spikes/sp7-static-gates/fixture/violations/packages/contracts/src/named-presubmit.ts (audit-fixed: 규칙 ID DS-01 §13)
import { z } from "zod";
import { ItemResultPostSubmit } from "./post-submit/item-result.ts";

// Schema is identified by NAME (contains "PreSubmit") although the file is elsewhere.
export const QuestionPreSubmitView = z.object({
  id: z.string(),
  is_correct: z.boolean(), // EXPECT[ng-g3/pre-submit-fields]
});

export interface NotePreSubmitDto {
  text: string;
  exemplar_note?: string; // EXPECT[ng-g3/pre-submit-fields]
}

export const SpreadPreSubmit = z.object({
  ...ItemResultPostSubmit.shape, // EXPECT[ng-g3/pre-submit-fields]
  extra: z.string(),
});
