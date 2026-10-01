import { describe, expect, it } from 'vitest';
import {
  AppealReason,
  AppealView,
  EvidenceParams,
  GradeAttemptRequest,
  JudgeTurnRequest,
  JudgeTurnResponse,
  PendingGradeView,
} from '../../../src/http/content/v1/grading.js';
import {
  AnswerRevealPostSubmit,
  CorrectAnswer,
  FeedbackPostSubmit,
  GradeAttemptResponse,
  SelfGradeFormPostSubmit,
} from '../../../src/http/content/v1/post-submit/grading.js';
import { JudgeCardPostSubmit } from '../../../src/http/content/v1/post-submit/judge-card.js';
import {
  AppealBody,
  ConfirmRatingAck,
  ConfirmRatingBody,
  CreateAppealBody,
  SelfAssessmentAck,
  SelfAssessmentBody,
  SelfGradeBody,
  SubmitAttemptBody,
} from '../../../src/http/learning/v1/attempts.js';
import { itemDelivery, SHA, ULID, ULID_B, verdict } from './samples.js';

const wGrader = {
  D: 1,
  J_calibrated: 0.9,
  J_uncalibrated: 0.5,
  J_low_confidence: 0.3,
  LJ: 0.6,
  H: 0.4,
  S: 0.3,
  PENDING: 0,
};
const evidence = {
  policy_version: 'ps_0123456789abcdef',
  w_format: 0.5,
  w_grader_table: wGrader,
  rapid: false,
  gaming_factor: 1,
};
const gradeReq = {
  attempt_id: ULID,
  session_id: ULID_B,
  block_id: null,
  run_id: null,
  item_id: 'k8s.probes.i01',
  item_content_hash: SHA,
  phase: 'practice',
  response: { kind: 'ox', value: true },
  confidence: 2,
  latency_ms: 1500,
  hints_used: 0,
  answered_at: 1_700_000_000_000,
  evidence_params: evidence,
  engine_constraints: { calibrated_only: false },
  ai_mode_observed: 'OFFLINE',
};
const appealView = {
  appeal_id: ULID,
  verdict_id: ULID_B,
  reason: 'ambiguous',
  state: 'classifying',
  classification: { label: 'ambiguous', engine: 'J', confidence: 0.7 },
  new_verdict_id: null,
  rejection_reason_ko: null,
  created_at: 1,
  decided_at: null,
};
const turnReq = {
  dialog_id: ULID,
  turn_id: ULID_B,
  dialog_kind: 'dig',
  concept_id: 'k8s.probes',
  session_id: null,
  level: 3,
  depth: 2,
  depth_max_allowed: 4,
  state_summary: {
    moves: ['probe_why'],
    covered_ku_ids: ['k8s.probes.k01'],
    flagged_mc_ids: [],
    fail_streak: 0,
    asks_for_answer_count: 0,
    turn_count: 1,
  },
  turn_text: '재시작 루프가 생깁니다.',
  d4_choice: null,
  artifact_ref: null,
  evidence_params: evidence,
  ai_mode_observed: 'FULL',
};
const turnRes = {
  turn_id: ULID_B,
  judgement: { label: 'partial', mc_id: null, asks_for_answer: false, engine: 'J', calibrated: true, badge: 'ai' },
  next_move: { move: 'probe_how', target_ku_id: null, target_mc_id: null, depth: 3 },
  utterance: { kind: 'static', text_md: '어떻게 막을 수 있을까요?', source: 'question_bank' },
  d4_item: null,
  verdict: null,
  end: { ended: false, reason: null },
};

describe('content grading.ts 스키마', () => {
  it('UT-CON-105 EvidenceParams(w_grader_table.PENDING ≠ 0 거부)·GradeAttemptRequest·JudgeTurnRequest/Response·PendingGradeView [FR-QST-017][FR-STD-020][FR-AI-012]', () => {
    expect(EvidenceParams.safeParse(evidence).success).toBe(true);
    expect(EvidenceParams.safeParse({ ...evidence, w_grader_table: { ...wGrader, PENDING: 0.1 } }).success).toBe(false);
    expect(EvidenceParams.safeParse({ ...evidence, gaming_factor: 1.5 }).success).toBe(false);
    expect(EvidenceParams.safeParse({ ...evidence, policy_version: 'p1' }).success).toBe(false);

    expect(GradeAttemptRequest.safeParse(gradeReq).success).toBe(true);
    expect(GradeAttemptRequest.safeParse({ ...gradeReq, hints_used: 5 }).success).toBe(false);
    expect(GradeAttemptRequest.safeParse({ ...gradeReq, phase: 'exam' }).success).toBe(false);
    expect(GradeAttemptRequest.safeParse({ ...gradeReq, extra: 1 }).success).toBe(false);

    expect(JudgeTurnRequest.safeParse(turnReq).success).toBe(true);
    expect(JudgeTurnRequest.safeParse({ ...turnReq, depth: 8 }).success).toBe(false);
    expect(JudgeTurnRequest.safeParse({ ...turnReq, turn_text: '' }).success).toBe(false);
    expect(JudgeTurnResponse.safeParse(turnRes).success).toBe(true);
    expect(JudgeTurnResponse.safeParse({ ...turnRes, d4_item: itemDelivery, verdict }).success).toBe(true);
    expect(JudgeTurnResponse.safeParse({ ...turnRes, extra: 1 }).success).toBe(false);

    const pending = {
      verdict_id: ULID,
      attempt_id: ULID_B,
      item_id: 'k8s.probes.i01',
      format: 'essay',
      queued_at: 1,
      reason: 'offline',
      attempts: 0,
      next_try_at: null,
    };
    expect(PendingGradeView.safeParse(pending).success).toBe(true);
    expect(PendingGradeView.shape.reason.options).toHaveLength(6);
    expect(PendingGradeView.safeParse({ ...pending, reason: 'other' }).success).toBe(false);

    expect(AppealReason.options).toHaveLength(5);
    expect(AppealView.safeParse(appealView).success).toBe(true);
    expect(AppealView.safeParse({ ...appealView, state: 'closed' }).success).toBe(false);

    // --- (이어서)
    const submit = {
      attempt_id: ULID,
      block_id: ULID_B,
      item_id: 'k8s.probes.i01',
      item_content_hash: SHA,
      response: { kind: 'ox', value: false },
      confidence: null,
      presented_at: 1,
      answered_at: 2,
      hints_used: 4,
      timer_extended: false,
    };
    expect(SubmitAttemptBody.safeParse(submit).success).toBe(true);
    expect(SubmitAttemptBody.safeParse({ ...submit, hints_used: 5 }).success).toBe(false);
    expect(SubmitAttemptBody.safeParse({ ...submit, extra: 1 }).success).toBe(false);

    expect(SelfGradeBody.options).toHaveLength(2);
    expect(SelfGradeBody.safeParse({ decision: 'grade', checks: { u01: 3 }, overall: 3 }).success).toBe(true);
    expect(SelfGradeBody.safeParse({ decision: 'grade', checks: { u01: 5 }, overall: null }).success).toBe(false);
    expect(SelfGradeBody.safeParse({ decision: 'skip' }).success).toBe(true);
    expect(SelfGradeBody.safeParse({ decision: 'skip', checks: {} }).success).toBe(false);
    expect(SelfGradeBody.safeParse({ decision: 'later' }).success).toBe(false);

    expect(ConfirmRatingBody.safeParse({ accept: true, rating: 3 }).success).toBe(true);
    expect(ConfirmRatingBody.safeParse({ accept: true, rating: 5 }).success).toBe(false);
    expect(ConfirmRatingAck.safeParse({ ledger_event_id: ULID, applied_rating: 4 }).success).toBe(true);

    for (const reason of AppealReason.options) {
      expect(
        CreateAppealBody.safeParse({ appeal_id: ULID, verdict_id: ULID_B, reason, text: null }).success,
        reason,
      ).toBe(true);
      expect(AppealBody.safeParse({ appeal_id: ULID, reason, text: '이유' }).success, reason).toBe(true);
    }
    expect(
      CreateAppealBody.safeParse({ appeal_id: ULID, verdict_id: ULID_B, reason: 'rude', text: null }).success,
    ).toBe(false);
    expect(
      CreateAppealBody.safeParse({ appeal_id: ULID, verdict_id: ULID_B, reason: 'other', text: 'x'.repeat(2001) })
        .success,
    ).toBe(false);

    const sa = { assessment_id: ULID, kind: 'bias_probe', target: { kind: 'item', id: 'k8s.probes.i01' }, value: 3 };
    expect(SelfAssessmentBody.safeParse(sa).success).toBe(true);
    expect(SelfAssessmentBody.safeParse({ ...sa, value: 5 }).success).toBe(false);
    expect(SelfAssessmentAck.safeParse({ ledger_event_id: ULID }).success).toBe(true);
    expect(SelfAssessmentAck.safeParse({ ledger_event_id: ULID, extra: 1 }).success).toBe(false);
  });
});

const answers = [
  { kind: 'ox', value: true },
  { kind: 'choice', option_keys: ['opt_a'] },
  { kind: 'text', accepted: ['정답'] },
  { kind: 'cloze', blanks: { b01: ['x'] } },
  { kind: 'matching', pairs: { l01: 'r01' } },
  { kind: 'numeric', value: 3, tolerance_log10: 0.1 },
  { kind: 'positions', keys: ['l01'] },
  {
    kind: 'code',
    reference_md: null,
    hidden_tests: { passed: 3, failed: 0, cases: [{ case_key: 'c01', ok: true }] },
    complexity: { slope: 1, method: 'ops', target_order: 1, passed: true },
  },
  { kind: 'sql', reference_sql: null, result_match: true },
  { kind: 'cond_pair', answers: { a: ['opt_a'], b: ['opt_b'] }, pivot_ko: '전환점' },
  { kind: 'rubric', units: { u01: { label_ko: '핵심', ku_id: null } } },
  { kind: 'case_decision', best_option_key: 'opt_a', scores: { opt_a: 1 } },
  { kind: 'none' },
];
const reveal = {
  answer: { kind: 'none' },
  explanation_md: null,
  model_answer_md: null,
  cited_ku_ids: [],
  runner: null,
};

describe('content post-submit 스키마', () => {
  it('UT-CON-106 CorrectAnswer 13종, GradeAttemptResponse 2 status [FR-QST-022]', () => {
    expect(CorrectAnswer.options).toHaveLength(13);
    for (const a of answers) {
      expect(CorrectAnswer.safeParse(a).success, a.kind).toBe(true);
    }
    expect(CorrectAnswer.safeParse({ kind: 'essay' }).success).toBe(false);
    expect(CorrectAnswer.safeParse({ kind: 'ox', value: true, extra: 1 }).success).toBe(false);
    expect(CorrectAnswer.safeParse({ kind: 'numeric', value: 1, tolerance_log10: -1 }).success).toBe(false);
    expect(AnswerRevealPostSubmit.safeParse(reveal).success).toBe(true);

    const feedback = { summary_md: '요약', per_unit: {}, misconception: null, source: 'template', stream_ref: null };
    expect(FeedbackPostSubmit.safeParse(feedback).success).toBe(true);
    expect(FeedbackPostSubmit.safeParse({ ...feedback, source: 'human' }).success).toBe(false);

    const graded = {
      status: 'graded',
      verdict,
      badge: 'none',
      feedback,
      reveal,
      upgrade_pending: false,
      continuation: null,
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
      heuristic_preview: { units: { u01: { covered: true, p: 0.8 } } },
    };
    expect(GradeAttemptResponse.options).toHaveLength(2);
    expect(GradeAttemptResponse.safeParse(graded).success).toBe(true);
    expect(GradeAttemptResponse.safeParse(awaiting).success).toBe(true);
    expect(GradeAttemptResponse.safeParse({ ...graded, status: 'pending' }).success).toBe(false);
    expect(GradeAttemptResponse.safeParse({ ...awaiting, extra: 1 }).success).toBe(false);
    expect(SelfGradeFormPostSubmit.safeParse(awaiting.self_grade_form).success).toBe(true);
    expect(
      SelfGradeFormPostSubmit.safeParse({
        ...awaiting.self_grade_form,
        rubric: { u01: { label_ko: '핵심', kind: 'kp', ku_id: null, levels: ['하나'] } },
      }).success,
    ).toBe(false);
  });

  it('UT-CON-107 JudgeCardPostSubmit.units 객체 키(u03) 통과·"0" 키 거부 [FR-AI-011][UR-16]', () => {
    const unit = { label_ko: '누락', kind: 'kp', outcome: 'missing', p: 0.91, score: null, ku_id: null, mc_id: null };
    const card = {
      verdict_id: ULID,
      attempt_id: ULID_B,
      item_id: 'k8s.probes.i01',
      format: 'essay',
      engine: 'J',
      badge: 'ai',
      calibrated: true,
      confidence: 0.8,
      model_version: 'jev-1',
      prompt_version: '1.0.0',
      judge_log_ref: null,
      units: { u03: unit },
      cited_ku_ids: [],
      supersedes: null,
      superseded_by: null,
      appeal: null,
      issued_at: 1,
    };
    expect(JudgeCardPostSubmit.safeParse(card).success).toBe(true);
    expect(JudgeCardPostSubmit.safeParse({ ...card, units: { '0': unit } }).success).toBe(false);
    expect(JudgeCardPostSubmit.safeParse({ ...card, units: { U03: unit } }).success).toBe(false);
    expect(JudgeCardPostSubmit.safeParse({ ...card, units: { u03: { ...unit, outcome: 'maybe' } } }).success).toBe(
      false,
    );
    expect(JudgeCardPostSubmit.safeParse({ ...card, appeal: appealView }).success).toBe(true);
    expect(JudgeCardPostSubmit.safeParse({ ...card, extra: 1 }).success).toBe(false);
  });
});
