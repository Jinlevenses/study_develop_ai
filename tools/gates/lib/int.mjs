// INT 식별자 순서·상한 계산(WBS INT 대역). tools/si-docs는 이 파일을 import하지 않는다(자체 구현).
export const INT_ORDER = ['INT-1a', 'INT-1b', 'INT-2', 'INT-3', 'INT-4', 'INT-5', 'INT-6', 'INT-7', 'PG-3'];

export function isIntId(s) {
  return typeof s === 'string' && INT_ORDER.includes(s);
}

/** 순서 비교: -1 | 0 | 1. 인식 불가 값은 던진다(조용한 오판 방지). */
export function compareInt(a, b) {
  const ia = INT_ORDER.indexOf(a);
  const ib = INT_ORDER.indexOf(b);
  if (ia < 0 || ib < 0) {
    throw new RangeError(`unknown INT id: ${ia < 0 ? a : b}`);
  }
  return ia < ib ? -1 : ia > ib ? 1 : 0;
}

const RANGE_RE = /(INT-(?:1a|1b|[2-7])|PG-3)\s*[~∼]\s*(?:INT-)?(1a|1b|[2-7]|PG-3)/;
const SINGLE_RE = /INT-(?:1a|1b|[2-7])|PG-3/g;

/** 텍스트에 담긴 INT(범위면 상한). 인식 불가 → null. 예: 'INT-2~3' → 'INT-3'. */
export function intUpper(text) {
  const s = String(text ?? '');
  const range = RANGE_RE.exec(s);
  if (range) {
    const hi = range[2].startsWith('PG') ? range[2] : `INT-${range[2]}`;
    return isIntId(hi) ? hi : null;
  }
  let best = null;
  for (const m of s.matchAll(SINGLE_RE)) {
    if (best === null || compareInt(m[0], best) > 0) {
      best = m[0];
    }
  }
  return best;
}
