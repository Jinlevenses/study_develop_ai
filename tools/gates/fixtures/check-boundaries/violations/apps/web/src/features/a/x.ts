// fixture authored for T-00-05 (no spike counterpart): web-feature-cross: feature a → feature b
import { y } from "../b/y.ts"; // EXPECT[boundary/web-feature-cross]

export const x = y;
