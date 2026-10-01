import { fileURLToPath } from 'node:url';
import type { ServiceDatabase } from '@fathom/shared-kernel/service/service';
import type { OpenDbOptions } from '@fathom/shared-kernel/sqlite/sqlite';

// DB-01 §7 — insight.db(learning 읽기 모델). 재구성 가능·백업 제외(ARC-01 §15.1)라 profile 'meta'.
export const INSIGHT_DB: ServiceDatabase = {
  file: 'insight.db',
  applicationId: 0x46544956,
  profile: 'meta',
  synchronous: 'NORMAL',
  recursiveTriggers: false,
  migrations: [{ module: 'insight', dir: fileURLToPath(new URL('../../../migrations-insight/', import.meta.url)) }],
};

export function insightDbOptions(readOnly: boolean): OpenDbOptions {
  return { readOnly, synchronous: INSIGHT_DB.synchronous, recursiveTriggers: INSIGHT_DB.recursiveTriggers };
}
