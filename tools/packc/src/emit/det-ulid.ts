// 결정적 ULID(Brief T-01-03 §4.8-8): 26자 Crockford base32 = 48비트 시간(V7 배치 created_at UTC 00:00 epoch ms)
// + 80비트(sha256Hex('<batch_id>|<item_id>|<content_hash>')의 앞 10바이트). 시계·난수 0.
import { sha256Hex } from '@fathom/shared-kernel/canonical/canonical';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** `YYYY-MM-DD`의 UTC 00:00 epoch ms. */
export function dayToEpochMs(day: string): number {
  const [y, m, d] = day.split('-').map((x) => Number.parseInt(x, 10));
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function detUlid(timeMs: number, seed: string): string {
  const tail = BigInt(`0x${sha256Hex(seed).slice(0, 20)}`);
  let value = (BigInt(timeMs) << 80n) | tail;
  let out = '';
  for (let i = 0; i < 26; i += 1) {
    out = `${ALPHABET[Number(value & 31n)] ?? '0'}${out}`;
    value >>= 5n;
  }
  return out;
}
