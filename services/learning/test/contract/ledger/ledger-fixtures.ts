import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { LedgerEventType } from '@fathom/contracts/ledger/envelope';
import { LedgerEventType as LedgerEventTypeSchema } from '@fathom/contracts/ledger/envelope';
import { fixedUlid } from '@fathom/testkit/ids';
import type { LedgerAppendDraft } from '../../../src/application/ledger/ports.js';

// CT-LR-801~817 골든 payload(`fixtures/<type>@v1.json`) + 타입별 멱등 키 표본. 단위 테스트도 이 표본을 쓴다.
const u = (n: number): string => fixedUlid(n);

export const LEDGER_TYPES: readonly LedgerEventType[] = LedgerEventTypeSchema.options;

/** 타입별 키 표본(같은 DB에 17종을 함께 넣어도 충돌하지 않는다). */
export const KEY_SAMPLES: Readonly<Record<LedgerEventType, string>> = {
  'attempt.graded': `verdict:${u(11)}`,
  'evidence.upgraded': `verdict:${u(21)}`,
  'evidence.regraded': `verdict:${u(22)}`,
  'evidence.voided': `corr:k8s.probes.i03:regate_g3:${u(31)}`,
  'evidence.weight_adjusted': `corr:k8s.probes.i03:regate_g5:${u(31)}`,
  'pretest.answered': `att:${u(41)}`,
  'lesson.completed': `cmd:${u(51)}:theory`,
  'self_assessment.recorded': `cmd:${u(53)}`,
  'card.enrolled': 'card:k8s.probes:definition:p',
  'card.status_changed': `cmd:${u(54)}`,
  'profile.setting_changed': `cmd:${u(55)}:session.default_minutes`,
  'policy.switched': 'policy:ps_5e1f0a9c3b7d2468',
  'ai_mode.observed': `aimode:${u(61)}`,
  'declaration.sealed': `cmd:${u(72)}`,
  'promotion.exam_completed': `exam:${u(81)}`,
  'level.promoted': 'promo:k8s:2',
  'level.provisional_resolved': 'promo-res:k8s:2:1',
};

export function fixturePayload(type: LedgerEventType): Record<string, unknown> {
  const file = fileURLToPath(new URL(`./fixtures/${type}@v1.json`, import.meta.url));
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`fixture ${type}@v1 is not an object`);
  }
  return Object.fromEntries(Object.entries(parsed));
}

export function fixtureDraft(type: LedgerEventType): LedgerAppendDraft {
  return { type, idempotency_key: KEY_SAMPLES[type], payload: fixturePayload(type) };
}
