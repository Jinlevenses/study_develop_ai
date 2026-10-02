import { err, ok } from '@fathom/shared-kernel/errors/errors';
import type { JobFailure, JobRunner } from '@fathom/shared-kernel/jobs/jobs';
import type { Logger } from '@fathom/shared-kernel/log/log';
import { createLogger } from '@fathom/shared-kernel/log/log';
import { runPackLoad } from '../../../../src/application/catalog/ingest/pack-load-run.js';
import type { IngestRegistry } from '../../../../src/application/catalog/ports.js';
import type { Fixture } from './db.js';
import { loadContext } from './stage.js';

// 단위 테스트용 JobRunner — 자식 프로세스 대신 같은 프로세스에서 `runPackLoad`를 직접 돌린다(실제 자식 = 통합 테스트 IT-230~).

export type FakeJobs = JobRunner & {
  readonly calls: { name: string; args: Record<string, unknown> }[];
  busy: boolean;
  /** 문자열을 돌려주면 그 메시지로 job_error를 낸다(null = 정상 실행). */
  failWith: ((args: Record<string, unknown>) => string | null) | null;
};

export function inProcessJobs(fx: Fixture, ingest: IngestRegistry): FakeJobs {
  const jobs: FakeJobs = {
    calls: [],
    busy: false,
    failWith: null,
    run(name, args) {
      jobs.calls.push({ name, args });
      const forced = jobs.failWith?.(args) ?? null;
      if (forced !== null) {
        const failure: JobFailure = { kind: 'job_error', code: 'handler_failed', message: forced, exitCode: 70 };
        return Promise.resolve(err(failure));
      }
      try {
        const result = runPackLoad(
          fx.db,
          { ingest, clock: fx.clock },
          {
            install_id: String(args.install_id),
            fpack_path: String(args.fpack_path),
            expected_sha256: String(args.expected_sha256),
          },
          loadContext().ctx,
        );
        return Promise.resolve(ok({ ...result }));
      } catch (e) {
        const failure: JobFailure = {
          kind: 'job_error',
          code: 'handler_failed',
          message: e instanceof Error ? e.message : String(e),
          exitCode: 70,
        };
        return Promise.resolve(err(failure));
      }
    },
    cancel(): void {},
    isBusy(): boolean {
      return jobs.busy;
    },
    shutdown(): Promise<void> {
      return Promise.resolve();
    },
  };
  return jobs;
}

export type CapturedLog = { readonly logger: Logger; readonly lines: string[] };

export function captureLogger(fx: Fixture): CapturedLog {
  const lines: string[] = [];
  const logger = createLogger('content', {
    level: 'debug',
    bootId: null,
    clock: fx.clock,
    destination: {
      write(chunk: string): void {
        lines.push(chunk);
      },
    },
  });
  return { logger, lines };
}
