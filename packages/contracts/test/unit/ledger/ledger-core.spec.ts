import { describe, expect, it } from 'vitest';
import { LedgerEventEnvelope, LedgerEventType } from '../../../src/ledger/envelope.js';
import { AttemptGradedV1 } from '../../../src/ledger/payloads/attempt-graded.js';
import { EvidenceWeightAdjustedV1 } from '../../../src/ledger/payloads/evidence-weight-adjusted.js';
import { LevelProvisionalResolvedV1 } from '../../../src/ledger/payloads/level-provisional-resolved.js';
import { PromotionExamCompletedV1 } from '../../../src/ledger/payloads/promotion-exam-completed.js';
import { VerdictCarried } from '../../../src/ledger/payloads/verdict-carried.js';
import { isValidLedgerIdempotencyKey, LEDGER_KEY_PATTERNS, LEDGER_PAYLOADS } from '../../../src/ledger/types.js';
import { CURRENT_SCHEMA_VERSION } from '../../../src/ledger/versions.js';
import { examItems, PAYLOAD_SAMPLES, PS, SHA, U1, U2, U3 } from './samples.js';

const sorted = (xs: readonly string[]) => [...xs].sort();

describe('ledger/types·versions·envelope', () => {
  it('UT-CON-082 CURRENT_SCHEMA_VERSION·LEDGER_PAYLOADS·LEDGER_KEY_PATTERNS 키 집합 = LedgerEventType 17종 [NFR-DATA-001][NFR-DATA-013][IF-LG-01~17]', () => {
    expect(LedgerEventType.options).toHaveLength(17);
    expect(sorted(Object.keys(CURRENT_SCHEMA_VERSION))).toEqual(sorted(LedgerEventType.options));
    expect(sorted(Object.keys(LEDGER_PAYLOADS))).toEqual(sorted(LedgerEventType.options));
    expect(sorted(Object.keys(LEDGER_KEY_PATTERNS))).toEqual(sorted(LedgerEventType.options));
    expect(sorted(Object.keys(PAYLOAD_SAMPLES))).toEqual(sorted(LedgerEventType.options));
    for (const type of LedgerEventType.options) {
      expect(CURRENT_SCHEMA_VERSION[type], type).toBe(1);
      expect(Object.keys(LEDGER_PAYLOADS[type]), type).toEqual(['1']);
    }
  });

  it("UT-CON-083 LedgerEventEnvelope.prev_hash는 '0'×64를 통과시키고 형식을 강제한다 [NFR-DATA-001][IF-LG-01]", () => {
    const env = {
      event_id: U1,
      device_id: U2,
      device_seq: 1,
      client_ts: 1_759_000_000_000,
      type: 'card.enrolled',
      schema_version: 1,
      idempotency_key: 'card:docker.dockerfile:concept:r',
      payload: {},
      prev_hash: '0'.repeat(64),
      hash: SHA,
      experiment_arm: null,
      recorded_at: 1_759_000_000_001,
    };
    expect(LedgerEventEnvelope.safeParse(env).success).toBe(true);
    expect(LedgerEventEnvelope.safeParse({ ...env, prev_hash: SHA }).success).toBe(true);
    expect(LedgerEventEnvelope.safeParse({ ...env, prev_hash: '0'.repeat(63) }).success).toBe(false);
    expect(LedgerEventEnvelope.safeParse({ ...env, prev_hash: 'G'.repeat(64) }).success).toBe(false);
    expect(LedgerEventEnvelope.safeParse({ ...env, device_seq: 0 }).success).toBe(false);
    expect(LedgerEventEnvelope.safeParse({ ...env, type: 'attempt.deleted' }).success).toBe(false);
    expect(LedgerEventEnvelope.safeParse({ ...env, idempotency_key: 'ab' }).success).toBe(false);
    expect(LedgerEventEnvelope.safeParse({ ...env, idempotency_key: 'k'.repeat(201) }).success).toBe(false);
    expect(LedgerEventEnvelope.safeParse({ ...env, experiment_arm: 'arm-a' }).success).toBe(true);
    expect(LedgerEventEnvelope.safeParse({ ...env, experiment_arm: 'a'.repeat(41) }).success).toBe(false);
    expect(LedgerEventEnvelope.safeParse({ ...env, extra: 1 }).success).toBe(false);
    const { experiment_arm: _arm, ...noArm } = env;
    expect(LedgerEventEnvelope.safeParse(noArm).success).toBe(false); // nullable이지 optional이 아니다
  });
});

describe('ledger 구조 규칙', () => {
  it('UT-CON-084 LevelProvisionalResolvedV1 refine — provisional_revoked + needs_reconfirmation:false 거부 [FR-PRG-003][IF-LG-17]', () => {
    const base = PAYLOAD_SAMPLES['level.provisional_resolved']?.() ?? {};
    expect(
      LevelProvisionalResolvedV1.safeParse({ ...base, outcome: 'provisional_revoked', needs_reconfirmation: true })
        .success,
    ).toBe(true);
    expect(
      LevelProvisionalResolvedV1.safeParse({ ...base, outcome: 'provisional_revoked', needs_reconfirmation: false })
        .success,
    ).toBe(false);
    expect(
      LevelProvisionalResolvedV1.safeParse({ ...base, outcome: 'confirmed', needs_reconfirmation: false }).success,
    ).toBe(true);
    expect(
      LevelProvisionalResolvedV1.safeParse({ ...base, outcome: 'confirmed', needs_reconfirmation: true }).success,
    ).toBe(true);
    expect(LevelProvisionalResolvedV1.safeParse({ ...base, unknown_key: 1 }).success).toBe(false);
  });

  it('UT-CON-085 EvidenceWeightAdjustedV1.adjustment는 factor·set 2종이다 [FR-PRG-002][IF-LG-05]', () => {
    const base = PAYLOAD_SAMPLES['evidence.weight_adjusted']?.() ?? {};
    const factor = { kind: 'factor', factor: 0.5 };
    const set = { kind: 'set', w_format: 0.3, w_grader: null, gaming_factor: 0.5 };
    expect(EvidenceWeightAdjustedV1.safeParse({ ...base, adjustment: factor }).success).toBe(true);
    expect(EvidenceWeightAdjustedV1.safeParse({ ...base, adjustment: set }).success).toBe(true);
    expect(EvidenceWeightAdjustedV1.safeParse({ ...base, adjustment: { kind: 'factor', factor: 1.5 } }).success).toBe(
      false,
    );
    expect(EvidenceWeightAdjustedV1.safeParse({ ...base, adjustment: { kind: 'set', w_format: 0.3 } }).success).toBe(
      false,
    );
    expect(EvidenceWeightAdjustedV1.safeParse({ ...base, adjustment: { kind: 'zero' } }).success).toBe(false);
    expect(EvidenceWeightAdjustedV1.safeParse({ ...base, adjustment: { ...factor, extra: 1 } }).success).toBe(false);
  });

  it('UT-CON-086 PromotionExamCompletedV1.item_ids는 정확히 12개다 [FR-PRG-003][IF-LG-15]', () => {
    const base = PAYLOAD_SAMPLES['promotion.exam_completed']?.() ?? {};
    expect(PromotionExamCompletedV1.safeParse({ ...base, item_ids: examItems() }).success).toBe(true);
    expect(PromotionExamCompletedV1.safeParse({ ...base, item_ids: examItems().slice(0, 11) }).success).toBe(false);
    expect(
      PromotionExamCompletedV1.safeParse({ ...base, item_ids: [...examItems(), 'docker.dockerfile.i13'] }).success,
    ).toBe(false);
    expect(PromotionExamCompletedV1.safeParse({ ...base, item_ids: [] }).success).toBe(false);
  });
});

describe('ledger/types isValidLedgerIdempotencyKey', () => {
  const CARD_KEY = 'card:docker.dockerfile:concept:r';
  const VALID: [string, string[]][] = [
    ['attempt.graded', [`verdict:${U1}`]],
    ['evidence.upgraded', [`verdict:${U2}`]],
    ['evidence.regraded', [`verdict:${U3}`]],
    ['evidence.voided', [`corr:docker.dockerfile.i05:regate_g3:${U1}`, `corr:${U2}:pack_upgrade:${U1}`]],
    ['evidence.weight_adjusted', [`corr:docker.dockerfile.i05:overlay:${U1}`, `recalc:${PS}:${U1}`]],
    ['pretest.answered', [`att:${U1}`]],
    ['lesson.completed', [`cmd:${U1}:theory`, `cmd:${U1}:code`, `cmd:${U1}:core`]],
    ['self_assessment.recorded', [`cmd:${U1}`, `cmd:${U1}:docker.dockerfile`, `cmd:${U1}:a_b-c.d`]],
    ['card.enrolled', [CARD_KEY, 'card:k8s.probes:definition:p']],
    ['card.status_changed', [`cmd:${U1}`]],
    ['profile.setting_changed', [`cmd:${U1}:rhythm`, `cmd:${U1}:rhythm.day_start`]],
    ['policy.switched', [`policy:${PS}`]],
    ['ai_mode.observed', [`aimode:${U1}`]],
    ['declaration.sealed', [`cmd:${U1}`]],
    ['promotion.exam_completed', [`exam:${U1}`]],
    ['level.promoted', ['promo:k8s:1', 'promo:alg:5', 'promo:data:3']],
    ['level.provisional_resolved', ['promo-res:k8s:3:0', 'promo-res:docker:5:1234']],
  ];
  const INVALID: [string, string[]][] = [
    [
      'attempt.graded',
      ['', 'verdict:', 'verdict:abc', `verdict:${U1.toLowerCase()}`, `cmd:${U1}`, `verdict:${U1}x`, `xverdict:${U1}`],
    ],
    ['evidence.upgraded', [`verdict:${U1.slice(1)}`, `att:${U1}`]],
    ['evidence.regraded', [`verdict:${U1}:x`, `regrade:${U1}`]],
    [
      'evidence.voided',
      [
        `corr:docker.dockerfile.i05:manual:${U1}`,
        `corr::regate_g3:${U1}`,
        `corr:docker.dockerfile.i05:regate_g3`,
        `recalc:${PS}:${U1}`,
      ],
    ],
    [
      'evidence.weight_adjusted',
      [`recalc:ps_123:${U1}`, `recalc:${PS}`, `corr:x:bad:${U1}`, `recalc:${PS.toUpperCase()}:${U1}`],
    ],
    ['pretest.answered', ['att:', `att:${U1}:x`, `verdict:${U1}`]],
    ['lesson.completed', [`cmd:${U1}`, `cmd:${U1}:quiz`, `cmd:${U1}:theory:x`, `cmd:${U1}:Theory`]],
    ['self_assessment.recorded', [`cmd:${U1}:`, `cmd:${U1}:UPPER`, `cmd:${U1}:${'a'.repeat(61)}`, `cmd:abc`]],
    [
      'card.enrolled',
      ['card:', 'card:not-a-card', 'card:k8s.probes:definition:x', `cmd:${U1}`, 'Card:k8s.probes:definition:p'],
    ],
    ['card.status_changed', [`cmd:${U1}:x`, `card:${U1}`, `cmd:${U1.toLowerCase()}`]],
    ['profile.setting_changed', [`cmd:${U1}`, `cmd:${U1}:Bad`, `cmd:${U1}:a..b`, `cmd:${U1}:a.`, `cmd:${U1}:1a`]],
    ['policy.switched', ['policy:ps_zz', `policy:${PS}x`, `policy:${PS.toUpperCase()}`, 'policy:']],
    ['ai_mode.observed', ['aimode:abc', `aimode:${U1.toLowerCase()}`, `mode:${U1}`]],
    ['declaration.sealed', [`cmd:${U1}:x`, `decl:${U1}`]],
    ['promotion.exam_completed', ['exam:', `exam:${U1}x`, `promo:${U1}`]],
    ['level.promoted', ['promo:xx:3', 'promo:k8s:6', 'promo:k8s:0', 'promo:k8s', 'promo:k8s:12', 'promo:k8s|alg:3']],
    [
      'level.provisional_resolved',
      ['promo-res:k8s:3:', 'promo-res:k8s:3:12345', 'promo-res:k8s:7:1', 'promo-res:xx:3:1', 'promo:k8s:3'],
    ],
  ];

  it('UT-CON-087 17타입 모두 IF-LG 형식의 양성 키를 통과시킨다 [NFR-DATA-013][IF-LG-01~17]', () => {
    expect(VALID).toHaveLength(17);
    expect(sorted(VALID.map(([t]) => t))).toEqual(sorted(LedgerEventType.options));
    for (const [type, keys] of VALID) {
      const t = LedgerEventType.parse(type);
      for (const key of keys) {
        expect(isValidLedgerIdempotencyKey(t, key), `${type} ${key}`).toBe(true);
      }
    }
  });

  it('UT-CON-088 17타입 모두 형식 위반 키를 거부하고 타입 간 키 교차 사용을 막는다 [NFR-DATA-013][IF-LG-01~17]', () => {
    expect(INVALID).toHaveLength(17);
    for (const [type, keys] of INVALID) {
      const t = LedgerEventType.parse(type);
      for (const key of keys) {
        expect(isValidLedgerIdempotencyKey(t, key), `${type} ${key}`).toBe(false);
      }
    }
    // 교차: verdict 키는 pretest·card 등에서 무효, cmd 키는 verdict 타입에서 무효
    expect(isValidLedgerIdempotencyKey('pretest.answered', `verdict:${U1}`)).toBe(false);
    expect(isValidLedgerIdempotencyKey('attempt.graded', `cmd:${U1}`)).toBe(false);
    expect(isValidLedgerIdempotencyKey('card.status_changed', `cmd:${U1}:theory`)).toBe(false);
    expect(isValidLedgerIdempotencyKey('lesson.completed', `cmd:${U1}`)).toBe(false);
    // 같은 형식을 공유하는 타입은 서로 키를 받아들인다(형식만 검사 — 중복 판정은 DB UNIQUE의 몫)
    expect(isValidLedgerIdempotencyKey('declaration.sealed', `cmd:${U1}`)).toBe(true);
    expect(isValidLedgerIdempotencyKey('card.status_changed', `cmd:${U1}`)).toBe(true);
  });

  it('UT-CON-089 AttemptGradedV1 shape가 §10.3 리듀서 입력 필드를 전부 가진다 [FR-PRG-001][FR-PRG-002][FR-PRG-027][IF-LG-01]', () => {
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
    const shapeKeys = Object.keys(AttemptGradedV1.shape);
    for (const f of reducerFields) {
      expect(shapeKeys, f).toContain(f);
    }
    // VerdictCarried는 zod 스키마가 아니라 shape 객체이고, AttemptGradedV1·EvidenceUpgradedV1·EvidenceRegradedV1이 스프레드한다.
    expect(Object.keys(VerdictCarried)).toHaveLength(38);
    for (const k of Object.keys(VerdictCarried)) {
      expect(shapeKeys, k).toContain(k);
    }
    for (const type of ['evidence.upgraded', 'evidence.regraded'] as const) {
      const keys = Object.keys(LEDGER_PAYLOADS[type][1].shape);
      for (const k of Object.keys(VerdictCarried)) {
        expect(keys, `${type} ${k}`).toContain(k);
      }
    }
    // 리듀서 입력은 envelope client_ts·prev_hash와 함께 쓰인다(envelope 쪽 단언은 UT-CON-083).
  });
});
