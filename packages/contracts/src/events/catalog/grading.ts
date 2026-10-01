import { z } from 'zod';
import { AiMode, Facet, FormatId, GraderEngine, ResponseMode, Stakes, Tier } from '../../common/domain.js';
import {
  ConceptId,
  ItemId,
  KuId,
  MisconceptionId,
  SemVer,
  type ServiceName,
  Sha256Hex,
  Ulid,
} from '../../common/ids.js';
import { S } from '../../common/schema.js';
import { EpochMs } from '../../common/time.js';

export const Verdict = S({
  // IF-EV-05 payload = Verdict (ADR-011 §4 정본)
  verdict_id: Ulid,
  attempt_id: Ulid,
  session_id: Ulid,
  block_id: Ulid.nullable(),
  item_id: ItemId,
  item_content_hash: Sha256Hex,
  item_beta_snapshot: z.number(),
  item_n_options: z.number().int().min(0), // 0 = 열린 형식(추측 보정 c = 0), SP-6 F0
  gate_result_id: Ulid.nullable(),
  stakes: Stakes,
  concept_id: ConceptId,
  ku_ids: z.array(KuId).max(20),
  mc_ids: z.array(MisconceptionId).max(20),
  facet: Facet,
  format: FormatId,
  response_mode: ResponseMode,
  tier: Tier,
  result: z.enum(['correct', 'partial', 'incorrect', 'pending']),
  band: z.enum(['wrong', 'partial', 'right']),
  score: z.number().min(0).max(1),
  confidence: z.number().int().min(1).max(3).nullable(),
  latency_ms: z.number().int().min(0),
  rapid: z.boolean(),
  hints_used: z.number().int().min(0),
  grader_engine: GraderEngine,
  calibrated: z.boolean(),
  grader_confidence: z.number().min(0).max(1).nullable(),
  pending: z.boolean(),
  provisional: z.boolean(),
  w_format: z.number().min(0).max(1),
  w_grader: z.number().min(0).max(1),
  gaming_factor: z.number().min(0).max(1),
  recommended_grade: z.number().int().min(1).max(4), // §6.3.1
  ai_mode: AiMode,
  content_policy_version: z.string().max(40), // content 정책 세트 주소(ps_…) — ARC §8.5의 'policy_version'(§15 D-15)
  judge_log_ref: Ulid.nullable(),
  prompt_version: SemVer.nullable(),
  issued_at: EpochMs, // SemVer = ai-gateway가 내는 값과 동일(golden fixture 정합)
});
export type Verdict = z.infer<typeof Verdict>;
export const GradingVerdictRevisedV1 = S({
  // IF-EV-06
  verdict: Verdict,
  supersedes_verdict_id: Ulid,
  reason: z.enum(['deadline_upgrade', 'pending_regrade', 'appeal']),
  band_changed: z.boolean(),
});
export type GradingVerdictRevisedV1 = z.infer<typeof GradingVerdictRevisedV1>;
type EventCatalog = Readonly<
  Record<
    string,
    {
      readonly ifId: string;
      readonly producer: z.infer<typeof ServiceName>;
      readonly freeze: 'D' | 'O';
      readonly slice: 'R0' | 'R1' | 'R2' | 'R3';
      readonly versions: Readonly<Record<number, z.ZodType>>;
    }
  >
>; // 파일 비공개
// IF-01 §9.3 카탈로그 표(v·생산·동결·슬라이스) 전사 — T-00-10 contracts:gen이 이 맵을 import해 registry.gen.ts를 만든다.
export const GRADING_EVENTS = {
  'grading.verdict.issued': {
    ifId: 'IF-EV-05',
    producer: 'content',
    freeze: 'D',
    slice: 'R0',
    versions: { 1: Verdict },
  },
  'grading.verdict.revised': {
    ifId: 'IF-EV-06',
    producer: 'content',
    freeze: 'O',
    slice: 'R2',
    versions: { 1: GradingVerdictRevisedV1 },
  },
} as const satisfies EventCatalog;
