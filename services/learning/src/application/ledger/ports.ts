import type { Verdict } from '@fathom/contracts/events/catalog/grading';
import type { LedgerEventEnvelope, LedgerEventType } from '@fathom/contracts/ledger/envelope';
import type { Result } from '@fathom/shared-kernel/errors/errors';
import type { ServiceDeps } from '@fathom/shared-kernel/service/service';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import type { StudyDayContext as DomainStudyDayContext } from '../../domain/ledger/time/study-day.js';

export type LedgerPorts = { readonly db: SqlitePort };
export type LedgerDeps = ServiceDeps<null> & { readonly infra: LedgerPorts };

// ───────── T-01-02 §4.1 포트 정본(PLAN R-05) — 위 두 타입은 그대로, 아래는 추가 export ─────────

/** 원장 append와 같은 BEGIN IMMEDIATE tx 안에서 동기 호출되는 투영 증분. 구현 = T-01-06 `infra/projection/applier.ts`, 결선 = T-01-09.
 *  event = 방금 changes=1로 삽입된 행(payload는 최신 schema_version·zod 검증 완료). Promise 반환 금지. 예외(ts-fsrs FSRSValidationError 포함)는 그대로 던진다. */
export interface ProjectionApplier {
  apply(db: SqlitePort, event: LedgerEventEnvelope): void;
}
export const NOOP_PROJECTION_APPLIER: ProjectionApplier = { apply: () => undefined };

/** 리플레이 리더 — T-01-06이 `application/learner-model/ports.ts`에 `LedgerReplaySource`로 **같은 구조**를 정의하고, 이 Task가 구현한다(구조적 타입 호환).
 *  모든 메서드는 payload를 최신 schema_version으로 upcast + LEDGER_PAYLOADS zod 검증한 envelope를 낸다. db = 호출자 연결(읽기 전용 job 연결 가능). */
export interface LedgerReplayReader {
  /** 총순서 ORDER BY client_ts, device_id, device_seq (rowid·도착 순서 금지). */
  replay(db: SqlitePort): IterableIterator<LedgerEventEnvelope>;
  /** 카드 키 재도출(ix_lr_event_card) — 같은 총순서. */
  byCard(db: SqlitePort, cardId: string): IterableIterator<LedgerEventEnvelope>;
  /** 개념 키 재도출(ix_lr_event_concept) — 같은 총순서. */
  byConcept(db: SqlitePort, conceptId: string): IterableIterator<LedgerEventEnvelope>;
  /** 정정 이벤트(type ∈ evidence.voided·evidence.weight_adjusted, ix_lr_event_corr) — 총순서. */
  corrections(db: SqlitePort): IterableIterator<LedgerEventEnvelope>;
  /** shadow 캐치업 커서: max(rowid), 빈 원장 0. */
  maxRowid(db: SqlitePort): number;
  /** rowid > after 를 rowid 순으로 — 캐치업 전용(DB-01 §6.4-3), 리플레이 순서 아님. */
  sinceRowid(db: SqlitePort, after: number): IterableIterator<LedgerEventEnvelope>;
}

export type IntegrityAlarmKind =
  | 'fsrs_validation'
  | 'chain_conflict'
  | 'check_swallowed'
  | 'chain_broken'
  | 'anchor_mismatch';
export interface IntegrityAlarm {
  raise(
    kind: IntegrityAlarmKind,
    detail: {
      readonly device_id?: string;
      readonly device_seq?: number;
      readonly event_id?: string;
      readonly message: string;
    },
  ): void;
}

export type CurrentPolicySet = {
  readonly policy_version: string; // PolicySetId 'ps_<16hex>'
  readonly members: Readonly<Record<string, { readonly version: string; readonly sha256: string }>>;
  readonly overrides_sha256: string | null;
};
export type StudyDayContext = DomainStudyDayContext;

export type LedgerAppendDraft = {
  readonly type: LedgerEventType;
  readonly idempotency_key: string;
  /** CURRENT_SCHEMA_VERSION[type] 스키마 대상. study_day·fsrs_at·policy_version은 호출자가 채운다(§4.4 헬퍼). */
  readonly payload: Readonly<Record<string, unknown>>;
};
export type LedgerAppendHooks = {
  /** changes=1일 때만, applier 다음·같은 tx 안에서 동기 호출(예: outbox `learning.evidence.recorded` — T-01-09). */
  readonly afterAppend?: (db: SqlitePort, event: LedgerEventEnvelope) => void;
};
export type LedgerAppendResult =
  | { readonly kind: 'appended'; readonly event: LedgerEventEnvelope }
  | { readonly kind: 'duplicate'; readonly event_id: string };
export type LedgerFaultKind =
  | 'payload_invalid'
  | 'key_invalid'
  | 'schema_version_unsupported'
  | 'chain_conflict'
  | 'check_swallowed'
  | 'chain_broken'
  | 'anchor_mismatch'
  | 'projection_invalid';
export type LedgerFault = {
  readonly kind: LedgerFaultKind;
  readonly detail: string;
  readonly device_id?: string;
  readonly device_seq?: number;
};

export type LedgerAnchor = Readonly<Record<string, { readonly seq: number; readonly head_hash: string }>>;

export interface LedgerWriter {
  /** 호출자가 이미 db.tx() 안이다(inbox 핸들러·practice 유스케이스). 중첩 tx 금지. */
  appendInTx(draft: LedgerAppendDraft, hooks?: LedgerAppendHooks): Result<LedgerAppendResult, LedgerFault>;
  /** 자기 tx(db.tx)로 appendInTx. err면 ROLLBACK 후 err 반환, FSRSValidationError면 ROLLBACK 후 err('projection_invalid'). */
  append(draft: LedgerAppendDraft, hooks?: LedgerAppendHooks): Result<LedgerAppendResult, LedgerFault>;
  /** 병합·골든 적재용(tx 안): 체인 필드를 보존해 INSERT OR IGNORE, 투영 호출 0(호출자가 rebuild). anchor가 있으면 끝난 뒤 대조. */
  importInTx(
    events: readonly LedgerEventEnvelope[],
    anchor?: LedgerAnchor,
  ): Result<{ readonly inserted: number; readonly duplicates: number }, LedgerFault>;
}

/** backstop 핸들러용 — 구현 = T-01-09(practice `lr_attempt`). 같은 tx 안 동기. null = 이 기기가 모르는 attempt(고아 verdict). */
export type AttemptLedgerContext = {
  readonly phase: string; // AttemptPhase
  readonly rating: 1 | 2 | 3 | 4 | null;
  readonly cbm_score: number | null;
  readonly fsrs_at: number;
  readonly study_day: string;
  readonly policy_version: string;
};
export interface VerdictAttemptResolver {
  resolve(db: SqlitePort, verdict: Verdict): AttemptLedgerContext | null;
  /** 원장 기록 직후(같은 tx) practice 상태 반영용. 선택. */
  onRecorded?(db: SqlitePort, verdict: Verdict, event: LedgerEventEnvelope): void;
}
