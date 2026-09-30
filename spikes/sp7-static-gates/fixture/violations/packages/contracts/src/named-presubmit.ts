import { z } from "zod";
import { ItemResultPostSubmit } from "./post-submit/item-result.ts";

// Schema is identified by NAME (contains "PreSubmit") although the file is elsewhere.
export const QuestionPreSubmitView = z.object({
  id: z.string(),
  is_correct: z.boolean(), // EXPECT[ng-g3/presubmit-field]
});

export interface NotePreSubmitDto {
  text: string;
  exemplar_note?: string; // EXPECT[ng-g3/presubmit-field]
}

export const SpreadPreSubmit = z.object({
  ...ItemResultPostSubmit.shape, // EXPECT[ng-g3/presubmit-spread]
  extra: z.string(),
});
