import { isValidLedgerIdempotencyKey, LEDGER_KEY_PATTERNS, LEDGER_PAYLOADS } from '@fathom/contracts/ledger/types';
import { CURRENT_SCHEMA_VERSION } from '@fathom/contracts/ledger/versions';
import { canonicalJson } from '@fathom/shared-kernel/canonical/canonical';
import { describe, expect, it } from 'vitest';
import { upcast } from '../../../src/domain/ledger/upcasters/registry.js';
import { makeHarness } from '../../unit/ledger/support/harness.js';
import { fixtureDraft, fixturePayload, KEY_SAMPLES, LEDGER_TYPES } from './ledger-fixtures.js';

// CT-LR-801~817 = IF-LG-01~17 거울(IF-01 §10.1 표 순서 = LedgerEventType 선언 순서). 계약은 import만 — 스키마를 재정의하지 않는다.
const REPLAY_FIELDS = [
  'card_id',
  'concept_id',
  'format',
  'facet',
  'response_mode',
  'tier',
  'result',
  'w_format',
  'w_grader',
  'gaming_factor',
  'rapid',
  'item_beta',
  'item_n_options',
];
const BAD_KEYS = ['', 'x', 'verdict:', 'verdict:not-a-ulid', 'cmd:01J00000000000000000000001:', 'policy:ps_xyz'];

describe('원장 payload 계약(IF-LG-01~17)', () => {
  it('CT-LR-801 17종 표본 파일이 모두 있고 CURRENT_SCHEMA_VERSION은 전부 1 [IF-LG-01~17]', () => {
    expect(LEDGER_TYPES).toHaveLength(17);
    for (const type of LEDGER_TYPES) {
      expect(CURRENT_SCHEMA_VERSION[type], type).toBe(1);
      expect(Object.keys(LEDGER_PAYLOADS[type]), type).toEqual(['1']);
    }
  });

  LEDGER_TYPES.forEach((type, index) => {
    const num = String(index + 1).padStart(2, '0');
    it(`CT-LR-${801 + index} IF-LG-${num} ${type}@v1 골든 payload·키·§10.3 필드·upcast 항등·저장 payload = canonicalJson(fixture) [IF-LG-${num}][NFR-DATA-003]`, async () => {
      const fixture = fixturePayload(type);
      // 1. 골든 payload → LEDGER_PAYLOADS 통과(strict)
      const schema = LEDGER_PAYLOADS[type][CURRENT_SCHEMA_VERSION[type]];
      const parsed = schema.safeParse(fixture);
      expect(parsed.success, type).toBe(true);
      expect(schema.safeParse({ ...fixture, unknown_field: 1 }).success, `${type} strict`).toBe(false);
      // 2. 키 정규식 표본 통과 + 잘못된 키 거부
      const key = KEY_SAMPLES[type];
      expect(LEDGER_KEY_PATTERNS[type].test(key), key).toBe(true);
      expect(isValidLedgerIdempotencyKey(type, key), key).toBe(true);
      for (const bad of BAD_KEYS) {
        expect(isValidLedgerIdempotencyKey(type, bad), `${type} ${bad}`).toBe(false);
      }
      // 3. §10.3 필드 존재(해당 타입)
      if (type === 'attempt.graded') {
        for (const f of [...REPLAY_FIELDS, 'rating', 'policy_version', 'fsrs_at', 'study_day']) {
          expect(fixture, f).toHaveProperty(f);
        }
      } else if (type === 'evidence.upgraded' || type === 'evidence.regraded') {
        for (const f of [...REPLAY_FIELDS, 'new_rating', 'policy_version', 'supersedes_event_id']) {
          expect(fixture, f).toHaveProperty(f);
        }
        expect(fixture.rating_applied).toBe(false);
      } else if (
        ![
          'profile.setting_changed',
          'ai_mode.observed',
          'declaration.sealed',
          'promotion.exam_completed',
          'level.promoted',
          'level.provisional_resolved',
        ].includes(type)
      ) {
        expect(fixture, 'policy_version').toHaveProperty('policy_version'); // policy_version이 없는 6종을 뺀 타입은 이벤트 정책 버전을 내장
      }
      expect(fixture, 'study_day').toHaveProperty('study_day');
      // 4. upcast 항등(v1)
      const up = upcast(type, 1, fixture);
      expect(up.ok && up.value.payload === fixture).toBe(true);
      // 5. writer 저장 payload = canonicalJson(fixture)
      const h = await makeHarness();
      const res = h.writer.append(fixtureDraft(type));
      expect(res.ok, type).toBe(true);
      const stored = h.db
        .prepare('SELECT payload, schema_version, idempotency_key FROM lr_event WHERE type = ?')
        .get(type);
      expect(stored?.payload).toBe(canonicalJson(fixture));
      expect(stored).toMatchObject({ schema_version: 1, idempotency_key: key });
    });
  });

  it('CT-LR-805 IF-LG-05 evidence.weight_adjusted: recalc 키·set 조정 변형도 계약 통과 [IF-LG-05]', () => {
    const base = fixturePayload('evidence.weight_adjusted');
    const recalc = {
      ...base,
      adjustment: { kind: 'set', w_format: 0.6, w_grader: null, gaming_factor: 0.8 },
      cause: 'policy_recalc',
      item_id: null,
      gate_result_id: null,
    };
    expect(LEDGER_PAYLOADS['evidence.weight_adjusted'][1].safeParse(recalc).success).toBe(true);
    expect(
      isValidLedgerIdempotencyKey('evidence.weight_adjusted', 'recalc:ps_5e1f0a9c3b7d2468:01J00000000000000000000001'),
    ).toBe(true);
    expect(
      isValidLedgerIdempotencyKey('evidence.voided', 'recalc:ps_5e1f0a9c3b7d2468:01J00000000000000000000001'),
    ).toBe(false);
  });
});
