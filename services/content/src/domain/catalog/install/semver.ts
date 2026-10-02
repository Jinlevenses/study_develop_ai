// SemVer 2.0 우선순위 비교(순수). 입력은 경계에서 zod `SemVer`로 이미 검증됐다 — 모양이 어긋나면 결함(invariant).
// 빌드 메타데이터(`+`)는 계약 정규식이 받지 않으므로 다루지 않는다.

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
const NUMERIC_RE = /^\d+$/;

type Parsed = { readonly core: readonly [number, number, number]; readonly pre: readonly string[] };

function parse(version: string): Parsed {
  const m = SEMVER_RE.exec(version);
  if (m === null) {
    throw new Error('invariant: semver malformed');
  }
  return {
    core: [Number(m[1]), Number(m[2]), Number(m[3])],
    pre: m[4] === undefined ? [] : m[4].split('.'),
  };
}

function compareNumbers(a: number, b: number): -1 | 0 | 1 {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

function comparePreIdentifier(a: string, b: string): -1 | 0 | 1 {
  const aNum = NUMERIC_RE.test(a);
  const bNum = NUMERIC_RE.test(b);
  if (aNum && bNum) {
    return compareNumbers(Number(a), Number(b));
  }
  if (aNum !== bNum) {
    return aNum ? -1 : 1; // 숫자 식별자 < 영숫자 식별자
  }
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1; // ASCII 사전순
}

/** a < b → -1 · a = b → 0 · a > b → 1. 사전 릴리스는 같은 core의 릴리스보다 작다. */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i += 1) {
    const c = compareNumbers(pa.core[i] ?? 0, pb.core[i] ?? 0);
    if (c !== 0) {
      return c;
    }
  }
  if (pa.pre.length === 0 && pb.pre.length === 0) {
    return 0;
  }
  if (pa.pre.length === 0) {
    return 1;
  }
  if (pb.pre.length === 0) {
    return -1;
  }
  const n = Math.min(pa.pre.length, pb.pre.length);
  for (let i = 0; i < n; i += 1) {
    const c = comparePreIdentifier(pa.pre[i] ?? '', pb.pre[i] ?? '');
    if (c !== 0) {
      return c;
    }
  }
  return compareNumbers(pa.pre.length, pb.pre.length); // 앞부분이 같으면 필드가 더 많은 쪽이 크다
}
