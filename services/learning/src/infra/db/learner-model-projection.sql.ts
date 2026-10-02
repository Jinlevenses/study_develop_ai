import { ident } from '@fathom/shared-kernel/sqlite/fragments';

// STD-SQL-06 — 투영 테이블 SQL. 테이블 이름은 ident()만, 값은 :name 바인딩. 생성 열(due_at·lapses·n_graded·mastered)은 읽지도 쓰지도 않는다.
// UPSERT는 P(투영) 테이블 한정(STD-SQL-11) — 원장 테이블에는 쓰지 않는다.

export const LIVE_TABLES = { card: 'lr_card_state', concept: 'lr_concept_state' } as const;
export const SHADOW_TABLES = { card: 'lr_card_state__shadow', concept: 'lr_concept_state__shadow' } as const;
export type ProjectionTables = typeof LIVE_TABLES | typeof SHADOW_TABLES;

// ───────── 라이브 ─────────

export const CARD_GET_LIVE = `SELECT card_id, concept_id, facet, response_mode, tier, status, last_ts, state_json FROM ${ident(LIVE_TABLES.card)} WHERE card_id = :card_id`;
export const CARD_PUT_LIVE = `INSERT INTO ${ident(LIVE_TABLES.card)}(card_id, concept_id, facet, response_mode, tier, status, last_ts, state_json) VALUES (:card_id, :concept_id, :facet, :response_mode, :tier, :status, :last_ts, :state_json) ON CONFLICT(card_id) DO UPDATE SET concept_id = excluded.concept_id, facet = excluded.facet, response_mode = excluded.response_mode, tier = excluded.tier, status = excluded.status, last_ts = excluded.last_ts, state_json = excluded.state_json`;
export const CONCEPT_GET_LIVE = `SELECT concept_id, track_id, last_ts, state_json FROM ${ident(LIVE_TABLES.concept)} WHERE concept_id = :concept_id`;
export const CONCEPT_PUT_LIVE = `INSERT INTO ${ident(LIVE_TABLES.concept)}(concept_id, track_id, last_ts, state_json) VALUES (:concept_id, :track_id, :last_ts, :state_json) ON CONFLICT(concept_id) DO UPDATE SET track_id = excluded.track_id, last_ts = excluded.last_ts, state_json = excluded.state_json`;

// ───────── shadow(rebuild·merge가 전체 리플레이 결과를 쓰는 곳) ─────────

export const CARD_GET_SHADOW = `SELECT card_id, concept_id, facet, response_mode, tier, status, last_ts, state_json FROM ${ident(SHADOW_TABLES.card)} WHERE card_id = :card_id`;
export const CARD_PUT_SHADOW = `INSERT INTO ${ident(SHADOW_TABLES.card)}(card_id, concept_id, facet, response_mode, tier, status, last_ts, state_json) VALUES (:card_id, :concept_id, :facet, :response_mode, :tier, :status, :last_ts, :state_json) ON CONFLICT(card_id) DO UPDATE SET concept_id = excluded.concept_id, facet = excluded.facet, response_mode = excluded.response_mode, tier = excluded.tier, status = excluded.status, last_ts = excluded.last_ts, state_json = excluded.state_json`;
export const CONCEPT_GET_SHADOW = `SELECT concept_id, track_id, last_ts, state_json FROM ${ident(SHADOW_TABLES.concept)} WHERE concept_id = :concept_id`;
export const CONCEPT_PUT_SHADOW = `INSERT INTO ${ident(SHADOW_TABLES.concept)}(concept_id, track_id, last_ts, state_json) VALUES (:concept_id, :track_id, :last_ts, :state_json) ON CONFLICT(concept_id) DO UPDATE SET track_id = excluded.track_id, last_ts = excluded.last_ts, state_json = excluded.state_json`;

// ───────── 원장 읽기(읽기 전용 — check:ledger-writer는 쓰기만 제한한다) ─────────

/** 정정 대상 event_id → 그 이벤트의 card_id·concept_id(lr_event STORED 열). :ids = JSON 배열 문자열. */
export const EVENT_TARGET_KEYS =
  'SELECT DISTINCT card_id, concept_id FROM lr_event WHERE event_id IN (SELECT value FROM json_each(:ids))';
/** 정책 세트 해석(resolver 캐시 미스 때만). */
export const POLICY_SWITCHED_BY_PS =
  "SELECT payload FROM lr_event WHERE type = 'policy.switched' AND json_extract(payload, '$.policy_version') = :ps";

// ───────── shadow 교체용 카운트 ─────────

export const CARD_COUNT_LIVE = `SELECT count(*) AS n FROM ${ident(LIVE_TABLES.card)}`;
export const CONCEPT_COUNT_LIVE = `SELECT count(*) AS n FROM ${ident(LIVE_TABLES.concept)}`;
