/** 고정 시작 시각: 2026-09-21T14:13:20.000Z (epoch ms). */
export const FIXED_EPOCH_MS = 1_790_000_000_000;

/** IF-EXT-16 `Clock`(`now(): EpochMs` + `monotonic(): bigint`)과 구조 호환인 테스트용 가짜 시계. */
export type FakeClock = {
  /** 현재 벽시계 epoch ms(정수). */
  now(): number;
  /** 단조 시계(ns). 시작 0n, `advance`로만 증가한다. */
  monotonic(): bigint;
  /** 벽시계와 단조 시계를 함께 진행한다. ms는 0 이상 safe integer, 아니면 RangeError. */
  advance(ms: number): void;
  /** 벽시계만 임의 값으로 되돌리거나 건너뛴다(시계 역행 시뮬레이션). safe integer 아니면 RangeError. */
  set(epochMs: number): void;
};

const NS_PER_MS = 1_000_000n;

function assertSafeInteger(value: number, what: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${what} must be a safe integer: ${String(value)}`);
  }
}

/** 고정·진행형 가짜 시계를 만든다. 실제 시간 원천(`Date.now()` 등)을 쓰지 않는다(STD-TST-03). */
export function createFakeClock(startMs: number = FIXED_EPOCH_MS): FakeClock {
  assertSafeInteger(startMs, 'startMs');
  let wallMs = startMs;
  let monotonicNs = 0n;
  return {
    now(): number {
      return wallMs;
    },
    monotonic(): bigint {
      return monotonicNs;
    },
    advance(ms: number): void {
      assertSafeInteger(ms, 'ms');
      if (ms < 0) {
        throw new RangeError(`ms must be >= 0: ${String(ms)}`);
      }
      wallMs += ms;
      monotonicNs += BigInt(ms) * NS_PER_MS;
    },
    set(epochMs: number): void {
      assertSafeInteger(epochMs, 'epochMs');
      wallMs = epochMs;
    },
  };
}
