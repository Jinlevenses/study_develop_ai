// Alias that does NOT follow the @fathom/svc-* naming convention: only module RESOLUTION can see it.
import { TABLE } from "@legacy/b"; // EXPECT[boundary/cross-service-import]
export const T = TABLE;
