import { canonicalJson } from '@fathom/shared-kernel/canonical/canonical';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import { SELECT_UNFINISHED_INSTALLS } from '../../../infra/db/ct-catalog-read.sql.js';
import type { VerifiedFpack } from '../../../infra/packs/fpack-reader.js';
import { str } from '../row-read.js';
import { INSERT_PACK, MARK_PACK_FAILED } from './catalog-ingest.sql.js';

// PGM-CT-001 설치 행 생성·실패 표기 — Brief T-01-07 §4.4-5·6. 서빙 테이블 쓰기라 ingest 디렉터리에 둔다(check:content-ingest).

export type NewInstallRow = {
  readonly install_id: string;
  readonly request_id: string;
  readonly previous_version: string | null;
  readonly channel: 'seed' | 'local' | 'user';
  readonly fpack: VerifiedFpack;
};

/** 요청의 팩마다 ct_pack(state = loading) INSERT — 호출자가 이미 검증을 끝낸 뒤 1 tx로 전부(실패 시 전부 롤백). */
export function insertInstallRows(db: SqlitePort, rows: readonly NewInstallRow[], now: number): void {
  db.tx(() => {
    const stmt = db.prepare(INSERT_PACK);
    for (const r of rows) {
      const m = r.fpack.manifest;
      stmt.run({
        install_id: r.install_id,
        pack_id: m.pack_id,
        version: m.version,
        channel: r.channel,
        track_id: m.track,
        schema_v: m.schema_v,
        packc_version: m.packc_version,
        manifest_hash: r.fpack.manifest_hash,
        merkle_root: m.merkle_root,
        source_sha256: r.fpack.source_sha256,
        manifest_json: canonicalJson(m),
        report_json: r.fpack.report_canonical,
        offline_cap_level: m.offline_cap_level,
        created_at: now,
        ext: canonicalJson({ 'catalog.request_id': r.request_id, 'catalog.previous_version': r.previous_version }),
      });
    }
  });
}

/** loading·ready → failed(사유 코드·error_id·종료 시각 기록). 바뀐 행이 있으면 true. */
export function markInstallFailed(
  db: SqlitePort,
  installId: string,
  reason: string,
  errorId: string,
  finishedAt: number,
): boolean {
  return db.tx(
    () =>
      db.prepare(MARK_PACK_FAILED).run({
        install_id: installId,
        reason,
        error_id: errorId,
        finished_at: finishedAt,
      }).changes === 1,
  );
}

/** 기동 시 1회: loading·ready로 남은 설치(이전 프로세스가 도중에 죽음) → failed('interrupted'). 바뀐 행 수. */
export function failUnfinishedInstalls(db: SqlitePort, newId: () => string, now: number): number {
  return db.tx(() => {
    let n = 0;
    for (const row of db.prepare(SELECT_UNFINISHED_INSTALLS).all()) {
      const res = db.prepare(MARK_PACK_FAILED).run({
        install_id: str(row, 'install_id'),
        reason: 'interrupted',
        error_id: newId(),
        finished_at: now,
      });
      n += res.changes;
    }
    return n;
  });
}
