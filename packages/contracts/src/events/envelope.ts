import { z } from 'zod';
import { ServiceName, Ulid } from '../common/ids.js';
import { S } from '../common/schema.js';
import { EpochMs } from '../common/time.js';

export const EventType = z.string().regex(/^[a-z]+\.[a-z_]+\.[a-z_]+$/); // <BC context>.<entity>.<past_tense>
export type EventType = z.infer<typeof EventType>;
export const IntegrationEventEnvelope = S({
  event_id: Ulid, // 전역 유일, 소비자 dedupe 키
  type: EventType,
  schema_version: z.number().int().min(1), // 타입별
  producer: ServiceName, // 배포 단위
  producer_seq: z.number().int().min(1), // = outbox.seq (생산자 내 총순서)
  occurred_at: EpochMs,
  correlation_id: Ulid, // 사용자 의도 단위(attempt_id·job_id·epoch_id·session_id …)
  causation_id: Ulid.nullable(), // 이 이벤트를 낳은 명령의 Idempotency-Key 또는 상위 event_id
  traceparent: z
    .string()
    .regex(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/)
    .nullable(),
  payload: z.record(z.string(), z.unknown()), // 2차 검증 = EVENT_PAYLOADS[type][schema_version]
});
export type IntegrationEventEnvelope = z.infer<typeof IntegrationEventEnvelope>;
// registry.gen.ts(생성물): export const EVENT_PAYLOADS = { 'grading.verdict.issued': { 1: Verdict }, ... } as const;
// routing.gen.ts(생성물): export const ROUTING = { content: { learning: { mode: 'durable', types: [...] }, gateway: { mode: 'notify', types: [...] } }, ... } as const;
