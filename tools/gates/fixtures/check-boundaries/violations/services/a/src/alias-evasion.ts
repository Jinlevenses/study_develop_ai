// ported-from: spikes/sp7-static-gates/fixture/violations/services/a/src/alias-evasion.ts (audit-fixed: 그대로(tsgo 대조군))
// Alias that does NOT follow the @fathom/svc-* naming convention: only module RESOLUTION can see it.
import { TABLE } from "@legacy/b"; // EXPECT[boundary/cross-service-import]
export const T = TABLE;
