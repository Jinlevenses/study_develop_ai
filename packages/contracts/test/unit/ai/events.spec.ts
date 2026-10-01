import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AI_EVENTS,
  AiBudgetThresholdReachedV1,
  AiJobCompletedV1,
  AiJudgeDriftDetectedV1,
  AiModeChangedV1,
  AiProviderStatusChangedV1,
  AiWorkOrderApprovalRequestedV1,
  AiWorkOrderDecidedV1,
} from '../../../src/events/catalog/ai.js';
import { OpsHostStateChangedV1 } from '../../../src/events/catalog/ops.js';
import { ConsumerManifest } from '../../../src/events/consumer-manifest.js';
import { EventType } from '../../../src/events/envelope.js';
import { ULID, ULID_B } from './samples.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONSUMERS_DIR = resolve(HERE, '../../../src/events/__consumers__');

const samples = {
  'ai.mode.changed': [
    AiModeChangedV1,
    {
      mode: 'OFFLINE',
      previous_mode: null,
      reasons: ['first_boot'],
      providers: [{ id: 'jev', kind: 'jev', status: 'unconsented' }],
      changed_at: 1,
    },
  ],
  'ai.provider.status_changed': [
    AiProviderStatusChangedV1,
    { provider_id: 'claude-cli', status: 'degraded', breaker: 'half_open', reason_code: null },
  ],
  'ai.job.completed': [
    AiJobCompletedV1,
    {
      job_id: ULID,
      task_id: 'AI-G05',
      work_order_id: ULID_B,
      outcome: 'ok',
      result_ref: ULID,
      prompt_version: '1.0.0',
    },
  ],
  'ai.work_order.approval_requested': [
    AiWorkOrderApprovalRequestedV1,
    {
      work_order_id: ULID,
      purpose: 'import',
      estimate: { calls: 80, krw: 1200, quota_pct: 25, duration_s: 600 },
      requested_by: 'content',
    },
  ],
  'ai.work_order.decided': [
    AiWorkOrderDecidedV1,
    { work_order_id: ULID, decision: 'approved', reservation: { calls: 80, krw: 1200, expires_at: 9 } },
  ],
  'ai.budget.threshold_reached': [
    AiBudgetThresholdReachedV1,
    { scope: 'money', provider_id: null, ratio: 0.8, period: '2026-10' },
  ],
  'ai.judge.drift_detected': [
    AiJudgeDriftDetectedV1,
    { provider_id: 'jev', task_id: 'AI-J03', model_version_prev: 'jev-1', model_version_new: 'jev-2' },
  ],
} as const;

describe('ai 이벤트 payload (events/catalog/ai.ts)', () => {
  it('UT-CON-151 events/catalog/ai.ts 7종 각 1건, AiBudgetThresholdReachedV1.ratio 0.5 거부·period 3형식 통과 [FR-AI-007][IF-EV-14~20]', () => {
    expect(Object.keys(samples)).toHaveLength(7);
    for (const [type, [schema, sample]] of Object.entries(samples)) {
      expect(schema.safeParse(sample).success, type).toBe(true);
      expect(schema.safeParse({ ...sample, extra: 1 }).success, `${type}+extra`).toBe(false);
    }
    const budget = samples['ai.budget.threshold_reached'][1];
    expect(AiBudgetThresholdReachedV1.safeParse({ ...budget, ratio: 1 }).success).toBe(true);
    expect(AiBudgetThresholdReachedV1.safeParse({ ...budget, ratio: 0.5 }).success).toBe(false);
    expect(AiBudgetThresholdReachedV1.safeParse({ ...budget, ratio: 0.9 }).success).toBe(false);
    for (const period of ['2026-10', '2026-10-01T05', '2026-W40']) {
      expect(AiBudgetThresholdReachedV1.safeParse({ ...budget, period }).success, period).toBe(true);
    }
    for (const period of ['2026', '2026-10-01', '2026-10-01T5', 'W40']) {
      expect(AiBudgetThresholdReachedV1.safeParse({ ...budget, period }).success, period).toBe(false);
    }
    expect(AiBudgetThresholdReachedV1.safeParse({ ...budget, scope: 'tokens' }).success).toBe(false);
    expect(
      AiBudgetThresholdReachedV1.safeParse({
        ...budget,
        scope: 'quota',
        provider_id: 'claude-cli',
        period: '2026-10-01T05',
      }).success,
    ).toBe(true);

    expect(
      AiWorkOrderDecidedV1.safeParse({ work_order_id: ULID, decision: 'pending', reservation: null }).success,
    ).toBe(false);
    expect(AiJobCompletedV1.safeParse({ ...samples['ai.job.completed'][1], task_id: 'SYS-CANARY' }).success).toBe(
      false,
    );
    expect(
      AiProviderStatusChangedV1.safeParse({ ...samples['ai.provider.status_changed'][1], breaker: 'broken' }).success,
    ).toBe(false);
    expect(
      AiModeChangedV1.safeParse({ ...samples['ai.mode.changed'][1], reasons: Array(11).fill('first_boot') }).success,
    ).toBe(false);
    expect(
      AiJudgeDriftDetectedV1.safeParse({ ...samples['ai.judge.drift_detected'][1], task_id: 'AI-G01' }).success,
    ).toBe(false);
  });

  it('UT-CON-152 AI_EVENTS 키 = IF-EV-14~20, producer ai-gateway, versions [1], freeze·slice = §9.3 [NFR-MAINT-003]', () => {
    // IF-01 §9.3 표(IF-ID · type · 동결·슬라이스)
    const table: Record<string, [string, 'D' | 'O', string]> = {
      'IF-EV-14': ['ai.mode.changed', 'D', 'R0'],
      'IF-EV-15': ['ai.provider.status_changed', 'O', 'R2'],
      'IF-EV-16': ['ai.job.completed', 'O', 'R2'],
      'IF-EV-17': ['ai.work_order.approval_requested', 'O', 'R2'],
      'IF-EV-18': ['ai.work_order.decided', 'O', 'R2'],
      'IF-EV-19': ['ai.budget.threshold_reached', 'O', 'R2'],
      'IF-EV-20': ['ai.judge.drift_detected', 'O', 'R2'],
    };
    expect(Object.keys(AI_EVENTS)).toEqual(Object.values(table).map((r) => r[0]));
    for (const [type, e] of Object.entries(AI_EVENTS)) {
      const row = table[e.ifId];
      expect(row?.[0], e.ifId).toBe(type);
      expect(EventType.safeParse(type).success, type).toBe(true);
      expect(e.producer, type).toBe('ai-gateway');
      expect(e.freeze, type).toBe(row?.[1]);
      expect(e.slice, type).toBe(row?.[2]);
      expect(Object.keys(e.versions), type).toEqual(['1']);
    }
    for (const [type, [schema]] of Object.entries(samples)) {
      expect((AI_EVENTS as Record<string, { versions: Record<number, unknown> }>)[type]?.versions[1], type).toBe(
        schema,
      );
    }
  });

  it('UT-CON-153 ai-gateway.json 통과·구독 1개·형식, reads ⊆ OpsHostStateChangedV1 최상위 키 [NFR-MAINT-003][AQ-02]', async () => {
    const text = await readFile(resolve(CONSUMERS_DIR, 'ai-gateway.json'), 'utf8');
    const manifest = ConsumerManifest.parse(JSON.parse(text));
    expect(manifest.consumer).toBe('ai-gateway');
    expect(manifest.subscriptions).toHaveLength(1);
    const sub = manifest.subscriptions[0];
    expect(sub).toEqual({
      type: 'ops.host_state.changed',
      schema_versions: [1],
      mode: 'durable',
      on_poison: 'dead_letter',
      reads: ['idle_window_open', 'power', 'interactive_cli', 'sampled_at'],
    });
    const keys = Object.keys(OpsHostStateChangedV1.shape);
    for (const r of sub?.reads ?? []) {
      expect(keys, r).toContain(r);
    }
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
    expect(text).not.toContain('\t');
    for (const line of text.split('\n')) {
      expect((line.length - line.trimStart().length) % 2, line).toBe(0);
    }
    expect(text.startsWith('{\n  "consumer": "ai-gateway",\n  "subscriptions": [\n')).toBe(true);
    expect(Object.keys(JSON.parse(text).subscriptions[0])).toEqual([
      'type',
      'schema_versions',
      'mode',
      'on_poison',
      'reads',
    ]);
  });
});
