// catalog BC 읽기 포트 — itembank가 `import type`으로 쓴다(동기: SQLite 동기 API). 구현체(어댑터)는 소유 WP가 만든다.
import type { BundleRecord } from '@fathom/contracts/pack/records';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';

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

// ───────── PGM-CT-001·002 가산(T-01-07) — 위 읽기 포트는 바꾸지 않는다 ─────────

/** catalog 밖 BC가 수입하는 레코드 kind(IT-01). 구현 = itembank `application/itembank/ingest/**`(T-01-10), 등록 = content config(T-01-11). */
export type IngestKind = 'item' | 'item_model' | 'gate_result';
export type IngestContext = {
  readonly install_id: string;
  readonly pack_id: string;
  readonly pack_version: string;
  readonly loaded_at: number;
};
export interface PackIngestHandler {
  readonly kinds: readonly IngestKind[];
  /** job `pack-load` 자식의 배치 tx 안에서 동기 호출. records = 이 핸들러 kinds만, 번들 순서 그대로. 재호출 멱등. */
  ingest(db: SqlitePort, ctx: IngestContext, records: readonly BundleRecord[]): void;
  /** failed 설치 정리(tx 안). 그 설치의 멤버십 행만(내용 주소 ib_item 행은 남긴다). */
  purge(db: SqlitePort, installId: string): void;
  /** 부모 활성화 1 tx 안. BC 쪽 활성 포인터 사본(ib_active_install) 갱신. 예외 = 활성화 전체 롤백. */
  activate(
    db: SqlitePort,
    ctx: {
      readonly pack_id: string;
      readonly install_id: string;
      readonly previous_install_id: string | null;
      readonly switched_at: number;
    },
  ): void;
}
export interface IngestRegistry {
  readonly handlers: readonly PackIngestHandler[];
}
export const EMPTY_INGEST_REGISTRY: IngestRegistry = { handlers: [] };
