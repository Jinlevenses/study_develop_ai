// ported-from: spikes/sp7-static-gates/fixture/violations/services/b/src/index.ts (audit-fixed: zod 제거)
import { ContentBody } from "@fathom/contracts";
import { ident } from "@fathom/shared-kernel";
import { LOCAL } from "./local.ts";

export const TABLE = ident("b_events");
export const BODY = ContentBody;
export { LOCAL };
