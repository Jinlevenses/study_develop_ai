import type { CatalogConceptChangedV1 } from '@fathom/contracts/events/catalog/catalog';
import type { Outbox } from '@fathom/shared-kernel/eventing/eventing';
import { appendEvent } from '@fathom/shared-kernel/eventing/eventing';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import type { Clock } from '@fathom/shared-kernel/time/time';
import { conceptCatalogVersion, nextCatalogVersion } from '../../../domain/catalog/catalog-version.js';
import type { ConceptDigest } from '../../../domain/catalog/install/diff.js';
import { diffConcepts, diffKus } from '../../../domain/catalog/install/diff.js';
import {
  SELECT_ACTIVE_POINTER,
  SELECT_CONCEPT_DIGESTS,
  SELECT_KU_HASHES,
  SELECT_MAX_CATALOG_VERSION,
  SELECT_PACK_ROW,
} from '../../../infra/db/ct-catalog-read.sql.js';
import { conceptRefsOfInstall } from '../concept-ref.js';
import type { IngestRegistry } from '../ports.js';
import { int, intOrNull, str, strOrNull } from '../row-read.js';
import { ACTIVATE_PACK, RETIRE_PACK, SET_CONCEPT_VERSION, UPSERT_PACK_ACTIVE } from './catalog-ingest.sql.js';

// PGM-CT-001·004 활성화 1 tx — Brief T-01-07 §4.6. 포인터 전환·이전 설치 은퇴·핸들러 activate·outbox가 같은 `BEGIN IMMEDIATE`.
// 이 tx 안에서는 await 0(STD-ASY-02). 예외 = 전부 롤백(포인터·상태·outbox 불변).

const MAX_CHANGED_CONCEPTS = 2_000;
const MAX_CHANGED_KUS = 20_000;

export type ActivateDeps = { readonly outbox: Outbox; readonly clock: Clock; readonly ingest: IngestRegistry };
export type ActivateResult = {
  readonly pack_id: string;
  readonly version: string;
  readonly previous_version: string | null;
  readonly catalog_version: number;
  readonly changed_concept_ids: readonly string[];
  readonly changed_ku_ids: readonly string[];
};

type DigestRow = ConceptDigest & { readonly version: number | null };

function readDigests(db: SqlitePort, installId: string): DigestRow[] {
  return db
    .prepare(SELECT_CONCEPT_DIGESTS)
    .all({ install_id: installId })
    .map((r) => {
      const tier = str(r, 'tier');
      if (tier !== 'A' && tier !== 'B' && tier !== 'C') {
        throw new Error('invariant: concept tier out of range');
      }
      return {
        concept_id: str(r, 'concept_id'),
        content_hash: str(r, 'content_hash'),
        tier,
        deprecated_by: strOrNull(r, 'deprecated_by'),
        version: intOrNull(r, 'version'),
      };
    });
}

function readKuHashes(db: SqlitePort, installId: string): Map<string, string> {
  return new Map(
    db
      .prepare(SELECT_KU_HASHES)
      .all({ install_id: installId })
      .map((r): [string, string] => [str(r, 'ku_id'), str(r, 'content_hash')]),
  );
}

/**
 * `installId`(state ready, 또는 reactivate면 retired)를 활성화한다. `requestId` = outbox correlation_id.
 * 순서: catalog 버전 부여 → 개념·KU 차분 → 개념 ext 버전 갱신 → 이전 설치 은퇴·새 설치 active·포인터 UPSERT·핸들러 activate →
 * outbox(변경 개념마다 `catalog.concept.changed`(concept_id 오름차순) → 마지막에 `catalog.pack.activated`).
 */
export function activateInstall(deps: ActivateDeps, installId: string, requestId: string): ActivateResult {
  const db = deps.outbox.db;
  return db.tx(() => {
    const now = deps.clock.now();
    const row = db.prepare(SELECT_PACK_ROW).get({ install_id: installId });
    if (row === undefined) {
      throw new Error('install_not_found');
    }
    const state = str(row, 'state');
    if (state !== 'ready' && state !== 'retired') {
      throw new Error('install_state_invalid');
    }
    const packId = str(row, 'pack_id');
    const version = str(row, 'version');
    const track = str(row, 'track_id');
    const prevPointer = db.prepare(SELECT_ACTIVE_POINTER).get({ pack_id: packId });
    const prevInstallId = prevPointer === undefined ? null : str(prevPointer, 'install_id');
    const prevRow = prevInstallId === null ? undefined : db.prepare(SELECT_PACK_ROW).get({ install_id: prevInstallId });
    const previousVersion = prevRow === undefined ? null : str(prevRow, 'version');

    const maxRow = db.prepare(SELECT_MAX_CATALOG_VERSION).get();
    const catalogVersion = nextCatalogVersion(maxRow === undefined ? null : intOrNull(maxRow, 'v'));

    const nextDigests = readDigests(db, installId);
    const prevDigests = prevInstallId === null ? null : readDigests(db, prevInstallId);
    const changes = diffConcepts(prevDigests, nextDigests);
    const changeById = new Map(changes.map((c) => [c.concept_id, c.change] as const));
    const changedKus = diffKus(
      prevInstallId === null ? null : readKuHashes(db, prevInstallId),
      readKuHashes(db, installId),
    );
    if (changes.length > MAX_CHANGED_CONCEPTS || changedKus.length > MAX_CHANGED_KUS) {
      throw new Error('invariant: changed set exceeds the IT-01 pack scale bound');
    }

    const carried = new Map((prevDigests ?? []).map((d) => [d.concept_id, d.version] as const));
    const setVersion = db.prepare(SET_CONCEPT_VERSION);
    for (const d of nextDigests) {
      setVersion.run({
        install_id: installId,
        concept_id: d.concept_id,
        version: conceptCatalogVersion(changeById.has(d.concept_id), catalogVersion, carried.get(d.concept_id) ?? null),
      });
    }

    if (prevInstallId !== null) {
      db.prepare(RETIRE_PACK).run({ install_id: prevInstallId, now });
    }
    if (db.prepare(ACTIVATE_PACK).run({ install_id: installId, now, version: catalogVersion }).changes !== 1) {
      throw new Error('invariant: activation changed no install row');
    }
    db.prepare(UPSERT_PACK_ACTIVE).run({
      pack_id: packId,
      install_id: installId,
      previous_install_id: prevInstallId,
      switched_at: now,
    });
    for (const handler of deps.ingest.handlers) {
      handler.activate(db, {
        pack_id: packId,
        install_id: installId,
        previous_install_id: prevInstallId,
        switched_at: now,
      });
    }

    const refs = conceptRefsOfInstall(db, installId);
    for (const ref of refs) {
      const change = changeById.get(ref.concept_id);
      if (change === undefined) {
        continue;
      }
      const payload: CatalogConceptChangedV1 = { change, concept: ref, pack_id: packId, version };
      appendEvent(deps.outbox, {
        type: 'catalog.concept.changed',
        schema_version: 1,
        correlation_id: requestId,
        payload,
      });
    }
    const channel = str(row, 'channel');
    const offlineCap = int(row, 'offline_cap_level');
    appendEvent(deps.outbox, {
      type: 'catalog.pack.activated',
      schema_version: 1,
      correlation_id: requestId,
      payload: {
        pack_id: packId,
        track,
        version,
        channel,
        manifest_hash: str(row, 'manifest_hash'),
        merkle_root: str(row, 'merkle_root'),
        previous_version: previousVersion,
        changed_concept_ids: changes.map((c) => c.concept_id),
        changed_ku_ids: changedKus,
        offline_cap_level: offlineCap,
        catalog_version: catalogVersion,
        activated_at: now,
      },
    });
    return {
      pack_id: packId,
      version,
      previous_version: previousVersion,
      catalog_version: catalogVersion,
      changed_concept_ids: changes.map((c) => c.concept_id),
      changed_ku_ids: changedKus,
    };
  });
}
