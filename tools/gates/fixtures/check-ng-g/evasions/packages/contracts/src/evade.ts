// ported-from: spikes/sp7-static-gates/fixture/evasions/packages/contracts/src/evade.ts
import { z } from "zod";
import { ItemViewPreSubmitResponse } from "./pre-submit/item-view.ts";

export const Widened = ItemViewPreSubmitResponse.extend({ answer_key: z.string() }); // EVADES[ng-g3/pre-submit-fields] widened after declaration
export const Computed = z.object({ ["answer" + "_key"]: z.string() }); // EVADES[ng-g3/pre-submit-fields] computed key (name is not PreSubmit)
