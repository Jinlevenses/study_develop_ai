import type { CurriculumExportQuery } from '@fathom/contracts/http/content/v1/catalog';
import { CurriculumExportLine } from '@fathom/contracts/http/content/v1/catalog';
import { canonicalJson, sha256Hex } from '@fathom/shared-kernel/canonical/canonical';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import type { Clock } from '@fathom/shared-kernel/time/time';
import { SELECT_ACTIVE_PACKS } from '../../infra/db/ct-catalog-read.sql.js';
import { conceptRefsOfActive } from './concept-ref.js';
import { intOrNull, str } from './row-read.js';

// PGM-CT-004 CurriculumExport(IF-CT-007 NDJSON) — Brief T-01-07 §4.8.
// 활성 데이터는 시작 시 `.all()`로 한 번에 읽어 둔다(제너레이터가 멈춰 있는 동안의 쓰기와 섞이지 않게).
// IT-01 팩에는 Case·경로가 없고 `AssessmentInventory`는 packc report에 아직 없어 case·inventory·path 줄은 0개다(CR 후보: report.inventory).

function line(value: unknown): string {
  return `${canonicalJson(CurriculumExportLine.parse(value))}\n`;
}

/**
 * 줄 = `canonicalJson(line) + '\n'`. end = `{ kind:'end', count, sha256 }` — count = header를 포함한 end 앞 줄 수,
 * sha256 = 그 줄들의 바이트(각 `\n` 포함) 전체의 sha256(IF-01 §2.15 해석, T-01-08·T-01-11 소비 규칙과 같다).
 */
export function* exportCurriculum(db: SqlitePort, query: CurriculumExportQuery, clock: Clock): Generator<string> {
  const packRows = db.prepare(SELECT_ACTIVE_PACKS).all();
  const concepts = conceptRefsOfActive(db);
  const packs = packRows.map((r) => ({
    pack_id: str(r, 'pack_id'),
    track: str(r, 'track_id'),
    version: str(r, 'version'),
    manifest_hash: str(r, 'manifest_hash'),
  }));
  const version = packRows.reduce((max, r) => Math.max(max, intOrNull(r, 'catalog_version') ?? 0), 0);
  const full = query.since === undefined || query.since > version;
  const emitted: string[] = [];
  const emit = (value: unknown): string => {
    const text = line(value);
    emitted.push(text);
    return text;
  };
  yield emit({
    kind: 'header',
    v: 1,
    version,
    full,
    pack_set_hash: sha256Hex(canonicalJson(packs)),
    packs,
    generated_at: clock.now(),
  });
  for (const concept of concepts) {
    if (full || concept.version > (query.since ?? 0)) {
      yield emit({ kind: 'concept', concept });
    }
  }
  yield line({ kind: 'end', count: emitted.length, sha256: sha256Hex(emitted.join('')) });
}
