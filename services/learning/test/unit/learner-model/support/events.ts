import type { LedgerEventEnvelope } from '@fathom/contracts/ledger/envelope';
import { AttemptGradedV1 } from '@fathom/contracts/ledger/payloads/attempt-graded';
import { CardEnrolledV1 } from '@fathom/contracts/ledger/payloads/card-enrolled';
import { CardStatusChangedV1 } from '@fathom/contracts/ledger/payloads/card-status-changed';
import { EvidenceRegradedV1 } from '@fathom/contracts/ledger/payloads/evidence-regraded';
import { EvidenceUpgradedV1 } from '@fathom/contracts/ledger/payloads/evidence-upgraded';
import { EvidenceVoidedV1 } from '@fathom/contracts/ledger/payloads/evidence-voided';
import { EvidenceWeightAdjustedV1 } from '@fathom/contracts/ledger/payloads/evidence-weight-adjusted';
import { PolicySwitchedV1 } from '@fathom/contracts/ledger/payloads/policy-switched';
import { fixedUlid } from '@fathom/testkit/ids';
import { REPO_MEMBERS, REPO_PS } from './policy.js';

// 원장 envelope 빌더(스키마 검증 통과 payload). 계약 스키마의 `.parse`로 만들어 필드 누락·오타를 즉시 잡는다.

export const DEV_A = fixedUlid(1);
export const DEV_B = fixedUlid(2);
export const T0 = 1_790_000_000_000;
export const DAY = 86_400_000;
export const STUDY_DAY_1 = '2026-09-21';
export const STUDY_DAY_2 = '2026-09-22';

export type Result4 = 'correct' | 'partial' | 'incorrect' | 'pending';
export type VerdictOpts = {
  readonly concept_id?: string;
  readonly card_id?: string;
  readonly facet?: string;
  readonly response_mode?: 'recognition' | 'production';
  readonly tier?: 'A' | 'B' | 'C';
  readonly format?: string;
  readonly result?: Result4;
  readonly pending?: boolean;
  readonly rapid?: boolean;
  readonly item_beta?: number;
  readonly item_n_options?: number;
  readonly w_format?: number;
  readonly w_grader?: number;
  readonly gaming_factor?: number;
  readonly hints_used?: number;
  readonly recommended_grade?: number;
  readonly latency_ms?: number;
};

export type GradedOpts = VerdictOpts & {
  readonly rating?: 1 | 2 | 3 | 4 | null;
  readonly fsrs_at?: number;
  readonly study_day?: string;
  readonly policy_version?: string;
};

export type EventMeta = { readonly ts: number; readonly device?: string; readonly seq?: number; readonly id?: string };

const DEFAULT_CONCEPT = 'k8s.probes';

export function cardIdOf(concept: string, facet: string, mode: 'recognition' | 'production'): string {
  return `${concept}:${facet}:${mode === 'recognition' ? 'r' : 'p'}`;
}

function bandOf(result: Result4): 'wrong' | 'partial' | 'right' {
  return result === 'correct' ? 'right' : result === 'partial' ? 'partial' : 'wrong';
}

export function verdictFields(o: VerdictOpts, verdictId: string, attemptId: string): Record<string, unknown> {
  const concept = o.concept_id ?? DEFAULT_CONCEPT;
  const result = o.result ?? 'correct';
  return {
    verdict_id: verdictId,
    attempt_id: attemptId,
    session_id: fixedUlid(9_000),
    block_id: null,
    item_id: `${concept}.i01`,
    item_content_hash: 'a'.repeat(64),
    item_beta: o.item_beta ?? 0,
    item_n_options: o.item_n_options ?? 0,
    gate_result_id: null,
    stakes: 'S0',
    concept_id: concept,
    ku_ids: [],
    mc_ids: [],
    facet: o.facet ?? 'concept',
    format: o.format ?? 'short',
    response_mode: o.response_mode ?? 'production',
    tier: o.tier ?? 'A',
    result,
    band: bandOf(result),
    score: result === 'correct' ? 1 : result === 'partial' ? 0.5 : 0,
    confidence: null,
    latency_ms: o.latency_ms ?? 5000,
    rapid: o.rapid ?? false,
    hints_used: o.hints_used ?? 0,
    grader_engine: 'D',
    calibrated: false,
    grader_confidence: null,
    pending: o.pending ?? result === 'pending',
    provisional: false,
    w_format: o.w_format ?? 1,
    w_grader: o.w_grader ?? 1,
    gaming_factor: o.gaming_factor ?? 1,
    recommended_grade: o.recommended_grade ?? 3,
    ai_mode: 'OFFLINE',
    content_policy_version: 'cp1',
    judge_log_ref: null,
    prompt_version: null,
    issued_at: 1,
  };
}

/** 기기별 단조 seq·결정적 event_id를 관리하는 envelope 팩토리. */
export class EventFactory {
  private idCounter: number;
  private readonly seqs = new Map<string, number>();

  constructor(idStart = 100) {
    this.idCounter = idStart;
  }

  nextId(): string {
    this.idCounter += 1;
    return fixedUlid(this.idCounter);
  }

  envelope(type: LedgerEventEnvelope['type'], meta: EventMeta, payload: Record<string, unknown>): LedgerEventEnvelope {
    const device = meta.device ?? DEV_A;
    const seq = meta.seq ?? (this.seqs.get(device) ?? 0) + 1;
    this.seqs.set(device, Math.max(seq, this.seqs.get(device) ?? 0));
    const id = meta.id ?? this.nextId();
    return {
      event_id: id,
      device_id: device,
      device_seq: seq,
      client_ts: meta.ts,
      type,
      schema_version: 1,
      idempotency_key: `${type}:${id}`,
      payload,
      prev_hash: '0'.repeat(64),
      hash: '1'.repeat(64),
      experiment_arm: null,
      recorded_at: 0,
    };
  }

  enrolled(
    meta: EventMeta,
    o: {
      readonly concept_id?: string;
      readonly facet?: string;
      readonly response_mode?: 'recognition' | 'production';
      readonly tier?: 'A' | 'B' | 'C';
      readonly study_day?: string;
      readonly policy_version?: string;
    } = {},
  ): LedgerEventEnvelope {
    const concept = o.concept_id ?? DEFAULT_CONCEPT;
    const facet = o.facet ?? 'concept';
    const mode = o.response_mode ?? 'production';
    const payload = CardEnrolledV1.parse({
      card_id: cardIdOf(concept, facet, mode),
      concept_id: concept,
      facet,
      response_mode: mode,
      tier: o.tier ?? 'A',
      study_day: o.study_day ?? STUDY_DAY_1,
      policy_version: o.policy_version ?? REPO_PS,
    });
    return this.envelope('card.enrolled', meta, { ...payload });
  }

  statusChanged(
    meta: EventMeta,
    cardId: string,
    status: 'active' | 'suspended' | 'retired',
    o: { readonly study_day?: string; readonly policy_version?: string } = {},
  ): LedgerEventEnvelope {
    const payload = CardStatusChangedV1.parse({
      card_id: cardId,
      status,
      reason: 'user',
      study_day: o.study_day ?? STUDY_DAY_1,
      policy_version: o.policy_version ?? REPO_PS,
    });
    return this.envelope('card.status_changed', meta, { ...payload });
  }

  graded(meta: EventMeta, o: GradedOpts = {}): LedgerEventEnvelope {
    const concept = o.concept_id ?? DEFAULT_CONCEPT;
    const facet = o.facet ?? 'concept';
    const mode = o.response_mode ?? 'production';
    const result = o.result ?? 'correct';
    const pending = o.pending ?? result === 'pending';
    const rating = o.rating === undefined ? (pending ? null : 3) : o.rating;
    const payload = AttemptGradedV1.parse({
      ...verdictFields({ ...o, concept_id: concept, facet, response_mode: mode }, this.nextId(), this.nextId()),
      card_id: o.card_id ?? cardIdOf(concept, facet, mode),
      phase: 'practice',
      rating,
      cbm_score: null,
      fsrs_at: o.fsrs_at ?? meta.ts,
      study_day: o.study_day ?? STUDY_DAY_1,
      policy_version: o.policy_version ?? REPO_PS,
    });
    return this.envelope('attempt.graded', meta, { ...payload });
  }

  upgraded(
    meta: EventMeta,
    target: string,
    o: GradedOpts & { readonly new_rating?: 1 | 2 | 3 | 4 | null } = {},
  ): LedgerEventEnvelope {
    const concept = o.concept_id ?? DEFAULT_CONCEPT;
    const facet = o.facet ?? 'concept';
    const mode = o.response_mode ?? 'production';
    const payload = EvidenceUpgradedV1.parse({
      ...verdictFields({ ...o, concept_id: concept, facet, response_mode: mode }, this.nextId(), this.nextId()),
      supersedes_event_id: target,
      supersedes_verdict_id: fixedUlid(8_000),
      card_id: o.card_id ?? cardIdOf(concept, facet, mode),
      new_rating: o.new_rating ?? null,
      rating_applied: false,
      study_day: o.study_day ?? STUDY_DAY_2,
      policy_version: o.policy_version ?? REPO_PS,
    });
    return this.envelope('evidence.upgraded', meta, { ...payload });
  }

  regraded(
    meta: EventMeta,
    target: string,
    o: GradedOpts & { readonly new_rating?: 1 | 2 | 3 | 4 | null } = {},
  ): LedgerEventEnvelope {
    const concept = o.concept_id ?? DEFAULT_CONCEPT;
    const facet = o.facet ?? 'concept';
    const mode = o.response_mode ?? 'production';
    const payload = EvidenceRegradedV1.parse({
      ...verdictFields({ ...o, concept_id: concept, facet, response_mode: mode }, this.nextId(), this.nextId()),
      supersedes_event_id: target,
      supersedes_verdict_id: fixedUlid(8_000),
      card_id: o.card_id ?? cardIdOf(concept, facet, mode),
      reason: 'pending_regrade',
      new_rating: o.new_rating ?? null,
      rating_applied: false,
      study_day: o.study_day ?? STUDY_DAY_2,
      policy_version: o.policy_version ?? REPO_PS,
    });
    return this.envelope('evidence.regraded', meta, { ...payload });
  }

  voided(
    meta: EventMeta,
    targets: readonly string[],
    o: { readonly policy_version?: string } = {},
  ): LedgerEventEnvelope {
    const payload = EvidenceVoidedV1.parse({
      item_id: `${DEFAULT_CONCEPT}.i01`,
      target_event_ids: targets,
      basis: 'report',
      correction: 'quarantined',
      gate_result_id: fixedUlid(7_000),
      study_day: STUDY_DAY_2,
      policy_version: o.policy_version ?? REPO_PS,
    });
    return this.envelope('evidence.voided', meta, { ...payload });
  }

  weightAdjusted(
    meta: EventMeta,
    targets: readonly string[],
    adjustment: EvidenceWeightAdjustedV1['adjustment'],
    o: { readonly policy_version?: string } = {},
  ): LedgerEventEnvelope {
    const payload = EvidenceWeightAdjustedV1.parse({
      target_event_ids: targets,
      adjustment,
      cause: 'correction_halve',
      item_id: null,
      gate_result_id: null,
      study_day: STUDY_DAY_2,
      policy_version: o.policy_version ?? REPO_PS,
    });
    return this.envelope('evidence.weight_adjusted', meta, { ...payload });
  }

  policySwitched(
    meta: EventMeta,
    o: {
      readonly policy_version?: string;
      readonly previous?: string;
      readonly members?: PolicySwitchedV1['members'];
    } = {},
  ): LedgerEventEnvelope {
    const payload = PolicySwitchedV1.parse({
      policy_version: o.policy_version ?? REPO_PS,
      previous_policy_version: o.previous ?? 'ps_0000000000000000',
      members: o.members ?? REPO_MEMBERS,
      overrides_sha256: null,
      replay_report_ref: null,
      study_day: STUDY_DAY_1,
    });
    return this.envelope('policy.switched', meta, { ...payload });
  }
}
