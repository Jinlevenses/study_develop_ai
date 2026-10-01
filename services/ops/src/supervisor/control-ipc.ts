import type { IpcOpsToSupervisor } from '@fathom/contracts/admin/ipc';
import { IpcSupervisorToOps } from '@fathom/contracts/admin/ipc';
import type { ServiceName } from '@fathom/contracts/common/ids';
import type { LogSvc } from './log-sink.js';
import type { StatusRow } from './process-table.js';
import type { RunModeResult } from './run-mode.js';

// IF-IPC-008~017 · Brief §4.1.11 — ops-api → supervisor 제어 요청. 응답은 `IpcSupervisorToOps.parse` 후 `re` = 요청 `id`.
export type Ack = { readonly ok: boolean; readonly error: string | null };
export interface ControlApi {
  stop(svc: IpcOpsToSupervisorSvc): Promise<Ack>;
  start(svc: IpcOpsToSupervisorSvc): Promise<Ack>;
  restart(svc: IpcOpsToSupervisorSvc): Promise<Ack>;
  runMode(
    svc: ServiceName,
    args: Extract<IpcOpsToSupervisor, { type: 'svc.run_mode' }>['args'],
  ): Promise<RunModeResult>;
  status(): readonly StatusRow[];
  tail(svc: LogSvc, n: number): readonly string[];
  shutdownAll(graceMs: number): Promise<void>;
  onDetachedError(e: unknown): void;
}
type IpcOpsToSupervisorSvc = Extract<IpcOpsToSupervisor, { type: 'svc.stop' }>['svc'];

function build(req: { readonly id?: string | undefined }, body: Record<string, unknown>): IpcSupervisorToOps {
  return IpcSupervisorToOps.parse({ v: 1, ...(req.id === undefined ? {} : { re: req.id }), ...body });
}

/**
 * 한 요청을 처리하고 응답을 `reply`로 보낸다. `shutdown.all`은 **ack를 먼저** 보내고 종료를 시작한다.
 * 처리·응답 구성이 실패해도 요청은 침묵으로 버려지지 않는다 — `svc.ack{ok:false,error:'internal'}`를 보내고 오류를 보고한다.
 */
export async function handleOpsRequest(
  msg: IpcOpsToSupervisor,
  api: ControlApi,
  reply: (m: IpcSupervisorToOps) => void,
): Promise<void> {
  try {
    await dispatch(msg, api, reply);
  } catch (e) {
    api.onDetachedError(e);
    reply(build(msg, { type: 'svc.ack', ok: false, error: 'internal' }));
  }
}

async function dispatch(
  msg: IpcOpsToSupervisor,
  api: ControlApi,
  reply: (m: IpcSupervisorToOps) => void,
): Promise<void> {
  switch (msg.type) {
    case 'svc.stop':
    case 'svc.start':
    case 'svc.restart': {
      const ack =
        msg.type === 'svc.stop'
          ? await api.stop(msg.svc)
          : msg.type === 'svc.start'
            ? await api.start(msg.svc)
            : await api.restart(msg.svc);
      reply(build(msg, { type: 'svc.ack', ok: ack.ok, error: ack.error }));
      return;
    }
    case 'svc.run_mode': {
      const result = await api.runMode(msg.svc, msg.args);
      reply(build(msg, { type: 'svc.run_mode.result', exit_code: result.exit_code, tail: result.tail }));
      return;
    }
    case 'status.get':
      reply(build(msg, { type: 'status', services: api.status() }));
      return;
    case 'logs.tail':
      reply(build(msg, { type: 'logs.tail.result', svc: msg.svc, lines: api.tail(msg.svc, msg.n) }));
      return;
    case 'shutdown.all':
      reply(build(msg, { type: 'svc.ack', ok: true, error: null }));
      // detached: 종료는 ack 이후 진행된다 — 실패는 로그로만 남긴다.
      api.shutdownAll(msg.grace_ms).catch((e: unknown) => api.onDetachedError(e));
      return;
  }
}
