import { canonicalJson, parseJsonStrict } from '@fathom/shared-kernel/canonical/canonical';
import type { SqlitePort, Stmt } from '@fathom/shared-kernel/sqlite/sqlite';
import type { ProjectionStore } from '../../application/learner-model/ports.js';
import type { CardRow, ConceptRow } from '../../domain/learner-model/projector/types.js';
import {
  CARD_GET_LIVE,
  CARD_GET_SHADOW,
  CARD_PUT_LIVE,
  CARD_PUT_SHADOW,
  CONCEPT_GET_LIVE,
  CONCEPT_GET_SHADOW,
  CONCEPT_PUT_LIVE,
  CONCEPT_PUT_SHADOW,
  type ProjectionTables,
  SHADOW_TABLES,
} from './learner-model-projection.sql.js';
import { CardRowSchema, ConceptRowSchema } from './learner-model-state-schema.js';

// DB-01 §6.7 lr_card_state·lr_concept_state — 투영 저장소(라이브 또는 shadow 테이블). 정본 = state_json(정준 JSON).
// 읽은 행은 즉시 로컬 zod로 파싱한다. 시각은 epoch ms 정수, 불리언은 상태 JSON 안에서만(바인딩 0).

type Statements = { readonly getCard: Stmt; readonly putCard: Stmt; readonly getConcept: Stmt; readonly putConcept: Stmt };

function prepareStatements(db: SqlitePort, tables: ProjectionTables): Statements {
  if (tables === SHADOW_TABLES) {
    return {
      getCard: db.prepare(CARD_GET_SHADOW),
      putCard: db.prepare(CARD_PUT_SHADOW),
      getConcept: db.prepare(CONCEPT_GET_SHADOW),
      putConcept: db.prepare(CONCEPT_PUT_SHADOW),
    };
  }
  return {
    getCard: db.prepare(CARD_GET_LIVE),
    putCard: db.prepare(CARD_PUT_LIVE),
    getConcept: db.prepare(CONCEPT_GET_LIVE),
    putConcept: db.prepare(CONCEPT_PUT_LIVE),
  };
}

function stateJson(row: Record<string, unknown>): unknown {
  const text = row.state_json;
  if (typeof text !== 'string') {
    throw new Error('invariant: projection state_json is not text');
  }
  return parseJsonStrict(text);
}

export function cardRowFromDb(row: Record<string, unknown>): CardRow {
  const { state_json: _omit, ...rest } = row;
  return CardRowSchema.parse({ ...rest, state: stateJson(row) });
}

export function conceptRowFromDb(row: Record<string, unknown>): ConceptRow {
  const { state_json: _omit, ...rest } = row;
  return ConceptRowSchema.parse({ ...rest, state: stateJson(row) });
}

export function createProjectionStore(db: SqlitePort, tables: ProjectionTables): ProjectionStore {
  const st = prepareStatements(db, tables);
  return {
    getCard(cardId: string): CardRow | null {
      const row = st.getCard.get({ card_id: cardId });
      return row === undefined ? null : cardRowFromDb(row);
    },
    putCard(row: CardRow): void {
      st.putCard.run({
        card_id: row.card_id,
        concept_id: row.concept_id,
        facet: row.facet,
        response_mode: row.response_mode,
        tier: row.tier,
        status: row.status,
        last_ts: row.last_ts,
        state_json: canonicalJson(row.state),
      });
    },
    getConcept(conceptId: string): ConceptRow | null {
      const row = st.getConcept.get({ concept_id: conceptId });
      return row === undefined ? null : conceptRowFromDb(row);
    },
    putConcept(row: ConceptRow): void {
      st.putConcept.run({
        concept_id: row.concept_id,
        track_id: row.track_id,
        last_ts: row.last_ts,
        state_json: canonicalJson(row.state),
      });
    },
  };
}
