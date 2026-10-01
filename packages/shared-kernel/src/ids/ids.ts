import { monotonicFactory } from 'ulidx';
import type { Clock } from '../time/time.js';

// process-wide monotonic ULID — STD-TS-16 예외: ID 생성기
const monotonicUlid = monotonicFactory();

/** 대문자 26자 ULID. 같은 ms 안에서도 단조 증가한다. */
export function ulid(): string {
  return monotonicUlid();
}

/** 주입 시계로 시간 성분을 정하는 단조 생성기(테스트·리플레이용). */
export function createUlid(clock: Clock): () => string {
  const factory = monotonicFactory();
  return (): string => factory(clock.now());
}

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isUlid(s: unknown): s is string {
  return typeof s === 'string' && ULID_PATTERN.test(s);
}
