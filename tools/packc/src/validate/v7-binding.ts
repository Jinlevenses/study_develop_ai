// V7 바인딩·문항 상태(Brief T-01-03 §4.5). 문항 gate_status:
//   ① code_predict의 answer: 'auto' = deferred(V4 미구현, 출제 0)
//   ② 그 밖: item_id를 scope.record_ids에 가진 V7 배치 중 가장 최근 created_at(같으면 batch_id 큰 쪽) 1개가
//      decision: approve ∧ defect_rate ≤ 0.05 ∧ reviewer.context_id ≠ author.context_id ∧ 미해결 blocker finding 0 ∧
//      approved_hashes[item_id] = subject hash → seed_reviewed(s2_mode v7_review), 아니면 authored.
// 해시 불일치·조건 불충족 id는 stale[](info finding). V7 결과는 error가 아니다.
import { dayToEpochMs } from '../emit/det-ulid.js';
import type { GateOutcome, ItemBody } from '../emit/records.js';
import type { Finding } from './finding.js';
import { byCode, finding } from './finding.js';
import type { V7Entry } from './model.js';

export const V7_MAX_DEFECT_RATE = 0.05;

export type V7Binding = {
  readonly gate: GateOutcome;
  /** 최신 배치에 들어 있으나 조건을 못 채운 item_id(정렬). */
  readonly stale: readonly string[];
  readonly counts: { readonly authored: number; readonly seed_reviewed: number; readonly deferred: number };
  readonly findings: readonly Finding[];
};

function newer(a: V7Entry, b: V7Entry): boolean {
  if (a.data.created_at !== b.data.created_at) {
    return a.data.created_at > b.data.created_at;
  }
  return a.data.batch_id > b.data.batch_id;
}

/** 배치가 이 문항을 승인하지 못하는 이유(승인 가능이면 null). */
function rejection(batch: V7Entry, item: ItemBody): string | null {
  const d = batch.data;
  if (d.decision !== 'approve') {
    return `batch ${d.batch_id} decision is ${d.decision}`;
  }
  if (d.defect_rate > V7_MAX_DEFECT_RATE) {
    return `batch ${d.batch_id} defect_rate ${d.defect_rate} > ${V7_MAX_DEFECT_RATE}`;
  }
  if (d.reviewer.context_id === d.author.context_id) {
    return `batch ${d.batch_id} reviewer context_id equals author context_id`;
  }
  const open = Object.entries(d.findings).filter(([, f]) => f.severity === 'blocker' && f.resolution !== 'fixed');
  if (open.length > 0) {
    return `batch ${d.batch_id} has unresolved blocker finding ${open.map(([k]) => k).join(',')}`;
  }
  const approved = d.approved_hashes[item.itemId];
  if (approved === undefined) {
    return `batch ${d.batch_id} has no approved_hashes entry`;
  }
  if (approved !== item.subject) {
    return `batch ${d.batch_id} approved hash does not match the current content`;
  }
  return null;
}

export function bindV7(items: readonly ItemBody[], batches: readonly V7Entry[]): V7Binding {
  const status = new Map<string, { gate_status: string; s2_mode: string | null }>();
  const gateResults: GateOutcome['gateResults'][number][] = [];
  const stale: string[] = [];
  const findings: Finding[] = [];
  let authored = 0;
  let seedReviewed = 0;
  let deferred = 0;
  for (const item of items) {
    if (item.deferred) {
      status.set(item.itemId, { gate_status: 'deferred', s2_mode: null });
      deferred += 1;
      continue;
    }
    let latest: V7Entry | null = null;
    for (const b of batches) {
      if (b.data.scope.record_ids.includes(item.itemId) && (latest === null || newer(b, latest))) {
        latest = b;
      }
    }
    if (latest === null) {
      status.set(item.itemId, { gate_status: 'authored', s2_mode: null });
      authored += 1;
      continue;
    }
    const why = rejection(latest, item);
    if (why === null) {
      status.set(item.itemId, { gate_status: 'seed_reviewed', s2_mode: 'v7_review' });
      gateResults.push({
        itemId: item.itemId,
        batchId: latest.data.batch_id,
        policy: latest.data.policy,
        defectRate: latest.data.defect_rate,
        timeMs: dayToEpochMs(latest.data.created_at),
        batchFile: latest.rel,
      });
      seedReviewed += 1;
    } else {
      status.set(item.itemId, { gate_status: 'authored', s2_mode: null });
      authored += 1;
      stale.push(item.itemId);
      findings.push(
        finding('V7', 'info', latest.rel, `approved_hashes.${item.itemId}`, `${item.itemId} stale: ${why}`),
      );
    }
  }
  return {
    gate: { status, gateResults },
    stale: stale.sort(byCode),
    counts: { authored, seed_reviewed: seedReviewed, deferred },
    findings,
  };
}
