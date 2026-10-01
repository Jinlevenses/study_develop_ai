// ported-from: spikes/sp7-static-gates/fixture/violations/services/b/src/index.ts
import { z } from "zod";
import { ContentBody } from "@fathom/contracts";
import { ident } from "@fathom/shared-kernel";
import { readLocal } from "./consumer.ts";

export const Schema = z.object({ body: ContentBody });
export const TABLE = ident("b_events");
export { readLocal };
