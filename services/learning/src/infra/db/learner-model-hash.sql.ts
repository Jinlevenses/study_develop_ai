// STD-SQL-06 — 정준 투영 해시용 SELECT(DB-01 §6.4). 생성 열(due_at·lapses·n_graded·mastered·state·level)은 뺀 열만, PK BINARY 오름차순.
// 정적 리터럴만 — 테이블 이름 조각 0.

export const HASH_SELECT_CARD =
  'SELECT card_id, concept_id, facet, response_mode, tier, status, last_ts, state_json FROM lr_card_state ORDER BY card_id';
export const HASH_SELECT_CONCEPT =
  'SELECT concept_id, track_id, last_ts, state_json FROM lr_concept_state ORDER BY concept_id';
export const HASH_SELECT_LIFECYCLE = 'SELECT concept_id, last_ts, state_json FROM lr_lifecycle ORDER BY concept_id';
export const HASH_SELECT_MC = 'SELECT mc_id, concept_id, last_ts, state_json FROM lr_mc_state ORDER BY mc_id';
export const HASH_SELECT_TRACK_LEVEL = 'SELECT track_id, last_ts, state_json FROM lr_track_level ORDER BY track_id';
export const HASH_SELECT_SETTING = 'SELECT key, value_json, last_ts, source_event_id FROM lr_setting ORDER BY key';

// ───────── 투영 메타(lr_projection_meta, name = 'live') ─────────

export const META_LIVE_PRESENT = "SELECT 1 AS present FROM lr_projection_meta WHERE name = 'live'";
export const META_UPSERT =
  "INSERT INTO lr_projection_meta(name, projection_hash, fsrs_impl, policy_version, event_count, last_order_json, computed_at) VALUES ('live', :projection_hash, :fsrs_impl, :policy_version, :event_count, :last_order_json, :computed_at) ON CONFLICT(name) DO UPDATE SET projection_hash = excluded.projection_hash, fsrs_impl = excluded.fsrs_impl, policy_version = excluded.policy_version, event_count = excluded.event_count, last_order_json = excluded.last_order_json, computed_at = excluded.computed_at";

// 원장 읽기(읽기 전용 — check:ledger-writer는 쓰기만 제한한다).
export const LEDGER_COUNT = 'SELECT count(*) AS n FROM lr_event';
export const LEDGER_LAST_ORDER =
  'SELECT client_ts, device_id, device_seq FROM lr_event ORDER BY client_ts DESC, device_id DESC, device_seq DESC LIMIT 1';
export const LEDGER_LAST_POLICY_SWITCHED =
  "SELECT json_extract(payload, '$.policy_version') AS ps FROM lr_event WHERE type = 'policy.switched' ORDER BY client_ts DESC, device_id DESC, device_seq DESC LIMIT 1";
