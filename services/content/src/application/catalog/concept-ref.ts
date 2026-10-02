import { ConceptRef } from '@fathom/contracts/events/catalog/catalog';
import { parseJsonStrict } from '@fathom/shared-kernel/canonical/canonical';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import {
  SELECT_ACTIVE_CONCEPT_REF_ROWS,
  SELECT_ACTIVE_PREREQ_EDGES,
  SELECT_CONCEPT_REF_ROWS,
  SELECT_PREREQ_EDGES,
} from '../../infra/db/ct-catalog-read.sql.js';
import type { Row } from './row-read.js';
import { int, intOrNull, str, strOrNull } from './row-read.js';

// PGM-CT-001·004 ConceptRef(IF-EV-02 = learning lr_curriculum_ref 한 행) 생성 — 활성화(설치 직접)와 export(활성 뷰)가 공용으로 쓴다.

function jsonArray(row: Row, key: string): unknown[] {
  const parsed = parseJsonStrict(str(row, key));
  if (!Array.isArray(parsed)) {
    throw new Error(`invariant: column ${key} is not a JSON array`);
  }
  return parsed;
}

function prereqIndex(edges: readonly Row[]): Map<string, string[]> {
  const byTo = new Map<string, string[]>();
  for (const e of edges) {
    const to = str(e, 'to_concept_id');
    const list = byTo.get(to) ?? [];
    list.push(str(e, 'from_concept_id'));
    byTo.set(to, list);
  }
  for (const list of byTo.values()) {
    list.sort((a, b) => (a === b ? 0 : a < b ? -1 : 1));
  }
  return byTo;
}

/** 행 → `ConceptRef`(parse 통과). `prereq_ids` = (kind = 'prereq' ∧ to = 이 개념)의 from 정렬. `version` = ext."catalog.version"(없으면 0). */
export function buildConceptRefs(rows: readonly Row[], edges: readonly Row[]): ConceptRef[] {
  const prereqs = prereqIndex(edges);
  return rows.map((row) =>
    ConceptRef.parse({
      concept_id: str(row, 'concept_id'),
      track: str(row, 'track_id'),
      level: int(row, 'level'),
      tier: str(row, 'tier'),
      knowledge_type: str(row, 'knowledge_type'),
      title_ko: str(row, 'title_ko'),
      title_en: str(row, 'title_en'),
      summary_ko: str(row, 'summary_ko'),
      prereq_ids: prereqs.get(str(row, 'concept_id')) ?? [],
      required_for_level: intOrNull(row, 'required_for_level'),
      aliases: jsonArray(row, 'aliases_json'),
      deprecated_by: strOrNull(row, 'deprecated_by'),
      volatility: str(row, 'volatility'),
      tags: jsonArray(row, 'tags_json'),
      version: intOrNull(row, 'version') ?? 0,
      content_hash: str(row, 'content_hash'),
    }),
  );
}

/** 한 설치(활성 전 포함)의 ConceptRef 전부(concept_id 순). */
export function conceptRefsOfInstall(db: SqlitePort, installId: string): ConceptRef[] {
  return buildConceptRefs(
    db.prepare(SELECT_CONCEPT_REF_ROWS).all({ install_id: installId }),
    db.prepare(SELECT_PREREQ_EDGES).all({ install_id: installId }),
  );
}

/** 활성 설치 전부의 ConceptRef(concept_id 순) — 활성 뷰만 읽는다. */
export function conceptRefsOfActive(db: SqlitePort): ConceptRef[] {
  return buildConceptRefs(db.prepare(SELECT_ACTIVE_CONCEPT_REF_ROWS).all(), db.prepare(SELECT_ACTIVE_PREREQ_EDGES).all());
}
