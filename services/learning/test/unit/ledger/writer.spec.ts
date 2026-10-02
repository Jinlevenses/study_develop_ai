import { CURRENT_SCHEMA_VERSION } from '@fathom/contracts/ledger/versions';
import { appendEvent, createOutbox } from '@fathom/shared-kernel/eventing/outbox';
import type { SqlitePort, Stmt } from '@fathom/shared-kernel/sqlite/sqlite';
import { fixedUlid } from '@fathom/testkit/ids';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ProjectionApplier } from '../../../src/application/ledger/ports.js';
import { LEDGER_DEVICE_HEAD } from '../../../src/infra/ledger/ledger.sql.js';
import { fixtureDraft, KEY_SAMPLES, LEDGER_TYPES } from '../../contract/ledger/ledger-fixtures.js';
import { GOLDEN_POLICY } from '../../golden/ledger/payloads.js';
import { openMigratedDb } from './support/db.js';
import { makeHarness } from './support/harness.js';

const count = (db: SqlitePort, sql: 'lr_event' | 'lr_device' | 'outbox'): number =>
  Number(
    db
      .prepare(
        sql === 'lr_event'
          ? 'SELECT count(*) AS n FROM lr_event'
          : sql === 'lr_device'
            ? 'SELECT count(*) AS n FROM lr_device'
            : 'SELECT count(*) AS n FROM outbox',
      )
      .get()?.n,
  );

function rows(db: SqlitePort): Record<string, unknown>[] {
  return db.prepare('SELECT * FROM lr_event ORDER BY device_seq').all();
}

/** 헤드 조회를 `stale`번 낡은 값(없음)으로 돌려주는 연결 래퍼 — 동시 append 경합 재현. */
function staleHeadDb(db: SqlitePort, control: { remaining: number }): SqlitePort {
  return {
    ...db,
    prepare(sql: string): Stmt {
      const stmt = db.prepare(sql);
      if (sql !== LEDGER_DEVICE_HEAD) {
        return stmt;
      }
      return {
        ...stmt,
        get(...args): Record<string, unknown> | undefined {
          if (control.remaining > 0) {
            control.remaining -= 1;
            return undefined;
          }
          return stmt.get(...args);
        },
      };
    },
    tx: (fn) => db.tx(fn),
  };
}

const fsrsError = (): Error => {
  const e = new Error('Invalid delta_t');
  e.name = 'FSRSValidationError';
  return e;
};

describe('LedgerWriter.append', () => {
  it('UT-LR-001 client_ts = max(now, last+1) — 시계 역행·동시각 포함 [FR-PRG-027]', async () => {
    const h = await makeHarness();
    h.clock.set(1_000_000);
    const first = h.writer.append(fixtureDraft('card.enrolled'));
    // policy.switched(seq 1)가 now, 요청 이벤트(seq 2)는 같은 ms라 +1.
    h.clock.set(500_000); // 시계 역행
    const second = h.writer.append(fixtureDraft('card.status_changed'));
    h.clock.set(2_000_000);
    const third = h.writer.append(fixtureDraft('lesson.completed'));
    expect(first.ok && second.ok && third.ok).toBe(true);
    const ts = rows(h.db).map((r) => Number(r.client_ts));
    expect(ts).toEqual([1_000_000, 1_000_001, 1_000_002, 2_000_000]);
  });

  it('UT-LR-002 device_seq 증가·충돌 → 1회 재시도, 반복되면 경보 [FR-PRG-003]', async () => {
    const control = { remaining: 0 };
    const h = await makeHarness({ wrapDb: (db) => staleHeadDb(db, control) });
    expect(h.writer.append(fixtureDraft('card.enrolled')).ok).toBe(true);
    expect(rows(h.db).map((r) => Number(r.device_seq))).toEqual([1, 2]);

    control.remaining = 1; // 첫 헤드 조회만 낡음 → (device, 1) 충돌 → 헤드 재조회 후 성공
    const retried = h.writer.append(fixtureDraft('card.status_changed'));
    expect(retried.ok && retried.value.kind === 'appended').toBe(true);
    expect(rows(h.db).map((r) => Number(r.device_seq))).toEqual([1, 2, 3]);
    expect(h.alarms).toEqual([]);

    control.remaining = 2; // 재시도에서도 낡음 → chain_conflict + 경보, 롤백
    const failed = h.writer.append(fixtureDraft('lesson.completed'));
    expect(failed.ok).toBe(false);
    expect(!failed.ok && failed.error.kind).toBe('chain_conflict');
    expect(h.alarms.map((a) => a.kind)).toEqual(['chain_conflict']);
    expect(count(h.db, 'lr_event')).toBe(3);
  });

  it('UT-LR-009 FSRSValidationError → 경보 + 롤백(원장 0행) [NFR-AVL-005]', async () => {
    const applier: ProjectionApplier = {
      apply(): void {
        throw new Error('projection failed', { cause: fsrsError() }); // 원인 사슬 안의 FSRSValidationError
      },
    };
    const h = await makeHarness({ applier });
    const res = h.writer.append(fixtureDraft('card.enrolled'));
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error.kind).toBe('projection_invalid');
    expect(h.alarms.map((a) => a.kind)).toEqual(['fsrs_validation']);
    // 같은 tx의 초기 policy.switched·lr_device도 함께 롤백된다.
    expect(count(h.db, 'lr_event')).toBe(0);
    expect(count(h.db, 'lr_device')).toBe(0);
    // appendInTx를 직접 부르면 예외가 그대로 전파된다(호출자 tx 롤백).
    expect(() => h.db.tx(() => h.writer.appendInTx(fixtureDraft('card.enrolled')))).toThrow('projection failed');
    expect(count(h.db, 'lr_event')).toBe(0);
  });

  it('UT-LR-009 FSRSValidationError가 아닌 투영 예외 = 경보 없이 재던짐 [NFR-AVL-005]', async () => {
    const h = await makeHarness({
      applier: {
        apply(): void {
          throw new Error('boom');
        },
      },
    });
    expect(() => h.writer.append(fixtureDraft('card.enrolled'))).toThrow('boom');
    expect(h.alarms).toEqual([]);
    expect(count(h.db, 'lr_event')).toBe(0);
  });

  it('UT-LR-011 CHECK 묵살(changes=0, 충돌 행 없음) → check_swallowed + 경보 [NFR-DATA-001]', async () => {
    let n = 0;
    let broken = false;
    const h = await makeHarness({
      newId: () => {
        n += 1; // 첫 호출 = 기기 ID
        return broken ? 'SHORT' : fixedUlid(n);
      },
    });
    expect(h.writer.append(fixtureDraft('card.enrolled')).ok).toBe(true);
    broken = true; // event_id CHECK(length = 26) 위반 — OR IGNORE는 오류 없이 건너뛴다
    const res = h.writer.append(fixtureDraft('card.status_changed'));
    expect(!res.ok && res.error.kind).toBe('check_swallowed');
    expect(h.alarms.map((a) => a.kind)).toEqual(['check_swallowed']);
    expect(count(h.db, 'lr_event')).toBe(2);
  });
});

describe('LedgerWriter 부트스트랩', () => {
  it('UT-LR-030 lr_device 지연 생성 1회(is_local=1) [FR-PRG-001]', async () => {
    const h = await makeHarness();
    expect(count(h.db, 'lr_device')).toBe(0);
    h.clock.set(1_234_000);
    for (const type of ['card.enrolled', 'card.status_changed', 'lesson.completed'] as const) {
      expect(h.writer.append(fixtureDraft(type)).ok).toBe(true);
    }
    const devices = h.db.prepare('SELECT device_id, is_local, platform, created_at FROM lr_device').all();
    expect(devices).toEqual([{ device_id: fixedUlid(0), is_local: 1, platform: 'linux-x64', created_at: 1_234_000 }]);
    expect(new Set(rows(h.db).map((r) => r.device_id))).toEqual(new Set([fixedUlid(0)]));
  });

  it('UT-LR-031 첫 append 앞 policy.switched(seq 1, 키 policy:<ps>) [FR-PRG-001][NFR-DATA-013]', async () => {
    const h = await makeHarness();
    h.clock.set(1_790_000_000_000);
    const res = h.writer.append(fixtureDraft('card.enrolled'));
    expect(res.ok && res.value.kind === 'appended').toBe(true);
    const [policy, requested] = rows(h.db);
    expect(policy).toMatchObject({
      device_seq: 1,
      type: 'policy.switched',
      idempotency_key: `policy:${GOLDEN_POLICY.policy_version}`,
    });
    expect(requested).toMatchObject({ device_seq: 2, type: 'card.enrolled' });
    const payload: unknown = JSON.parse(String(policy?.payload));
    expect(payload).toMatchObject({
      policy_version: GOLDEN_POLICY.policy_version,
      previous_policy_version: GOLDEN_POLICY.policy_version, // [Brief 결정] 최초 = 자기 자신
      replay_report_ref: null,
      overrides_sha256: null,
      study_day: '2026-09-21', // 1_790_000_000_000 = 23:13 KST
    });
    // 투영에는 policy.switched가 먼저, 요청 이벤트가 다음 순서로 적용된다.
    expect(h.applied.map((e) => e.type)).toEqual(['policy.switched', 'card.enrolled']);
  });

  it('UT-LR-032 재기동(새 writer) 후 기기·정책 이벤트 재생성 0 [FR-PRG-001]', async () => {
    const db = await openMigratedDb();
    const first = await makeHarness({ db });
    expect(first.writer.append(fixtureDraft('card.enrolled')).ok).toBe(true);
    const second = await makeHarness({ db, idStart: 100 });
    expect(second.writer.append(fixtureDraft('card.status_changed')).ok).toBe(true);
    expect(count(db, 'lr_device')).toBe(1);
    expect(rows(db).filter((r) => r.type === 'policy.switched')).toHaveLength(1);
    expect(rows(db).map((r) => Number(r.device_seq))).toEqual([1, 2, 3]);
  });

  it('UT-LR-033 롤백된 tx 뒤 캐시 오염 0 [NFR-DATA-013]', async () => {
    const h = await makeHarness();
    expect(() =>
      h.db.tx(() => {
        expect(h.writer.appendInTx(fixtureDraft('card.enrolled')).ok).toBe(true);
        throw new Error('caller rollback');
      }),
    ).toThrow('caller rollback');
    expect(count(h.db, 'lr_device')).toBe(0);
    expect(count(h.db, 'lr_event')).toBe(0);
    // 같은 writer로 다시: 기기·정책 이벤트가 다시 만들어진다(롤백된 값을 캐시하지 않았다).
    expect(h.writer.append(fixtureDraft('card.enrolled')).ok).toBe(true);
    expect(count(h.db, 'lr_device')).toBe(1);
    expect(rows(h.db).map((r) => r.type)).toEqual(['policy.switched', 'card.enrolled']);
    // 같은 tx 안에서 두 번 부르면 둘째는 기기·정책을 SELECT로 찾는다.
    expect(h.db.tx(() => [h.writer.appendInTx(fixtureDraft('card.status_changed')).ok])).toEqual([true]);
    expect(count(h.db, 'lr_device')).toBe(1);
  });

  it('UT-LR-034 duplicate = applier·hook 0회 [FR-PRG-001][NFR-DATA-013]', async () => {
    const h = await makeHarness();
    let hooks = 0;
    const hooksArg = {
      afterAppend: (): void => {
        hooks += 1;
      },
    };
    const first = h.writer.append(fixtureDraft('attempt.graded'), hooksArg);
    const appliedAfterFirst = h.applied.length;
    const second = h.writer.append(fixtureDraft('attempt.graded'), hooksArg);
    expect(first.ok && first.value.kind === 'appended').toBe(true);
    expect(second.ok && second.value.kind === 'duplicate').toBe(true);
    if (first.ok && first.value.kind === 'appended' && second.ok && second.value.kind === 'duplicate') {
      expect(second.value.event_id).toBe(first.value.event.event_id);
    }
    expect(h.applied).toHaveLength(appliedAfterFirst);
    expect(hooks).toBe(1);
    expect(count(h.db, 'lr_event')).toBe(2);
  });
});

describe('LedgerWriter 검증·tx 규칙', () => {
  it('UT-LR-035 잘못된 멱등 키 = key_invalid [IF-LG-01][NFR-DATA-013]', async () => {
    const h = await makeHarness();
    const res = h.writer.append({ ...fixtureDraft('attempt.graded'), idempotency_key: 'cmd:not-a-verdict' });
    expect(!res.ok && res.error.kind).toBe('key_invalid');
    expect(count(h.db, 'lr_event')).toBe(0);
  });

  it('UT-LR-036 payload_invalid detail에 값이 없다 [IF-LG-01][NFR-DATA-013]', async () => {
    const h = await makeHarness();
    const secret = 'learner-secret-answer-xyz';
    const res = h.writer.append({
      ...fixtureDraft('card.enrolled'),
      payload: { ...fixtureDraft('card.enrolled').payload, concept_id: secret },
    });
    expect(!res.ok && res.error.kind).toBe('payload_invalid');
    expect(JSON.stringify(res)).not.toContain(secret);
    expect(!res.ok && res.error.detail).toBe('card.enrolled payload invalid at concept_id: invalid_format');
    const strict = h.writer.append({
      ...fixtureDraft('card.enrolled'),
      payload: { ...fixtureDraft('card.enrolled').payload, extra_field: 1 },
    });
    expect(!strict.ok && strict.error.kind).toBe('payload_invalid');
    expect(count(h.db, 'lr_event')).toBe(0);
  });

  it('UT-LR-037 schema_version 스탬프 = CURRENT_SCHEMA_VERSION, 저장 payload는 정준 JSON 17종 [NFR-DATA-013][IF-LG-01]', async () => {
    const h = await makeHarness();
    for (const type of LEDGER_TYPES) {
      const res = h.writer.append(fixtureDraft(type));
      expect(res.ok, type).toBe(true);
    }
    for (const row of rows(h.db)) {
      const type = LEDGER_TYPES.find((t) => t === row.type);
      expect(type).toBeDefined();
      if (type !== undefined) {
        expect(row.schema_version).toBe(CURRENT_SCHEMA_VERSION[type]);
        expect(row.idempotency_key).toBe(KEY_SAMPLES[type]);
      }
      expect(row).toMatchObject({ experiment_arm: null, ext: '{}', ext_v: 1 });
    }
  });

  it('UT-LR-038 applier 예외 → 호출자 tx 롤백 시 lr_event·outbox 0 [NFR-DATA-013][IF-LG-01]', async () => {
    const db = await openMigratedDb();
    const outbox = createOutbox({
      db,
      svc: 'learning',
      clock: { now: () => 1 },
      payloads: { 'learning.test.recorded': { 1: z.strictObject({ n: z.number() }) } },
      currentTraceparent: () => null,
      onAppended: () => undefined,
    });
    let fail = false;
    const h = await makeHarness({
      db,
      applier: {
        apply(): void {
          if (fail) {
            throw new Error('apply failed');
          }
        },
      },
    });
    const hook = {
      afterAppend: (): void => {
        appendEvent(outbox, {
          type: 'learning.test.recorded',
          schema_version: 1,
          correlation_id: fixedUlid(9),
          payload: { n: 1 },
        });
      },
    };
    expect(() =>
      db.tx(() => {
        expect(h.writer.appendInTx(fixtureDraft('card.enrolled'), hook).ok).toBe(true);
        expect(count(db, 'outbox')).toBe(1);
        fail = true;
        h.writer.appendInTx(fixtureDraft('card.status_changed'), hook);
      }),
    ).toThrow('apply failed');
    expect(count(db, 'lr_event')).toBe(0);
    expect(count(db, 'outbox')).toBe(0);
  });

  it('UT-LR-039 afterAppend는 applier 다음, 같은 tx 안에서 호출된다 [NFR-DATA-013][IF-LG-01]', async () => {
    const order: string[] = [];
    const h = await makeHarness({
      applier: {
        apply(_db, e): void {
          order.push(`apply:${e.type}`);
        },
      },
    });
    const res = h.writer.append(fixtureDraft('card.enrolled'), {
      afterAppend: (db, e) => {
        order.push(`hook:${e.type}`);
        // 같은 연결·같은 tx — 방금 삽입한 행이 보인다.
        expect(db.prepare('SELECT count(*) AS n FROM lr_event WHERE event_id = ?').get(e.event_id)?.n).toBe(1);
      },
    });
    expect(res.ok).toBe(true);
    // 초기 policy.switched는 hook 없이 apply만(증거가 아님).
    expect(order).toEqual(['apply:policy.switched', 'apply:card.enrolled', 'hook:card.enrolled']);
  });
});
