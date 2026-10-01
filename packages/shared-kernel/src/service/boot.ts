import { resolveFathomHome } from '@fathom/shared-kernel/config/config';
import type { Logger } from '@fathom/shared-kernel/log/log';
import { createLogger } from '@fathom/shared-kernel/log/log';
import type { Clock } from '@fathom/shared-kernel/time/time';
import { systemClock } from '@fathom/shared-kernel/time/time';
import { runNonServeMode } from './mode-run.js';
import { parseModeArgs } from './modes.js';
import type { ProcessPort } from './process-port.js';
import { processWarningTarget, realProcessPort } from './process-port.js';
import { serve } from './serve.js';
import { createSqliteLoader } from './sqlite-loader.js';
import type { ServiceDefinition, ServiceRunResult } from './types.js';

// ARC-01 §17.3 `createService(def)` — 서비스 `main.ts`의 유일한 진입 호출. `--mode`로 serve·migrate·restore·verify·job을 가른다.

export type CreateServiceOptions = {
  readonly process?: ProcessPort;
  readonly clock?: Clock;
  /** [Brief 결정] 가산: 로그 목적지(기본 stdout). 테스트가 로그를 가로챌 때 쓴다. */
  readonly logDestination?: { write(chunk: string): void };
  /** [Brief 결정] 가산: job 자식의 `execArgv`(기본 = 현재 프로세스). TS 소스를 tsx로 띄우는 통합 테스트가 쓴다. */
  readonly jobExecArgv?: readonly string[];
};

const EXIT_USAGE = 64;
const EXIT_SOFTWARE = 70;

export async function createService<P>(
  def: ServiceDefinition<P>,
  opts?: CreateServiceOptions,
): Promise<ServiceRunResult> {
  const port = opts?.process ?? realProcessPort();
  const clock = opts?.clock ?? systemClock;
  const destination = opts?.logDestination === undefined ? {} : { destination: opts.logDestination };
  const parsed = parseModeArgs(port.argv);
  if (!parsed.ok) {
    const log = createLogger(def.svc, { level: 'info', bootId: null, clock, ...destination });
    log.error({ event: 'mode.args.invalid', detail: parsed.error }, 'invalid arguments');
    port.exit(EXIT_USAGE);
    return { kind: 'exited', code: EXIT_USAGE };
  }
  // 경고 필터는 진짜 프로세스에만 건다(가짜 포트를 쓰는 테스트가 전역 `process`를 건드리지 않게).
  const target = opts?.process === undefined ? processWarningTarget() : { emitWarning: (): void => undefined };
  const loader = createSqliteLoader(target);
  if (parsed.value.mode === 'serve') {
    return serve(def, {
      port,
      clock,
      loader,
      ...(opts?.logDestination === undefined ? {} : { logDestination: opts.logDestination }),
      ...(opts?.jobExecArgv === undefined ? {} : { jobExecArgv: opts.jobExecArgv }),
    });
  }
  const mode = parsed.value;
  const log: Logger = createLogger(def.svc, {
    level: 'info',
    bootId: null,
    clock,
    ...(mode.mode === 'job' ? { job: mode.job } : {}),
    ...destination,
  });
  let code: number;
  try {
    const home = resolveFathomHome({ env: (name) => port.env(name) });
    code = await runNonServeMode(def, mode, { clock, log, home, runtime: loader });
  } catch (e) {
    log.fatal({ event: `mode.${mode.mode}.crashed`, err: e }, 'mode crashed');
    code = EXIT_SOFTWARE;
  }
  port.exit(code);
  return { kind: 'exited', code };
}
