import { z } from 'zod';
import { DeviceId, Sha256Hex, Ulid } from '../common/ids.js';
import { S } from '../common/schema.js';
import { EpochMs } from '../common/time.js';

export const LedgerEventType = z.enum([
  'attempt.graded',
  'evidence.upgraded',
  'evidence.regraded',
  'evidence.voided',
  'evidence.weight_adjusted',
  'pretest.answered',
  'lesson.completed',
  'self_assessment.recorded',
  'card.enrolled',
  'card.status_changed',
  'profile.setting_changed',
  'policy.switched',
  'ai_mode.observed',
  'declaration.sealed',
  'promotion.exam_completed',
  'level.promoted',
  'level.provisional_resolved',
]);
export type LedgerEventType = z.infer<typeof LedgerEventType>;
export const LedgerEventEnvelope = S({
  event_id: Ulid,
  device_id: DeviceId, // ASCII ULID(CHECK) — SQLite BINARY 정렬 = JS '<' 정렬
  device_seq: z.number().int().min(1),
  client_ts: EpochMs, // 기기별 단조: max(now, last_client_ts + 1)
  type: LedgerEventType,
  schema_version: z.number().int().min(1),
  idempotency_key: z.string().min(3).max(200), // §10.1 표
  payload: z.record(z.string(), z.unknown()), // 2차 검증 = LEDGER_PAYLOADS[type][schema_version] (upcast 후)
  prev_hash: z.string().regex(/^[0-9a-f]{64}$/), // 같은 device 직전 hash, 첫 이벤트 = '0' × 64
  hash: Sha256Hex, // sha256(canonicalJson({event_id, device_id, device_seq, client_ts, type, schema_version, idempotency_key, payload, prev_hash}))
  experiment_arm: z.string().max(40).nullable(), // DR-020 이름 훅
  recorded_at: EpochMs, // 수신 시각(정보용, 리플레이 미사용)
});
export type LedgerEventEnvelope = z.infer<typeof LedgerEventEnvelope>;
// 리플레이 순서 = ORDER BY client_ts, device_id, device_seq (rowid·도착 순서·ULID 순서 금지)
// versions.ts: CURRENT_SCHEMA_VERSION (17개 전부 1)
