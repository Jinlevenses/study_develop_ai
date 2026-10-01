import { describe, expect, it } from 'vitest';
import { AttemptOutcomePostSubmit } from '../../../src/http/learning/v1/post-submit/attempt.js';
import { BlockViewPreSubmit } from '../../../src/http/learning/v1/pre-submit/block.js';
import {
  BlockAlternatives,
  BlockKind,
  BlockSummary,
  CompleteBlockBody,
  ReasonChip,
  SessionReport,
  SessionScope,
  SessionView,
  StartSessionBody,
} from '../../../src/http/learning/v1/sessions.js';
import { blockSummary, feedback, itemDelivery, reveal, sessionView, ULID, ULID_B, withFields } from './samples.js';

describe('learning sessions.ts · pre-submit/block.ts · post-submit/attempt.ts', () => {
  it('UT-CON-180 SessionScope 4·StartSessionBody 7 템플릿(from_level 5 거부)·BlockKind 10·ReasonChip.code 17·CompleteBlockBody 5·SessionView.blocks 61 거부 [FR-STD-001][FR-STD-006]', () => {
    const scopes = [
      { kind: 'all' },
      { kind: 'path', path_id: 'path.backend-core' },
      { kind: 'tracks', tracks: ['k8s'] },
      { kind: 'concepts', concept_ids: ['k8s.probes'] },
    ];
    expect(SessionScope.options).toHaveLength(4);
    for (const s of scopes) {
      expect(SessionScope.safeParse(s).success, s.kind).toBe(true);
    }
    expect(SessionScope.safeParse({ kind: 'tags' }).success).toBe(false);
    expect(SessionScope.safeParse({ kind: 'all', extra: 1 }).success).toBe(false);
    expect(SessionScope.safeParse({ kind: 'tracks', tracks: [] }).success).toBe(false);
    expect(SessionScope.safeParse({ kind: 'concepts', concept_ids: [] }).success).toBe(false);

    const start = [
      { template: 'standard', session_id: ULID, minutes: 15, energy: 'normal', scope: { kind: 'all' } },
      { template: 'placement', session_id: ULID, tracks: ['k8s', 'docker'] },
      { template: 'verify', session_id: ULID, concept_id: 'k8s.probes' },
      { template: 'promotion_exam', session_id: ULID, track: 'k8s', from_level: 2 },
      { template: 'weak_drill', session_id: ULID, minutes: 25, scope: { kind: 'all' } },
      { template: 'dday', session_id: ULID, minutes: 45, energy: 'deep' },
      { template: 'return', session_id: ULID, minutes: 5 },
    ];
    expect(StartSessionBody.options).toHaveLength(7);
    for (const s of start) {
      expect(StartSessionBody.safeParse(s).success, s.template).toBe(true);
      expect(StartSessionBody.safeParse({ ...s, extra: 1 }).success, `${s.template} extra`).toBe(false);
    }
    const exam = { template: 'promotion_exam', session_id: ULID, track: 'k8s', from_level: 4 };
    expect(StartSessionBody.safeParse(exam).success).toBe(true);
    expect(StartSessionBody.safeParse({ ...exam, from_level: 5 }).success).toBe(false);
    expect(StartSessionBody.safeParse({ ...exam, from_level: 0 }).success).toBe(false);
    expect(
      StartSessionBody.safeParse({
        template: 'standard',
        session_id: ULID,
        minutes: 10,
        energy: 'normal',
        scope: { kind: 'all' },
      }).success,
    ).toBe(false);

    expect(BlockKind.options).toHaveLength(10);
    const chip = ReasonChip.shape.code.options;
    expect(chip).toHaveLength(17);
    expect(ReasonChip.safeParse({ code: 'due', label_ko: '복습 시점', value: null }).success).toBe(true);
    expect(ReasonChip.safeParse({ code: 'nope', label_ko: 'x', value: null }).success).toBe(false);
    expect(ReasonChip.safeParse({ code: 'due', label_ko: 'x'.repeat(41), value: null }).success).toBe(false);

    const complete = [
      { kind: 'lesson', stages_done: ['theory', 'core'], duration_ms: 1000 },
      { kind: 'jol', predictions: { 'k8s.probes': 0.5 } },
      { kind: 'reflection', answers_ko: ['배움'] },
      { kind: 'triage', decisions: { [ULID]: 'link' } },
      { kind: 'generic' },
    ];
    expect(CompleteBlockBody.options).toHaveLength(5);
    for (const c of complete) {
      expect(CompleteBlockBody.safeParse(c).success, c.kind).toBe(true);
      expect(CompleteBlockBody.safeParse({ ...c, extra: 1 }).success, `${c.kind} extra`).toBe(false);
    }
    expect(CompleteBlockBody.safeParse({ kind: 'lesson', stages_done: [], duration_ms: 1 }).success).toBe(false);
    expect(CompleteBlockBody.safeParse({ kind: 'jol', predictions: { 'k8s.probes': 1.5 } }).success).toBe(false);

    expect(BlockSummary.safeParse(blockSummary).success).toBe(true);
    expect(BlockSummary.safeParse({ ...blockSummary, extra: 1 }).success).toBe(false);
    expect(SessionView.safeParse(sessionView).success).toBe(true);
    expect(
      SessionView.safeParse({ ...sessionView, blocks: Array.from({ length: 60 }, () => blockSummary) }).success,
    ).toBe(true);
    expect(
      SessionView.safeParse({ ...sessionView, blocks: Array.from({ length: 61 }, () => blockSummary) }).success,
    ).toBe(false);
    expect(SessionView.safeParse({ ...sessionView, extra: 1 }).success).toBe(false);
    expect(SessionView.safeParse({ ...sessionView, state: 'done' }).success).toBe(false);
    expect(BlockAlternatives.safeParse({ block_id: ULID, candidates: [] }).success).toBe(true);
    const report = {
      session_id: ULID,
      completed_at: null,
      duration_ms: 1000,
      blocks_done: 1,
      blocks_total: 2,
      lines_ko: ['한 줄'],
      attempts: { total: 1, correct: 1, partial: 0, incorrect: 0, pending: 0 },
      mastery_changes: [],
      jol: [],
      modes: ['M-01'],
      next_due: { tomorrow: 3, week: 10 },
    };
    expect(SessionReport.safeParse(report).success).toBe(true);
    expect(SessionReport.safeParse({ ...report, lines_ko: [] }).success).toBe(false);
    expect(SessionReport.safeParse({ ...report, lines_ko: ['a', 'b', 'c', 'd'] }).success).toBe(false);
  });

  it('UT-CON-181 BlockViewPreSubmit.payload 10종·getter block이 BlockSummary로 검증(미지 키 거부) [FR-STD-010][FR-UX-016]', () => {
    const payloads = [
      { kind: 'lesson', concept_id: 'k8s.probes', entry_stage: 'theory', page_content_hash: 'a'.repeat(64) },
      { kind: 'items', phase: 'practice', items: [itemDelivery], attempted_item_ids: [] },
      { kind: 'blank_note', concept_id: 'k8s.probes', ladder_step: 'BN-1', item: itemDelivery },
      { kind: 'dialog', dialog_kind: 'dig', concept_id: 'k8s.probes', dialog_id: null },
      { kind: 'lab', item: itemDelivery, runner_enabled: false },
      { kind: 'case', case_id: 'k8s.case.liveness-restart-storm', run_id: null },
      { kind: 'artifact', artifact_id: 'sre.art.postmortem-cascading-latency', run_id: ULID_B },
      { kind: 'jol', concept_ids: ['k8s.probes'] },
      { kind: 'reflection', prompts_ko: ['오늘 배운 것'] },
      { kind: 'triage', inbox_ids: [ULID] },
    ];
    expect(BlockViewPreSubmit.shape.payload.options).toHaveLength(10);
    for (const payload of payloads) {
      const view = { session_id: ULID, block: blockSummary, payload };
      expect(BlockViewPreSubmit.safeParse(view).success, payload.kind).toBe(true);
      expect(BlockViewPreSubmit.safeParse({ ...view, extra: 1 }).success, `${payload.kind} extra`).toBe(false);
      expect(
        BlockViewPreSubmit.safeParse({ ...view, payload: { ...payload, extra: 1 } }).success,
        `${payload.kind} payload extra`,
      ).toBe(false);
    }
    const ok = { session_id: ULID, block: blockSummary, payload: payloads[7] };
    expect(BlockViewPreSubmit.shape.block).toBe(BlockSummary); // getter(E1)가 같은 객체를 돌려준다
    expect(BlockViewPreSubmit.safeParse({ ...ok, block: { ...blockSummary, extra: 1 } }).success).toBe(false);
    expect(BlockViewPreSubmit.safeParse({ ...ok, block: { ...blockSummary, state: 'nope' } }).success).toBe(false);
    expect(
      BlockViewPreSubmit.safeParse({
        ...ok,
        payload: { kind: 'items', phase: 'practice', items: [], attempted_item_ids: [] },
      }).success,
    ).toBe(false);
    expect(BlockViewPreSubmit.safeParse({ ...ok, payload: { kind: 'video' } }).success).toBe(false);
    expect(
      BlockViewPreSubmit.safeParse({
        ...ok,
        payload: { kind: 'blank_note', concept_id: 'k8s.probes', ladder_step: 'BN-6', item: itemDelivery },
      }).success,
    ).toBe(false);
  });

  it('UT-CON-182 AttemptOutcomePostSubmit 2 status·rating null 허용·경계 거부 [FR-QST-019][FR-PRG-002]', () => {
    const graded = {
      status: 'graded',
      attempt_id: ULID,
      verdict_id: ULID_B,
      ledger_event_id: ULID,
      result: 'correct',
      band: 'right',
      score: 1,
      grader_engine: 'D',
      calibrated: false,
      pending: false,
      provisional: false,
      badge: 'none',
      feedback,
      reveal,
      cbm: null,
      rating: null,
      mastery: null,
      continuation: null,
      next_block_id: null,
      upgrade_pending: false,
    };
    const awaiting = {
      status: 'awaiting_self_grade',
      attempt_id: ULID,
      self_grade_form: {
        attempt_id: ULID,
        overall_required: true,
        rubric: { u01: { label_ko: '핵심', kind: 'kp', ku_id: null, levels: ['없음', '있음'] } },
      },
      reveal,
      heuristic_preview: null,
    };
    expect(AttemptOutcomePostSubmit.options).toHaveLength(2);
    expect(AttemptOutcomePostSubmit.safeParse(graded).success).toBe(true);
    expect(AttemptOutcomePostSubmit.safeParse(awaiting).success).toBe(true);
    // rating null 허용(pretest·카드 없음) + 값이 있으면 3필드 구조
    const rating = { recommended: 3, applied: 3, needs_confirmation: false };
    expect(AttemptOutcomePostSubmit.safeParse(withFields(graded, { rating })).success).toBe(true);
    expect(AttemptOutcomePostSubmit.safeParse(withFields(graded, { rating: { ...rating, applied: 5 } })).success).toBe(
      false,
    );
    const mastery = { concept_id: 'k8s.probes', from: 'learning', to: 'mastered', provisional: false };
    expect(AttemptOutcomePostSubmit.safeParse(withFields(graded, { mastery })).success).toBe(true);
    expect(
      AttemptOutcomePostSubmit.safeParse(withFields(graded, { cbm: { confidence: 2, score: 2, max_chosen: 3 } }))
        .success,
    ).toBe(true);
    expect(
      AttemptOutcomePostSubmit.safeParse(
        withFields(graded, { continuation: { next_node: itemDelivery, finished: false, revealed_evidence_keys: [] } }),
      ).success,
    ).toBe(true);
    expect(AttemptOutcomePostSubmit.safeParse(withFields(graded, { score: 1.1 })).success).toBe(false);
    expect(AttemptOutcomePostSubmit.safeParse(withFields(graded, { result: 'maybe' })).success).toBe(false);
    expect(AttemptOutcomePostSubmit.safeParse({ ...graded, extra: 1 }).success).toBe(false);
    expect(AttemptOutcomePostSubmit.safeParse({ ...awaiting, extra: 1 }).success).toBe(false);
    expect(AttemptOutcomePostSubmit.safeParse(withFields(graded, { status: 'pending' })).success).toBe(false);
  });
});
