// DB-01 §4.2 운영 SQL(inbox) — 정적 상수. INBOX_DEAD_INSERT는 [Brief 결정] 가산분이다.

/** INBOX_SEEN: 이벤트마다 개별 BEGIN IMMEDIATE tx (핸들러 쓰기와 함께) — 있으면 핸들러 생략·ack */
export const INBOX_SEEN = `SELECT 1 FROM inbox_dedupe WHERE event_id = :event_id`;

/** INBOX_RECORD */
export const INBOX_RECORD = `INSERT INTO inbox_dedupe(event_id, producer, producer_seq, type, received_at) VALUES (:event_id, :producer, :producer_seq, :type, :now)`;

/** INBOX_WATERMARK */
export const INBOX_WATERMARK = `INSERT INTO inbox_watermark(producer, last_producer_seq, updated_at) VALUES (:producer, :producer_seq, :now)
ON CONFLICT(producer) DO UPDATE SET last_producer_seq = max(last_producer_seq, excluded.last_producer_seq), updated_at = excluded.updated_at`;

/** [Brief 결정] INBOX_DEAD_INSERT: 비원장 경로(dead_letter) 독 이벤트 격리 */
export const INBOX_DEAD_INSERT = `INSERT INTO inbox_dead(event_id, producer, producer_seq, type, envelope, error_code, error_detail, attempts, failed_at)
VALUES (:event_id, :producer, :producer_seq, :type, :envelope, :error_code, :error_detail, :attempts, :failed_at)`;
