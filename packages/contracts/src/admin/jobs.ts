import { z } from 'zod';
import { Ulid } from '../common/ids.js';
import { S } from '../common/schema.js';

// shared-kernel `jobs.run()` ↔ 자식 `defineJob()`
// [Brief 결정 §4.4-1] `H`는 ipc.ts의 비공개 상수다. 같은 정의를 로컬 복사한다(UT-CON-053이 두 머리의 동등성을 단언).
const H = { v: z.literal(1), id: Ulid.optional(), re: Ulid.optional() };
export const JobName = z.enum([
  'snapshot',
  'integrity',
  'pack-load',
  'pipeline',
  'replay-verify',
  'merge',
  'rebuild',
  'fsrs-optimize',
]);
export type JobName = z.infer<typeof JobName>;
export const IpcJob = z.discriminatedUnion('type', [
  S({ type: z.literal('job.start'), ...H, job: JobName, args: z.record(z.string(), z.unknown()) }),
  S({ type: z.literal('job.progress'), ...H, pct: z.number().min(0).max(100).nullable(), step: z.string().max(60) }),
  S({ type: z.literal('job.result'), ...H, result: z.record(z.string(), z.unknown()) }), // job별 스키마 = 호출 라우트의 결과(SnapshotResult 등)
  S({ type: z.literal('job.error'), ...H, code: z.string().max(60), message: z.string().max(500) }),
  S({ type: z.literal('job.cancel'), ...H }),
]);
export type IpcJob = z.infer<typeof IpcJob>;
