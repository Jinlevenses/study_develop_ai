import path from 'node:path';
import {
  AdminEventsRoute,
  AdminIntegrityRoute,
  AdminQuiesceRoute,
  AdminResumeRoute,
  AdminShutdownRoute,
  AdminSnapshotRoute,
  IntegrityResult,
  SnapshotResult,
} from '@fathom/contracts/admin/admin-routes';
import type { JobName } from '@fathom/contracts/admin/jobs';
import { homePath } from '@fathom/shared-kernel/config/config';
import { AppError } from '@fathom/shared-kernel/errors/errors';
import type { JobFailure, JobRunner } from '@fathom/shared-kernel/jobs/jobs';
import type { Logger } from '@fathom/shared-kernel/log/log';
import type { MetricsRegistry } from '@fathom/shared-kernel/metrics/metrics';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import type { Clock } from '@fathom/shared-kernel/time/time';
import type { z } from 'zod';
import { readEventTimeline } from '../eventing/timeline.js';
import { appErrorCode } from './problem.js';
import type { ServiceApp, ServiceDefinitionBase } from './types.js';
import type { WriteGate } from './write-gate.js';

// §4.6 admin 라우트(IF-COM-005~010) — quiesce · snapshot · resume · events · integrity · shutdown.

export type AdminRouteDeps = {
  readonly def: ServiceDefinitionBase;
  readonly app: ServiceApp;
  readonly clock: Clock;
  readonly log: Logger;
  readonly metrics: MetricsRegistry;
  readonly home: string;
  readonly gate: WriteGate;
  readonly jobs: JobRunner;
  /** content·learning·ai-gateway의 full DB(이벤트 타임라인 원천). */
  readonly fullDb: SqlitePort | null;
  readonly requestShutdown: (graceMs: number) => void;
};

const SNAPSHOT_TIMEOUT_MS = 30_000;
const INTEGRITY_TIMEOUT_MS = 120_000;

function insideOrSame(base: string, target: string): boolean {
  const rel = path.relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function registerAdminRoutes(
  d: AdminRouteDeps,
  opts: { readonly withState: boolean; readonly withShutdown: boolean },
): void {
  const svc = d.def.svc;
  const failures = d.metrics.counter('job_failures_total', 'job 실패 횟수', ['job']);
  const durations = d.metrics.histogram(
    'job_duration_ms',
    'job 실행 시간(ms)',
    [100, 500, 1000, 5000, 15_000, 30_000, 120_000],
    ['job'],
  );

  /** job 실행 → 결과 스키마 파싱. 실패는 504/503/500으로 매핑한다. */
  async function runJob<S extends z.ZodType>(
    name: JobName,
    args: Record<string, unknown>,
    timeoutMs: number,
    deadlineAt: number,
    schema: S,
  ): Promise<z.output<S>> {
    const budget = Math.min(timeoutMs, deadlineAt - d.clock.now());
    if (budget <= 0) {
      throw new AppError(appErrorCode(svc, 'DEP-902'), 504, '데드라인이 소진됐다.');
    }
    const started = performance.now();
    const result = await d.jobs.run(name, args, { timeoutMs: budget });
    if (!result.ok) {
      throw mapJobFailure(name, result.error);
    }
    durations.observe(performance.now() - started, { job: name });
    const parsed = schema.safeParse(result.value);
    if (!parsed.success) {
      d.log.error({ event: 'job.result.invalid', job: name }, 'job result violates contract');
      throw new AppError(appErrorCode(svc, 'INTERNAL-901'), 500);
    }
    return parsed.data;
  }

  function mapJobFailure(name: JobName, f: JobFailure): AppError {
    if (f.kind === 'timeout') {
      return new AppError(appErrorCode(svc, 'DEP-902'), 504, 'job이 기한 안에 끝나지 않았다.');
    }
    if (f.kind === 'queue_full') {
      return new AppError(appErrorCode(svc, 'DEP-900'), 503, 'job 대기열이 가득 찼다.');
    }
    failures.inc({ job: name });
    d.log.error({ event: 'job.failed', job: name, kind: f.kind, code: f.code, message: f.message }, 'job failed');
    return new AppError(appErrorCode(svc, 'INTERNAL-900'), 500);
  }

  if (opts.withState) {
    d.app.route(AdminQuiesceRoute, async (ctx) => {
      const r = await d.gate.quiesce(ctx.body.epoch_id, ctx.body.ack_deadline_ms);
      if (!r.ok) {
        throw new AppError(appErrorCode(svc, 'DEP-900'), 503, 'quiesce 기한 초과');
      }
      return { status: 200, body: { epoch_id: ctx.body.epoch_id, quiesced_at: r.value, in_flight_drained: true } };
    });

    d.app.route(AdminResumeRoute, (ctx) => {
      d.gate.resume(ctx.body.epoch_id);
      return Promise.resolve({ status: 200, body: { epoch_id: ctx.body.epoch_id, resumed_at: d.clock.now() } });
    });

    d.app.route(AdminSnapshotRoute, async (ctx) => {
      const { epoch_id, dir } = ctx.body;
      const allowed = path.resolve(homePath(d.home, 'backups', 'snap', epoch_id));
      if (!insideOrSame(allowed, path.resolve(dir))) {
        throw new AppError(appErrorCode(svc, 'VAL-900'), 400, 'snapshot dir가 허용 범위 밖이다.', {
          extra: { errors: [{ path: 'dir', message: 'backups/snap/<epoch_id> 안이어야 한다', rule: 'snapshot_dir' }] },
        });
      }
      const result = await runJob(
        'snapshot',
        { epoch_id, dir, home: d.home },
        SNAPSHOT_TIMEOUT_MS,
        ctx.deadlineAt,
        SnapshotResult,
      );
      return { status: 200, body: result };
    });

    d.app.route(AdminEventsRoute, (ctx) => {
      if (d.fullDb === null) {
        throw new Error('invariant: admin events route without a full database');
      }
      return Promise.resolve({ status: 200, body: readEventTimeline(d.fullDb, svc, ctx.query.correlation_id) });
    });

    d.app.route(AdminIntegrityRoute, async (ctx) => {
      const result = await runJob(
        'integrity',
        { level: ctx.body.level, home: d.home },
        INTEGRITY_TIMEOUT_MS,
        ctx.deadlineAt,
        IntegrityResult,
      );
      return { status: 200, body: result };
    });
  }

  if (opts.withShutdown) {
    d.app.route(AdminShutdownRoute, (ctx) => {
      const grace = ctx.body.grace_ms;
      const acceptedAt = d.clock.now();
      // 202를 먼저 돌려준 뒤 종료 절차를 시작한다(진행 중 요청에는 이 요청도 포함돼 끝나기를 기다린다).
      setImmediate(() => {
        d.requestShutdown(grace);
      });
      return Promise.resolve({ status: 202, body: { accepted_at: acceptedAt, grace_ms: grace } });
    });
  }
}
