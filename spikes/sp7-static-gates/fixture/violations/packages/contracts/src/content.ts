import { z } from "zod";

export const ContentBodyKind = z.enum(["text", "code", "video", "run_widget"]); // EXPECT[ng-g6/video]
export const ContentBody = z.object({
  kind: ContentBodyKind,
  video_url: z.string().optional(), // EXPECT[ng-g6/video]
  value: z.string(),
});
