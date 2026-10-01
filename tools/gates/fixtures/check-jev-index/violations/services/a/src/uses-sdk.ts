// ported-from: spikes/sp7-static-gates/fixture/violations/services/a/src/uses-sdk.ts (audit-fixed: fixture 규약)
import { jev } from "@typesafe-ai/sdk";
export async function ask(candidates: string[]) {
  return [await jev({ pick: candidates[3] })]; // EXPECT[jev/index-literal]
}
