import type { Verdict } from '@fathom/contracts/events/catalog/grading';
import { sha256Hex } from '@fathom/shared-kernel/canonical/canonical';
import type { CurrentPolicySet, StudyDayContext } from '../../../src/application/ledger/ports.js';

// 골든 원장·계약 표본의 공통 페이로드 조립(결정적 — 시각·ID·난수는 호출자가 준다). 스키마는 contracts 그대로이며 여기서 재정의하지 않는다.

export const GOLDEN_POLICY: CurrentPolicySet = {
  policy_version: 'ps_5e1f0a9c3b7d2468',
  members: {
    mastery_rules: { version: 'mastery_rules@v1', sha256: sha256Hex('mastery_rules@v1') },
    fsrs_params: { version: 'fsrs_params@v1', sha256: sha256Hex('fsrs_params@v1') },
    cbm_params: { version: 'cbm_params@v1', sha256: sha256Hex('cbm_params@v1') },
    gaming_params: { version: 'gaming_params@v1', sha256: sha256Hex('gaming_params@v1') },
  },
  overrides_sha256: null,
};
export const GOLDEN_STUDY_DAY: StudyDayContext = { timeZone: 'Asia/Seoul', dayBoundaryMinutes: 240 };

export const GOLDEN_CONCEPTS = ['net.tcp-handshake', 'k8s.probes', 'lang.js-event-loop'] as const;
export type GoldenConcept = (typeof GOLDEN_CONCEPTS)[number];

export function trackOf(concept: string): string {
  return concept.split('.')[0] ?? concept;
}
export function itemIdOf(concept: string, n: number): string {
  return `${concept}.i${String(n).padStart(2, '0')}`;
}

export type VerdictResult = 'correct' | 'partial' | 'incorrect' | 'pending';
export type VerdictSpec = {
  readonly verdict_id: string;
  readonly attempt_id: string;
  readonly session_id: string;
  readonly block_id: string | null;
  readonly item_n: number;
  readonly concept_id: string;
  readonly facet: string;
  readonly response_mode: 'recognition' | 'production';
  readonly result: VerdictResult;
  readonly format: Verdict['format'];
  readonly tier: Verdict['tier'];
  readonly item_beta: number;
  readonly confidence: 1 | 2 | 3 | null;
  readonly latency_ms: number;
  readonly hints_used: number;
  readonly ai_mode: Verdict['ai_mode'];
  readonly issued_at: number;
};

const W_FORMAT: Readonly<Record<string, number>> = {
  ox: 0.5,
  mcq: 0.7,
  mcq_multi: 0.8,
  matching: 0.75,
  short: 0.9,
  cloze: 0.85,
  code_task: 1,
  essay: 0.9,
};

/** 결과별 파생 필드를 채운 완전한 Verdict(= `grading.verdict.issued` 페이로드, IF-EV-05). */
export function buildVerdict(s: VerdictSpec): Verdict {
  const pending = s.result === 'pending';
  const engine: Verdict['grader_engine'] = pending ? 'PENDING' : s.ai_mode === 'OFFLINE' ? 'D' : 'J';
  const band: Verdict['band'] =
    s.result === 'correct' ? 'right' : s.result === 'partial' ? 'partial' : ('wrong' as const);
  const rapid = s.latency_ms < 2000;
  return {
    verdict_id: s.verdict_id,
    attempt_id: s.attempt_id,
    session_id: s.session_id,
    block_id: s.block_id,
    item_id: itemIdOf(s.concept_id, s.item_n),
    item_content_hash: sha256Hex(`item:${itemIdOf(s.concept_id, s.item_n)}:v1`),
    item_beta_snapshot: s.item_beta,
    item_n_options: s.format === 'ox' ? 2 : s.format === 'mcq' || s.format === 'mcq_multi' ? 4 : 0,
    gate_result_id: null,
    stakes: 'S0',
    concept_id: s.concept_id,
    ku_ids: [`${s.concept_id}.k01`],
    mc_ids: s.result === 'incorrect' ? [`${s.concept_id}.m01`] : [],
    facet: s.facet,
    format: s.format,
    response_mode: s.response_mode,
    tier: s.tier,
    result: s.result,
    band,
    score: s.result === 'correct' ? 1 : s.result === 'partial' ? 0.5 : 0,
    confidence: s.confidence,
    latency_ms: s.latency_ms,
    rapid,
    hints_used: s.hints_used,
    grader_engine: engine,
    calibrated: engine === 'J',
    grader_confidence: engine === 'J' ? 0.82 : null,
    pending,
    provisional: pending,
    w_format: W_FORMAT[s.format] ?? 0.7,
    w_grader: pending ? 0 : engine === 'D' ? 1 : 0.8,
    gaming_factor: rapid ? 0.5 : 1,
    recommended_grade: s.result === 'correct' ? (s.latency_ms < 6000 ? 4 : 3) : s.result === 'partial' ? 2 : 1,
    ai_mode: s.ai_mode,
    content_policy_version: GOLDEN_POLICY.policy_version,
    judge_log_ref: null,
    prompt_version: null,
    issued_at: s.issued_at,
  };
}

/** Verdict → 원장 payload의 Verdict 운반 필드(`item_beta_snapshot` → `item_beta`). */
export function carriedFields(v: Verdict): Record<string, unknown> {
  const { item_beta_snapshot, ...rest } = v;
  return { ...rest, item_beta: item_beta_snapshot };
}

// ───────── 17종 중 Verdict 비운반 타입 ─────────

export function cardEnrolledPayload(c: {
  card_id: string;
  concept_id: string;
  facet: string;
  response_mode: 'recognition' | 'production';
  tier: 'A' | 'B' | 'C';
  study_day: string;
}): Record<string, unknown> {
  return { ...c, policy_version: GOLDEN_POLICY.policy_version };
}

export const sha = (seed: string): string => sha256Hex(seed);
