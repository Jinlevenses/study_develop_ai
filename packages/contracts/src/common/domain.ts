import { z } from 'zod';

// 서비스 공통 도메인 스칼라(값 목록은 정책이 아니라 계약)
export const Level = z.number().int().min(1).max(5);
export type Level = z.infer<typeof Level>;
export const Tier = z.enum(['A', 'B', 'C']);
export type Tier = z.infer<typeof Tier>;
export const KnowledgeType = z.enum(['D', 'C', 'P', 'S']); // 서술·개념·절차·전략
export type KnowledgeType = z.infer<typeof KnowledgeType>;
export const Stakes = z.enum(['S0', 'S1', 'S2']);
export type Stakes = z.infer<typeof Stakes>;
export const AiMode = z.enum(['FULL', 'JUDGE_ONLY', 'LLM_ONLY', 'OFFLINE']);
export type AiMode = z.infer<typeof AiMode>;
export const ResponseMode = z.enum(['recognition', 'production']);
export type ResponseMode = z.infer<typeof ResponseMode>;
export const Facet = z.string().regex(/^[a-z][a-z_]{0,31}$/); // 'concept', 'code', 'ops', 'tradeoff'
export type Facet = z.infer<typeof Facet>;
export const ModeId = z.string().regex(/^M-(0[1-9]|1\d|2[01])$/); // M-01 ~ M-21 (modes.manifest.json)
export type ModeId = z.infer<typeof ModeId>;
export const SlotId = z.enum(['W', 'R', 'N', 'D', 'S', 'C']); // 워밍업·복습·신규·심화·도전·마무리 (FR-STD-002)
export type SlotId = z.infer<typeof SlotId>;
export const Energy = z.enum(['light', 'normal', 'deep']);
export type Energy = z.infer<typeof Energy>;
export const SessionMinutes = z.union([z.literal(5), z.literal(15), z.literal(25), z.literal(45), z.literal(90)]);
export type SessionMinutes = z.infer<typeof SessionMinutes>;
export const Confidence = z.union([z.literal(1), z.literal(2), z.literal(3)]); // C1~C3 (FR-QST-024)
export type Confidence = z.infer<typeof Confidence>;
export const FsrsRating = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]); // Again·Hard·Good·Easy
export type FsrsRating = z.infer<typeof FsrsRating>;
export const Lifecycle = z.enum(['CL-0', 'CL-1', 'CL-2', 'CL-3', 'CL-4', 'CL-5', 'CL-6', 'CL-7', 'CL-8', 'CL-X']);
export type Lifecycle = z.infer<typeof Lifecycle>;
export const MasteryStatus = z.enum(['unseen', 'learning', 'mastered']);
export type MasteryStatus = z.infer<typeof MasteryStatus>;
export const Sp1State = z.enum(['pass', 'fail', 'unknown']);
export type Sp1State = z.infer<typeof Sp1State>;
export const FormatId = z.enum([
  // 단일 형식 어휘(33종, CR-36) — packc 저작·Verdict.format·렌더러 레지스트리·method_policy@v1.formats 키가 모두 이 집합
  // SP-6 형식 카탈로그(결정적·판단 분류는 method_policy@v1)
  'embedded',
  'ox',
  'mcq',
  'cloze',
  'short',
  'matching',
  'code_task',
  'blank_note',
  'digging_d4_mcq',
  'error_find',
  'confusable',
  'fermi',
  'cond_reversal',
  'infra_lite',
  'kata',
  'audit',
  'case_decision',
  // v1 추가 형식(§15 D-10)
  'code_predict',
  'sql_task',
  'essay',
  'digging',
  'feynman',
  'pr_review',
  'reverse_item',
  'artifact',
  'case_postmortem',
  'micro_judgment',
  'ml_predict',
  // DCP-01 §6.5.1 저작 형식 중 w_format·본문이 다른 5종(CR-36, 병합 금지)
  'mcq_multi',
  'order',
  'parsons',
  'log_read',
  'config_review',
]);
export type FormatId = z.infer<typeof FormatId>;
export const Volatility = z.enum(['stable', 'evolving', 'volatile']); // FR-CUR-013 · DCP · DB CHECK와 동일(CR-35)
export type Volatility = z.infer<typeof Volatility>;
export const Tag = z.string().regex(/^(qa|lc|ctx|stack|cert|mode):[a-z0-9_.-]{1,40}$/); // 'cert:cka', 'ctx:si', 'qa:performance'(R4 §3.3, CR-35)
export type Tag = z.infer<typeof Tag>;
export const ProviderKind = z.enum(['jev', 'llm_api', 'llm_cli', 'generic_cli', 'local_llm']); // 원장 ai_mode.observed가 쓰므로 공통(CR-54)
export type ProviderKind = z.infer<typeof ProviderKind>;
export const ProviderStatus = z.enum(['ok', 'degraded', 'down', 'unconsented', 'disabled']);
export type ProviderStatus = z.infer<typeof ProviderStatus>;
export const GraderEngine = z.enum(['D', 'J', 'LJ', 'H', 'S', 'PENDING']);
export type GraderEngine = z.infer<typeof GraderEngine>;
export const JudgeBadge = z.enum([
  // FR-UX-007 (none = 결정적, 배지 없음)
  'none',
  'ai',
  'ai_uncalibrated',
  'ai_confirm',
  'ai_estimate_confirm',
  'heuristic',
  'self',
  'pending',
]);
export type JudgeBadge = z.infer<typeof JudgeBadge>;
export const DataClass = z.enum(['C0', 'C1', 'C2', 'C3']);
export type DataClass = z.infer<typeof DataClass>;
export const Locale = z.literal('ko');
export type Locale = z.infer<typeof Locale>;
export const RuntimeProfile = z.enum(['prod', 'dev', 'test']);
export type RuntimeProfile = z.infer<typeof RuntimeProfile>;
export const ServiceState = z.enum(['starting', 'ready', 'restarting', 'degraded', 'stopped']);
export type ServiceState = z.infer<typeof ServiceState>;
