// ported-from: spikes/sp7-static-gates/fixture/clean/services/a/src/index.ts
import type { ItemViewPreSubmitResponse } from "@fathom/contracts";
import { ident } from "@fathom/shared-kernel";
import { openStore } from "./store.ts";

// Mentioning other services in comments/strings is fine:
//   import { x } from "@fathom/svc-b";
//   import y from "../../b/src/consumer.ts";
export const NOTE = "docs say: import { x } from '@fathom/svc-b' is forbidden";
export const NOTE2 = `also: require("../../b/src/db.ts")`;

export function present(view: ItemViewPreSubmitResponse): string {
  return `${view.item_id}:${ident("cards")}`;
}
export { openStore };
