const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_PART = '01J0000000'; // 고정 시간 성분(10자, 유효 ULID 시간 범위)
const RANDOM_LEN = 16;
const LIMIT = 2 ** 40;

/** 고정 시간 성분 + n을 Crockford base32로 인코딩한 무작위 성분. n이 커지면 사전순으로 커진다(0 ≤ n < 2^40). */
export function fixedUlid(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0 || n >= LIMIT) {
    throw new RangeError(`fixedUlid n out of range [0, 2^40): ${String(n)}`);
  }
  let rest = n;
  let encoded = '';
  while (rest > 0) {
    encoded = `${CROCKFORD.charAt(rest % 32)}${encoded}`;
    rest = Math.floor(rest / 32);
  }
  return `${TIME_PART}${encoded.padStart(RANDOM_LEN, '0')}`;
}

/** `start`부터 1씩 증가하는 고정 ULID 생성기(테스트 결정성용). */
export function createUlidSequence(start = 0): () => string {
  let next = start;
  return (): string => {
    const id = fixedUlid(next);
    next += 1;
    return id;
  };
}
