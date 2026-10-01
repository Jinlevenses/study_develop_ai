// DB-01 §4.2 운영 SQL — 정적 상수(STD-SQL-06). 글자 그대로 옮긴다.

/** APPEND_OUTBOX: 생산자 상태 변경과 같은 tx */
export const APPEND_OUTBOX = `INSERT INTO outbox(event_id, type, schema_version, occurred_at, correlation_id, causation_id, traceparent, payload)
VALUES (:event_id, :type, :schema_version, :occurred_at, :correlation_id, :causation_id, :traceparent, :payload)`;

/** OUTBOX_HEAD: epoch 매니페스트 outbox_head_seq (정리 후에도 정확 — 실측) */
export const OUTBOX_HEAD = `SELECT coalesce((SELECT seq FROM sqlite_sequence WHERE name = 'outbox'), 0) AS head`;
