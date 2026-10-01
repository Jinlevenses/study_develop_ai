/** mulberry32 시드 PRNG(STD-TS-21, TST-01 §3.2). seed는 정수여야 하며 내부 상태는 `seed >>> 0`이다. 반환값은 [0, 1). */
export function mulberry32(seed: number): () => number {
  if (!Number.isInteger(seed)) {
    throw new RangeError(`seed must be an integer: ${String(seed)}`);
  }
  let a = seed >>> 0;
  return (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 시드 PRNG 도우미. `next`는 화살표 함수라 분리해 rng 포트로 넘겨도 동작한다. */
export type Prng = {
  /** [0, 1) 난수. */
  readonly next: () => number;
  /** min..max(양끝 포함) 정수. 정수가 아니거나 min > max면 RangeError. */
  int(minInclusive: number, maxInclusive: number): number;
  /** 배열에서 하나를 고른다. 빈 배열이면 RangeError. */
  pick<T>(items: readonly T[]): T;
  /** Fisher–Yates 셔플 복사본. 입력은 변하지 않는다. */
  shuffle<T>(items: readonly T[]): T[];
};

/** index 위치의 요소. `items[index]`의 `| undefined`(noUncheckedIndexedAccess)를 타입 단언 없이 다루려고 1칸 slice를 순회하며, 범위 밖이면 RangeError(STD-TS-12). */
function at<T>(items: readonly T[], index: number): T {
  for (const value of items.slice(index, index + 1)) {
    return value;
  }
  throw new RangeError(`index out of range: ${String(index)}`);
}

/** 시드로 {@link Prng}를 만든다. */
export function createPrng(seed: number): Prng {
  const next = mulberry32(seed);
  const int = (minInclusive: number, maxInclusive: number): number => {
    if (!Number.isInteger(minInclusive) || !Number.isInteger(maxInclusive)) {
      throw new RangeError(`int bounds must be integers: ${String(minInclusive)}, ${String(maxInclusive)}`);
    }
    if (minInclusive > maxInclusive) {
      throw new RangeError(`min must be <= max: ${String(minInclusive)} > ${String(maxInclusive)}`);
    }
    return minInclusive + Math.floor(next() * (maxInclusive - minInclusive + 1));
  };
  return {
    next,
    int,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) {
        throw new RangeError('pick: items must not be empty');
      }
      return at(items, int(0, items.length - 1));
    },
    shuffle<T>(items: readonly T[]): T[] {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(0, i);
        const a = at(out, i);
        out[i] = at(out, j);
        out[j] = a;
      }
      return out;
    },
  };
}
