import type { LedgerEventEnvelope } from '@fathom/contracts/ledger/envelope';
import {
  evidenceRegradedPayload,
  evidenceUpgradedPayload,
  evidenceVoidedPayload,
  evidenceWeightAdjustedPayload,
} from './payload.js';
import { type CorrectionIndex, EMPTY_CORRECTIONS as EMPTY, type WeightAdjustment } from './types.js';

// ADR-011 §5 정정 2-패스 — 무효·가중·대체 대상 집합을 먼저 모으고(1패스) 본 패스에서 적용한다(순서 무관, 병합 안전).

export const EMPTY_CORRECTIONS: CorrectionIndex = EMPTY;

type Order = readonly [number, string, number];

export function orderOf(e: LedgerEventEnvelope): Order {
  return [e.client_ts, e.device_id, e.device_seq];
}

/** 총순서 비교: client_ts, device_id(ASCII ULID — BINARY = JS 비교), device_seq. */
export function compareOrder(a: Order, b: Order): number {
  if (a[0] !== b[0]) {
    return a[0] < b[0] ? -1 : 1;
  }
  if (a[1] !== b[1]) {
    return a[1] < b[1] ? -1 : 1;
  }
  if (a[2] !== b[2]) {
    return a[2] < b[2] ? -1 : 1;
  }
  return 0;
}

function supersededId(e: LedgerEventEnvelope): string {
  return e.type === 'evidence.upgraded'
    ? evidenceUpgradedPayload(e).supersedes_event_id
    : evidenceRegradedPayload(e).supersedes_event_id;
}

/**
 * 입력 = 정정·대체 이벤트(어떤 순서든, 중복 허용, 무관한 타입 무시). 루트 = 대체 사슬을 끝까지 따라간 원 attempt.graded event_id.
 * 무효·가중 대상이 사슬 중간(upgraded/regraded)을 가리켜도 루트로 정규화한다.
 */
export function buildCorrectionIndex(events: Iterable<LedgerEventEnvelope>): CorrectionIndex {
  const supersedes = new Map<string, LedgerEventEnvelope>();
  const voids = new Map<string, LedgerEventEnvelope>();
  const adjusts = new Map<string, LedgerEventEnvelope>();
  for (const e of events) {
    switch (e.type) {
      case 'evidence.upgraded':
      case 'evidence.regraded':
        supersedes.set(e.event_id, e);
        break;
      case 'evidence.voided':
        voids.set(e.event_id, e);
        break;
      case 'evidence.weight_adjusted':
        adjusts.set(e.event_id, e);
        break;
      default:
        break;
    }
  }
  if (supersedes.size === 0 && voids.size === 0 && adjusts.size === 0) {
    return EMPTY;
  }
  const targetOf = new Map<string, string>();
  for (const [id, e] of supersedes) {
    targetOf.set(id, supersededId(e));
  }
  const rootCache = new Map<string, string>();
  const root = (id: string): string => {
    const cached = rootCache.get(id);
    if (cached !== undefined) {
      return cached;
    }
    const seen = new Set<string>();
    let cur = id;
    for (let next = targetOf.get(cur); next !== undefined; next = targetOf.get(cur)) {
      if (seen.has(cur)) {
        throw new Error(`invariant: supersede cycle at ${cur}`);
      }
      seen.add(cur);
      cur = next;
    }
    rootCache.set(id, cur);
    return cur;
  };

  const rootOf = new Map<string, string>();
  const latest = new Map<string, LedgerEventEnvelope>();
  for (const [id, e] of supersedes) {
    const r = root(id);
    rootOf.set(id, r);
    const prev = latest.get(r);
    if (prev === undefined || compareOrder(orderOf(prev), orderOf(e)) < 0) {
      latest.set(r, e);
    }
  }

  const voided = new Set<string>();
  for (const e of voids.values()) {
    for (const t of evidenceVoidedPayload(e).target_event_ids) {
      voided.add(root(t));
    }
  }

  const adjustments = new Map<string, WeightAdjustment[]>();
  for (const e of adjusts.values()) {
    const p = evidenceWeightAdjustedPayload(e);
    const roots = new Set<string>();
    for (const t of p.target_event_ids) {
      roots.add(root(t));
    }
    for (const r of roots) {
      const list = adjustments.get(r) ?? [];
      list.push({ order: orderOf(e), adjustment: p.adjustment });
      adjustments.set(r, list);
    }
  }
  for (const list of adjustments.values()) {
    list.sort((a, b) => compareOrder(a.order, b.order));
  }
  return { voided, adjustments, latestSupersede: latest, rootOf };
}
