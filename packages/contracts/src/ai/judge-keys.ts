import { ObjKey } from '../common/ids.js';

// prefix 'kp'·'mc'·'opt' → 키 '<prefix>01'…(ObjKey 정규식 충족), keymap = 키 → 원 ID
// [Brief 결정 D3] 순수 구현 — 너비 w = max(2, 자릿수(items.length)), 키 = prefix + 1부터 0 채움(입력 순서).
export function keyedFromList<T>(
  prefix: string,
  items: readonly T[],
  idOf: (item: T) => string,
): { map: Record<string, T>; keymap: Record<string, string> } {
  if (!ObjKey.safeParse(`${prefix}01`).success) {
    throw new RangeError('keyedFromList: invalid prefix');
  }
  const width = Math.max(2, String(items.length).length);
  const map: Record<string, T> = {};
  const keymap: Record<string, string> = {};
  const seenIds = new Set<string>();
  items.forEach((item, i) => {
    const key = prefix + String(i + 1).padStart(width, '0');
    if (!ObjKey.safeParse(key).success) {
      throw new RangeError('keyedFromList: invalid prefix');
    }
    const id = idOf(item);
    if (seenIds.has(id)) {
      throw new RangeError('keyedFromList: duplicate id');
    }
    seenIds.add(id);
    map[key] = item;
    keymap[key] = id;
  });
  return { map, keymap };
}
