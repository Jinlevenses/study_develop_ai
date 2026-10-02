import { ConceptId } from '@fathom/contracts/common/ids';

// IF-CT-005 트랙 개념 커서(순수) — `${level}-${concept_id에서 '.'→'_'}`. 개념 ID에는 `_`가 없어 왕복 가역이고 Cursor 정규식(`[A-Za-z0-9_-]`)을 통과한다.

export type ConceptCursor = { readonly level: number; readonly concept_id: string };

export function encodeConceptCursor(c: ConceptCursor): string {
  return `${c.level}-${c.concept_id.replaceAll('.', '_')}`;
}

/** 무효(모양·레벨 범위·개념 ID 문법 위반)면 null. */
export function decodeConceptCursor(raw: string): ConceptCursor | null {
  const m = /^([1-5])-([A-Za-z0-9_-]+)$/.exec(raw);
  if (m === null) {
    return null;
  }
  const id = ConceptId.safeParse((m[2] ?? '').replaceAll('_', '.'));
  if (!id.success) {
    return null;
  }
  return { level: Number(m[1]), concept_id: id.data };
}
