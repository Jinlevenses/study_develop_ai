import { jev } from "@typesafe-ai/sdk";
export async function ask(argv: string[], options: Record<string, string>) {
  return [await jev({ key: options.opt_a }), argv[2]];
}
