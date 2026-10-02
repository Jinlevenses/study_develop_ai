// 이진 merkle(Brief T-01-03 §4.8-3, IF-01 §13.1 "정렬된 bundle 레코드 해시들의 이진 merkle"):
// leaf = sha256(줄의 UTF-8 바이트, \n 제외) → leaf 바이트 오름차순 정렬 → 레벨마다 인접 쌍 sha256(0x01 ‖ L ‖ R), 홀수 마지막 노드는 그대로 올림.
import { createHash } from 'node:crypto';

function sha256(...parts: readonly Uint8Array[]): Buffer {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(p);
  }
  return h.digest();
}

export function merkleRoot(lines: readonly string[]): string {
  if (lines.length === 0) {
    return sha256(Buffer.alloc(0)).toString('hex');
  }
  let level: Buffer[] = lines.map((l) => sha256(Buffer.from(l, 'utf8'))).sort((a, b) => Buffer.compare(a, b));
  const prefix = Buffer.from([0x01]);
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1];
      if (left === undefined) {
        continue;
      }
      next.push(right === undefined ? left : sha256(prefix, left, right));
    }
    level = next;
  }
  return (level[0] ?? Buffer.alloc(0)).toString('hex');
}
