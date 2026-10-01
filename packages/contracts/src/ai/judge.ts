import { z } from 'zod';
import { ContextRef } from './data-class.js';
import { DataClass } from '../common/domain.js';
import { ObjKey, ObjPath, ProviderId, SemVer, Ulid } from '../common/ids.js';
import { S } from '../common/schema.js';
import { DurationMs } from '../common/time.js';
import { ProviderFamily } from '../http/ai-gateway/v1/providers.js';

export const JudgeStateValue: z.ZodType<JudgeStateValueT> = z.lazy(() => z.union([
  z.string().max(20_000), z.number(), z.boolean(), z.null(), z.record(ObjKey, JudgeStateValue),   // 배열 타입 없음(UR-16)
]));
export type JudgeStateValue = z.infer<typeof JudgeStateValue>;
export const JudgeState = z.record(ObjKey, JudgeStateValue).superRefine((s, ctx) => {
  /* 깊이 ≤ 4, canonicalJson 바이트 ≤ 65,536, 배열 값이 런타임에 섞이면 AI-VAL-010 */
});
export type JudgeState = z.infer<typeof JudgeState>;
export const QuestionInstance = S({
  template: ObjKey,                                                           // 레지스트리의 질문 템플릿 키 — 호출자는 instructions 문자열을 보내지 않는다
  vars: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,31}$/), ObjPath),        // '{{kp}}' → 'key_points.kp01' (없는 경로 = 422 AI-VAL-010, 폴백 금지)
});
export type QuestionInstance = z.infer<typeof QuestionInstance>;
export const JudgeRequest = S({
  template_version: z.union([z.literal('active'), SemVer]),
  state: JudgeState,
  state_classes: z.record(ObjKey, DataClass),                                 // state 최상위 키마다 데이터 등급(빠지면 422)
  untrusted_keys: z.array(ObjKey).max(32),                                    // 학습자·가져온 텍스트 키
  questions: z.record(ObjKey, QuestionInstance),                              // 1 ~ 15개(AI-VAL-011)
  lane: z.enum(['interactive', 'background']), deadline_ms: z.number().int().min(100).max(10_000),
  context_ref: ContextRef, calibrated_only: z.boolean(), family_exclude: z.array(ProviderFamily).max(4), local_only: z.boolean(),
  work_order_id: Ulid.nullable(),                                             // background 필수(AI-POLICY-002)
});                                                                           // task_id는 경로 파라미터(JudgeTaskId)
export type JudgeRequest = z.infer<typeof JudgeRequest>;
export const JudgeAnswer = z.discriminatedUnion('type', [
  S({ type: z.literal('noul'), p_yes: z.number().min(0).max(1) }),
  S({ type: z.literal('choice'), choice: ObjKey, confidence: z.number().min(0).max(1), probabilities: z.record(ObjKey, z.number().min(0).max(1)) }),
  S({ type: z.literal('score'), score: z.number().min(0), confidence: z.number().min(0).max(1),
      probabilities: z.record(z.string().regex(/^\d{1,2}$/), z.number().min(0).max(1)), levels: z.number().int().min(2).max(10) }),
]);
export type JudgeAnswer = z.infer<typeof JudgeAnswer>;
export const JudgeUnavailableReason = z.enum(['offline', 'no_consented_provider', 'auth_invalid', 'breaker_open', 'deadline', 'firewall_blocked',
  'budget_exhausted', 'quota_exhausted', 'task_disabled', 'provider_error', 'bad_request', 'calibrated_engine_unavailable', 'busy']);
export type JudgeUnavailableReason = z.infer<typeof JudgeUnavailableReason>;
export const JudgeResult = z.discriminatedUnion('status', [
  S({ status: z.literal('ok'), engine: z.enum(['J', 'LJ']), calibrated: z.boolean(), confidence: z.number().min(0).max(1),
      answers: z.record(ObjKey, JudgeAnswer), model_version: z.string().max(80), provider_id: ProviderId, prompt_version: SemVer,
      judge_log_id: Ulid, firewall_decision_id: Ulid, cache_hit: z.boolean(), latency_ms: DurationMs }),
  S({ status: z.literal('unavailable'), reason: JudgeUnavailableReason, retry_after_ms: z.number().int().min(0).nullable() }),
  S({ status: z.literal('deferred'), reason: z.enum(['background_queued', 'batch_window_closed', 'work_order_pending']), job_id: Ulid.nullable() }),
]);
export type JudgeResult = z.infer<typeof JudgeResult>;
export const JudgeJobPayload = S({ state: JudgeState, state_classes: z.record(ObjKey, DataClass), untrusted_keys: z.array(ObjKey).max(32),
  questions: z.record(ObjKey, QuestionInstance), calibrated_only: z.boolean(), family_exclude: z.array(ProviderFamily).max(4), local_only: z.boolean() });
export type JudgeJobPayload = z.infer<typeof JudgeJobPayload>;
