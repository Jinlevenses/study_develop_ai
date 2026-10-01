// DB-01 §15 공통 4행 — `_infra` 보존 정리. [Brief 결정] 배치 상한 500행.

/** [Brief 결정] PURGE_OUTBOX: 모든 durable 목적지가 ack한 행 중 7일 경과분(durable 목적지가 없으면 head까지) */
export const PURGE_OUTBOX = `DELETE FROM outbox WHERE rowid IN (
  SELECT rowid FROM outbox
  WHERE seq <= coalesce((SELECT min(last_acked_seq) FROM outbox_delivery WHERE mode = 'durable'), (SELECT coalesce(max(seq), 0) FROM outbox))
    AND occurred_at < :cutoff_7d
  LIMIT 500)`;

/** [Brief 결정] PURGE_INBOX_DEDUPE: 30일 경과 + 워터마크 이하 */
export const PURGE_INBOX_DEDUPE = `DELETE FROM inbox_dedupe WHERE rowid IN (
  SELECT rowid FROM inbox_dedupe
  WHERE received_at < :cutoff_30d
    AND producer_seq <= coalesce((SELECT last_producer_seq FROM inbox_watermark w WHERE w.producer = inbox_dedupe.producer), 0)
  LIMIT 500)`;

/** [Brief 결정] PURGE_INBOX_DEAD: 처리 완료 후 90일 경과 */
export const PURGE_INBOX_DEAD = `DELETE FROM inbox_dead WHERE rowid IN (
  SELECT rowid FROM inbox_dead
  WHERE resolved_at IS NOT NULL AND resolved_at < :cutoff_90d
  LIMIT 500)`;

/** [Brief 결정] PURGE_IDEM_REQUEST: 7일 경과 */
export const PURGE_IDEM_REQUEST = `DELETE FROM idem_request WHERE rowid IN (
  SELECT rowid FROM idem_request
  WHERE created_at < :cutoff_7d
  LIMIT 500)`;
