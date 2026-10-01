// ported-from: spikes/sp7-static-gates/fixture/violations/services/a/src/cross.ts (audit-fixed: store.ts 대신 local.ts)
// Deliberate service-boundary violations (check:boundaries)
import { LOCAL } from "../../b/src/local.ts"; // EXPECT[boundary/cross-service-import]
import { TABLE } from "@fathom/svc-b"; // EXPECT[boundary/cross-service-import]
import { LOCAL as L2 } from "@fathom/svc-b/local.ts"; // EXPECT[boundary/cross-service-import]
import type { Concept } from "../../b/src/local.ts"; // EXPECT[boundary/cross-service-import]
export { LOCAL as REEXPORT } from "../../b/src/local.ts"; // EXPECT[boundary/cross-service-import]
import "../../b/src/local.ts"; // EXPECT[boundary/cross-service-import]

export async function lazy() {
  const m = await import("../../b/src/local.ts"); // EXPECT[boundary/cross-service-import]
  return [m.LOCAL, LOCAL, TABLE, L2];
}
export type X = Concept;

// legal: same-service relative + contracts + shared-kernel + node builtin
import { hello } from "./index.ts";
import { ItemResultPostSubmit } from "@fathom/contracts";
import { ident } from "@fathom/shared-kernel";
import { join } from "node:path";
export const OK = [hello, ItemResultPostSubmit, ident, join];
