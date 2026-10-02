import { createHash } from 'node:crypto';

// IF-01 §13.1 · T-01-03 Brief §4.8-3 — 정렬된 bundle 줄 해시의 이진 merkle.
// leaf = sha256(줄 바이트, `\n` 제외) 32바이트 → leaf 바이트 오름차순 → 레벨마다 인접 쌍 sha256(0x01 ‖ L ‖ R), 홀수 마지막은 그대로 올림.

const NODE_PREFIX = Buffer.from([0x01]);

function sha256(...parts: readonly Uint8Array[]): Buffer {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(p);
  }
  return h.digest();
}

/** `lines` = 줄 바이트(또는 UTF-8 문자열), `\n`은 포함하지 않는다. 입력 순서와 무관. 0줄 = sha256('')(발생하지 않는 경계). */
export function merkleRoot(lines: readonly (string | Uint8Array)[]): string {
  if (lines.length === 0) {
    return sha256().toString('hex');
  }
  let level = lines.map((l) => sha256(typeof l === 'string' ? Buffer.from(l, 'utf8') : l));
  level.sort((a, b) => Buffer.compare(a, b));
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1];
      if (left === undefined) {
        break;
      }
      next.push(right === undefined ? left : sha256(NODE_PREFIX, left, right));
    }
    level = next;
  }
  return (level[0] ?? sha256()).toString('hex');
}
