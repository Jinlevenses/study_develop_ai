import type { GamingParamsV1 } from '@fathom/contracts/policy/gaming_params';

// FR-PRG-007 · FR-QST-025 — attempt.graded.rating(확정 grade) 계산 헬퍼. T-01-09(practice)가 payload 생성에 쓴다. 순수.

export type RatingInput = {
  readonly result: 'correct' | 'partial' | 'incorrect' | 'pending';
  readonly pending: boolean;
  readonly recommended_grade: number;
  readonly response_mode: 'recognition' | 'production';
  readonly rapid: boolean;
  readonly hints_used: number;
};

function toRating(n: number): 1 | 2 | 3 | 4 {
  if (n >= 4) {
    return 4;
  }
  if (n >= 3) {
    return 3;
  }
  if (n >= 2) {
    return 2;
  }
  return 1;
}

/** pending → null · recognition → ≤ Good(3) · rapid → ≤ grade_cap · 힌트 2 이상 → ≤ 2, 1 → ≤ 3. */
export function fsrsRating(input: RatingInput, gaming: GamingParamsV1): 1 | 2 | 3 | 4 | null {
  if (input.pending || input.result === 'pending') {
    return null;
  }
  let r = input.recommended_grade;
  if (input.response_mode === 'recognition') {
    r = Math.min(r, 3);
  }
  if (input.rapid) {
    r = Math.min(r, gaming.rapid.grade_cap);
  }
  if (input.hints_used >= 2) {
    r = Math.min(r, 2);
  } else if (input.hints_used === 1) {
    r = Math.min(r, 3);
  }
  return toRating(r);
}
