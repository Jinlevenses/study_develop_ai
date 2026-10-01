// catalog BC 읽기 포트 — itembank가 `import type`으로 쓴다(동기: SQLite 동기 API). 구현체(어댑터)는 소유 WP가 만든다.

export type ActiveInstall = {
  readonly packId: string;
  readonly installId: string;
  readonly version: string;
  readonly trackId: string | null;
};
export type ConceptForItems = {
  readonly conceptId: string;
  readonly installId: string;
  readonly kuIds: readonly string[];
  readonly misconceptionIds: readonly string[];
};
export interface CatalogReader {
  activeInstalls(): readonly ActiveInstall[];
  conceptForItems(conceptId: string): ConceptForItems | null;
}
