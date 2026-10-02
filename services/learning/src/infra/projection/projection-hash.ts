import { createHash } from 'node:crypto';
import { canonicalJson, parseJsonStrict } from '@fathom/shared-kernel/canonical/canonical';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import type { CardRow, ConceptRow, ProjectionSlice } from '../../domain/learner-model/projector/types.js';
import {
  HASH_SELECT_CARD,
  HASH_SELECT_CONCEPT,
  HASH_SELECT_LIFECYCLE,
  HASH_SELECT_MC,
  HASH_SELECT_SETTING,
  HASH_SELECT_TRACK_LEVEL,
} from '../db/learner-model-hash.sql.js';

// DB-01 §6.4 정준 투영 해시 — Brief T-01-06 §4.6의 바이트 정의:
//   테이블 순서 고정, 테이블마다 "<table>\n" + 행마다 canonicalJson(행) + "\n"(UTF-8) → sha256.
//   행 = 생성 열을 뺀 열의 {열: 값}, 단 state_json·value_json은 파싱한 값(키 이름 유지). PK BINARY 오름차순. 빈 테이블은 "<table>\n"만.

export const PROJECTION_HASH_TABLES = [
  'lr_card_state',
  'lr_concept_state',
  'lr_lifecycle',
  'lr_mc_state',
  'lr_track_level',
  'lr_setting',
] as const;
export type ProjectionHashTable = (typeof PROJECTION_HASH_TABLES)[number];

type HashRow = Readonly<Record<string, unknown>>;

function parsedJsonColumn(row: Record<string, unknown>, column: string): unknown {
  const text = row[column];
  if (typeof text !== 'string') {
    throw new Error(`invariant: projection ${column} is not text`);
  }
  return parseJsonStrict(text);
}

function selectAll(db: SqlitePort, table: ProjectionHashTable): IterableIterator<Record<string, unknown>> {
  switch (table) {
    case 'lr_card_state':
      return db.prepare(HASH_SELECT_CARD).iterate();
    case 'lr_concept_state':
      return db.prepare(HASH_SELECT_CONCEPT).iterate();
    case 'lr_lifecycle':
      return db.prepare(HASH_SELECT_LIFECYCLE).iterate();
    case 'lr_mc_state':
      return db.prepare(HASH_SELECT_MC).iterate();
    case 'lr_track_level':
      return db.prepare(HASH_SELECT_TRACK_LEVEL).iterate();
    case 'lr_setting':
      return db.prepare(HASH_SELECT_SETTING).iterate();
  }
}

function* dbRows(db: SqlitePort, table: ProjectionHashTable): IterableIterator<HashRow> {
  for (const row of selectAll(db, table)) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      out[key] = key === 'state_json' || key === 'value_json' ? parsedJsonColumn(row, key) : value;
    }
    yield out;
  }
}

function cardHashRow(row: CardRow): HashRow {
  return {
    card_id: row.card_id,
    concept_id: row.concept_id,
    facet: row.facet,
    response_mode: row.response_mode,
    tier: row.tier,
    status: row.status,
    last_ts: row.last_ts,
    state_json: row.state,
  };
}

function conceptHashRow(row: ConceptRow): HashRow {
  return { concept_id: row.concept_id, track_id: row.track_id, last_ts: row.last_ts, state_json: row.state };
}

/** PK(ASCII id) BINARY 오름차순 = JS 코드 단위 비교. */
function sortedByKey<T>(rows: Readonly<Record<string, T>>): T[] {
  return Object.keys(rows)
    .sort()
    .map((k) => rows[k] as T);
}

function hashTables(rowsOf: (table: ProjectionHashTable) => Iterable<HashRow>): string {
  const h = createHash('sha256');
  for (const table of PROJECTION_HASH_TABLES) {
    h.update(`${table}\n`, 'utf8');
    for (const row of rowsOf(table)) {
      h.update(`${canonicalJson(row)}\n`, 'utf8');
    }
  }
  return h.digest('hex');
}

/** 라이브(또는 임의 연결)의 투영 표 6종에서 계산한다. */
export function projectionHashFromDb(db: SqlitePort): string {
  return hashTables((table) => dbRows(db, table));
}

/** card·concept = slice, 나머지 4표 = fallbackDb의 현재 행(IT-01 투영 대상은 2표뿐). 같은 투영이면 projectionHashFromDb와 같은 해시. */
export function projectionHashFromSlice(slice: ProjectionSlice, fallbackDb: SqlitePort): string {
  return hashTables((table) => {
    if (table === 'lr_card_state') {
      return sortedByKey(slice.cards).map(cardHashRow);
    }
    if (table === 'lr_concept_state') {
      return sortedByKey(slice.concepts).map(conceptHashRow);
    }
    return dbRows(fallbackDb, table);
  });
}
