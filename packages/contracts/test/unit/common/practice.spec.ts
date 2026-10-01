import { describe, expect, it } from 'vitest';
import {
  ArtifactTemplateKind,
  AttemptPhase,
  AttemptResponse,
  DialogEndReason,
  DialogKind,
  DialogMove,
  FeasibilityBlocker,
  PromotionGate,
  TurnJudgement,
  Utterance,
  WGraderTable,
} from '../../../src/common/practice.js';

const ULID = '01HZX3Y5K7M9N2P4Q6R8S0T1V2';

const SAMPLES: Record<string, unknown> = {
  ox: { kind: 'ox', value: true },
  choice: { kind: 'choice', option_keys: ['opt_a', 'opt_b'] },
  text: { kind: 'text', text: '답안' },
  cloze: { kind: 'cloze', blanks: { blank_1: 'x', blank_2: 'y' } },
  matching: { kind: 'matching', pairs: { left_a: 'right_b' } },
  code: { kind: 'code', lang: 'ts', code: 'export const x = 1;' },
  sql: { kind: 'sql', sql: 'select 1' },
  positions: { kind: 'positions', keys: ['line_3'], notes: { line_3: '경계 오류' } },
  numeric: { kind: 'numeric', value: 3.5, unit: null },
  essay: { kind: 'essay', text: '본문', uncertain_spans: [{ start: 0, end: 3 }] },
  cond_pair: { kind: 'cond_pair', answers: { a: ['opt_a'], b: ['opt_b'] }, pivot_text: '전환점' },
  review: { kind: 'review', comments: [{ line_key: 'line_1', severity: 'major', text: '문제' }] },
  authoring: {
    kind: 'authoring',
    item: {
      stem_md: '문제',
      options: { opt_a: { text_md: 'A', mc_id: null }, opt_b: { text_md: 'B', mc_id: 'k8s.probes.m01' } },
      chosen_keys: ['opt_a'],
      rationale_md: '근거',
    },
  },
  case_decision: { kind: 'case_decision', option_key: 'opt_a', rationale: null },
};

describe('common/practice', () => {
  it('UT-CON-030 AttemptResponse 판별자 14종이 각각 유효 샘플을 통과한다 [FR-STD-020]', () => {
    // IF-01 §5.1 블록의 판별자 수 = 14 (Brief 표의 "13종"은 계수 오류 — 블록이 정본)
    expect(AttemptResponse.options).toHaveLength(14);
    expect(Object.keys(SAMPLES)).toHaveLength(14);
    for (const [kind, sample] of Object.entries(SAMPLES)) {
      const r = AttemptResponse.safeParse(sample);
      expect(r.success, kind).toBe(true);
    }
  });

  it('UT-CON-031 AttemptResponse는 미지 kind·미지 키·경계 위반을 거부한다 [FR-STD-020]', () => {
    expect(AttemptResponse.safeParse({ kind: 'drawing', value: 1 }).success).toBe(false);
    expect(AttemptResponse.safeParse({ value: true }).success).toBe(false);
    expect(AttemptResponse.safeParse({ kind: 'ox', value: true, extra: 1 }).success).toBe(false);
    expect(AttemptResponse.safeParse({ kind: 'ox', value: 'yes' }).success).toBe(false);
    expect(AttemptResponse.safeParse({ kind: 'choice', option_keys: [] }).success).toBe(false);
    expect(AttemptResponse.safeParse({ kind: 'choice', option_keys: ['A'] }).success).toBe(false);
    expect(AttemptResponse.safeParse({ kind: 'text', text: 'a'.repeat(2001) }).success).toBe(false);
    expect(AttemptResponse.safeParse({ kind: 'code', lang: 'py', code: 'x' }).success).toBe(false);
    expect(AttemptResponse.safeParse({ kind: 'numeric', value: 1 }).success).toBe(false); // unit 필수(null 허용)
    expect(
      AttemptResponse.safeParse({ kind: 'review', comments: [{ line_key: 'line_1', severity: 'info', text: 't' }] })
        .success,
    ).toBe(false);
    expect(AttemptResponse.safeParse({ kind: 'authoring', item: { stem_md: 's' } }).success).toBe(false);
  });

  it('UT-CON-032 AttemptPhase·DialogKind·DialogMove·DialogEndReason·ArtifactTemplateKind 값 집합 [FR-STD-020]', () => {
    expect(AttemptPhase.options).toEqual([
      'practice',
      'pretest',
      'embedded',
      'verify',
      'promotion_exam',
      'placement',
      'boss',
    ]);
    expect(DialogKind.options).toEqual(['dig', 'feynman', 'artifact_rebuttal']);
    expect(DialogMove.options).toHaveLength(15);
    expect(DialogMove.options).toContain('wrap_up');
    expect(DialogEndReason.options).toEqual(['turn_limit', 'fail_limit', 'learner', 'completed']);
    expect(ArtifactTemplateKind.options).toEqual(['adr', 'runbook', 'postmortem', 'design_review', 'standard_clause']);
  });

  it('UT-CON-033 Utterance는 static·stream 2종만 받는다 [FR-STD-020]', () => {
    expect(Utterance.safeParse({ kind: 'static', text_md: '왜 그럴까요?', source: 'question_bank' }).success).toBe(
      true,
    );
    expect(Utterance.safeParse({ kind: 'static', text_md: 'x', source: 'rebuttal_bank' }).success).toBe(true);
    expect(
      Utterance.safeParse({ kind: 'stream', stream_ref: ULID, expires_at: 1_759_000_000_000, fallback_text_md: '대체' })
        .success,
    ).toBe(true);
    expect(Utterance.safeParse({ kind: 'static', text_md: 'x', source: 'llm' }).success).toBe(false);
    expect(
      Utterance.safeParse({ kind: 'stream', stream_ref: 'abc', expires_at: 1, fallback_text_md: 'x' }).success,
    ).toBe(false);
    expect(Utterance.safeParse({ kind: 'text', text_md: 'x' }).success).toBe(false);
  });

  it('UT-CON-034 TurnJudgement는 label·engine·badge 열거와 strict를 강제한다 [FR-STD-020]', () => {
    const ok = {
      label: 'misconception',
      mc_id: 'k8s.probes.m01',
      asks_for_answer: false,
      engine: 'S',
      calibrated: false,
      badge: 'self',
    };
    expect(TurnJudgement.safeParse(ok).success).toBe(true);
    expect(TurnJudgement.safeParse({ ...ok, mc_id: null }).success).toBe(true);
    expect(TurnJudgement.safeParse({ ...ok, label: 'wrong' }).success).toBe(false);
    expect(TurnJudgement.safeParse({ ...ok, engine: 'X' }).success).toBe(false);
    expect(TurnJudgement.safeParse({ ...ok, badge: 'gold' }).success).toBe(false);
    expect(TurnJudgement.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });

  it('UT-CON-035 PromotionGate.gate_id는 대문자 스네이크 정규식이다 [FR-CUR-025]', () => {
    const gate = {
      gate_id: 'REQUIRED_MASTERED',
      label_ko: '필수 개념 숙달',
      met: false,
      value: 0.5,
      threshold: 0.8,
      evidence_event_ids: [ULID],
      shortfall_ko: '30% 부족',
    };
    expect(PromotionGate.safeParse(gate).success).toBe(true);
    for (const id of [
      'ASSESSMENT_ACCURACY',
      'ASSESSMENT_CBM',
      'D4_DEPTH',
      'CASE_L4',
      'MASTERY_P',
      'FORMATS',
      'STUDY_DAYS',
    ]) {
      expect(PromotionGate.safeParse({ ...gate, gate_id: id }).success, id).toBe(true);
    }
    for (const id of ['required_mastered', '1ABC', 'A', 'A-B', `A${'B'.repeat(41)}`]) {
      expect(PromotionGate.safeParse({ ...gate, gate_id: id }).success, id).toBe(false);
    }
    expect(PromotionGate.safeParse({ ...gate, value: null, threshold: null, shortfall_ko: null }).success).toBe(true);
    expect(PromotionGate.safeParse({ ...gate, evidence_event_ids: Array(51).fill(ULID) }).success).toBe(false);
  });

  it('UT-CON-036 FeasibilityBlocker.code는 5형식을 받는다(MASTERY_FORMATS<3:<concept_id>) [FR-CUR-025]', () => {
    for (const code of [
      'NO_ASSESSMENT_POOL',
      'EMPTY_LEVEL',
      'D4_POSSIBLE<REQUIRED',
      'CASE_L4+<2',
      'MASTERY_FORMATS<3:k8s.probes',
    ]) {
      expect(FeasibilityBlocker.safeParse({ code, detail_ko: '사유' }).success, code).toBe(true);
    }
    for (const code of [
      'MASTERY_FORMATS<3:',
      'MASTERY_FORMATS<3:K8S',
      'MASTERY_FORMATS<3:ab',
      'UNKNOWN',
      'EMPTY_LEVEL2',
    ]) {
      expect(FeasibilityBlocker.safeParse({ code, detail_ko: '사유' }).success, code).toBe(false);
    }
  });

  it('UT-CON-037 WGraderTable은 PENDING이 literal 0이다 [FR-STD-020]', () => {
    const table = {
      D: 1,
      J_calibrated: 0.9,
      J_uncalibrated: 0.5,
      J_low_confidence: 0.3,
      LJ: 0.6,
      H: 0.4,
      S: 0.3,
      PENDING: 0,
    };
    expect(WGraderTable.safeParse(table).success).toBe(true);
    expect(WGraderTable.safeParse({ ...table, PENDING: 0.1 }).success).toBe(false);
    expect(WGraderTable.safeParse({ ...table, PENDING: 1 }).success).toBe(false);
    expect(WGraderTable.safeParse({ ...table, D: 1.1 }).success).toBe(false);
    expect(WGraderTable.safeParse({ ...table, D: -0.1 }).success).toBe(false);
    const { PENDING: _omitted, ...withoutPending } = table;
    expect(WGraderTable.safeParse(withoutPending).success).toBe(false);
    expect(WGraderTable.safeParse({ ...table, extra: 0 }).success).toBe(false);
  });
});
