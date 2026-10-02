import { EVENT_PAYLOADS } from '@fathom/contracts/events/registry.gen';
import { qk } from './query-keys.js';

/** IF-01 §9.6 표 순서 그대로 — gateway가 구독하는 17종(`__consumers__/gateway.json`)과 같다. */
export const SSE_EVENT_TYPES = [
  'catalog.pack.activated',
  'catalog.overlay.conflicted',
  'acquisition.import.staged',
  'grading.verdict.revised',
  'itembank.item.corrected',
  'learning.session.completed',
  'learning.mastery.changed',
  'learning.level.promoted',
  'learning.ledger.merged',
  'ai.mode.changed',
  'ai.provider.status_changed',
  'ai.work_order.approval_requested',
  'ai.work_order.decided',
  'ai.budget.threshold_reached',
  'ai.judge.drift_detected',
  'ops.health.changed',
  'ops.backup.completed',
] as const;

export type SseEventType = (typeof SSE_EVENT_TYPES)[number];
export type Invalidation = readonly (readonly unknown[])[] | 'all';

const ALL: Invalidation = 'all';

type Rule = (payload: unknown) => Invalidation;

// payload를 EVENT_PAYLOADS[type][1]로 검증한 뒤에만 키를 만든다. 실패 = 전체 무효화(IR-016 누락 0).
// 규칙은 schema_version별이다 — contracts에 v2 payload가 생기면 RULES_BY_VERSION에 그 버전의 규칙을 추가한다.
const RULES_V1: Readonly<Record<SseEventType, Rule>> = {
  'catalog.pack.activated': (p) => {
    const r = EVENT_PAYLOADS['catalog.pack.activated'][1].safeParse(p);
    return r.success ? [qk.tracks(), qk.track(r.data.track), qk.conceptAll(), qk.map()] : ALL;
  },
  'catalog.overlay.conflicted': (p) => {
    const r = EVENT_PAYLOADS['catalog.overlay.conflicted'][1].safeParse(p);
    return r.success ? [qk.curationConflicts(), qk.concept(r.data.target_id)] : ALL;
  },
  'acquisition.import.staged': (p) => {
    const r = EVENT_PAYLOADS['acquisition.import.staged'][1].safeParse(p);
    return r.success ? [qk.imports(), qk.import(r.data.job_id)] : ALL;
  },
  'grading.verdict.revised': (p) => {
    const r = EVENT_PAYLOADS['grading.verdict.revised'][1].safeParse(p);
    return r.success
      ? [
          qk.verdict(r.data.supersedes_verdict_id),
          qk.verdict(r.data.verdict.verdict_id),
          qk.session(r.data.verdict.session_id),
          qk.evidence(r.data.verdict.concept_id),
        ]
      : ALL;
  },
  'itembank.item.corrected': (p) => {
    const r = EVENT_PAYLOADS['itembank.item.corrected'][1].safeParse(p);
    return r.success ? [qk.sessionAll(), qk.evidenceAll(), qk.curationReports()] : ALL;
  },
  'learning.session.completed': (p) => {
    const r = EVENT_PAYLOADS['learning.session.completed'][1].safeParse(p);
    return r.success ? [qk.home(), qk.reviewWeekly()] : ALL;
  },
  'learning.mastery.changed': (p) => {
    const r = EVENT_PAYLOADS['learning.mastery.changed'][1].safeParse(p);
    return r.success ? [qk.concept(r.data.concept_id), qk.map(), qk.evidence(r.data.concept_id), qk.tracks()] : ALL;
  },
  'learning.level.promoted': (p) => {
    const r = EVENT_PAYLOADS['learning.level.promoted'][1].safeParse(p);
    return r.success ? [qk.tracks(), qk.track(r.data.track), qk.promotion(r.data.track), qk.home()] : ALL;
  },
  'learning.ledger.merged': () => ALL,
  'ai.mode.changed': (p) => {
    const r = EVENT_PAYLOADS['ai.mode.changed'][1].safeParse(p);
    return r.success ? [qk.aiStatus(), qk.home()] : ALL;
  },
  'ai.provider.status_changed': (p) => {
    const r = EVENT_PAYLOADS['ai.provider.status_changed'][1].safeParse(p);
    return r.success ? [qk.aiStatus()] : ALL;
  },
  'ai.work_order.approval_requested': (p) => {
    const r = EVENT_PAYLOADS['ai.work_order.approval_requested'][1].safeParse(p);
    return r.success ? [qk.aiWorkOrders()] : ALL;
  },
  'ai.work_order.decided': (p) => {
    const r = EVENT_PAYLOADS['ai.work_order.decided'][1].safeParse(p);
    return r.success ? [qk.aiWorkOrders(), qk.imports()] : ALL;
  },
  'ai.budget.threshold_reached': (p) => {
    const r = EVENT_PAYLOADS['ai.budget.threshold_reached'][1].safeParse(p);
    return r.success ? [qk.aiUsage(), qk.opsHealth()] : ALL;
  },
  'ai.judge.drift_detected': (p) => {
    const r = EVENT_PAYLOADS['ai.judge.drift_detected'][1].safeParse(p);
    return r.success ? [qk.aiCalibration()] : ALL;
  },
  'ops.health.changed': (p) => {
    const r = EVENT_PAYLOADS['ops.health.changed'][1].safeParse(p);
    return r.success ? [qk.opsHealth(), qk.home()] : ALL;
  },
  'ops.backup.completed': (p) => {
    const r = EVENT_PAYLOADS['ops.backup.completed'][1].safeParse(p);
    return r.success ? [qk.opsBackups(), qk.opsHealth()] : ALL;
  },
};

const RULES_BY_VERSION: ReadonlyMap<SseEventType, ReadonlyMap<number, Rule>> = new Map(
  SSE_EVENT_TYPES.map((type) => [type, new Map([[1, RULES_V1[type]]])]),
);

export function isSseEventType(type: string): type is SseEventType {
  return SSE_EVENT_TYPES.some((t) => t === type);
}

/** 이벤트 → 무효화할 query key 목록. 모르는 type·규칙 없는 버전·payload 파싱 실패 → `'all'`(Brief 결정). */
export function invalidationsFor(type: string, schemaVersion: number, payload: unknown): Invalidation {
  if (!isSseEventType(type)) {
    return ALL;
  }
  const rule = RULES_BY_VERSION.get(type)?.get(schemaVersion);
  return rule === undefined ? ALL : rule(payload);
}
