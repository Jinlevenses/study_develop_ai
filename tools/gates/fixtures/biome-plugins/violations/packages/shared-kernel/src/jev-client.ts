// ported-from: spikes/sp7-static-gates/fixture/violations/packages/shared-kernel/src/jev-client.ts
export interface JudgeInput { instruction: string; units: Record<string, string> }
export interface JudgeOutput { units: Record<string, "complete" | "partial" | "missing"> }
export async function judge(input: JudgeInput): Promise<JudgeOutput> {
  const units: JudgeOutput["units"] = {};
  for (const key of Object.keys(input.units)) units[key] = "partial";
  return { units };
}
