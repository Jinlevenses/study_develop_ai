// PGM-CT-001·004 개념·KU 차분(순수) — Brief T-01-07 §4.6-3. 해시는 호출자가 계산해 값으로 넘긴다.

export type ConceptChange = 'published' | 'revised' | 'deprecated' | 'tier_promoted';
export type ConceptDigest = {
  readonly concept_id: string;
  readonly content_hash: string;
  readonly tier: 'A' | 'B' | 'C';
  readonly deprecated_by: string | null;
};
export type ConceptDiffEntry = { readonly concept_id: string; readonly change: ConceptChange };

const TIER_RANK = { C: 0, B: 1, A: 2 } as const;

/**
 * prev 없음·prev에 없던 개념 = published · hash 같음 = 변경 없음(목록에 없음) ·
 * hash 다름 + deprecated_by가 새로 non-null = deprecated · tier가 C→B→A로 오름 = tier_promoted · 그 밖 = revised.
 * 결과는 concept_id 오름차순(코드 단위).
 */
export function diffConcepts(
  prev: readonly ConceptDigest[] | null,
  next: readonly ConceptDigest[],
): readonly ConceptDiffEntry[] {
  const before = new Map<string, ConceptDigest>();
  for (const c of prev ?? []) {
    before.set(c.concept_id, c);
  }
  const out: ConceptDiffEntry[] = [];
  for (const c of next) {
    const old = before.get(c.concept_id);
    if (old === undefined) {
      out.push({ concept_id: c.concept_id, change: 'published' });
    } else if (old.content_hash !== c.content_hash) {
      if (old.deprecated_by === null && c.deprecated_by !== null) {
        out.push({ concept_id: c.concept_id, change: 'deprecated' });
      } else if (TIER_RANK[c.tier] > TIER_RANK[old.tier]) {
        out.push({ concept_id: c.concept_id, change: 'tier_promoted' });
      } else {
        out.push({ concept_id: c.concept_id, change: 'revised' });
      }
    }
  }
  return out.sort((a, b) => compareCodeUnits(a.concept_id, b.concept_id));
}

/** 새 KU 또는 hash가 다른 KU의 ID(정렬). prev가 null이면 전부. */
export function diffKus(
  prev: ReadonlyMap<string, string> | null,
  next: ReadonlyMap<string, string>,
): readonly string[] {
  const out: string[] = [];
  for (const [id, hash] of next) {
    if (prev === null || prev.get(id) !== hash) {
      out.push(id);
    }
  }
  return out.sort(compareCodeUnits);
}

export function compareCodeUnits(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}
