import { Verdict } from '@fathom/contracts/events/catalog/grading';
import { ConsumerManifest } from '@fathom/contracts/events/consumer-manifest';
import type { IntegrationEventEnvelope } from '@fathom/contracts/events/envelope';
import { SUBSCRIPTIONS } from '@fathom/contracts/events/routing.gen';
import { inboxPlugin } from '@fathom/shared-kernel/eventing/eventing';
import { createLogger } from '@fathom/shared-kernel/log/log';
import { createMetrics } from '@fathom/shared-kernel/metrics/metrics';
import { createFakeClock } from '@fathom/testkit/clock';
import { fixedUlid } from '@fathom/testkit/ids';
import { describe, expect, it } from 'vitest';
import { createGradingVerdictIssuedHandler } from '../../../src/application/ledger/inbox/grading-verdict-issued.js';
import type { AttemptLedgerContext, VerdictAttemptResolver } from '../../../src/application/ledger/ports.js';
import { GOLDEN_POLICY } from '../../golden/ledger/payloads.js';
import { openMigratedDb } from '../../unit/ledger/support/db.js';
import { makeHarness } from '../../unit/ledger/support/harness.js';

// CT-LR-505 · IF-EV-05 소비 — 골든 Verdict(스펙 안 상수, Verdict.parse 통과).
const GOLDEN_VERDICT = Verdict.parse({
  verdict_id: fixedUlid(11),
  attempt_id: fixedUlid(12),
  session_id: fixedUlid(13),
  block_id: fixedUlid(14),
  item_id: 'k8s.probes.i03',
  item_content_hash: 'a'.repeat(64),
  item_beta_snapshot: 0.35,
  item_n_options: 0,
  gate_result_id: null,
  stakes: 'S0',
  concept_id: 'k8s.probes',
  ku_ids: ['k8s.probes.k01'],
  mc_ids: [],
  facet: 'definition',
  format: 'short',
  response_mode: 'production',
  tier: 'A',
  result: 'correct',
  band: 'right',
  score: 1,
  confidence: 2,
  latency_ms: 8200,
  rapid: false,
  hints_used: 0,
  grader_engine: 'D',
  calibrated: false,
  grader_confidence: null,
  pending: false,
  provisional: false,
  w_format: 0.9,
  w_grader: 1,
  gaming_factor: 1,
  recommended_grade: 3,
  ai_mode: 'OFFLINE',
  content_policy_version: GOLDEN_POLICY.policy_version,
  judge_log_ref: null,
  prompt_version: null,
  issued_at: 1_790_000_100_000,
});
const CTX: AttemptLedgerContext = {
  phase: 'practice',
  rating: 3,
  cbm_score: 2,
  fsrs_at: 1_790_000_099_000,
  study_day: '2026-09-21',
  policy_version: GOLDEN_POLICY.policy_version,
};

/** learning 매니페스트에서 `grading.verdict.issued` 구독만 남긴다(다른 구독·핸들러 결선은 T-01-09). */
function verdictOnlyManifest(): ConsumerManifest {
  const sub = SUBSCRIPTIONS.learning['grading.verdict.issued'];
  return ConsumerManifest.parse({
    consumer: 'learning',
    subscriptions: [
      {
        type: 'grading.verdict.issued',
        schema_versions: [...sub.schema_versions],
        mode: sub.mode,
        on_poison: sub.on_poison,
        reads: [...sub.reads],
      },
    ],
  });
}

function delivery(eventId: string, seq: number): { producer: 'content'; events: IntegrationEventEnvelope[] } {
  return {
    producer: 'content',
    events: [
      {
        event_id: eventId,
        type: 'grading.verdict.issued',
        schema_version: 1,
        producer: 'content',
        producer_seq: seq,
        occurred_at: 1_790_000_100_000,
        correlation_id: GOLDEN_VERDICT.attempt_id,
        causation_id: null,
        traceparent: null,
        payload: { ...GOLDEN_VERDICT },
      },
    ],
  };
}

async function setup(resolver: VerdictAttemptResolver) {
  const db = await openMigratedDb();
  const h = await makeHarness({ db });
  const clock = createFakeClock(1_790_000_200_000);
  const logLines: string[] = [];
  const log = createLogger('learning', {
    level: 'info',
    bootId: null,
    clock,
    destination: { write: (c) => void logLines.push(c) },
  });
  const handler = createGradingVerdictIssuedHandler({ writer: h.writer, resolver, log });
  const plugin = inboxPlugin(
    { mode: 'durable', manifest: verdictOnlyManifest(), handlers: [handler] },
    { db, clock, log, metrics: createMetrics() },
  );
  const attempts = (): number =>
    Number(db.prepare("SELECT count(*) AS n FROM lr_event WHERE type = 'attempt.graded'").get()?.n);
  return { db, plugin, attempts, logLines };
}

describe('IF-EV-05 grading.verdict.issued 소비(inbox durable, on_poison: halt)', () => {
  it('CT-LR-505 구독 계약: learning 매니페스트의 grading.verdict.issued = durable · halt · v1 [IF-EV-05]', () => {
    const sub = SUBSCRIPTIONS.learning['grading.verdict.issued'];
    expect(sub).toMatchObject({ mode: 'durable', on_poison: 'halt', schema_versions: [1] });
    expect(sub.reads).toContain('item_beta_snapshot');
  });

  it('CT-LR-505 골든 Verdict 1회 반영 = attempt.graded 1행, 같은 event_id 재전송 = 0행 [IF-EV-05][NFR-DATA-013]', async () => {
    const t = await setup({ resolve: () => CTX });
    const first = await t.plugin.process('content', delivery(fixedUlid(2001), 1), 1);
    expect(first).toEqual({ kind: 'ack', acked_through_seq: 1 });
    expect(t.attempts()).toBe(1);
    const row = t.db.prepare("SELECT idempotency_key, device_seq FROM lr_event WHERE type = 'attempt.graded'").get();
    expect(row).toEqual({ idempotency_key: `verdict:${GOLDEN_VERDICT.verdict_id}`, device_seq: 2 }); // seq 1 = 초기 policy.switched

    const again = await t.plugin.process('content', delivery(fixedUlid(2001), 1), 1); // 같은 event_id
    expect(again).toEqual({ kind: 'ack', acked_through_seq: 1 });
    expect(t.attempts()).toBe(1);

    const sameVerdict = await t.plugin.process('content', delivery(fixedUlid(2002), 2), 1); // 새 event_id·같은 verdict
    expect(sameVerdict).toEqual({ kind: 'ack', acked_through_seq: 2 });
    expect(t.attempts()).toBe(1);
  });

  it('CT-LR-505 resolver 실패(throw) = halt 결과, 원장·dedupe 0 [IF-EV-05][NFR-DATA-013]', async () => {
    const t = await setup({
      resolve: () => {
        throw new Error('resolver down');
      },
    });
    const outcome = await t.plugin.process('content', delivery(fixedUlid(2001), 1), 1);
    expect(outcome).toEqual({ kind: 'halt', acked_through_seq: 0, producer: 'content' });
    expect(t.attempts()).toBe(0);
    expect(t.db.prepare('SELECT count(*) AS n FROM inbox_dedupe').get()?.n).toBe(0);
    // writer 오류(예: 잘못된 컨텍스트)도 같은 halt
    const bad = await setup({ resolve: () => ({ ...CTX, study_day: 'nope' }) });
    expect(await bad.plugin.process('content', delivery(fixedUlid(2001), 1), 1)).toMatchObject({ kind: 'halt' });
    expect(bad.attempts()).toBe(0);
  });

  it('CT-LR-505 고아 verdict(resolve = null) = ack·0행·warn [IF-EV-05][NFR-DATA-013]', async () => {
    const t = await setup({ resolve: () => null });
    const outcome = await t.plugin.process('content', delivery(fixedUlid(2001), 1), 1);
    expect(outcome).toEqual({ kind: 'ack', acked_through_seq: 1 });
    expect(t.attempts()).toBe(0);
    expect(t.logLines.some((l) => l.includes('ledger.verdict.orphan'))).toBe(true);
    // 고아도 inbox에는 기록되어 재전송이 다시 처리되지 않는다
    expect(t.db.prepare('SELECT count(*) AS n FROM inbox_dedupe').get()?.n).toBe(1);
  });
});
