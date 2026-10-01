// DB-01 §4.2 운영 SQL(relay·rewind) — 정적 상수. [Brief 결정] 표시 상수는 DB-01에 없는 가산분이다.

/** ENSURE_DELIVERY: relay 시작 시 routing.gen.ts의 목적지마다 */
export const ENSURE_DELIVERY = `INSERT INTO outbox_delivery(dest, mode, updated_at) VALUES (:dest, :mode, :now)
ON CONFLICT(dest) DO UPDATE SET mode = excluded.mode, updated_at = excluded.updated_at`;

/** [Brief 결정] DELIVERY_GET: 목적지 커서·백오프 상태 읽기 */
export const DELIVERY_GET = `SELECT last_acked_seq, attempts, next_attempt_at FROM outbox_delivery WHERE dest = :dest`;

/** RELAY_BATCH: 목적지별 in-flight 1, 배치 ≤ 100 (type 목록은 생성된 상수 :types_json) */
export const RELAY_BATCH = `SELECT seq, event_id, type, schema_version, occurred_at, correlation_id, causation_id, traceparent, payload
FROM outbox
WHERE seq > :last_acked_seq AND type IN (SELECT value FROM json_each(:types_json))
ORDER BY seq LIMIT 100`;

/** RELAY_ACK: 200 {acked_through_seq} */
export const RELAY_ACK = `UPDATE outbox_delivery SET last_acked_seq = max(last_acked_seq, :acked_through_seq), attempts = 0,
  next_attempt_at = 0, last_error_code = NULL, updated_at = :now WHERE dest = :dest`;

/** RELAY_FAIL: 0.5s → 30s 지수 백오프 */
export const RELAY_FAIL = `UPDATE outbox_delivery SET attempts = attempts + 1, next_attempt_at = :next_attempt_at,
  last_error_code = :code, updated_at = :now WHERE dest = :dest`;

/** [Brief 결정] RELAY_PARTIAL: 부분 ack — 커서는 max()로만 전진, 진전이 있으면 시도 횟수를 1로 되돌린다(dead-letter가 영원히 오지 않는 것을 막는다) */
export const RELAY_PARTIAL = `UPDATE outbox_delivery SET last_acked_seq = max(last_acked_seq, :acked_through_seq),
  attempts = CASE WHEN :acked_through_seq > last_acked_seq THEN 1 ELSE attempts + 1 END,
  next_attempt_at = :next_attempt_at, last_error_code = :code, updated_at = :now WHERE dest = :dest`;

/** [Brief 결정] RELAY_SKIP_TO_HEAD: 구독하지 않는 타입만 남은 꼬리 구간을 전진시킨다 */
export const RELAY_SKIP_TO_HEAD = `UPDATE outbox_delivery SET last_acked_seq = max(last_acked_seq, (SELECT coalesce(max(seq), 0) FROM outbox)),
  updated_at = :now WHERE dest = :dest`;

/** [Brief 결정] OUTBOX_PENDING: 목적지별 미전달 행 수·가장 오래된 발생 시각 */
export const OUTBOX_PENDING = `SELECT count(*) AS n, min(occurred_at) AS oldest FROM outbox
WHERE seq > :last_acked_seq AND type IN (SELECT value FROM json_each(:types_json))`;

/** REWIND_DELIVERY: 복원 시 커서 되감기 (restore 모드 전용) */
export const REWIND_DELIVERY = `UPDATE outbox_delivery SET last_acked_seq = :rewind_seq, attempts = 0, next_attempt_at = 0,
  last_error_code = NULL, updated_at = :now WHERE dest = :dest AND mode = 'durable'`;
