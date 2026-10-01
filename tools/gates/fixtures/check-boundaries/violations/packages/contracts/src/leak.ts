// ported-from: spikes/sp7-static-gates/fixture/violations/packages/contracts/src/leak.ts (audit-fixed: 그대로)
import { hello } from "../../../services/a/src/index.ts"; // EXPECT[boundary/cross-service-import]
export const LEAK = hello;
