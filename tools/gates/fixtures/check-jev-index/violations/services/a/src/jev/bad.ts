// ported-from: spikes/sp7-static-gates/fixture/violations/services/a/src/jev/bad.ts (audit-fixed: fixture 규약)
import { judge } from "@fathom/shared-kernel";

export const INSTR_1 = "Compare item 2 with item 3 and say which is better."; // EXPECT[jev/index-string]
export const INSTR_2 = "항목 2번을 평가하고 선택지 3과 비교하세요"; // EXPECT[jev/index-string]
export const INSTR_3 = "candidates[3] is the best answer"; // EXPECT[jev/index-string]
export const INSTR_4 = "Explain why the second candidate is wrong"; // EXPECT[jev/index-string]
export const INSTR_5 = `Judge Option 1 first`; // EXPECT[jev/index-string]
export const INSTR_6 = "3번째 보기가 정답인가?"; // EXPECT[jev/index-string]

export function build(candidates: string[], options: string[]) {
  const lines = candidates.map((c, i) => `${i + 1}. ${c}`); // EXPECT[jev/index-interp]
  const numbered = options.map((o, idx) => `[${idx}] ${o}`); // EXPECT[jev/index-interp]
  return [lines, numbered];
}

export async function pickFirst(candidates: string[], options: string[], units: string[]) {
  const a = candidates[3]; // EXPECT[jev/index-literal]
  const b = options[0]; // EXPECT[jev/index-literal]
  const c = units[1]; // EXPECT[jev/index-literal]
  const d = options.at(0); // EXPECT[jev/index-literal]
  const out = await judge({ instruction: "x", units: {} });
  for (let i = 0; i < units.length; i++) void units[i]; // WARN[jev/index-var] (경고 — selftest 기대 집합은 error만 비교)
  return [a, b, c, d, out];
}

export function fromResponse(res: { items: string[]; selectedIndex: number }) { // EXPECT[jev/index-field]
  return res.items[2]; // EXPECT[jev/index-literal]
}

export const RESPONSE_FORMAT = {
  best_index: 0, // EXPECT[jev/index-field]
  selectedIndex: 1, // EXPECT[jev/index-field]
};
