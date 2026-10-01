// ported-from: spikes/sp7-static-gates/fixture/violations/apps/web/src/leak.ts (audit-fixed: 그대로)
import { hello } from "@fathom/svc-a"; // EXPECT[boundary/cross-service-import]
export const H = hello();
