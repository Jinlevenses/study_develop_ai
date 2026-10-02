import type { BundleRecord } from '@fathom/contracts/pack/records';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import type { Clock } from '@fathom/shared-kernel/time/time';
import {
  SELECT_APPLIED_DELTA_COUNT,
  SELECT_FAILED_INSTALLS_OF_PACK,
  SELECT_OVERLAY_EVENT_COUNT,
  SELECT_PACK_ROW,
} from '../../../infra/db/ct-catalog-read.sql.js';
import { readFpack } from '../../../infra/packs/fpack-reader.js';
import type { IngestContext, IngestRegistry, PackIngestHandler } from '../ports.js';
import { int, str } from '../row-read.js';
import { DELETE_PACK, MARK_PACK_READY } from './catalog-ingest.sql.js';
import { isCatalogKind, insertCatalogRecord, prepareCatalogInserts } from './load-records.js';

// PGM-CT-002 job `pack-load` 핵심 — Brief T-01-07 §4.5. 동기 함수(tx 안 await 0, STD-ASY-02) — job 래퍼(jobs/pack-load.ts)가 비동기 경계를 맡는다.

export const PACK_LOAD_BATCH = 500;

export type PackLoadArgs = {
  readonly install_id: string;
  readonly fpack_path: string;
  readonly expected_sha256: string;
};
export type PackLoadDeps = { readonly ingest: IngestRegistry; readonly clock: Clock };
export type PackLoadContext = {
  progress(pct: number | null, step: string): void;
  readonly signal: AbortSignal;
};
export type PackLoadResult = {
  readonly install_id: string;
  readonly records: Readonly<Record<string, number>>;
  readonly batches: number;
  readonly overlay_events: number;
  readonly duration_ms: number;
};

/** 부모가 `state_reason`에 옮겨 적는 실패 사유 코드(메시지 = 코드, 경로·원문 0). */
export class PackLoadError extends Error {
  override readonly name = 'PackLoadError';
}

function cmpIds(a: string, b: string): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

/** kind → 핸들러. 두 핸들러가 같은 kind를 선언하면 결함. */
function routeByKind(registry: IngestRegistry): Map<string, PackIngestHandler> {
  const byKind = new Map<string, PackIngestHandler>();
  for (const handler of registry.handlers) {
    for (const kind of handler.kinds) {
      if (byKind.has(kind)) {
        throw new Error(`invariant: ingest kind ${kind} declared by more than one handler`);
      }
      byKind.set(kind, handler);
    }
  }
  return byKind;
}

function countOf(db: SqlitePort, sql: string, bind: Readonly<Record<string, string>> | null): number {
  const row = bind === null ? db.prepare(sql).get() : db.prepare(sql).get(bind);
  if (row === undefined) {
    throw new Error('invariant: count query returned no row');
  }
  return int(row, 'n');
}

export function runPackLoad(
  db: SqlitePort,
  deps: PackLoadDeps,
  args: PackLoadArgs,
  ctx: PackLoadContext,
): PackLoadResult {
  const startedAt = deps.clock.now();
  const byKind = routeByKind(deps.ingest);

  // 1. 대상 행 확인 + 같은 팩의 failed 설치 정리(핸들러 purge → ct_pack DELETE, 설치 범위 행은 CASCADE).
  const target = db.tx(() => {
    const row = db.prepare(SELECT_PACK_ROW).get({ install_id: args.install_id });
    if (row === undefined || str(row, 'state') !== 'loading') {
      throw new PackLoadError('install_state_invalid');
    }
    const packId = str(row, 'pack_id');
    for (const failed of db.prepare(SELECT_FAILED_INSTALLS_OF_PACK).all({ pack_id: packId, install_id: args.install_id })) {
      const failedId = str(failed, 'install_id');
      for (const handler of deps.ingest.handlers) {
        handler.purge(db, failedId);
      }
      db.prepare(DELETE_PACK).run({ install_id: failedId });
    }
    return { pack_id: packId, version: str(row, 'version'), manifest_hash: str(row, 'manifest_hash') };
  });

  // 2. 재검증(TOCTOU) — 파일 바이트가 부모가 검증한 것과 같아야 한다.
  const verified = readFpack(args.fpack_path);
  if (!verified.ok) {
    if (verified.error.source_sha256 !== undefined && verified.error.source_sha256 !== args.expected_sha256) {
      throw new PackLoadError('source_changed');
    }
    throw new PackLoadError(`fpack_invalid:${verified.error.reason}`);
  }
  const fpack = verified.value;
  if (
    fpack.source_sha256 !== args.expected_sha256 ||
    fpack.manifest_hash !== target.manifest_hash ||
    fpack.manifest.pack_id !== target.pack_id ||
    fpack.manifest.version !== target.version
  ) {
    throw new PackLoadError('source_changed');
  }

  // 4(선검사). 재적용 자리 — 적용된 PackDelta가 있으면 새 설치 위에 되살릴 수 없으므로(IT-04 수입 WP 전) 쓰기 전에 실패한다.
  if (countOf(db, SELECT_APPLIED_DELTA_COUNT, { pack_id: target.pack_id }) > 0) {
    throw new PackLoadError('delta_reapply_unsupported');
  }
  // 미지원 kind는 조용히 버리지 않는다 — 첫 INSERT 전에 실패시킨다.
  for (const r of fpack.records) {
    if (!isCatalogKind(r.kind) && !byKind.has(r.kind)) {
      throw new PackLoadError(`unsupported_record_kind:${r.kind}`);
    }
  }

  // 3. 500건 배치 — 배치마다 tx 1회, catalog 8종은 직접·핸들러 kind는 배치 안 순서대로 묶어 ingest.
  const ingestCtx: IngestContext = {
    install_id: args.install_id,
    pack_id: target.pack_id,
    pack_version: target.version,
    loaded_at: deps.clock.now(),
  };
  const inserts = prepareCatalogInserts(db);
  const counts = new Map<string, number>();
  const total = fpack.records.length;
  let batches = 0;
  for (let from = 0; from < total; from += PACK_LOAD_BATCH) {
    if (ctx.signal.aborted) {
      throw new Error('cancelled');
    }
    const slice = fpack.records.slice(from, from + PACK_LOAD_BATCH);
    db.tx(() => {
      const forHandler = new Map<PackIngestHandler, BundleRecord[]>();
      for (const r of slice) {
        if (!insertCatalogRecord(inserts, args.install_id, r)) {
          const handler = byKind.get(r.kind);
          if (handler === undefined) {
            throw new PackLoadError(`unsupported_record_kind:${r.kind}`);
          }
          const list = forHandler.get(handler) ?? [];
          list.push(r);
          forHandler.set(handler, list);
        }
      }
      for (const handler of deps.ingest.handlers) {
        const list = forHandler.get(handler);
        if (list !== undefined) {
          handler.ingest(db, ingestCtx, list);
        }
      }
    });
    for (const r of slice) {
      counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
    }
    batches += 1;
    ctx.progress(Math.floor((Math.min(from + PACK_LOAD_BATCH, total) * 100) / total), 'load');
  }

  // 5. loading → ready
  db.tx(() => {
    if (db.prepare(MARK_PACK_READY).run({ install_id: args.install_id, now: deps.clock.now() }).changes !== 1) {
      throw new Error('invariant: pack-load could not mark the install ready');
    }
  });

  // 6. 결과 — 오버레이는 팩 ⊕ 오버레이를 읽기 시점에 합성하므로 적재에는 영향 0, 수만 보고한다(충돌 탐지 = IT-03).
  return {
    install_id: args.install_id,
    records: Object.fromEntries([...counts].sort(([a], [b]) => cmpIds(a, b))),
    batches,
    overlay_events: countOf(db, SELECT_OVERLAY_EVENT_COUNT, null),
    duration_ms: Math.max(0, deps.clock.now() - startedAt),
  };
}

export function sanitizeFailureCode(message: string): string {
  return /^[a-z][a-z0-9_]*(?::[A-Za-z0-9_.@-]+)*$/.test(message) && message.length <= 100 ? message : 'internal';
}
