import type { RunModeArgs, SupervisedService } from '@fathom/contracts/admin/ipc';
import { IpcOpsToSupervisor, IpcSupervisorToOps } from '@fathom/contracts/admin/ipc';
import type { ServiceName } from '@fathom/contracts/common/ids';
import type { Result } from '@fathom/shared-kernel/errors/errors';
import { err, ok } from '@fathom/shared-kernel/errors/errors';
import { ulid } from '@fathom/shared-kernel/ids/ids';
import type { Logger } from '@fathom/shared-kernel/log/log';
import type { z } from 'zod';
import type { IpcChannel } from './channel.js';

// PGM-OP-002 · IF-IPC-008~017 — ops-api → supervisor 요청/응답 클라이언트. 응답 `re` = 요청 `id`로 짝짓는다.
type IpcSupervisorToOpsT = z.infer<typeof IpcSupervisorToOps>;
type SupervisedServiceT = z.infer<typeof SupervisedService>;
type ServiceNameT = z.infer<typeof ServiceName>;
type RunModeArgsT = z.infer<typeof RunModeArgs>;

export type StatusRow = Extract<IpcSupervisorToOpsT, { type: 'status' }>['services'][number];
export type SupervisorIpcFailure = {
  readonly kind: 'no_channel' | 'timeout' | 'rejected' | 'closed' | 'protocol';
  readonly detail: string;
};
type Fail = Result<never, SupervisorIpcFailure>;

export interface SupervisorControl {
  status(): Promise<Result<readonly StatusRow[], SupervisorIpcFailure>>;
  stop(svc: SupervisedServiceT): Promise<Result<null, SupervisorIpcFailure>>;
  start(svc: SupervisedServiceT): Promise<Result<null, SupervisorIpcFailure>>;
  restart(svc: SupervisedServiceT): Promise<Result<null, SupervisorIpcFailure>>;
  runMode(
    svc: ServiceNameT,
    args: RunModeArgsT,
  ): Promise<Result<{ readonly exit_code: number; readonly tail: readonly string[] }, SupervisorIpcFailure>>;
  logsTail(
    svc: ServiceNameT | 'supervisor',
    n: number,
  ): Promise<Result<{ readonly svc: string; readonly lines: readonly string[] }, SupervisorIpcFailure>>;
  shutdownAll(graceMs: number): Promise<Result<null, SupervisorIpcFailure>>;
  close(): void;
}

type TimeoutKey = 'status' | 'stop' | 'start' | 'restart' | 'run_mode' | 'logs_tail' | 'shutdown_all';
export type SupervisorControlOptions = {
  readonly channel: IpcChannel;
  readonly log?: Logger;
  readonly newId?: () => string;
  readonly timeoutsMs?: Partial<Record<TimeoutKey, number>>;
};

// 시간 상한 [Brief 결정]: stop = grace 3000 + treeKill 2000 + 여유 · start/restart = ready 30s + 여유 · run_mode = RUN_MODE_TIMEOUT_MS 600_000 + 여유.
const DEFAULT_TIMEOUT_MS: Readonly<Record<Exclude<TimeoutKey, 'shutdown_all'>, number>> = {
  status: 2_000,
  logs_tail: 5_000,
  stop: 10_000,
  start: 40_000,
  restart: 40_000,
  run_mode: 610_000,
};
const SHUTDOWN_MARGIN_MS = 5_000;

type Reply = Result<IpcSupervisorToOpsT, SupervisorIpcFailure>;
type Requester = {
  request(body: Record<string, unknown>, timeoutMs: number): Promise<Reply>;
  close(): void;
};

const failure = (kind: SupervisorIpcFailure['kind'], detail: string): Fail => err({ kind, detail });

function ackOf(m: IpcSupervisorToOpsT): Result<null, SupervisorIpcFailure> {
  if (m.type !== 'svc.ack') {
    return failure('protocol', m.type);
  }
  return m.ok ? ok(null) : failure('rejected', m.error ?? 'unknown');
}

/** 요청 id ↔ 대기 맵 · 지연 리스너 · 시간 상한. 응답 해석은 호출 쪽(`createSupervisorControl`)이 한다. */
function createRequester(opts: Pick<SupervisorControlOptions, 'channel' | 'newId'>): Requester {
  const { channel } = opts;
  const newId = opts.newId ?? ulid;
  const pending = new Map<string, (r: Reply) => void>();
  let listening = false;
  let closed = false;

  function onMessage(raw: unknown): void {
    const parsed = IpcSupervisorToOps.safeParse(raw);
    const re = parsed.success ? parsed.data.re : undefined;
    if (!parsed.success || re === undefined) {
      return; // bootstrap·registry.updated·shutdown 등은 createService 몫 — 조용히 무시
    }
    pending.get(re)?.(ok(parsed.data));
  }

  function transmit(message: unknown): boolean {
    try {
      return channel.connected() && channel.send(message);
    } catch {
      return false;
    }
  }

  function wait(id: string, type: string, message: unknown, timeoutMs: number): Promise<Reply> {
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const settle = (r: Reply): void => {
        if (!pending.delete(id)) {
          return;
        }
        if (timer !== null) {
          clearTimeout(timer);
        }
        resolve(r);
      };
      pending.set(id, settle);
      if (!transmit(message)) {
        settle(failure('no_channel', 'ipc channel unavailable'));
        return;
      }
      timer = setTimeout(() => settle(failure('timeout', `${type} timed out after ${timeoutMs}ms`)), timeoutMs);
      timer.unref();
    });
  }

  return {
    request(body: Record<string, unknown>, timeoutMs: number): Promise<Reply> {
      if (closed) {
        return Promise.resolve(failure('closed', 'supervisor control closed'));
      }
      const id = newId();
      const message = IpcOpsToSupervisor.parse({ ...body, v: 1, id }); // 잘못된 인자 = 호출자 결함(전송 0)
      if (!listening) {
        listening = true;
        channel.on(onMessage);
      }
      return wait(id, message.type, message, timeoutMs);
    },
    close(): void {
      closed = true;
      for (const settle of [...pending.values()]) {
        settle(failure('closed', 'supervisor control closed'));
      }
      if (listening) {
        listening = false;
        channel.off(onMessage);
      }
    },
  };
}

export function createSupervisorControl(opts: SupervisorControlOptions): SupervisorControl {
  const requester = createRequester(opts);
  const ms = (key: Exclude<TimeoutKey, 'shutdown_all'>): number => opts.timeoutsMs?.[key] ?? DEFAULT_TIMEOUT_MS[key];

  /** 요청 → 응답 해석(`pick`). 실패는 종류별로 한 줄 `warn`(페이로드 값 0). */
  async function call<T>(
    body: Record<string, unknown>,
    timeoutMs: number,
    pick: (m: IpcSupervisorToOpsT) => Result<T, SupervisorIpcFailure>,
  ): Promise<Result<T, SupervisorIpcFailure>> {
    const reply = await requester.request(body, timeoutMs);
    const result = reply.ok ? pick(reply.value) : reply;
    if (!result.ok) {
      opts.log?.warn(
        { event: 'ipc.request.failed', type: String(body.type), kind: result.error.kind },
        'supervisor ipc request failed',
      );
    }
    return result;
  }
  const svcAck = (
    type: 'svc.stop' | 'svc.start' | 'svc.restart',
    svc: SupervisedServiceT,
    key: 'stop' | 'start' | 'restart',
  ): Promise<Result<null, SupervisorIpcFailure>> => call({ type, svc }, ms(key), ackOf);

  return {
    status: () =>
      call({ type: 'status.get' }, ms('status'), (m) =>
        m.type === 'status' ? ok(m.services) : failure('protocol', m.type),
      ),
    stop: (svc) => svcAck('svc.stop', svc, 'stop'),
    start: (svc) => svcAck('svc.start', svc, 'start'),
    restart: (svc) => svcAck('svc.restart', svc, 'restart'),
    runMode: (svc, args) =>
      call({ type: 'svc.run_mode', svc, args }, ms('run_mode'), (m) =>
        m.type === 'svc.run_mode.result' ? ok({ exit_code: m.exit_code, tail: m.tail }) : failure('protocol', m.type),
      ),
    logsTail: (svc, n) =>
      call({ type: 'logs.tail', svc, n }, ms('logs_tail'), (m) =>
        m.type === 'logs.tail.result' ? ok({ svc: m.svc, lines: m.lines }) : failure('protocol', m.type),
      ),
    shutdownAll: (graceMs) =>
      call(
        { type: 'shutdown.all', grace_ms: graceMs },
        opts.timeoutsMs?.shutdown_all ?? graceMs + SHUTDOWN_MARGIN_MS,
        ackOf,
      ),
    close: () => requester.close(),
  };
}
