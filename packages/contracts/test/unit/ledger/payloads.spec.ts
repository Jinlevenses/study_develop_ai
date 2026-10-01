import { describe, expect, it } from 'vitest';
import type { LedgerEventType } from '../../../src/ledger/envelope.js';
import { LEDGER_PAYLOADS } from '../../../src/ledger/types.js';
import { PAYLOAD_SAMPLES, PS, SHA, U1 } from './samples.js';

const sample = (type: LedgerEventType) => {
  const make = PAYLOAD_SAMPLES[type];
  if (make === undefined) {
    throw new Error(`no sample for ${type}`);
  }
  return make();
};
const parseV1 = (type: LedgerEventType, value: unknown) => LEDGER_PAYLOADS[type][1].safeParse(value);

/** 공통 단언: 유효 샘플 통과 · 미지 키 거부 · 필수 키 하나 제거 시 거부 · 최상위 배열 거부 */
const assertPayloadContract = (type: LedgerEventType) => {
  const ok = sample(type);
  expect(parseV1(type, ok).success, `${type} valid`).toBe(true);
  expect(parseV1(type, { ...ok, unknown_key: 1 }).success, `${type} unknown key`).toBe(false);
  const [firstKey] = Object.keys(ok);
  expect(firstKey).toBeDefined();
  const { [firstKey as string]: _removed, ...rest } = ok;
  expect(parseV1(type, rest).success, `${type} missing ${String(firstKey)}`).toBe(false);
  expect(parseV1(type, []).success, `${type} array`).toBe(false);
};

describe('ledger/payloads v1 (LEDGER_PAYLOADS 경유)', () => {
  it('UT-CON-065 attempt.graded v1은 유효 샘플을 통과하고 미지 키를 거부한다 [FR-PRG-001][NFR-DATA-001][IF-LG-01]', () => {
    assertPayloadContract('attempt.graded');
    expect(parseV1('attempt.graded', { ...sample('attempt.graded'), rating: null }).success).toBe(true); // pending(w 0) → FSRS 미적용
    expect(parseV1('attempt.graded', { ...sample('attempt.graded'), rating: 5 }).success).toBe(false);
    expect(parseV1('attempt.graded', { ...sample('attempt.graded'), phase: 'exam' }).success).toBe(false);
    expect(parseV1('attempt.graded', { ...sample('attempt.graded'), policy_version: 'ps_xyz' }).success).toBe(false);
  });

  it('UT-CON-066 evidence.upgraded v1은 유효 샘플을 통과하고 미지 키를 거부한다 [FR-PRG-002][NFR-DATA-001][IF-LG-02]', () => {
    assertPayloadContract('evidence.upgraded');
    expect(parseV1('evidence.upgraded', { ...sample('evidence.upgraded'), rating_applied: true }).success).toBe(false);
  });

  it('UT-CON-067 evidence.regraded v1은 유효 샘플을 통과하고 미지 키를 거부한다 [FR-PRG-002][NFR-DATA-001][IF-LG-03]', () => {
    assertPayloadContract('evidence.regraded');
    expect(parseV1('evidence.regraded', { ...sample('evidence.regraded'), reason: 'other' }).success).toBe(false);
    expect(parseV1('evidence.regraded', { ...sample('evidence.regraded'), rating_applied: true }).success).toBe(false);
  });

  it('UT-CON-068 evidence.voided v1은 유효 샘플을 통과하고 미지 키를 거부한다 [FR-PRG-002][NFR-DATA-001][IF-LG-04]', () => {
    assertPayloadContract('evidence.voided');
    expect(parseV1('evidence.voided', { ...sample('evidence.voided'), basis: 'manual' }).success).toBe(false);
    expect(parseV1('evidence.voided', { ...sample('evidence.voided'), correction: 'deleted' }).success).toBe(false);
    expect(parseV1('evidence.voided', { ...sample('evidence.voided'), target_event_ids: [] }).success).toBe(false);
  });

  it('UT-CON-069 evidence.weight_adjusted v1은 유효 샘플을 통과하고 미지 키를 거부한다 [FR-PRG-002][NFR-DATA-001][IF-LG-05]', () => {
    assertPayloadContract('evidence.weight_adjusted');
    expect(
      parseV1('evidence.weight_adjusted', { ...sample('evidence.weight_adjusted'), cause: 'manual' }).success,
    ).toBe(false);
    expect(
      parseV1('evidence.weight_adjusted', {
        ...sample('evidence.weight_adjusted'),
        item_id: null,
        gate_result_id: null,
      }).success,
    ).toBe(true);
  });

  it('UT-CON-070 pretest.answered v1은 유효 샘플을 통과하고 미지 키를 거부한다 [FR-PRG-001][NFR-DATA-001][IF-LG-06]', () => {
    assertPayloadContract('pretest.answered');
    expect(parseV1('pretest.answered', { ...sample('pretest.answered'), result: 'skipped' }).success).toBe(false);
  });

  it('UT-CON-071 lesson.completed v1은 유효 샘플을 통과하고 미지 키를 거부한다 [FR-PRG-001][NFR-DATA-001][IF-LG-07]', () => {
    assertPayloadContract('lesson.completed');
    expect(parseV1('lesson.completed', { ...sample('lesson.completed'), stage: 'quiz' }).success).toBe(false);
    expect(parseV1('lesson.completed', { ...sample('lesson.completed'), duration_ms: -1 }).success).toBe(false);
  });

  it('UT-CON-072 self_assessment.recorded v1은 유효 샘플을 통과하고 미지 키를 거부한다 [FR-PRG-003][NFR-DATA-001][IF-LG-08]', () => {
    assertPayloadContract('self_assessment.recorded');
    const grade = { kind: 'grade', grade: 3 };
    const confirm = { kind: 'rating_confirm', accepted: true, rating: 3 };
    expect(
      parseV1('self_assessment.recorded', { ...sample('self_assessment.recorded'), kind: 'self_grade', value: grade })
        .success,
    ).toBe(true);
    expect(
      parseV1('self_assessment.recorded', {
        ...sample('self_assessment.recorded'),
        kind: 'regrade_rating_confirm',
        value: confirm,
      }).success,
    ).toBe(true);
    expect(
      parseV1('self_assessment.recorded', {
        ...sample('self_assessment.recorded'),
        value: { kind: 'probability', p: 1.1 },
      }).success,
    ).toBe(false);
    expect(parseV1('self_assessment.recorded', { ...sample('self_assessment.recorded'), kind: 'guess' }).success).toBe(
      false,
    );
  });

  it('UT-CON-073 card.enrolled v1은 유효 샘플을 통과하고 미지 키를 거부한다 [FR-PRG-001][NFR-DATA-001][IF-LG-09]', () => {
    assertPayloadContract('card.enrolled');
    expect(parseV1('card.enrolled', { ...sample('card.enrolled'), card_id: 'not-a-card' }).success).toBe(false);
    expect(parseV1('card.enrolled', { ...sample('card.enrolled'), tier: 'D' }).success).toBe(false);
  });

  it('UT-CON-074 card.status_changed v1은 유효 샘플을 통과하고 미지 키를 거부한다 [FR-PRG-001][NFR-DATA-001][IF-LG-10]', () => {
    assertPayloadContract('card.status_changed');
    expect(parseV1('card.status_changed', { ...sample('card.status_changed'), status: 'deleted' }).success).toBe(false);
    expect(parseV1('card.status_changed', { ...sample('card.status_changed'), reason: 'bored' }).success).toBe(false);
  });

  it('UT-CON-075 profile.setting_changed v1은 유효 샘플을 통과하고 미지 키를 거부한다 [FR-PRG-027][NFR-DATA-001][IF-LG-11]', () => {
    assertPayloadContract('profile.setting_changed');
    for (const v of [null, 1, 'x', true, [1, 'a', null], { a: { b: [1] } }]) {
      expect(parseV1('profile.setting_changed', { ...sample('profile.setting_changed'), from: v, to: v }).success).toBe(
        true,
      );
    }
    expect(
      parseV1('profile.setting_changed', { ...sample('profile.setting_changed'), key: 'Rhythm.Day' }).success,
    ).toBe(false);
    expect(
      parseV1('profile.setting_changed', { ...sample('profile.setting_changed'), policy_version: PS }).success,
    ).toBe(false); // 이 타입은 policy_version이 없다
  });

  it('UT-CON-076 policy.switched v1은 유효 샘플을 통과하고 미지 키를 거부한다 [FR-PRG-003][NFR-DATA-001][IF-LG-12]', () => {
    assertPayloadContract('policy.switched');
    expect(
      parseV1('policy.switched', { ...sample('policy.switched'), overrides_sha256: SHA, replay_report_ref: U1 })
        .success,
    ).toBe(true);
    expect(
      parseV1('policy.switched', { ...sample('policy.switched'), members: { m: { version: 'Bad', sha256: SHA } } })
        .success,
    ).toBe(false);
  });

  it('UT-CON-077 ai_mode.observed v1은 유효 샘플을 통과하고 미지 키를 거부한다 [NFR-DATA-001][NFR-DATA-001][IF-LG-13]', () => {
    assertPayloadContract('ai_mode.observed');
    const provider = { id: 'jev', kind: 'jev', status: 'degraded' };
    expect(
      parseV1('ai_mode.observed', { ...sample('ai_mode.observed'), providers: Array(32).fill(provider) }).success,
    ).toBe(true);
    expect(
      parseV1('ai_mode.observed', { ...sample('ai_mode.observed'), providers: Array(33).fill(provider) }).success,
    ).toBe(false);
    expect(parseV1('ai_mode.observed', { ...sample('ai_mode.observed'), mode: 'ONLINE' }).success).toBe(false);
  });

  it('UT-CON-078 declaration.sealed v1은 유효 샘플을 통과하고 미지 키를 거부한다 [NFR-DATA-001][NFR-DATA-001][IF-LG-14]', () => {
    assertPayloadContract('declaration.sealed');
    expect(
      parseV1('declaration.sealed', { ...sample('declaration.sealed'), unseal_at: 1_759_000_000_000 }).success,
    ).toBe(true);
    expect(parseV1('declaration.sealed', { ...sample('declaration.sealed'), kind: 'wish' }).success).toBe(false);
  });

  it('UT-CON-079 promotion.exam_completed v1은 유효 샘플을 통과하고 미지 키를 거부한다 [FR-PRG-003][NFR-DATA-001][IF-LG-15]', () => {
    assertPayloadContract('promotion.exam_completed');
    expect(
      parseV1('promotion.exam_completed', { ...sample('promotion.exam_completed'), correct_count: 13 }).success,
    ).toBe(false);
    expect(
      parseV1('promotion.exam_completed', { ...sample('promotion.exam_completed'), formats: ['mcq', 'ox', 'cloze'] })
        .success,
    ).toBe(false);
  });

  it('UT-CON-080 level.promoted v1은 유효 샘플을 통과하고 미지 키를 거부한다 [FR-PRG-003][NFR-DATA-001][IF-LG-16]', () => {
    assertPayloadContract('level.promoted');
    expect(parseV1('level.promoted', { ...sample('level.promoted'), from: 1, to: 2 }).success).toBe(true);
    expect(parseV1('level.promoted', { ...sample('level.promoted'), to: 6 }).success).toBe(false);
    expect(parseV1('level.promoted', { ...sample('level.promoted'), basis: 'manual' }).success).toBe(false);
    expect(
      parseV1('level.promoted', { ...sample('level.promoted'), gates: Array(21).fill(sample('level.promoted').gates) })
        .success,
    ).toBe(false);
  });

  it('UT-CON-081 level.provisional_resolved v1은 유효 샘플을 통과하고 미지 키를 거부한다 [FR-PRG-003][NFR-DATA-001][IF-LG-17]', () => {
    assertPayloadContract('level.provisional_resolved');
    expect(
      parseV1('level.provisional_resolved', { ...sample('level.provisional_resolved'), outcome: 'demoted' }).success,
    ).toBe(false);
  });
});
