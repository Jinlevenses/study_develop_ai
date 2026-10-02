import type { GamingParamsV1 } from '@fathom/contracts/policy/gaming_params';

// FR-QST-025 · ARC-01 §11.4 — 증거 가중치 w와 빠른 응답(rapid) 판정. 순수.

export type WeightFields = {
  readonly w_format: number;
  readonly w_grader: number;
  readonly gaming_factor: number;
  readonly rapid: boolean;
};

/** t_min = max(floor_ms, base_ms + 글자 수 ÷ chars_per_s × 1000). */
export function tMinMs(
  format: keyof GamingParamsV1['t_min_ms_by_format'],
  promptChars: number,
  gaming: GamingParamsV1,
): number {
  const t = gaming.t_min_ms_by_format[format];
  return Math.max(t.floor_ms, t.base_ms + (promptChars / t.chars_per_s) * 1000);
}

/** 빠른 응답: latency < t_min. */
export function isRapid(latencyMs: number, tMin: number): boolean {
  return latencyMs < tMin;
}

/** w = rapid ? 0 : w_format × w_grader × gaming_factor (rapid는 정오 무관 w 0, DEC-CNV-33). */
export function evidenceWeight(f: WeightFields): number {
  return f.rapid ? 0 : f.w_format * f.w_grader * f.gaming_factor;
}
