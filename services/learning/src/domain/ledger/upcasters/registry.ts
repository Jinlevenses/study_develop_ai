import type { LedgerEventType } from '@fathom/contracts/ledger/envelope';
import { CURRENT_SCHEMA_VERSION } from '@fathom/contracts/ledger/versions';
import type { Result } from '@fathom/shared-kernel/errors/errors';
import { err, ok } from '@fathom/shared-kernel/errors/errors';

// ADR-011 §8 — 순수 upcaster 체인. 파일 규약 `domain/ledger/upcasters/<type>/v<n>-to-v<n+1>.ts`(v1 시점 = 0개, 항등).
export type UpcastPayload = Readonly<Record<string, unknown>>;
export type UpcastStep = (payload: UpcastPayload) => UpcastPayload;
export type UpcastFault = { readonly kind: 'schema_version_unsupported'; readonly detail: string };
export type Upcasted = { readonly schema_version: number; readonly payload: UpcastPayload };

/** `STEPS[type][n]` = v<n> → v<n+1> 변환. 17종 전부 현재 v1이라 비어 있다(새 버전 = 이 표에 단계 추가 + CURRENT_SCHEMA_VERSION 상향). */
const STEPS = {
  'attempt.graded': {},
  'evidence.upgraded': {},
  'evidence.regraded': {},
  'evidence.voided': {},
  'evidence.weight_adjusted': {},
  'pretest.answered': {},
  'lesson.completed': {},
  'self_assessment.recorded': {},
  'card.enrolled': {},
  'card.status_changed': {},
  'profile.setting_changed': {},
  'policy.switched': {},
  'ai_mode.observed': {},
  'declaration.sealed': {},
  'promotion.exam_completed': {},
  'level.promoted': {},
  'level.provisional_resolved': {},
} as const satisfies Record<LedgerEventType, Readonly<Record<number, UpcastStep>>>;

/** 저장된 `schema_version`의 payload를 현재 버전으로 올린다. 현재보다 크거나 단계가 없으면 err. */
export function upcast(
  type: LedgerEventType,
  schemaVersion: number,
  payload: UpcastPayload,
): Result<Upcasted, UpcastFault> {
  const current = CURRENT_SCHEMA_VERSION[type];
  const steps: Readonly<Record<number, UpcastStep>> = STEPS[type];
  let version = schemaVersion;
  let value = payload;
  if (!Number.isInteger(version) || version < 1 || version > current) {
    return err({
      kind: 'schema_version_unsupported',
      detail: `${type}@v${String(schemaVersion)} (current v${current})`,
    });
  }
  while (version < current) {
    const step = steps[version];
    if (step === undefined) {
      return err({ kind: 'schema_version_unsupported', detail: `${type}: no upcaster v${version}-to-v${version + 1}` });
    }
    value = step(value);
    version += 1;
  }
  return ok({ schema_version: version, payload: value });
}

/** 17종 표(테스트가 `LedgerEventType` 완전성을 확인한다). */
export const UPCASTER_TYPES: readonly string[] = Object.keys(STEPS);
