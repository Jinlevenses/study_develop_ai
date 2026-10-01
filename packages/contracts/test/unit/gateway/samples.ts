// 테스트 전용 유효 샘플(무네트워크). gateway 계약 스키마의 "유효 1건" 단언에만 쓴다.
import { conceptSummary, SHA, ULID, ULID_B } from '../content/samples.js';

export { conceptSummary, SHA, ULID, ULID_B };
export const NOW = 1_700_000_000_000;
export const B64 = 'A'.repeat(43);

export const banner = {
  banner_id: ULID,
  code: 'ai_offline',
  severity: 'info',
  message_ko: 'AI가 꺼져 있습니다.',
  since: 1,
  dismissible: true,
  action: { label_ko: '설정', href: '/settings/ai', cli: null },
};

export const alert = {
  code: 'due_overflow',
  severity: 'warn',
  message_ko: '복습이 쌓였습니다',
  action: { label_ko: '시작', href: '/sessions' },
};

export const home = {
  primary_action: {
    kind: 'start_session',
    label_ko: '시작',
    suggested: { minutes: 15, energy: 'normal' },
    session_id: null,
  },
  alerts: [alert],
  energy_default: 'normal',
  minutes_default: 15,
  today: { due_cards: 3, new_budget: 2, est_minutes: 15 },
  weekly_goal: { target_sessions: 3, done_sessions: 1, streak_weeks: 0, rest_tokens: 1 },
  ai_chip: { mode: 'OFFLINE', label_ko: 'AI: 오프라인', degraded_badge: false },
  banners: [banner],
  degraded: [],
};

export const lensEmpty = { questions_md: [] };
export const conceptContent = {
  concept: conceptSummary,
  content_hash: SHA,
  version: { pack_id: 'k8s', pack_version: '1.0.0', overlay_rev: 0 },
  stages: {
    theory: { body_md: '본문', placeholder: false, diagrams: [] },
    code: { body_md: '본문', placeholder: false, examples: [] },
    core: { body_md: '본문', placeholder: false, when_not_to_use_md: null },
  },
  kus: [],
  misconceptions: [],
  prereq_ids: [],
  successor_ids: [],
  related_case_ids: [],
  sources: [],
  lenses: { 1: lensEmpty, 2: lensEmpty, 3: lensEmpty, 4: lensEmpty, 5: { questions_md: ['왜?'] } },
  embedded_items: [],
  freshness: { valid_as_of_min: null, cl_x: false, volatile_ku_count: 0 },
};

export const learnerState = {
  concept_id: 'k8s.probes',
  lifecycle: 'CL-3',
  mastery: {
    status: 'learning',
    provisional: false,
    needs_reconfirmation: false,
    p: 0.7,
    formats_counted: ['ox'],
    distinct_study_days: 1,
  },
  theta: { display: null, n_graded: 3, evidence_sufficient: false, display_min_events: 30 },
  competence: { mastered: false, retained: false, deepened: false, transferred: false, taught: false },
  cards: [],
  track_level: 2,
  rusty: false,
  entry_stage: 'theory',
  nba: null,
  last_activity_at: null,
};

export const mapCell = {
  concept_id: 'k8s.probes',
  track: 'k8s',
  level: 2,
  x: 1,
  y: 2,
  lifecycle: 'CL-3',
  mastery: 'learning',
  provisional: false,
  retention: null,
  rusty: false,
  illusion: false,
  foundation_crack: false,
  needs_revalidation: false,
  depth_ring: 1,
  star: false,
  blueprint_weight: null,
};

export const providerView = {
  provider_id: 'claude-cli',
  kind: 'llm_cli',
  family: 'anthropic',
  display_name: 'Claude CLI',
  status: 'ok',
  consent: { granted: true, granted_at: NOW, scopes: ['judge'] },
  probe: null,
  breaker: 'closed',
  billing_mode: 'subscription',
  trust: 'unverified',
  models_by_tier: { low: null, mid: null, high: null },
  capabilities: { structured_output: true, json_schema_flag: true, streaming: true, multi_turn: false },
  external_processor: true,
};

export const modeView = {
  mode: 'FULL',
  previous_mode: null,
  reasons: ['probe_ok'],
  providers: [{ id: 'claude-cli', kind: 'llm_cli', status: 'ok' }],
  changed_at: NOW,
  safe_mode: false,
};

export const healthBoard = {
  generated_at: NOW,
  overall: 'ok',
  app_version: '1.0.0',
  services: [
    { svc: 'gateway', state: 'ready', pid: 100, port: 4747, restarts_60s: 0, started_at: NOW, degraded_reason: null },
  ],
  ai: { mode: 'OFFLINE', providers: [] },
  backup: { last_ok_at: null, rpo_hours: null, secondary_configured: false, last_outcome: null },
  outbox: [],
  inbox: { dead_total: 0, halted: [] },
  runner: { enabled: false, queue_length: 0, platform_reason: null },
  eventloop_p99_ms: { gateway: 1, content: 1, learning: 1, 'ai-gateway': 1, 'ops-api': 1 },
  rss_mb: { gateway: 100 },
  disk: { free_mb: 1000, warn: false },
  integrity: { ledger_alarm: false, projection_match: null, last_full_check_at: null },
  banners: [],
};

/** 객체의 얕은 복사에 필드를 덮어쓴 새 객체(테스트 입력 변형용). */
export const withFields = (base: object, over: Record<string, unknown>): Record<string, unknown> => ({
  ...base,
  ...over,
});
