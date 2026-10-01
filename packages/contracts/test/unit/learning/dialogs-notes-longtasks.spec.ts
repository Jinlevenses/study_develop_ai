import { describe, expect, it } from 'vitest';
import {
  DialogView,
  EndDialogBody,
  StartDialogBody,
  SubmitTurnBody,
  TurnOutcome,
} from '../../../src/http/learning/v1/dialogs.js';
import {
  ArtifactDraftBody,
  ArtifactRunView,
  ArtifactSubmitBody,
  CaseEvidenceRequestBody,
  CaseRunView,
  LongTaskAttemptBody,
  StartArtifactRunBody,
  StartCaseRunBody,
} from '../../../src/http/learning/v1/longtasks.js';
import { NoteDraftBody, NoteView } from '../../../src/http/learning/v1/notes.js';
import { ArtifactRunPostSubmit } from '../../../src/http/learning/v1/post-submit/artifact.js';
import { CaseRunPostSubmit } from '../../../src/http/learning/v1/post-submit/case.js';
import { NotePostSubmit } from '../../../src/http/learning/v1/post-submit/note.js';
import { ArtifactRunPreSubmit } from '../../../src/http/learning/v1/pre-submit/artifact.js';
import { CaseRunPreSubmit } from '../../../src/http/learning/v1/pre-submit/case.js';
import { NotePreSubmit } from '../../../src/http/learning/v1/pre-submit/note.js';
import { itemDelivery, NOW, SHA, ULID, ULID_B, withFields } from './samples.js';

const judgement = {
  label: 'partial',
  mc_id: null,
  asks_for_answer: false,
  engine: 'D',
  calibrated: false,
  badge: 'none',
};
const turn = {
  turn_id: ULID,
  role: 'learner',
  created_at: NOW,
  text_md: '답',
  judgement: null,
  move: null,
  utterance: null,
  verdict_id: null,
};
const dialog = {
  dialog_id: ULID,
  kind: 'dig',
  concept_id: 'k8s.probes',
  state: 'active',
  session_id: null,
  block_id: null,
  artifact_run_id: null,
  depth: 1,
  depth_max_allowed: 3,
  turn_count: 0,
  turn_limit: 12,
  fail_streak: 0,
  turns: [turn],
  discovered: [],
  pending_d4_item: null,
  ended_reason: null,
};
const notePre = {
  phase: 'pre_submit',
  block_id: ULID,
  session_id: ULID_B,
  concept_id: 'k8s.probes',
  ladder_step: 'BN-1',
  prompt_md: '백지에 써 보세요',
  item: itemDelivery,
  draft: null,
  timer: { limit_ms: null, extensions: [1.5, 2] },
};
const notePost = {
  phase: 'post_submit',
  block_id: ULID,
  session_id: ULID_B,
  concept_id: 'k8s.probes',
  ladder_step: 'BN-2',
  submitted_text: '제출 본문',
  submitted_at: NOW,
  attempt_id: ULID,
  verdict_id: null,
  status: 'graded',
  diff: null,
  model_note_md: null,
  followups: { cards: [], ox_item_ids: [], import_candidates_ko: [], recall_scheduled: [] },
  judge_card: null,
};
const casePre = {
  phase: 'pre_submit',
  run_id: ULID,
  case_id: 'k8s.case.liveness-restart-storm',
  variant_id: 'v1',
  state: 'active',
  started_at: NOW,
  alarm_md: '새벽 3시 경보',
  evidence: { e_logs: { label_ko: '로그', cost: 1, revealed: false, content_md: null } },
  evidence_requests: [],
  current_node: null,
  decisions: [],
};
const casePost = {
  phase: 'post_submit',
  run_id: ULID,
  case_id: 'k8s.case.liveness-restart-storm',
  variant_id: 'v1',
  state: 'graded',
  started_at: NOW,
  finished_at: NOW + 1,
  decisions: [],
  score: {
    decision_score: 0.5,
    rubric_score: null,
    total: null,
    mttr_sim_min: null,
    evidence_efficiency: null,
    offline_weighting: false,
  },
  debrief_md: '복기',
};
const artifactPre = {
  phase: 'pre_submit',
  run_id: ULID,
  artifact_id: 'sre.art.postmortem-cascading-latency',
  template_kind: 'postmortem',
  template_md: '# 템플릿',
  item: itemDelivery,
  draft: null,
};
const artifactPost = {
  phase: 'post_submit',
  run_id: ULID,
  artifact_id: 'sre.art.postmortem-cascading-latency',
  template_kind: 'adr',
  state: 'graded',
  submitted_text: '본문',
  attempt_id: ULID_B,
  verdict_id: null,
  dimensions: { d_clarity: { label_ko: '명료성', score: 2, max: 4 } },
  rebuttal_dialog_ids: [],
  exemplar_md: null,
};

describe('learning dialogs.ts · notes.ts · longtasks.ts', () => {
  it('UT-CON-183 DialogView(turn_limit 12만·turns 31 거부)·NoteView phase 2종·NotePostSubmit.judge_card null [FR-STD-018][FR-STD-020]', () => {
    expect(DialogView.safeParse(dialog).success).toBe(true);
    expect(DialogView.safeParse(withFields(dialog, { turn_limit: 11 })).success).toBe(false);
    expect(DialogView.safeParse(withFields(dialog, { turn_limit: 13 })).success).toBe(false);
    expect(DialogView.safeParse(withFields(dialog, { turns: Array.from({ length: 30 }, () => turn) })).success).toBe(
      true,
    );
    expect(DialogView.safeParse(withFields(dialog, { turns: Array.from({ length: 31 }, () => turn) })).success).toBe(
      false,
    );
    expect(DialogView.safeParse(withFields(dialog, { depth: 8 })).success).toBe(false);
    expect(DialogView.safeParse({ ...dialog, extra: 1 }).success).toBe(false);
    const streamTurn = {
      ...turn,
      role: 'system',
      text_md: null,
      judgement,
      move: 'probe_why',
      utterance: { kind: 'stream', stream_ref: ULID, expires_at: NOW, fallback_text_md: '대체 문장' },
    };
    expect(DialogView.safeParse(withFields(dialog, { turns: [streamTurn] })).success).toBe(true);
    expect(DialogView.safeParse(withFields(dialog, { turns: [{ ...turn, move: 'nope' }] })).success).toBe(false);

    expect(
      StartDialogBody.safeParse({
        dialog_id: ULID,
        kind: 'dig',
        concept_id: 'k8s.probes',
        session_id: null,
        block_id: null,
      }).success,
    ).toBe(true);
    expect(
      StartDialogBody.safeParse({
        dialog_id: ULID,
        kind: 'artifact_rebuttal',
        concept_id: 'k8s.probes',
        session_id: null,
        block_id: null,
      }).success,
    ).toBe(false);
    expect(SubmitTurnBody.safeParse({ turn_id: ULID, text: '답', answered_at: NOW, d4_choice: null }).success).toBe(
      true,
    );
    expect(SubmitTurnBody.safeParse({ turn_id: ULID, text: '', answered_at: NOW, d4_choice: null }).success).toBe(
      false,
    );
    expect(
      SubmitTurnBody.safeParse({ turn_id: ULID, text: 'x'.repeat(4001), answered_at: NOW, d4_choice: null }).success,
    ).toBe(false);
    const outcome = {
      turn_id: ULID,
      judgement,
      move: 'wrap_up',
      depth: 7,
      utterance: { kind: 'static', text_md: '정리', source: 'template' },
      d4_item: null,
      verdict_id: null,
      ended: true,
      ended_reason: 'completed',
    };
    expect(TurnOutcome.safeParse(outcome).success).toBe(true);
    expect(TurnOutcome.safeParse({ ...outcome, depth: 8 }).success).toBe(false);
    expect(EndDialogBody.safeParse({ reason: 'learner' }).success).toBe(true);
    expect(EndDialogBody.safeParse({ reason: 'turn_limit' }).success).toBe(false);

    expect(NoteView.options).toHaveLength(2);
    expect(NotePreSubmit.safeParse(notePre).success).toBe(true);
    expect(NoteView.safeParse(notePre).success).toBe(true);
    expect(NoteView.safeParse(notePost).success).toBe(true);
    expect(NotePostSubmit.safeParse(notePost).success).toBe(true);
    expect(NotePostSubmit.shape.judge_card.safeParse(null).success).toBe(true);
    expect(NotePostSubmit.shape.judge_card.safeParse({}).success).toBe(false);
    expect(NoteView.safeParse(withFields(notePre, { phase: 'draft' })).success).toBe(false);
    expect(NoteView.safeParse({ ...notePre, extra: 1 }).success).toBe(false);
    expect(NoteView.safeParse(withFields(notePre, { timer: { limit_ms: null, extensions: [3] } })).success).toBe(false);
    expect(NoteView.safeParse(withFields(notePost, { status: 'done' })).success).toBe(false);
    expect(
      NoteDraftBody.safeParse({ text: '메모', updated_at: NOW, uncertain_spans: [{ start: 0, end: 1 }] }).success,
    ).toBe(true);
    expect(NoteDraftBody.safeParse({ text: 'x'.repeat(20_001), updated_at: NOW, uncertain_spans: [] }).success).toBe(
      false,
    );
  });

  it('UT-CON-184 CaseRunView·ArtifactRunView phase 2종·StartCaseRunBody.variant_seed 2^31 거부 [FR-STD-025][FR-STD-026]', () => {
    expect(CaseRunView.options).toHaveLength(2);
    expect(CaseRunPreSubmit.safeParse(casePre).success).toBe(true);
    expect(CaseRunPostSubmit.safeParse(casePost).success).toBe(true);
    expect(CaseRunView.safeParse(casePre).success).toBe(true);
    expect(CaseRunView.safeParse(casePost).success).toBe(true);
    expect(CaseRunView.safeParse(withFields(casePre, { phase: 'draft' })).success).toBe(false);
    expect(CaseRunView.safeParse({ ...casePre, extra: 1 }).success).toBe(false);
    expect(CaseRunView.safeParse(withFields(casePre, { state: 'graded' })).success).toBe(false); // pre_submit = active만
    expect(CaseRunView.safeParse(withFields(casePost, { state: 'active' })).success).toBe(false);

    expect(ArtifactRunView.options).toHaveLength(2);
    expect(ArtifactRunPreSubmit.safeParse(artifactPre).success).toBe(true);
    expect(ArtifactRunPostSubmit.safeParse(artifactPost).success).toBe(true);
    expect(ArtifactRunView.safeParse(artifactPre).success).toBe(true);
    expect(ArtifactRunView.safeParse(artifactPost).success).toBe(true);
    expect(ArtifactRunView.safeParse(withFields(artifactPost, { state: 'rebuttal' })).success).toBe(true);
    expect(ArtifactRunView.safeParse(withFields(artifactPost, { state: 'pending' })).success).toBe(false);
    expect(ArtifactRunView.safeParse(withFields(artifactPre, { template_kind: 'rfc' })).success).toBe(false);
    expect(ArtifactRunView.safeParse({ ...artifactPost, extra: 1 }).success).toBe(false);

    const start = {
      run_id: ULID,
      case_id: 'k8s.case.liveness-restart-storm',
      session_id: null,
      block_id: null,
      variant_seed: null,
    };
    expect(StartCaseRunBody.safeParse(start).success).toBe(true);
    expect(StartCaseRunBody.safeParse({ ...start, variant_seed: 2_147_483_647 }).success).toBe(true);
    expect(StartCaseRunBody.safeParse({ ...start, variant_seed: 2_147_483_648 }).success).toBe(false); // 2^31
    expect(StartCaseRunBody.safeParse({ ...start, variant_seed: -1 }).success).toBe(false);
    expect(StartCaseRunBody.safeParse({ ...start, extra: 1 }).success).toBe(false);
    expect(CaseEvidenceRequestBody.safeParse({ request_id: ULID, evidence_key: 'e_logs' }).success).toBe(true);
    expect(CaseEvidenceRequestBody.safeParse({ request_id: ULID, evidence_key: 'E-LOGS' }).success).toBe(false);
    const attempt = {
      attempt_id: ULID,
      item_id: 'k8s.probes.i01',
      item_content_hash: SHA,
      response: { kind: 'case_decision', option_key: 'opt_a', rationale: null },
      confidence: 2,
      presented_at: NOW,
      answered_at: NOW + 1,
    };
    expect(LongTaskAttemptBody.safeParse(attempt).success).toBe(true);
    expect(LongTaskAttemptBody.safeParse({ ...attempt, confidence: 4 }).success).toBe(false);
    expect(
      StartArtifactRunBody.safeParse({
        run_id: ULID,
        artifact_id: 'sre.art.postmortem-cascading-latency',
        session_id: null,
        block_id: null,
      }).success,
    ).toBe(true);
    expect(ArtifactDraftBody.safeParse({ text: 'x'.repeat(40_000), updated_at: NOW }).success).toBe(true);
    expect(ArtifactDraftBody.safeParse({ text: 'x'.repeat(40_001), updated_at: NOW }).success).toBe(false);
    expect(ArtifactSubmitBody.safeParse({ attempt_id: ULID, text: '', confidence: null }).success).toBe(false);
    expect(ArtifactSubmitBody.safeParse({ attempt_id: ULID, text: '제출', confidence: 1 }).success).toBe(true);
  });
});
