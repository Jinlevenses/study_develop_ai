import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import {
  SELECT_ACTIVE_CONCEPT_INSTALL,
  SELECT_ACTIVE_INSTALLS,
  SELECT_ACTIVE_KU_IDS,
  SELECT_ACTIVE_MC_IDS,
} from '../../infra/db/ct-catalog-read.sql.js';
import type { ActiveInstall, CatalogReader, ConceptForItems } from './ports.js';
import { str, strOrNull } from './row-read.js';

// PGM-CT-003 기존 읽기 포트 `CatalogReader`의 어댑터 — itembank가 `import type`으로 쓰는 시그니처는 그대로다. 활성 뷰만 읽는다.

export function createCatalogReader(db: SqlitePort): CatalogReader {
  return {
    activeInstalls(): readonly ActiveInstall[] {
      return db
        .prepare(SELECT_ACTIVE_INSTALLS)
        .all()
        .map((row) => ({
          packId: str(row, 'pack_id'),
          installId: str(row, 'install_id'),
          version: str(row, 'version'),
          trackId: strOrNull(row, 'track_id'),
        }));
    },
    conceptForItems(conceptId: string): ConceptForItems | null {
      const concept = db.prepare(SELECT_ACTIVE_CONCEPT_INSTALL).get({ concept_id: conceptId });
      if (concept === undefined) {
        return null;
      }
      const installId = str(concept, 'install_id');
      const bind = { install_id: installId, concept_id: conceptId };
      return {
        conceptId,
        installId,
        kuIds: db
          .prepare(SELECT_ACTIVE_KU_IDS)
          .all(bind)
          .map((r) => str(r, 'ku_id')),
        misconceptionIds: db
          .prepare(SELECT_ACTIVE_MC_IDS)
          .all(bind)
          .map((r) => str(r, 'mc_id')),
      };
    },
  };
}
