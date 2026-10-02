// CR-41 catalog 단조 버전 규칙(순수). 열이 없어 `ct_pack.ext."catalog.version"`에 둔다 — Brief T-01-07 §4.6-2.

/** 지금까지의 최댓값(없으면 null) → 이번 활성화에 부여할 버전. 첫 값 = 1. */
export function nextCatalogVersion(currentMax: number | null): number {
  const base = currentMax ?? 0;
  if (!Number.isSafeInteger(base) || base < 0) {
    throw new Error('invariant: catalog version must be a non-negative safe integer');
  }
  return base + 1;
}

/** 개념의 `catalog.version`: 이번에 바뀐 개념 = 새 버전, 안 바뀐 개념 = 이전 활성 설치의 값을 그대로 이어받는다. */
export function conceptCatalogVersion(changed: boolean, catalogVersion: number, carried: number | null): number {
  if (changed || carried === null) {
    return catalogVersion;
  }
  return carried;
}
