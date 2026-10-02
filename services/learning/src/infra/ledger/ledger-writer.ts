// ported-from: spikes/sp3-replay-determinism/src/ledger.ts (audit-fixed: lr_event DDL·전체 sha256 체인(32자 절단 폐기)·체인 헤드 외부 앵커·recursive_triggers·CHECK 묵살 재확인·study_day 04:00·정정은 새 이벤트·Date/any 0)
import type { LedgerEventEnvelope, LedgerEventType } from '@fathom/contracts/ledger/envelope';
import { isValidLedgerIdempotencyKey, LEDGER_PAYLOADS } from '@fathom/contracts/ledger/types';
import { CURRENT_SCHEMA_VERSION } from '@fathom/contracts/ledger/versions';
import { canonicalJson } from '@fathom/shared-kernel/canonical/canonical';
import type { Result } from '@fathom/shared-kernel/errors/errors';
import { err, ok } from '@fathom/shared-kernel/errors/errors';
import type { SqlitePort, Stmt } from '@fathom/shared-kernel/sqlite/sqlite';
import type { Clock } from '@fathom/shared-kernel/time/time';
import { monotonicClientTs } from '@fathom/shared-kernel/time/time';
import type {
  CurrentPolicySet,
  IntegrityAlarm,
  LedgerAnchor,
  LedgerAppendDraft,
  LedgerAppendHooks,
  LedgerAppendResult,
  LedgerFault,
  LedgerWriter,
  ProjectionApplier,
  StudyDayContext,
} from '../../application/ledger/ports.js';
import { verifyAnchor } from '../../domain/ledger/chain/anchor.js';
import { eventHash, GENESIS_HASH } from '../../domain/ledger/chain/hash.js';
import type { ChainRow, DeviceHead } from '../../domain/ledger/chain/verify.js';
import { verifyChains } from '../../domain/ledger/chain/verify.js';
import { studyDayOf } from '../../domain/ledger/time/study-day.js';
import { NODE_HASH_PORT } from './hash-port.js';
import {
  LEDGER_DEVICE_HEAD,
  LEDGER_FIND_CONFLICT,
  LEDGER_HASH_AT,
  LEDGER_POLICY_EXISTS,
  LR_DEVICE_INSERT_LOCAL,
  LR_DEVICE_INSERT_REMOTE,
  LR_DEVICE_LOCAL,
} from './ledger.sql.js';

// ADR-011 §1 · DB-01 §6.3 — `lr_event`에 쓰는 유일한 코드. 쓰기 문장은 `INSERT OR IGNORE` 하나뿐(check:ledger-writer, STD-SQL-11).
// [Brief 결정] DB-01 §6.3은 이 문장을 ledger.sql.ts에 두지만, check:ledger-writer가 writer 파일 밖의 INSERT 리터럴을 금지하므로 INSERT만 여기에 둔다.
export const LEDGER_INSERT =
  'INSERT OR IGNORE INTO lr_event(event_id, device_id, device_seq, client_ts, type, schema_version, idempotency_key, payload, prev_hash, hash, experiment_arm, recorded_at, ext, ext_v) VALUES (:event_id, :device_id, :device_seq, :client_ts, :type, :schema_version, :idempotency_key, :payload, :prev_hash, :hash, :experiment_arm, :recorded_at, :ext, :ext_v)';

export type LedgerWriterDeps = {
  readonly db: SqlitePort;
  readonly clock: Clock;
  readonly newId: () => string;
  readonly applier: ProjectionApplier;
  readonly alarm: IntegrityAlarm;
  readonly policySet: () => CurrentPolicySet;
  readonly studyDay: StudyDayContext;
  readonly platform: string;
};

/** `append()`가 tx 안에서 err를 ROLLBACK으로 바꾸려고 던지는 내부 표지(밖에서 잡아 err로 되돌린다). */
class LedgerFaultAbort extends Error {
  readonly fault: LedgerFault;
  constructor(fault: LedgerFault) {
    super(`ledger fault: ${fault.kind}`);
    this.name = 'LedgerFaultAbort';
    this.fault = fault;
  }
}

/** 원인 사슬(`e`, `e.cause`, …)에 ts-fsrs `FSRSValidationError`가 있는가. */
function hasFsrsValidationCause(e: unknown): boolean {
  let cur: unknown = e;
  for (let depth = 0; depth < 8 && cur instanceof Error; depth += 1) {
    if (cur.name === 'FSRSValidationError') {
      return true;
    }
    cur = cur.cause;
  }
  return false;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function safeInt(v: unknown, what: string): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) {
    throw new Error(`invariant: ${what} is not a safe integer`);
  }
  return n;
}

/** 키 형식·payload(현재 schema_version) 검증. 실패 detail에는 값이 없다(zod 첫 이슈의 경로·코드만). */
function validateDraft(draft: LedgerAppendDraft): Result<Readonly<Record<string, unknown>>, LedgerFault> {
  if (!isValidLedgerIdempotencyKey(draft.type, draft.idempotency_key)) {
    return err({ kind: 'key_invalid', detail: `idempotency_key does not match ${draft.type}` });
  }
  const schema = LEDGER_PAYLOADS[draft.type][CURRENT_SCHEMA_VERSION[draft.type]];
  const parsed = schema.safeParse(draft.payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue === undefined ? '(root)' : issue.path.map(String).join('.') || '(root)';
    return err({
      kind: 'payload_invalid',
      detail: `${draft.type} payload invalid at ${where}: ${issue?.code ?? 'unknown'}`,
    });
  }
  if (!isRecord(parsed.data)) {
    return err({ kind: 'payload_invalid', detail: `${draft.type} payload is not an object` });
  }
  return ok(parsed.data);
}

type InsertStep =
  | { readonly kind: 'inserted'; readonly event: LedgerEventEnvelope }
  | { readonly kind: 'duplicate'; readonly event_id: string }
  | { readonly kind: 'seq_conflict'; readonly device_seq: number }
  | { readonly kind: 'swallowed'; readonly event_id: string; readonly device_seq: number };

export function createLedgerWriter(deps: LedgerWriterDeps): LedgerWriter {
  const { db, clock, newId, applier, alarm } = deps;
  let localDeviceId: string | null = null;
  let policyKnown = false;

  // 지연 준비 문장(문장은 연결에 묶인다 — writer는 db 하나를 쓴다).
  let headStmt: Stmt | null = null;
  let insertStmt: Stmt | null = null;
  let conflictStmt: Stmt | null = null;
  let hashAtStmt: Stmt | null = null;
  const head = (): Stmt => {
    headStmt ??= db.prepare(LEDGER_DEVICE_HEAD);
    return headStmt;
  };
  const insert = (): Stmt => {
    insertStmt ??= db.prepare(LEDGER_INSERT);
    return insertStmt;
  };
  const conflict = (): Stmt => {
    conflictStmt ??= db.prepare(LEDGER_FIND_CONFLICT);
    return conflictStmt;
  };
  const hashAt = (): Stmt => {
    hashAtStmt ??= db.prepare(LEDGER_HASH_AT);
    return hashAtStmt;
  };

  /** 1. 로컬 기기. 캐시는 SELECT로 찾았을 때만(INSERT는 같은 tx가 롤백되면 무효). */
  function ensureDevice(): string {
    if (localDeviceId !== null) {
      return localDeviceId;
    }
    const found = db.prepare(LR_DEVICE_LOCAL).get();
    if (found !== undefined) {
      localDeviceId = String(found.device_id);
      return localDeviceId;
    }
    const id = newId();
    db.prepare(LR_DEVICE_INSERT_LOCAL).run({ device_id: id, platform: deps.platform, created_at: clock.now() });
    return id;
  }

  /** 3~5: 헤드 조회 → 체인 필드 → INSERT OR IGNORE(+ changes 판정). 투영·hook은 부르지 않는다. */
  function insertOnce(
    deviceId: string,
    type: LedgerEventType,
    key: string,
    payload: Readonly<Record<string, unknown>>,
  ): InsertStep {
    const h = head().get({ device_id: deviceId });
    const lastSeq = h === undefined ? 0 : safeInt(h.device_seq, 'device_seq');
    const lastTs = h === undefined ? null : safeInt(h.client_ts, 'client_ts');
    const now = clock.now();
    const fields = {
      event_id: newId(),
      device_id: deviceId,
      device_seq: lastSeq + 1,
      client_ts: monotonicClientTs(now, lastTs),
      type,
      schema_version: CURRENT_SCHEMA_VERSION[type],
      idempotency_key: key,
      prev_hash: h === undefined ? GENESIS_HASH : String(h.hash),
    };
    const hash = eventHash(NODE_HASH_PORT, { ...fields, payload });
    const res = insert().run({
      ...fields,
      payload: canonicalJson(payload),
      hash,
      experiment_arm: null,
      recorded_at: now,
      ext: '{}',
      ext_v: 1,
    });
    if (res.changes === 1) {
      return { kind: 'inserted', event: { ...fields, payload, hash, experiment_arm: null, recorded_at: now } };
    }
    const rows = conflict().all({
      event_id: fields.event_id,
      idempotency_key: key,
      device_id: deviceId,
      device_seq: fields.device_seq,
    });
    const sameKey = rows.find((r) => r.idempotency_key === key);
    if (sameKey !== undefined) {
      return { kind: 'duplicate', event_id: String(sameKey.event_id) };
    }
    if (rows.length > 0) {
      return { kind: 'seq_conflict', device_seq: fields.device_seq };
    }
    return { kind: 'swallowed', event_id: fields.event_id, device_seq: fields.device_seq };
  }

  /** 6·7: 삽입(+1회 재시도) → applier → afterAppend. */
  function appendCore(
    deviceId: string,
    type: LedgerEventType,
    key: string,
    payload: Readonly<Record<string, unknown>>,
    hooks: LedgerAppendHooks | undefined,
  ): Result<LedgerAppendResult, LedgerFault> {
    let step = insertOnce(deviceId, type, key, payload);
    if (step.kind === 'seq_conflict') {
      step = insertOnce(deviceId, type, key, payload); // 헤드를 다시 읽는다. OR IGNORE는 변경이 없었으므로 롤백이 필요 없다.
    }
    switch (step.kind) {
      case 'duplicate':
        return ok({ kind: 'duplicate', event_id: step.event_id });
      case 'seq_conflict':
        alarm.raise('chain_conflict', {
          device_id: deviceId,
          device_seq: step.device_seq,
          message: 'ledger device chain conflict after retry',
        });
        return err({
          kind: 'chain_conflict',
          detail: 'device_seq conflict persisted after one retry',
          device_id: deviceId,
          device_seq: step.device_seq,
        });
      case 'swallowed':
        alarm.raise('check_swallowed', {
          device_id: deviceId,
          device_seq: step.device_seq,
          event_id: step.event_id,
          message: 'ledger insert ignored without a conflicting row (CHECK/NOT NULL swallowed)',
        });
        return err({
          kind: 'check_swallowed',
          detail: 'insert changes=0 with no conflicting row',
          device_id: deviceId,
          device_seq: step.device_seq,
        });
      case 'inserted':
        break;
    }
    const { event } = step;
    try {
      applier.apply(db, event);
    } catch (e) {
      if (hasFsrsValidationCause(e)) {
        alarm.raise('fsrs_validation', {
          device_id: event.device_id,
          device_seq: event.device_seq,
          event_id: event.event_id,
          message: 'projection rejected a ledger event (FSRSValidationError)',
        });
      }
      throw e; // 호출자 tx가 롤백한다.
    }
    hooks?.afterAppend?.(db, event);
    return ok({ kind: 'appended', event });
  }

  /** 2. 초기 정책 이벤트(DB-01 §5 ②, CO-20): 요청 이벤트보다 먼저. 존재를 SELECT로 확인했을 때만 캐시한다. */
  function ensureInitialPolicy(deviceId: string, requested: LedgerEventType): Result<null, LedgerFault> {
    if (policyKnown || requested === 'policy.switched') {
      return ok(null);
    }
    if (db.prepare(LEDGER_POLICY_EXISTS).get() !== undefined) {
      policyKnown = true;
      return ok(null);
    }
    const ps = deps.policySet();
    const draft: LedgerAppendDraft = {
      type: 'policy.switched',
      idempotency_key: `policy:${ps.policy_version}`,
      payload: {
        policy_version: ps.policy_version,
        previous_policy_version: ps.policy_version, // [Brief 결정] 최초 = 자기 자신
        members: { ...ps.members },
        overrides_sha256: ps.overrides_sha256,
        replay_report_ref: null,
        study_day: studyDayOf(clock.now(), deps.studyDay),
      },
    };
    const checked = validateDraft(draft);
    if (!checked.ok) {
      return checked;
    }
    const res = appendCore(deviceId, draft.type, draft.idempotency_key, checked.value, undefined);
    return res.ok ? ok(null) : res;
  }

  function appendInTx(draft: LedgerAppendDraft, hooks?: LedgerAppendHooks): Result<LedgerAppendResult, LedgerFault> {
    const checked = validateDraft(draft);
    if (!checked.ok) {
      return checked;
    }
    const deviceId = ensureDevice();
    const boot = ensureInitialPolicy(deviceId, draft.type);
    if (!boot.ok) {
      return boot;
    }
    return appendCore(deviceId, draft.type, draft.idempotency_key, checked.value, hooks);
  }

  function append(draft: LedgerAppendDraft, hooks?: LedgerAppendHooks): Result<LedgerAppendResult, LedgerFault> {
    try {
      return db.tx(() => {
        const res = appendInTx(draft, hooks);
        if (!res.ok) {
          throw new LedgerFaultAbort(res.error);
        }
        return res;
      });
    } catch (e) {
      if (e instanceof LedgerFaultAbort) {
        return err(e.fault);
      }
      if (hasFsrsValidationCause(e)) {
        return err({ kind: 'projection_invalid', detail: 'projection rejected the event (FSRSValidationError)' });
      }
      throw e;
    }
  }

  function importInTx(
    events: readonly LedgerEventEnvelope[],
    anchor?: LedgerAnchor,
  ): Result<{ readonly inserted: number; readonly duplicates: number }, LedgerFault> {
    const sorted = [...events].sort((a, b) =>
      a.device_id === b.device_id ? a.device_seq - b.device_seq : a.device_id < b.device_id ? -1 : 1,
    );
    // 기기별 시작점: 파일의 첫 번호가 1이면 GENESIS, 아니면 로컬에 있는 직전 행(증분 import = 로컬 헤드)의 hash.
    const startHeads: Record<string, DeviceHead> = {};
    const seen = new Set<string>();
    for (const e of sorted) {
      if (seen.has(e.device_id)) {
        continue;
      }
      seen.add(e.device_id);
      if (e.device_seq > 1) {
        const prev = hashAt().get({ device_id: e.device_id, device_seq: e.device_seq - 1 });
        if (prev !== undefined) {
          startHeads[e.device_id] = { seq: e.device_seq - 1, head_hash: String(prev.hash) };
        }
      }
    }
    const chainRows: ChainRow[] = sorted;
    const report = verifyChains(NODE_HASH_PORT, chainRows, startHeads);
    const broken = report.breaks[0];
    if (broken !== undefined) {
      alarm.raise('chain_broken', {
        device_id: broken.device_id,
        device_seq: broken.device_seq,
        message: `ledger import chain broken: ${broken.reason}`,
      });
      return err({
        kind: 'chain_broken',
        detail: broken.reason,
        device_id: broken.device_id,
        device_seq: broken.device_seq,
      });
    }
    const now = clock.now();
    for (const deviceId of seen) {
      db.prepare(LR_DEVICE_INSERT_REMOTE).run({ device_id: deviceId, created_at: now });
    }
    let inserted = 0;
    let duplicates = 0;
    for (const e of sorted) {
      const res = insert().run({
        event_id: e.event_id,
        device_id: e.device_id,
        device_seq: e.device_seq,
        client_ts: e.client_ts,
        type: e.type,
        schema_version: e.schema_version,
        idempotency_key: e.idempotency_key,
        payload: canonicalJson(e.payload),
        prev_hash: e.prev_hash,
        hash: e.hash,
        experiment_arm: e.experiment_arm,
        recorded_at: now,
        ext: '{}',
        ext_v: 1,
      });
      if (res.changes === 1) {
        inserted += 1;
        continue;
      }
      const rows = conflict().all({
        event_id: e.event_id,
        idempotency_key: e.idempotency_key,
        device_id: e.device_id,
        device_seq: e.device_seq,
      });
      if (rows.some((r) => r.event_id === e.event_id && r.hash === e.hash)) {
        duplicates += 1;
        continue;
      }
      alarm.raise('chain_broken', {
        device_id: e.device_id,
        device_seq: e.device_seq,
        event_id: e.event_id,
        message: 'ledger import row conflicts with an existing row',
      });
      return err({
        kind: 'chain_broken',
        detail: 'imported row conflicts with an existing row',
        device_id: e.device_id,
        device_seq: e.device_seq,
      });
    }
    if (inserted + duplicates !== events.length) {
      throw new Error('invariant: ledger import inserted + duplicates !== events');
    }
    if (anchor !== undefined) {
      const violations = verifyAnchor(anchor, (deviceId, seq) => {
        const row = hashAt().get({ device_id: deviceId, device_seq: seq });
        return row === undefined ? null : String(row.hash);
      });
      const first = violations[0];
      if (first !== undefined) {
        alarm.raise('anchor_mismatch', {
          device_id: first.device_id,
          message: `ledger import anchor mismatch: ${first.reason}`,
        });
        return err({ kind: 'anchor_mismatch', detail: first.reason, device_id: first.device_id });
      }
    }
    return ok({ inserted, duplicates });
  }

  return { appendInTx, append, importInTx };
}
