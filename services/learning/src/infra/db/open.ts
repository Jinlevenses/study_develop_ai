import { fileURLToPath } from 'node:url';
import type { ServiceDatabase, ServiceDeps } from '@fathom/shared-kernel/service/service';
import type { OpenDbOptions, SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import type { LearningInfra } from '../../config.js';
import { contentClient } from '../clients/content.client.js';
import { INSIGHT_DB } from '../insight-db/open.js';

// DB-01 §2·§3.1 — learning.db(원장·투영·연습·교과 참조). 증거 DB = synchronous FULL + recursive_triggers ON(CR-04).
export const LEARNING_DB: ServiceDatabase = {
  file: 'learning.db',
  applicationId: 0x46544c52,
  profile: 'full',
  synchronous: 'FULL',
  recursiveTriggers: true,
  migrations: [
    { module: 'ledger', dir: fileURLToPath(new URL('../../../migrations/ledger/', import.meta.url)) },
    { module: 'learner-model', dir: fileURLToPath(new URL('../../../migrations/learner-model/', import.meta.url)) },
    { module: 'practice', dir: fileURLToPath(new URL('../../../migrations/practice/', import.meta.url)) },
    { module: 'curriculum-ref', dir: fileURLToPath(new URL('../../../migrations/curriculum-ref/', import.meta.url)) },
  ],
};

/** 원장 연결(읽기 전용·job 포함) 규칙의 단일 원천(DB-01 §3.1, CR-04). */
export function learningDbOptions(readOnly: boolean): OpenDbOptions {
  return { readOnly, synchronous: LEARNING_DB.synchronous, recursiveTriggers: LEARNING_DB.recursiveTriggers };
}

function openedDb(deps: ServiceDeps<null>, file: string): SqlitePort {
  const db = deps.dbs[file];
  if (db === undefined) {
    throw new Error(`invariant: db ${file} not opened`);
  }
  return db;
}

export function openInfra(deps: ServiceDeps<null>): LearningInfra {
  return {
    db: openedDb(deps, LEARNING_DB.file),
    insightDb: openedDb(deps, INSIGHT_DB.file),
    content: contentClient(deps.peers),
  };
}
