// content 전용 확장(팩 무결성 등)은 이 파일에 가산 — 기본 동작 = shared-kernel(DB-01 §12.1).
import type { JobDefinition } from '@fathom/shared-kernel/jobs/jobs';
import { loadSqliteRuntime, makeSnapshotJob } from '@fathom/shared-kernel/service/service';

export function contentSnapshotJob(def: Parameters<typeof makeSnapshotJob>[0]): JobDefinition {
  return makeSnapshotJob(def, loadSqliteRuntime);
}
