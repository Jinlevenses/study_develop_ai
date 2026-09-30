import { jev } from "@typesafe-ai/sdk";
export async function ask(candidates: string[]) {
  return [await jev({ pick: candidates[3] })]; // EXPECT[jev/index-literal]
}
