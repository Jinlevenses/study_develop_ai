import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Verdict } from '../../../src/events/catalog/grading.js';
import {
  LEARNING_EVENTS,
  LearningDemandForecastedV1,
  LearningEvidenceRecordedV1,
  LearningLedgerMergedV1,
  LearningLevelPromotedV1,
  LearningMasteryChangedV1,
  LearningSessionCompletedV1,
} from '../../../src/events/catalog/learning.js';
import { ConsumerManifest } from '../../../src/events/consumer-manifest.js';
import { NOW, PS, SHA, ULID, ULID_B, withFields } from './samples.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = resolve(HERE, '../../../src/events/__consumers__/learning.json');

const evidence = {
  ledger_event_id: ULID,
  verdict_id: ULID_B,
  item_id: 'k8s.probes.i01',
  concept_id: 'k8s.probes',
  format: 'ox',
  result: 'correct',
  latency_ms: 1200,
  rapid: false,
  confidence: 2,
  selected_option_key: null,
  ai_mode: 'OFFLINE',
  recorded_at: NOW,
  phase: 'practice',
  item_beta_after: 0.1,
};
const completed = {
  session_id: ULID,
  scope: { kind: 'all' },
  template: 'standard',
  blocks_total: 4,
  blocks_done: 4,
  modes: ['M-01', 'M-02'],
  duration_ms: 900_000,
  first_item_latency_ms: 1500,
  completed_at: NOW,
};
const forecast = {
  window_days: 14,
  demand: [{ concept_id: 'k8s.probes', facet: 'concept', format: 'ox', level: 2, n: 3 }],
  computed_at: NOW,
};
const promoted = {
  track: 'k8s',
  from_level: 1,
  to_level: 2,
  provisional: false,
  profile: { policy_version: PS, ai_mode: 'OFFLINE' },
};

describe('learning 통합 이벤트 payload · 카탈로그 · 소비자 매니페스트', () => {
  it('UT-CON-193 LearningEvidenceRecordedV1(pretest·item_beta_after null)·DemandForecastedV1.window_days 13 거부·LevelPromotedV1.profile 외 4종 [FR-QST-013][FR-PRG-013][IF-EV-08~13]', () => {
    expect(LearningEvidenceRecordedV1.safeParse(evidence).success).toBe(true);
    expect(LearningEvidenceRecordedV1.safeParse(withFields(evidence, { phase: 'pretest' })).success).toBe(true); // CR-29
    expect(LearningEvidenceRecordedV1.safeParse(withFields(evidence, { item_beta_after: null })).success).toBe(true);
    expect(LearningEvidenceRecordedV1.safeParse(withFields(evidence, { phase: 'warmup' })).success).toBe(false);
    expect(LearningEvidenceRecordedV1.safeParse(withFields(evidence, { confidence: 4 })).success).toBe(false);
    expect(LearningEvidenceRecordedV1.safeParse(withFields(evidence, { latency_ms: -1 })).success).toBe(false);
    expect(LearningEvidenceRecordedV1.safeParse({ ...evidence, extra: 1 }).success).toBe(false);
    const { item_beta_after: _omit, ...missingBeta } = evidence;
    expect(LearningEvidenceRecordedV1.safeParse(missingBeta).success).toBe(false); // 필수(nullable)

    expect(LearningSessionCompletedV1.safeParse(completed).success).toBe(true);
    expect(
      LearningSessionCompletedV1.safeParse(withFields(completed, { scope: null, template: 'return' })).success,
    ).toBe(true);
    expect(LearningSessionCompletedV1.safeParse(withFields(completed, { template: 'quick' })).success).toBe(false);
    expect(LearningSessionCompletedV1.safeParse({ ...completed, extra: 1 }).success).toBe(false);

    expect(LearningDemandForecastedV1.safeParse(forecast).success).toBe(true);
    expect(LearningDemandForecastedV1.safeParse(withFields(forecast, { window_days: 13 })).success).toBe(false);
    expect(LearningDemandForecastedV1.safeParse(withFields(forecast, { window_days: 30 })).success).toBe(false);
    expect(
      LearningDemandForecastedV1.safeParse(withFields(forecast, { demand: [{ ...forecast.demand[0], n: 0 }] })).success,
    ).toBe(false);

    const mastery = { concept_id: 'k8s.probes', from: 'learning', to: 'mastered', provisional: true };
    expect(LearningMasteryChangedV1.safeParse(mastery).success).toBe(true);
    expect(LearningMasteryChangedV1.safeParse({ ...mastery, to: 'expert' }).success).toBe(false);

    expect(LearningLevelPromotedV1.safeParse(promoted).success).toBe(true);
    expect(LearningLevelPromotedV1.safeParse(withFields(promoted, { from_level: null })).success).toBe(true);
    expect(LearningLevelPromotedV1.safeParse(withFields(promoted, { profile: { policy_version: PS } })).success).toBe(
      false,
    );
    expect(
      LearningLevelPromotedV1.safeParse(
        withFields(promoted, { profile: { policy_version: PS, ai_mode: 'OFFLINE', sp1_state: 'pass' } }),
      ).success,
    ).toBe(false);
    expect(LearningLevelPromotedV1.safeParse(withFields(promoted, { to_level: 6 })).success).toBe(false);

    const merged = {
      checkpoint_id: ULID,
      root_hash: SHA,
      imported_events: 3,
      devices: [{ device_id: ULID_B, seq: 1, head_hash: SHA }],
    };
    expect(LearningLedgerMergedV1.safeParse(merged).success).toBe(true);
    expect(
      LearningLedgerMergedV1.safeParse(
        withFields(merged, { devices: Array.from({ length: 33 }, () => merged.devices[0]) }),
      ).success,
    ).toBe(false);
    expect(LearningLedgerMergedV1.safeParse(withFields(merged, { imported_events: -1 })).success).toBe(false);
  });

  it('UT-CON-194 LEARNING_EVENTS(IF-EV-08~13)·learning.json 7구독·형식·verdict.issued reads = Verdict 38필드·halt 3종 [NFR-MAINT-003][AQ-02]', async () => {
    expect(Object.keys(LEARNING_EVENTS)).toEqual([
      'learning.evidence.recorded',
      'learning.session.completed',
      'learning.demand.forecasted',
      'learning.mastery.changed',
      'learning.level.promoted',
      'learning.ledger.merged',
    ]);
    const meta = Object.entries(LEARNING_EVENTS).map(([type, e]) => [
      type,
      e.ifId,
      e.producer,
      e.freeze,
      e.slice,
      Object.keys(e.versions),
    ]);
    expect(meta).toEqual([
      ['learning.evidence.recorded', 'IF-EV-08', 'learning', 'D', 'R0', ['1']],
      ['learning.session.completed', 'IF-EV-09', 'learning', 'D', 'R0', ['1']],
      ['learning.demand.forecasted', 'IF-EV-10', 'learning', 'D', 'R1', ['1']],
      ['learning.mastery.changed', 'IF-EV-11', 'learning', 'D', 'R1', ['1']],
      ['learning.level.promoted', 'IF-EV-12', 'learning', 'D', 'R1', ['1']],
      ['learning.ledger.merged', 'IF-EV-13', 'learning', 'D', 'R1', ['1']],
    ]);
    expect(LEARNING_EVENTS['learning.evidence.recorded'].versions[1]).toBe(LearningEvidenceRecordedV1);
    expect(LEARNING_EVENTS['learning.ledger.merged'].versions[1]).toBe(LearningLedgerMergedV1);

    const text = await readFile(MANIFEST, 'utf8');
    const json: unknown = JSON.parse(text);
    const parsed = ConsumerManifest.safeParse(json);
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }
    expect(parsed.data.consumer).toBe('learning');
    expect(parsed.data.subscriptions).toHaveLength(7);
    expect(parsed.data.subscriptions.map((s) => s.type)).toEqual([
      'catalog.pack.activated',
      'catalog.concept.changed',
      'grading.verdict.issued',
      'grading.verdict.revised',
      'itembank.item.corrected',
      'ai.mode.changed',
      'ops.host_state.changed',
    ]);
    for (const s of parsed.data.subscriptions) {
      expect(s.schema_versions, s.type).toEqual([1]);
      expect(s.mode, s.type).toBe('durable');
    }
    // 형식: 2칸 들여쓰기·키 순서·끝 줄바꿈 1개
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
    expect(Object.keys(json as object)).toEqual(['consumer', 'subscriptions']);
    for (const s of parsed.data.subscriptions) {
      expect(Object.keys(s), s.type).toEqual(['type', 'schema_versions', 'mode', 'on_poison', 'reads']);
    }
    expect(text.startsWith('{\n  "consumer": "learning",\n  "subscriptions": [\n    {\n      "type":')).toBe(true);
    // E5: grading.verdict.issued reads = Verdict 전 필드(Object.keys(Verdict.shape) 순서 38개)
    const issued = parsed.data.subscriptions.find((s) => s.type === 'grading.verdict.issued');
    expect(Object.keys(Verdict.shape)).toHaveLength(38);
    expect(issued?.reads).toEqual(Object.keys(Verdict.shape));
    // 독 이벤트(원장 경로) halt 3종
    expect(parsed.data.subscriptions.filter((s) => s.on_poison === 'halt').map((s) => s.type)).toEqual([
      'grading.verdict.issued',
      'grading.verdict.revised',
      'itembank.item.corrected',
    ]);
    expect(parsed.data.subscriptions.filter((s) => s.on_poison === 'dead_letter')).toHaveLength(4);
    const revised = parsed.data.subscriptions.find((s) => s.type === 'grading.verdict.revised');
    expect(revised?.reads).toEqual(['verdict', 'supersedes_verdict_id', 'reason', 'band_changed']);
  });
});
