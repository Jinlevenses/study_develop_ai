import { z } from 'zod';
import { ServiceState } from '../../common/domain.js';
import { ProviderId, ServiceName, Ulid } from '../../common/ids.js';
import { S } from '../../common/schema.js';
import { DurationMs, EpochMs } from '../../common/time.js';
import { Banner } from '../../http/ops/v1/health.js';

export const OpsHealthChangedV1 = S({
  // IF-EV-21
  services: z
    .array(
      S({ svc: z.union([ServiceName, z.literal('supervisor')]), state: ServiceState, restarts_60s: z.number().int() }),
    )
    .max(8),
  degraded: z.array(z.string().max(60)).max(20),
  outbox_lag: z.array(S({ svc: ServiceName, dest: ServiceName, oldest_age_ms: DurationMs })).max(20),
  banners: z.array(Banner).max(20),
});
export type OpsHealthChangedV1 = z.infer<typeof OpsHealthChangedV1>;
export const OpsBackupCompletedV1 = S({
  // IF-EV-22
  epoch_id: Ulid,
  kind: z.enum(['snapshot', 'incremental', 'rehearsal']),
  outcome: z.enum(['ok', 'aborted', 'failed']),
  reason: z.string().max(200).nullable(),
  rpo_hours: z.number().min(0).nullable(),
});
export type OpsBackupCompletedV1 = z.infer<typeof OpsBackupCompletedV1>;
export const OpsHostStateChangedV1 = S({
  // IF-EV-23
  idle_window_open: z.boolean(),
  idle_since: EpochMs.nullable(),
  power: z.enum(['ac', 'battery', 'unknown']),
  interactive_cli: z.array(ProviderId).max(8), // 사용자가 대화형으로 쓰는 중인 CLI(FR-AI-025)
  sampled_at: EpochMs,
});
export type OpsHostStateChangedV1 = z.infer<typeof OpsHostStateChangedV1>;
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
export const OPS_EVENTS = {
  'ops.health.changed': {
    ifId: 'IF-EV-21',
    producer: 'ops-api',
    freeze: 'D',
    slice: 'R0',
    versions: { 1: OpsHealthChangedV1 },
  },
  'ops.backup.completed': {
    ifId: 'IF-EV-22',
    producer: 'ops-api',
    freeze: 'D',
    slice: 'R1',
    versions: { 1: OpsBackupCompletedV1 },
  },
  'ops.host_state.changed': {
    ifId: 'IF-EV-23',
    producer: 'ops-api',
    freeze: 'D',
    slice: 'R1',
    versions: { 1: OpsHostStateChangedV1 },
  },
} as const satisfies EventCatalog;
