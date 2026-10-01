export const IDEMPOTENCY_HEADER = 'idempotency-key';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const MAX_TIME = 2 ** 48;
const RANDOM_BYTES = 10;

export type RandomFill = (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;

function defaultRandom(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(bytes);
}

function encodeTime(ms: number): string {
  let rest = ms;
  let out = '';
  for (let i = 0; i < 10; i += 1) {
    out = (ALPHABET[rest % 32] ?? '0') + out;
    rest = Math.floor(rest / 32);
  }
  return out;
}

function assertTime(ms: number): void {
  if (!Number.isInteger(ms) || ms < 0 || ms >= MAX_TIME) {
    throw new RangeError(`시각이 ULID 범위(0 ≤ ms < 2^48 정수)를 벗어났습니다: ${String(ms)}`);
  }
}

/** 80비트 무작위부를 5비트씩 16개로 나눈다(상위 → 하위). */
function bytesToDigits(bytes: Uint8Array): number[] {
  let acc = 0n;
  for (const b of bytes) {
    acc = (acc << 8n) | BigInt(b);
  }
  const digits: number[] = [];
  for (let i = 0; i < 16; i += 1) {
    digits.unshift(Number(acc & 31n));
    acc >>= 5n;
  }
  return digits;
}

function incrementDigits(digits: number[]): boolean {
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    const d = digits[i] ?? 0;
    if (d < 31) {
      digits[i] = d + 1;
      return true;
    }
    digits[i] = 0;
  }
  return false;
}

function digitsToString(digits: readonly number[]): string {
  return digits.map((d) => ALPHABET[d] ?? '0').join('');
}

function freshDigits(random: RandomFill): number[] {
  return bytesToDigits(random(new Uint8Array(RANDOM_BYTES)));
}

/** 같은 ms 안에서 단조 증가하는 ULID 팩토리(무작위부 +1, 80비트 넘침 = throw). */
export function createUlidFactory(now: () => number, random: RandomFill = defaultRandom): () => string {
  let lastTime = -1;
  let lastDigits: number[] = [];
  return (): string => {
    const t = now();
    assertTime(t);
    if (t === lastTime) {
      if (!incrementDigits(lastDigits)) {
        throw new RangeError('같은 밀리초 안에서 ULID 무작위부가 넘쳤습니다');
      }
    } else {
      lastTime = t;
      lastDigits = freshDigits(random);
    }
    return encodeTime(t) + digitsToString(lastDigits);
  };
}

export function newUlid(now: () => number, random: RandomFill = defaultRandom): string {
  const t = now();
  assertTime(t);
  return encodeTime(t) + digitsToString(freshDigits(random));
}
