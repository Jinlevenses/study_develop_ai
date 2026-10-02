import type { LedgerEventEnvelope } from '@fathom/contracts/ledger/envelope';
import { AttemptGradedV1 } from '@fathom/contracts/ledger/payloads/attempt-graded';
import { CardEnrolledV1 } from '@fathom/contracts/ledger/payloads/card-enrolled';
import { CardStatusChangedV1 } from '@fathom/contracts/ledger/payloads/card-status-changed';
import { EvidenceRegradedV1 } from '@fathom/contracts/ledger/payloads/evidence-regraded';
import { EvidenceUpgradedV1 } from '@fathom/contracts/ledger/payloads/evidence-upgraded';
import { EvidenceVoidedV1 } from '@fathom/contracts/ledger/payloads/evidence-voided';
import { EvidenceWeightAdjustedV1 } from '@fathom/contracts/ledger/payloads/evidence-weight-adjusted';

// 리듀서 입력 계약(IF-01 §10.3): payload는 소스(리플레이 리더)가 upcast·검증한 값이지만, 리듀서도 읽는 필드를 계약 스키마로 한 번 더 좁힌다.
// 같은 envelope 객체의 반복 파싱(증분 + 전체 리플레이)은 WeakMap으로 1회만 한다(순수 메모이제이션 — 결과는 입력의 함수).

type ParseResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: { readonly issues: readonly { readonly message: string }[] } };
type PayloadParser<T> = { safeParse(input: unknown): ParseResult<T> };

function cachedParser<T extends object>(
  type: string,
  parser: PayloadParser<T>,
): (event: LedgerEventEnvelope) => Readonly<T> {
  const cache = new WeakMap<LedgerEventEnvelope, Readonly<T>>();
  return (event) => {
    const hit = cache.get(event);
    if (hit !== undefined) {
      return hit;
    }
    const parsed = parser.safeParse(event.payload);
    if (!parsed.success) {
      const why = parsed.error.issues[0]?.message ?? 'schema mismatch';
      throw new Error(`invariant: projector payload invalid for ${type} ${event.event_id}: ${why}`);
    }
    cache.set(event, parsed.data);
    return parsed.data;
  };
}

export const attemptGradedPayload = cachedParser('attempt.graded', AttemptGradedV1);
export const cardEnrolledPayload = cachedParser('card.enrolled', CardEnrolledV1);
export const cardStatusChangedPayload = cachedParser('card.status_changed', CardStatusChangedV1);
export const evidenceUpgradedPayload = cachedParser('evidence.upgraded', EvidenceUpgradedV1);
export const evidenceRegradedPayload = cachedParser('evidence.regraded', EvidenceRegradedV1);
export const evidenceVoidedPayload = cachedParser('evidence.voided', EvidenceVoidedV1);
export const evidenceWeightAdjustedPayload = cachedParser('evidence.weight_adjusted', EvidenceWeightAdjustedV1);
