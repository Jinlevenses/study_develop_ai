import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ACQUISITION_EVENTS, AcquisitionImportStagedV1 } from '../../../src/events/catalog/acquisition.js';
import { AI_EVENTS } from '../../../src/events/catalog/ai.js';
import {
  CATALOG_EVENTS,
  CatalogConceptChangedV1,
  CatalogOverlayConflictedV1,
  CatalogPackActivatedV1,
  ConceptRef,
} from '../../../src/events/catalog/catalog.js';
import { GRADING_EVENTS, GradingVerdictRevisedV1, Verdict } from '../../../src/events/catalog/grading.js';
import { ITEMBANK_EVENTS, ItembankItemCorrectedV1 } from '../../../src/events/catalog/itembank.js';
import { ConsumerManifest } from '../../../src/events/consumer-manifest.js';
import { EventType } from '../../../src/events/envelope.js';
import { conceptRef, SHA, ULID, ULID_B, verdict } from './samples.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONSUMERS_DIR = resolve(HERE, '../../../src/events/__consumers__');

const activated = {
  pack_id: 'k8s',
  track: 'k8s',
  version: '1.2.0',
  channel: 'local',
  manifest_hash: SHA,
  merkle_root: SHA,
  previous_version: '1.1.0',
  changed_concept_ids: ['k8s.probes'],
  changed_ku_ids: ['k8s.probes.k01'],
  offline_cap_level: 3,
  catalog_version: 7,
  activated_at: 1_700_000_000_000,
};

describe('content 이벤트 payload (catalog)', () => {
  it('UT-CON-116 ConceptRef·CatalogPackActivatedV1(channel getter)·CatalogConceptChangedV1.change 4종·CatalogOverlayConflictedV1 [FR-CUR-002][IF-EV-01~03]', () => {
    expect(ConceptRef.safeParse(conceptRef).success).toBe(true);
    expect(ConceptRef.safeParse({ ...conceptRef, extra: 1 }).success).toBe(false);
    expect(ConceptRef.safeParse({ ...conceptRef, version: -1 }).success).toBe(false);
    expect(ConceptRef.safeParse({ ...conceptRef, tags: ['nope'] }).success).toBe(false);

    expect(CatalogPackActivatedV1.safeParse(activated).success).toBe(true);
    expect(CatalogPackActivatedV1.safeParse({ ...activated, channel: 'seed' }).success).toBe(true);
    expect(CatalogPackActivatedV1.safeParse({ ...activated, channel: 'x' }).success).toBe(false);
    expect(CatalogPackActivatedV1.safeParse({ ...activated, extra: 1 }).success).toBe(false);
    expect(CatalogPackActivatedV1.safeParse({ ...activated, offline_cap_level: 6 }).success).toBe(false);

    const changed = { change: 'published', concept: conceptRef, pack_id: 'k8s', version: '1.2.0' };
    expect(CatalogConceptChangedV1.safeParse(changed).success).toBe(true);
    expect(CatalogConceptChangedV1.shape.change.options).toEqual([
      'published',
      'revised',
      'deprecated',
      'tier_promoted',
    ]);
    for (const change of CatalogConceptChangedV1.shape.change.options) {
      expect(CatalogConceptChangedV1.safeParse({ ...changed, change }).success, change).toBe(true);
    }
    expect(CatalogConceptChangedV1.safeParse({ ...changed, change: 'removed' }).success).toBe(false);

    const conflicted = {
      conflict_id: ULID,
      patch_id: ULID_B,
      target_kind: 'item',
      target_id: 'k8s.probes.i01',
      field: 'answer',
      base_version: SHA,
      new_base_version: SHA,
    };
    expect(CatalogOverlayConflictedV1.safeParse(conflicted).success).toBe(true);
    expect(CatalogOverlayConflictedV1.safeParse({ ...conflicted, target_kind: 'pack' }).success).toBe(false);
    expect(CatalogOverlayConflictedV1.safeParse({ ...conflicted, field: 'f'.repeat(81) }).success).toBe(false);
  });

  it('UT-CON-117 AcquisitionImportStagedV1·Verdict(item_n_options 0·recommended_grade 0/5 거부·result 4종)·GradingVerdictRevisedV1.reason 3종·ItembankItemCorrectedV1.basis 6종 [IF-EV-04~07][FR-QST-011]', () => {
    const staged = {
      job_id: ULID,
      source_kind: 'paste',
      diff_summary: { concepts: 1, kus: 2, items: 3 },
      requires_approval: true,
    };
    expect(AcquisitionImportStagedV1.safeParse(staged).success).toBe(true);
    expect(AcquisitionImportStagedV1.safeParse({ ...staged, source_kind: 'folder' }).success).toBe(false);
    expect(
      AcquisitionImportStagedV1.safeParse({ ...staged, diff_summary: { concepts: 1, kus: 2, items: 3, conflicts: 0 } })
        .success,
    ).toBe(false);

    expect(Verdict.safeParse(verdict).success).toBe(true);
    expect(Verdict.safeParse({ ...verdict, item_n_options: 0 }).success).toBe(true);
    expect(Verdict.safeParse({ ...verdict, item_n_options: -1 }).success).toBe(false);
    expect(Verdict.safeParse({ ...verdict, recommended_grade: 0 }).success).toBe(false);
    expect(Verdict.safeParse({ ...verdict, recommended_grade: 5 }).success).toBe(false);
    for (const r of [1, 4]) {
      expect(Verdict.safeParse({ ...verdict, recommended_grade: r }).success).toBe(true);
    }
    expect(Verdict.shape.result.options).toEqual(['correct', 'partial', 'incorrect', 'pending']);
    expect(Verdict.safeParse({ ...verdict, result: 'skipped' }).success).toBe(false);
    expect(Verdict.safeParse({ ...verdict, w_grader: 1.1 }).success).toBe(false);
    expect(Verdict.safeParse({ ...verdict, confidence: 4 }).success).toBe(false);
    expect(Verdict.safeParse({ ...verdict, extra: 1 }).success).toBe(false);

    const revised = { verdict, supersedes_verdict_id: ULID_B, reason: 'appeal', band_changed: true };
    expect(GradingVerdictRevisedV1.safeParse(revised).success).toBe(true);
    expect(GradingVerdictRevisedV1.shape.reason.options).toEqual(['deadline_upgrade', 'pending_regrade', 'appeal']);
    expect(GradingVerdictRevisedV1.safeParse({ ...revised, reason: 'manual' }).success).toBe(false);

    const corrected = {
      item_id: 'k8s.probes.i01',
      correction: 'key_fixed',
      evidence_policy: 'void',
      basis: 'pack_upgrade',
      gate_result_id: ULID,
      effective_from: 5,
    };
    expect(ItembankItemCorrectedV1.safeParse(corrected).success).toBe(true);
    expect(ItembankItemCorrectedV1.shape.basis.options).toHaveLength(6);
    expect(ItembankItemCorrectedV1.shape.basis.options).toContain('pack_upgrade');
    expect(ItembankItemCorrectedV1.safeParse({ ...corrected, basis: 'manual' }).success).toBe(false);
    expect(ItembankItemCorrectedV1.safeParse({ ...corrected, correction: 'deleted' }).success).toBe(false);
  });

  it('UT-CON-118 CATALOG·ACQUISITION·GRADING·ITEMBANK _EVENTS 키 = IF-EV-01~07, producer content, versions [1], freeze·slice = §9.3 [NFR-MAINT-003]', () => {
    // IF-01 §9.3 표(IF-ID · type · v · 생산 · 동결·슬라이스)
    const table: Record<string, [string, string, 'D' | 'O', string]> = {
      'IF-EV-01': ['catalog.pack.activated', 'content', 'D', 'R0'],
      'IF-EV-02': ['catalog.concept.changed', 'content', 'D', 'R0'],
      'IF-EV-03': ['catalog.overlay.conflicted', 'content', 'O', 'R2'],
      'IF-EV-04': ['acquisition.import.staged', 'content', 'O', 'R2'],
      'IF-EV-05': ['grading.verdict.issued', 'content', 'D', 'R0'],
      'IF-EV-06': ['grading.verdict.revised', 'content', 'O', 'R2'],
      'IF-EV-07': ['itembank.item.corrected', 'content', 'D', 'R1'],
    };
    const merged = { ...CATALOG_EVENTS, ...ACQUISITION_EVENTS, ...GRADING_EVENTS, ...ITEMBANK_EVENTS };
    expect(Object.keys(merged)).toHaveLength(7);
    expect(Object.keys(CATALOG_EVENTS)).toHaveLength(3);
    expect(Object.keys(ACQUISITION_EVENTS)).toHaveLength(1);
    expect(Object.keys(GRADING_EVENTS)).toHaveLength(2);
    expect(Object.keys(ITEMBANK_EVENTS)).toHaveLength(1);
    expect(Object.keys(merged).sort()).toEqual(
      Object.values(table)
        .map((r) => r[0])
        .sort(),
    );
    for (const [type, e] of Object.entries(merged)) {
      const row = table[e.ifId];
      expect(row?.[0], e.ifId).toBe(type);
      expect(EventType.safeParse(type).success, type).toBe(true);
      expect(e.producer, type).toBe(row?.[1]);
      expect(e.producer, type).toBe('content');
      expect(e.freeze, type).toBe(row?.[2]);
      expect(e.slice, type).toBe(row?.[3]);
      expect(Object.keys(e.versions), type).toEqual(['1']);
    }
    expect(CATALOG_EVENTS['catalog.pack.activated'].versions[1]).toBe(CatalogPackActivatedV1);
    expect(CATALOG_EVENTS['catalog.concept.changed'].versions[1]).toBe(CatalogConceptChangedV1);
    expect(CATALOG_EVENTS['catalog.overlay.conflicted'].versions[1]).toBe(CatalogOverlayConflictedV1);
    expect(ACQUISITION_EVENTS['acquisition.import.staged'].versions[1]).toBe(AcquisitionImportStagedV1);
    expect(GRADING_EVENTS['grading.verdict.issued'].versions[1]).toBe(Verdict);
    expect(GRADING_EVENTS['grading.verdict.revised'].versions[1]).toBe(GradingVerdictRevisedV1);
    expect(ITEMBANK_EVENTS['itembank.item.corrected'].versions[1]).toBe(ItembankItemCorrectedV1);
  });

  it('UT-CON-119 content.json이 ConsumerManifest 통과, 구독 6개(type·mode·on_poison = §9.5), 형식(2칸·끝 줄바꿈 1개), ai.* reads ⊆ 생산자 키 [NFR-MAINT-003][AQ-02]', async () => {
    const text = await readFile(resolve(CONSUMERS_DIR, 'content.json'), 'utf8');
    const manifest = ConsumerManifest.parse(JSON.parse(text));
    expect(manifest.consumer).toBe('content');
    expect(manifest.subscriptions).toHaveLength(6);
    expect(manifest.subscriptions.map((s) => [s.type, s.mode, s.on_poison])).toEqual([
      ['learning.evidence.recorded', 'durable', 'dead_letter'],
      ['learning.session.completed', 'durable', 'dead_letter'],
      ['learning.demand.forecasted', 'durable', 'dead_letter'],
      ['ai.mode.changed', 'durable', 'dead_letter'],
      ['ai.job.completed', 'durable', 'dead_letter'],
      ['ai.work_order.decided', 'durable', 'dead_letter'],
    ]);
    for (const s of manifest.subscriptions) {
      expect(s.schema_versions).toEqual([1]);
    }
    expect(manifest.subscriptions[0]?.reads).toEqual([
      'ledger_event_id',
      'verdict_id',
      'item_id',
      'format',
      'result',
      'latency_ms',
      'rapid',
      'confidence',
      'selected_option_key',
      'recorded_at',
      'phase',
      'item_beta_after',
    ]);
    // 파일 형식: 2칸 들여쓰기(탭 0), 끝 줄바꿈 정확히 1개
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
    expect(text).not.toContain('\t');
    for (const line of text.split('\n')) {
      expect((line.length - line.trimStart().length) % 2, line).toBe(0);
    }
    expect(text.startsWith('{\n  "consumer": "content",\n  "subscriptions": [\n')).toBe(true);
    // 키 순서 = consumer, subscriptions / type, schema_versions, mode, on_poison, reads
    expect(Object.keys(JSON.parse(text))).toEqual(['consumer', 'subscriptions']);
    expect(Object.keys(JSON.parse(text).subscriptions[0])).toEqual([
      'type',
      'schema_versions',
      'mode',
      'on_poison',
      'reads',
    ]);

    // ai.* 구독의 reads ⊆ 생산자(AI_EVENTS) 스키마 최상위 키. learning.* 은 T-00-10 몫.
    for (const s of manifest.subscriptions.filter((x) => x.type.startsWith('ai.'))) {
      const entry = (AI_EVENTS as Record<string, { versions: Record<number, { shape?: object }> }>)[s.type];
      expect(entry, s.type).toBeDefined();
      const keys = Object.keys(entry?.versions[1]?.shape ?? {});
      expect(keys.length, s.type).toBeGreaterThan(0);
      for (const r of s.reads) {
        expect(keys, `${s.type}.${r}`).toContain(r);
      }
    }
  });
});
