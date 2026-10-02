import type { LedgerEventEnvelope } from '@fathom/contracts/ledger/envelope';
import type { ServiceDeps } from '@fathom/shared-kernel/service/service';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import type { CardRow, ConceptRow, ProjectorParams } from '../../domain/learner-model/projector/types.js';

export type LearnerModelPorts = { readonly db: SqlitePort };
export type LearnerModelDeps = ServiceDeps<null> & { readonly infra: LearnerModelPorts };

/** 리플레이 리더 — 구현 = T-01-02 `infra/ledger/replay-source.ts`(createLedgerReplayReader). T-01-02 §4.1 LedgerReplayReader와 구조 동일.
 *  모든 메서드는 최신 schema_version으로 upcast + LEDGER_PAYLOADS 검증된 envelope를 낸다. db = 호출자 연결(읽기 전용 가능). */
export interface LedgerReplaySource {
  replay(db: SqlitePort): IterableIterator<LedgerEventEnvelope>; // ORDER BY client_ts, device_id, device_seq
  byCard(db: SqlitePort, cardId: string): IterableIterator<LedgerEventEnvelope>; // 같은 총순서
  byConcept(db: SqlitePort, conceptId: string): IterableIterator<LedgerEventEnvelope>;
  corrections(db: SqlitePort): IterableIterator<LedgerEventEnvelope>; // evidence.voided · evidence.weight_adjusted
  maxRowid(db: SqlitePort): number; // 빈 원장 0
  sinceRowid(db: SqlitePort, after: number): IterableIterator<LedgerEventEnvelope>; // rowid 순(캐치업 전용)
}

/** 원장 append와 같은 BEGIN IMMEDIATE tx 안에서 동기 호출. T-01-02 §4.1 ProjectionApplier와 구조 동일(ledger 코드 import 0).
 *  Promise 반환 금지. 예외(ts-fsrs FSRSValidationError 포함)는 감싸지 말고 그대로 던진다 — 경보·롤백은 writer 몫. */
export interface ProjectionApplier {
  apply(db: SqlitePort, event: LedgerEventEnvelope): void;
}

/** policy_version('ps_<16hex>') → 불변 파라미터 세트. 실패 = ProjectionParamsError throw. */
export interface ProjectorParamsResolver {
  resolve(db: SqlitePort, policyVersion: string): ProjectorParams;
  /** policy.switched를 볼 때마다 호출(라이브·리플레이 공통). 같은 ps 재등록 = no-op, 다른 members = invariant throw. */
  register(
    policyVersion: string,
    members: Readonly<Record<string, { readonly version: string; readonly sha256: string }>>,
  ): void;
}

/** 투영 저장소(테이블 = 라이브 또는 shadow). 구현 = infra/db/learner-model-store.ts(DB) · test 메모리 구현. */
export interface ProjectionStore {
  getCard(cardId: string): CardRow | null;
  putCard(row: CardRow): void;
  getConcept(conceptId: string): ConceptRow | null;
  putConcept(row: ConceptRow): void;
}

/** 정정 대상 event_id → 그 이벤트의 card_id·concept_id(lr_event STORED 열). 구현 = infra/db(SQL) · test 메모리. */
export interface EventTargetLookup {
  keysOf(
    db: SqlitePort,
    eventIds: readonly string[],
  ): { readonly card_ids: readonly string[]; readonly concept_ids: readonly string[] };
}
