import { z } from "zod";
import { ItemViewPreSubmitResponse } from "./pre-submit/item-view.ts";

export const Widened = ItemViewPreSubmitResponse.extend({ answer_key: z.string() }); // EVADES[ng-g3/presubmit-field] widened after declaration
export const Computed = z.object({ ["answer" + "_key"]: z.string() }); // EVADES[ng-g3/presubmit-field] computed key (name is not PreSubmit)
