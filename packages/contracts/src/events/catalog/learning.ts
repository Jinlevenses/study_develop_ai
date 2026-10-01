import { z } from 'zod';
import { AiMode, Facet, FormatId, Level, MasteryStatus, ModeId } from '../../common/domain.js';
import {
  ConceptId,
  DeviceId,
  ItemId,
  ObjKey,
  PolicySetId,
  type ServiceName,
  Sha256Hex,
  TrackId,
  Ulid,
} from '../../common/ids.js';
import { AttemptPhase } from '../../common/practice.js';
import { S } from '../../common/schema.js';
import { DurationMs, EpochMs } from '../../common/time.js';
import { SessionScope, SessionTemplate } from '../../http/learning/v1/sessions.js';

export const LearningEvidenceRecordedV1 = S({
  // IF-EV-08
  ledger_event_id: Ulid,
  verdict_id: Ulid,
  item_id: ItemId,
  concept_id: ConceptId,
  format: FormatId,
  result: z.enum(['correct', 'partial', 'incorrect', 'pending']),
  latency_ms: z.number().int().min(0),
  rapid: z.boolean(),
  confidence: z.number().int().min(1).max(3).nullable(),
  selected_option_key: ObjKey.nullable(),
  ai_mode: AiMode,
  recorded_at: EpochMs,
  phase: AttemptPhase, // 'pretest' 포함 — pretest.answered도 이 이벤트를 발행(CR-29)
  item_beta_after: z.number().nullable(), // learning 리듀서의 w 가중 Elo β 갱신값(w = 0이면 null → content β 불변). FR-PRG-008·FR-CUR-007, CR-29(PG-2 의무화)
});
export type LearningEvidenceRecordedV1 = z.infer<typeof LearningEvidenceRecordedV1>;
export const LearningSessionCompletedV1 = S({
  // IF-EV-09
  session_id: Ulid,
  scope: SessionScope.nullable(),
  template: SessionTemplate,
  blocks_total: z.number().int(),
  blocks_done: z.number().int(),
  modes: z.array(ModeId).max(21),
  duration_ms: DurationMs,
  first_item_latency_ms: z.number().int().min(0).nullable(),
  completed_at: EpochMs,
});
export type LearningSessionCompletedV1 = z.infer<typeof LearningSessionCompletedV1>;
export const LearningDemandForecastedV1 = S({
  // IF-EV-10 (FR-QST-013)
  window_days: z.literal(14),
  demand: z
    .array(S({ concept_id: ConceptId, facet: Facet, format: FormatId, level: Level, n: z.number().int().min(1) }))
    .max(5000),
  computed_at: EpochMs,
});
export type LearningDemandForecastedV1 = z.infer<typeof LearningDemandForecastedV1>;
export const LearningMasteryChangedV1 = S({
  concept_id: ConceptId,
  from: MasteryStatus,
  to: MasteryStatus,
  provisional: z.boolean(),
}); // IF-EV-11
export type LearningMasteryChangedV1 = z.infer<typeof LearningMasteryChangedV1>;
export const LearningLevelPromotedV1 = S({
  // IF-EV-12
  track: TrackId,
  from_level: Level.nullable(),
  to_level: Level,
  provisional: z.boolean(),
  profile: S({ policy_version: PolicySetId, ai_mode: AiMode }),
});
export type LearningLevelPromotedV1 = z.infer<typeof LearningLevelPromotedV1>;
export const LearningLedgerMergedV1 = S({
  // IF-EV-13
  checkpoint_id: Ulid,
  root_hash: Sha256Hex,
  imported_events: z.number().int().min(0),
  devices: z.array(S({ device_id: DeviceId, seq: z.number().int().min(1), head_hash: Sha256Hex })).max(32),
});
export type LearningLedgerMergedV1 = z.infer<typeof LearningLedgerMergedV1>;
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
export const LEARNING_EVENTS = {
  'learning.evidence.recorded': {
    ifId: 'IF-EV-08',
    producer: 'learning',
    freeze: 'D',
    slice: 'R0',
    versions: { 1: LearningEvidenceRecordedV1 },
  },
  'learning.session.completed': {
    ifId: 'IF-EV-09',
    producer: 'learning',
    freeze: 'D',
    slice: 'R0',
    versions: { 1: LearningSessionCompletedV1 },
  },
  'learning.demand.forecasted': {
    ifId: 'IF-EV-10',
    producer: 'learning',
    freeze: 'D',
    slice: 'R1',
    versions: { 1: LearningDemandForecastedV1 },
  },
  'learning.mastery.changed': {
    ifId: 'IF-EV-11',
    producer: 'learning',
    freeze: 'D',
    slice: 'R1',
    versions: { 1: LearningMasteryChangedV1 },
  },
  'learning.level.promoted': {
    ifId: 'IF-EV-12',
    producer: 'learning',
    freeze: 'D',
    slice: 'R1',
    versions: { 1: LearningLevelPromotedV1 },
  },
  'learning.ledger.merged': {
    ifId: 'IF-EV-13',
    producer: 'learning',
    freeze: 'D',
    slice: 'R1',
    versions: { 1: LearningLedgerMergedV1 },
  },
} as const satisfies EventCatalog;
