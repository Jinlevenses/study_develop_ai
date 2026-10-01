// ported-from: spikes/sp7-static-gates/fixture/clean/packages/contracts/src/content.ts (audit-fixed: 규칙 ID DS-01 §13)
import { z } from "zod";

// NG-G6: text + code + run widgets only. No video body type.
export const ContentBodyKind = z.enum(["text", "code", "run_widget", "diagram"]);
export const ContentBody = z.object({ kind: ContentBodyKind, value: z.string() });
