import { z } from 'zod';
import { ItemId, ObjKey, SemVer, Ulid } from '../../../common/ids.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';
import { DurationMs } from '../../../common/time.js';

export const CreateRunBody = S({
  run_id: Ulid,
  item_id: ItemId.nullable(),
  kind: z.enum(['code', 'sql']),
  lang: z.enum(['js', 'ts']).nullable(),
  code: z.string().min(1).max(65_536),
  mode: z.enum(['stdout', 'public_tests']),
}); // 공개(IF-GW-038)
export type CreateRunBody = z.infer<typeof CreateRunBody>;
export const CreateRunRequest = S({
  run_id: Ulid,
  item_id: ItemId.nullable(),
  kind: z.enum(['code', 'sql']),
  lang: z.enum(['js', 'ts']).nullable(),
  code: z.string().min(1).max(65_536),
  mode: z.enum(['stdout', 'public_tests']),
  source_kind: z.enum(['learner', 'seed', 't1']),
});
export type CreateRunRequest = z.infer<typeof CreateRunRequest>;
export const RunStatus = z.union([
  z.enum(['ok', 'error', 'timeout', 'memory_limit', 'output_limit', 'rejected', 'platform_disabled']),
  z.string().regex(/^killed_[a-z_]{1,30}$/),
]);
export type RunStatus = z.infer<typeof RunStatus>;
export const RunResultView = S({
  run_id: Ulid,
  status: RunStatus,
  stdout: z.string().max(65_536),
  stderr: z.string().max(65_536), // stderr의 러너·tmp 경로 치환 후
  exit_code: z.number().int().nullable(),
  duration_ms: DurationMs,
  peak_rss_mb: z.number().min(0),
  output_truncated: z.boolean(),
  reason: z.string().max(300).nullable(),
  public_tests: S({
    passed: z.number().int(),
    failed: z.number().int(),
    cases: z.array(S({ case_key: ObjKey, ok: z.boolean(), message_ko: z.string().max(500).nullable() })).max(50),
  }).nullable(),
  sql: S({
    columns: z.array(z.string().max(128)).max(64),
    rows: z.array(z.array(z.union([z.string().max(1024), z.number(), z.null()]))).max(1000),
    truncated: z.boolean(),
  }).nullable(),
});
export type RunResultView = z.infer<typeof RunResultView>;
export const RunnerPlatformView = S({
  enabled: z.boolean(),
  platform: S({ os: z.enum(['linux', 'darwin', 'win32']), arch: z.string().max(20), node: SemVer }),
  verified_platforms: z
    .array(S({ os: z.enum(['linux', 'darwin', 'win32']), arch: z.string().max(20), node: SemVer }))
    .max(20),
  watchdog_period_ms: z.number().int().nullable(),
  reason: z.enum(['not_verified', 'watchdog_period_exceeded', 'helper_unavailable']).nullable(),
  docker_recommended: z.boolean(),
  queue: S({ running: z.number().int(), queued: z.number().int(), max_concurrency: z.number().int() }),
});
export type RunnerPlatformView = z.infer<typeof RunnerPlatformView>;

// idem = run_id
export const RunnerRunsCreateRoute = defineRoute({
  id: 'content.runner.runs.create',
  ifId: 'IF-CT-050',
  method: 'POST',
  path: '/internal/v1/runner/runs',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { body: CreateRunRequest },
  response: { 200: RunResultView },
  deadlineMs: 6000,
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-LAB-001', 'FR-LAB-002', 'FR-LAB-003', 'FR-LAB-006', 'FR-LAB-007', 'FR-LAB-013', 'FR-LAB-016', 'NFR-SEC-006'],
});
export const RunnerPlatformRoute = defineRoute({
  id: 'content.runner.platform',
  ifId: 'IF-CT-051',
  method: 'GET',
  path: '/internal/v1/runner/platform',
  allowedCallers: ['gateway', 'ops-api'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: RunnerPlatformView },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-LAB-012', 'NFR-PORT-001', 'CR-02'],
});
export const CT_RUNNER_ROUTES = [RunnerRunsCreateRoute, RunnerPlatformRoute] as const;
