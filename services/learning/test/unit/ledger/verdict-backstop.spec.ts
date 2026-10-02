import { Verdict } from '@fathom/contracts/events/catalog/grading';
import type { IntegrationEventEnvelope } from '@fathom/contracts/events/envelope';
import type { LedgerEventEnvelope } from '@fathom/contracts/ledger/envelope';
import { createLogger } from '@fathom/shared-kernel/log/log';
import { createFakeClock } from '@fathom/testkit/clock';
import { fixedUlid } from '@fathom/testkit/ids';
import { describe, expect, it } from 'vitest';
import {
  cardIdOfVerdict,
  createGradingVerdictIssuedHandler,
  verdictToAttemptDraft,
} from '../../../src/application/ledger/inbox/grading-verdict-issued.js';
import type { AttemptLedgerContext, VerdictAttemptResolver } from '../../../src/application/ledger/ports.js';
import { buildVerdict, GOLDEN_POLICY } from '../../golden/ledger/payloads.js';
import { makeHarness } from './support/harness.js';

const VERDICT = Verdict.parse(
  buildVerdict({
    verdict_id: fixedUlid(11),
    attempt_id: fixedUlid(12),
    session_id: fixedUlid(13),
    block_id: fixedUlid(14),
    item_n: 3,
    concept_id: 'k8s.probes',
    facet: 'definition',
    response_mode: 'production',
    result: 'correct',
    format: 'short',
    tier: 'A',
    item_beta: 0.35,
    confidence: 2,
    latency_ms: 8200,
    hints_used: 0,
    ai_mode: 'OFFLINE',
    issued_at: 1_790_000_100_000,
  }),
);
const CTX: AttemptLedgerContext = {
  phase: 'practice',
  rating: 3,
  cbm_score: 2,
  fsrs_at: 1_790_000_099_000,
  study_day: '2026-09-21',
  policy_version: GOLDEN_POLICY.policy_version,
};

function envelopeOf(verdict: Verdict, producerSeq = 1): IntegrationEventEnvelope {
  return {
    event_id: fixedUlid(2000 + producerSeq),
    type: 'grading.verdict.issued',
    schema_version: 1,
    producer: 'content',
    producer_seq: producerSeq,
    occurred_at: 1_790_000_100_000,
    correlation_id: verdict.attempt_id,
    causation_id: null,
    traceparent: null,
    payload: { ...verdict },
  };
}

function silentLog(lines: string[] = []) {
  return createLogger('learning', {
    level: 'info',
    bootId: null,
    clock: createFakeClock(1),
    destination: { write: (chunk) => void lines.push(chunk) },
  });
}

describe('attempt.graded 리플레이 입력', () => {
  it('UT-LR-010 attempt.graded payload에 IF-01 §10.3 리듀서 입력 필드 전부 [NFR-DATA-013][FR-PRG-001]', async () => {
    const h = await makeHarness();
    h.clock.set(1_790_000_100_000);
    const res = h.writer.append(verdictToAttemptDraft(VERDICT, CTX));
    expect(res.ok && res.value.kind === 'appended').toBe(true);
    const row = h.db
      .prepare("SELECT payload, client_ts, prev_hash, idempotency_key FROM lr_event WHERE type = 'attempt.graded'")
      .get();
    const payload: Record<string, unknown> = JSON.parse(String(row?.payload));
    // IF-01 §10.3: 리듀서가 읽는 필드 + envelope client_ts(+ 체인 검증 prev_hash)
    const reducerFields = [
      'card_id',
      'concept_id',
      'format',
      'facet',
      'response_mode',
      'tier',
      'rating',
      'result',
      'w_format',
      'w_grader',
      'gaming_factor',
      'rapid',
      'item_beta',
      'item_n_options',
      'policy_version',
      'fsrs_at',
      'study_day',
    ];
    for (const f of reducerFields) {
      expect(payload, f).toHaveProperty(f);
    }
    expect(row?.client_ts).toEqual(expect.any(Number));
    expect(row?.prev_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.idempotency_key).toBe(`verdict:${VERDICT.verdict_id}`);
    // Verdict 평탄화: item_beta_snapshot → item_beta, card_id 도출, 컨텍스트 6필드
    expect(payload).not.toHaveProperty('item_beta_snapshot');
    expect(payload.item_beta).toBe(VERDICT.item_beta_snapshot);
    expect(payload.card_id).toBe('k8s.probes:definition:p');
    expect(cardIdOfVerdict({ ...VERDICT, response_mode: 'recognition' })).toBe('k8s.probes:definition:r');
    expect(payload).toMatchObject({
      phase: 'practice',
      rating: 3,
      cbm_score: 2,
      fsrs_at: 1_790_000_099_000,
      study_day: '2026-09-21',
      policy_version: GOLDEN_POLICY.policy_version,
    });
    // 계보 필드(리듀서 입력이 아님)도 함께 운반된다
    for (const f of ['verdict_id', 'attempt_id', 'session_id', 'item_id', 'issued_at', 'content_policy_version']) {
      expect(payload, f).toHaveProperty(f);
    }
  });
});

describe('grading.verdict.issued backstop 핸들러', () => {
  it('UT-LR-012 같은 verdict 재수신 = 원장 삽입 0(duplicate는 정상) [FR-PRG-001][NFR-DATA-013]', async () => {
    const h = await makeHarness();
    const recorded: LedgerEventEnvelope[] = [];
    const resolver: VerdictAttemptResolver = {
      resolve: () => CTX,
      onRecorded: (_db, _v, e) => void recorded.push(e),
    };
    const handler = createGradingVerdictIssuedHandler({ writer: h.writer, resolver, log: silentLog() });
    expect(handler.type).toBe('grading.verdict.issued');
    h.db.tx(() => handler.run(envelopeOf(VERDICT, 1), h.db));
    const count = (): number =>
      Number(h.db.prepare("SELECT count(*) AS n FROM lr_event WHERE type = 'attempt.graded'").get()?.n);
    expect(count()).toBe(1);
    expect(recorded).toHaveLength(1);
    const appliedBefore = h.applied.length;
    // 같은 verdict(다른 integration event_id) 재수신
    h.db.tx(() => handler.run(envelopeOf(VERDICT, 2), h.db));
    expect(count()).toBe(1);
    expect(recorded).toHaveLength(1); // onRecorded 재호출 0
    expect(h.applied).toHaveLength(appliedBefore);
    // 동기 경로가 먼저 기록한 경우도 같다
    const sync = await makeHarness();
    sync.writer.append(verdictToAttemptDraft(VERDICT, CTX));
    const handler2 = createGradingVerdictIssuedHandler({ writer: sync.writer, resolver, log: silentLog() });
    sync.db.tx(() => handler2.run(envelopeOf(VERDICT, 1), sync.db));
    expect(Number(sync.db.prepare("SELECT count(*) AS n FROM lr_event WHERE type = 'attempt.graded'").get()?.n)).toBe(
      1,
    );
  });

  it('UT-LR-012 고아 verdict(resolve = null)는 ack·원장 0·warn 로그 [FR-PRG-001][NFR-DATA-013]', async () => {
    const h = await makeHarness();
    const lines: string[] = [];
    const handler = createGradingVerdictIssuedHandler({
      writer: h.writer,
      resolver: { resolve: () => null },
      log: silentLog(lines),
    });
    h.db.tx(() => handler.run(envelopeOf(VERDICT), h.db));
    expect(h.db.prepare('SELECT count(*) AS n FROM lr_event').get()?.n).toBe(0);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      level: 'warn',
      event: 'ledger.verdict.orphan',
      verdict_id: VERDICT.verdict_id,
    });
  });

  it('UT-LR-012 writer 오류는 throw(on_poison: halt, 같은 tx 롤백) [IF-EV-05][NFR-DATA-013]', async () => {
    const h = await makeHarness();
    const handler = createGradingVerdictIssuedHandler({
      writer: h.writer,
      // fsrs_at이 정수가 아니어서 payload_invalid
      resolver: { resolve: () => ({ ...CTX, fsrs_at: 1.5 }) },
      log: silentLog(),
    });
    expect(() => h.db.tx(() => handler.run(envelopeOf(VERDICT), h.db))).toThrow(
      'ledger backstop failed: payload_invalid',
    );
    expect(h.db.prepare('SELECT count(*) AS n FROM lr_event').get()?.n).toBe(0);
    // 잘못된 Verdict(스키마 위반)는 VAL-SCHEMA 표지
    expect(() => h.db.tx(() => handler.run({ ...envelopeOf(VERDICT), payload: { verdict_id: 'x' } }, h.db))).toThrow(
      /payload invalid/,
    );
  });
});
