import { z } from 'zod';
import { ContextRef } from '../../../ai/data-class.js';
import { AiErrorClass } from '../../../ai/errors.js';
import { GenerateJobPayload, GenerateResult } from '../../../ai/generate.js';
import { JudgeJobPayload, JudgeResult } from '../../../ai/judge.js';
import { TaskId } from '../../../ai/tasks.js';
import { SemVer, Ulid } from '../../../common/ids.js';
import { Cursor } from '../../../common/pagination.js';
import { S } from '../../../common/schema.js';
import { EpochMs } from '../../../common/time.js';

export const JobItemKey = z.string().regex(/^[a-z0-9][a-z0-9_.:#!~-]{0,159}$/);           // 항목 식별(문항 ID 등) — 결과 매핑용, Jev에 전달 안 함
export type JobItemKey = z.infer<typeof JobItemKey>;
export const CreateJobBody = S({
  job_id: Ulid, kind: z.enum(['judge', 'generate']), task_id: TaskId, work_order_id: Ulid,
  priority: z.enum(['normal', 'low']), not_before: EpochMs.nullable(), dedupe_key: z.string().max(200).nullable(), context_ref: ContextRef,
  items: z.array(S({ item_key: JobItemKey, judge: JudgeJobPayload.nullable(), generate: GenerateJobPayload.nullable() })).min(1).max(500),
}).superRefine((v, ctx) => { /* kind='judge'면 모든 item.judge ≠ null ∧ generate = null, 반대도 같음 */ });
export type CreateJobBody = z.infer<typeof CreateJobBody>;
export const JobView = S({
  job_id: Ulid, kind: z.enum(['judge', 'generate']), task_id: TaskId, work_order_id: Ulid,
  state: z.enum(['queued', 'waiting_window', 'running', 'done', 'failed', 'cancelled', 'deferred']),
  items_total: z.number().int(), items_done: z.number().int(), items_failed: z.number().int(), attempts: z.number().int().min(0).max(3),
  created_at: EpochMs, started_at: EpochMs.nullable(), finished_at: EpochMs.nullable(), next_attempt_at: EpochMs.nullable(),
  outcome: z.enum(['ok', 'failed', 'cancelled', 'deferred']).nullable(), result_ref: Ulid.nullable(), prompt_version: SemVer.nullable(),
  last_error: AiErrorClass.nullable(),
});
export type JobView = z.infer<typeof JobView>;
export const JobListQuery = S({ state: z.enum(['queued', 'waiting_window', 'running', 'done', 'failed', 'cancelled', 'deferred']).optional(),
  task_id: TaskId.optional(), cursor: Cursor.optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });
export type JobListQuery = z.infer<typeof JobListQuery>;
export const JobResultPage = S({ job_id: Ulid, task_id: TaskId, items: z.array(S({ item_key: JobItemKey, status: z.enum(['ok', 'failed', 'unavailable']),
  judge: JudgeResult.nullable(), generate: GenerateResult.nullable() })).max(200), next_cursor: Cursor.nullable() });
export type JobResultPage = z.infer<typeof JobResultPage>;
