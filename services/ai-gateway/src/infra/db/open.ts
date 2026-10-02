import { fileURLToPath } from 'node:url';
import type { ServiceDatabase, ServiceDeps } from '@fathom/shared-kernel/service/service';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import type { Clock } from '@fathom/shared-kernel/time/time';
import type { AiInfra } from '../../config.js';

// DB-01 §2 — ai.db(제어·라우팅·판정·프라이버시)·ai-cache.db(재생성 캐시, 백업 제외).
export const AI_DB: ServiceDatabase = {
  file: 'ai.db',
  applicationId: 0x46544149,
  profile: 'full',
  synchronous: 'NORMAL',
  recursiveTriggers: false,
  migrations: [
    { module: 'control', dir: fileURLToPath(new URL('../../../migrations/control/', import.meta.url)) },
    { module: 'routing', dir: fileURLToPath(new URL('../../../migrations/routing/', import.meta.url)) },
    { module: 'judge', dir: fileURLToPath(new URL('../../../migrations/judge/', import.meta.url)) },
    { module: 'privacy', dir: fileURLToPath(new URL('../../../migrations/privacy/', import.meta.url)) },
  ],
};

export const AI_CACHE_DB: ServiceDatabase = {
  file: 'ai-cache.db',
  applicationId: 0x46544143,
  profile: 'meta',
  synchronous: 'NORMAL',
  recursiveTriggers: false,
  migrations: [{ module: 'cache', dir: fileURLToPath(new URL('../../../migrations-cache/', import.meta.url)) }],
};

// DB-01 §14.3 — 첫 기동 시드: 모드 상태 1행(OFFLINE, 사유 first_boot). 이미 있으면 바꾸지 않는다(재기동 멱등).
const SEED_MODE_STATE =
  "INSERT OR IGNORE INTO ai_mode_state(id, mode, reasons_json, changed_at) VALUES (1, 'OFFLINE', '[\"first_boot\"]', :now)";
const MODE_STATE_PRESENT = 'SELECT mode FROM ai_mode_state WHERE id = 1';

/**
 * 첫 기동 = OFFLINE(FR-AI-003 · AI-01 §5.1 "동의 0건 → OFFLINE"). 첫 상태 설정은 전이가 아니므로
 * `ai_mode_history`·outbox(`ai.mode.changed`)는 쓰지 않는다 — 첫 전이는 control WP의 동의 흐름이 기록한다.
 */
export function seedFirstBoot(db: SqlitePort, clock: Clock): 'seeded' | 'present' {
  return db.tx((): 'seeded' | 'present' => {
    const inserted = db.prepare(SEED_MODE_STATE).run({ now: clock.now() });
    if (inserted.changes === 1) {
      return 'seeded';
    }
    if (db.prepare(MODE_STATE_PRESENT).get() === undefined) {
      throw new Error('invariant: ai_mode_state seed ignored without row');
    }
    return 'present';
  });
}

function openedDb(deps: ServiceDeps<null>, file: string): SqlitePort {
  const db = deps.dbs[file];
  if (db === undefined) {
    throw new Error(`invariant: db ${file} not opened`);
  }
  return db;
}

export function openInfra(deps: ServiceDeps<null>, opts: { readonly assetsDir: string }): AiInfra {
  const db = openedDb(deps, AI_DB.file);
  const firstBoot = seedFirstBoot(db, deps.clock);
  if (firstBoot === 'seeded') {
    deps.log.info({ event: 'control.mode.seeded', mode: 'OFFLINE' }, 'first boot AI mode');
  }
  return { db, cacheDb: openedDb(deps, AI_CACHE_DB.file), assetsDir: opts.assetsDir, firstBoot };
}
