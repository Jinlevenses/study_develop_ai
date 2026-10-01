// 테스트 전용 유효 샘플(무네트워크). learning 계약 스키마의 "유효 1건" 단언에만 쓴다.
import { itemDelivery, SHA, ULID, ULID_B } from '../content/samples.js';

export { itemDelivery, SHA, ULID, ULID_B };
export const ULID_C = '01J1N2P3Q4R5S6T7V8W9X0Y1Z2';
export const PS = 'ps_0123456789abcdef';
export const DAY = '2026-10-01';
export const NOW = 1_700_000_000_000;

export const blockSummary = {
  block_id: ULID,
  ord: 0,
  slot: 'W',
  mode_id: 'M-01',
  kind: 'items',
  concept_id: 'k8s.probes',
  reason_chips: [{ code: 'due', label_ko: '복습 시점', value: 'R 0.71' }],
  locked: false,
  state: 'pending',
  est_minutes: 3,
  item_count: 3,
  done_count: 0,
  wildcard: null,
  boss: false,
};

export const sessionView = {
  session_id: ULID,
  template: 'standard',
  state: 'active',
  scope: { kind: 'all' },
  minutes: 15,
  energy: 'normal',
  started_at: NOW,
  ended_at: null,
  policy_version: PS,
  ai_mode_at_start: 'OFFLINE',
  relaxations: [],
  blocks: [blockSummary],
  current_block_id: ULID,
  progress: { blocks_total: 1, blocks_done: 0, elapsed_ms: 0 },
  pending_grades: 0,
};

export const ldiSummary = {
  value: 0.62,
  delta: null,
  params: 'ldi_params@v1',
  params_provisional: true,
  computed_at: NOW,
};

export const forecastView = {
  window_days: 30,
  total_range: { low: 100, high: 130 },
  band_source: 'default_15pct',
  history_windows: 0,
  method: 'model',
  method_provisional: true,
  governor: { daily_budget: 20, lower_bound_exceeds_budget: false, new_cards_throttled: false },
  computed_at: NOW,
};

export const trackCap = { declared: 3, offline: 3, oracle: 3, display: 3 };

export const reveal = {
  answer: { kind: 'none' },
  explanation_md: null,
  model_answer_md: null,
  cited_ku_ids: [],
  runner: null,
};
export const feedback = { summary_md: '요약', per_unit: {}, misconception: null, source: 'template', stream_ref: null };

/** 객체의 얕은 복사에 필드를 덮어쓴 새 객체(테스트 입력 변형용). */
export const withFields = (base: object, over: Record<string, unknown>): Record<string, unknown> => ({
  ...base,
  ...over,
});
/** 키를 뺀 새 객체. */
export const without = (base: Record<string, unknown>, key: string): Record<string, unknown> => {
  const { [key]: _drop, ...rest } = base;
  return rest;
};
