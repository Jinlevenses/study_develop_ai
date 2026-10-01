// IF-COM-009 타임라인 · epoch 매니페스트 사본 읽기 — 정적 상수. [Brief 결정] 가산분.

/** [Brief 결정] TIMELINE_OUTBOX */
export const TIMELINE_OUTBOX = `SELECT seq, event_id, type, occurred_at, causation_id FROM outbox
WHERE correlation_id = :cid ORDER BY seq LIMIT 500`;

/** [Brief 결정] TIMELINE_DELIVERY: 목적지별 커서 */
export const TIMELINE_DELIVERY = `SELECT dest, last_acked_seq FROM outbox_delivery`;

/** [Brief 결정] TIMELINE_DEAD: 독 이벤트(상관 ID는 envelope 안) */
export const TIMELINE_DEAD = `SELECT event_id, producer, type, error_code, failed_at, resolution FROM inbox_dead
WHERE json_extract(envelope, '$.correlation_id') = :cid ORDER BY failed_at LIMIT 100`;

/** [Brief 결정] SNAPSHOT_DELIVERY: durable 목적지 커서(사본에서 읽음) */
export const SNAPSHOT_DELIVERY = `SELECT dest, last_acked_seq FROM outbox_delivery WHERE mode = 'durable'`;

/** [Brief 결정] SNAPSHOT_WATERMARK: 생산자별 워터마크(사본에서 읽음) */
export const SNAPSHOT_WATERMARK = `SELECT producer, last_producer_seq FROM inbox_watermark`;
