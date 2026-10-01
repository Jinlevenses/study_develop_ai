// jev-ok: 마이그레이션 중인 레거시 목록 — 사유가 있으면 면제
export const LEGACY = 'Compare item 2 with item 3'; // jev-ok: 레거시 문구, IT-02에서 제거
export function pick(candidates: string[]) {
  // jev-ok: 정렬이 보장된 내부 배열
  return candidates[0];
}
