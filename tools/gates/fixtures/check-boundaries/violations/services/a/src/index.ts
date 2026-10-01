// ported-from: spikes/sp7-static-gates/fixture/clean/services/a/src/index.ts (audit-fixed: 경계 관련 줄만)
import type { ItemViewPreSubmitResponse } from "@fathom/contracts";
import { ident } from "@fathom/shared-kernel";
import { LOCAL } from "./local.ts";

// Mentioning other services in comments/strings is fine:
//   import { x } from "@fathom/svc-b";
//   import y from "../../b/src/consumer.ts";
export const NOTE = "docs say: import { x } from '@fathom/svc-b' is forbidden";
export const NOTE2 = `also: require("../../b/src/db.ts")`;

export function hello(): string {
  return "a";
}
export function present(view: ItemViewPreSubmitResponse): string {
  return `${view.item_id}:${ident("cards")}:${LOCAL}`;
}
