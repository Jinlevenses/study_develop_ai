// ported-from: spikes/sp7-static-gates/fixture/violations/packages/contracts/src/content.ts (audit-fixed: 규칙 ID DS-01 §13)
import { z } from "zod";

export const ContentBodyKind = z.enum(["text", "code", "video", "run_widget"]); // EXPECT[ng-g6/video]
export const ContentBody = z.object({
  kind: ContentBodyKind,
  video_url: z.string().optional(), // EXPECT[ng-g6/video]
  value: z.string(),
});
