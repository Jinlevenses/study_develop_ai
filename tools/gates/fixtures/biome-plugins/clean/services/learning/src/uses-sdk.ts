// ported-from: spikes/sp7-static-gates/fixture/clean/services/a/src/uses-sdk.ts
import { jev } from "@typesafe-ai/sdk";
export async function ask(argv: string[], options: Record<string, string>) {
  return [await jev({ key: options.opt_a }), argv[2]];
}
