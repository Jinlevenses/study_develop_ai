import { z } from 'zod';
import { AiMode, Facet, FormatId, GraderEngine, ResponseMode, Stakes, Tier } from '../../common/domain.js';
import { ConceptId, ItemId, KuId, MisconceptionId, SemVer, Sha256Hex, Ulid } from '../../common/ids.js';
import { EpochMs } from '../../common/time.js';

// [Brief 결정 §4.4-2] 공유 shape 객체(zod 스키마 아님 — z.infer 타입 없음). 각 payload 파일이 스프레드한다.
// Verdict 필드 평탄화(item_beta_snapshot → item_beta)
export const VerdictCarried = {
  verdict_id: Ulid,
  attempt_id: Ulid,
  session_id: Ulid,
  block_id: Ulid.nullable(),
  item_id: ItemId,
  item_content_hash: Sha256Hex,
  item_beta: z.number(),
  item_n_options: z.number().int().min(0),
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
  recommended_grade: z.number().int().min(1).max(4),
  ai_mode: AiMode,
  content_policy_version: z.string().max(40),
  judge_log_ref: Ulid.nullable(),
  prompt_version: SemVer.nullable(),
  issued_at: EpochMs,
} as const;
