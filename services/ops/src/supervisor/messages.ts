import type { IpcServiceToSupervisor } from '@fathom/contracts/admin/ipc';
import { IpcOpsToSupervisor, IpcServiceToSupervisor as ServiceMessage } from '@fathom/contracts/admin/ipc';
import type { ChildHandle } from './child.js';
import type { Ctx } from './context.js';
import { peersOf } from './context.js';
import type { ControlApi } from './control-ipc.js';
import { handleOpsRequest } from './control-ipc.js';
import { checkHandshake } from './handshake.js';
import type { Lifecycle } from './lifecycle.js';
import { STOP_SLACK_MS } from './lifecycle.js';
import { classifyPort, PREFERRED_PORTS } from './ports.js';
import type { Row } from './process-table.js';

// IF-IPC-005~007·008~017 · Brief §4.1.8·§4.1.9·§4.1.6 — 자식 → supervisor 메시지 처리(listening·ready·fatal, ops-api 제어 요청).
const MAX_NOTICES = 20;

function messageType(raw: unknown): string | null {
  return typeof raw === 'object' && raw !== null && 'type' in raw && typeof raw.type === 'string'
    ? raw.type.slice(0, 40)
    : null;
}

export function createMessageHandler(
  ctx: Ctx,
  life: Lifecycle,
  api: () => ControlApi,
): (row: Row, handle: ChildHandle, raw: unknown) => void {
  const { deps, opts } = ctx;

  function onListening(row: Row, port: number): void {
    row.port = port;
    row.lastPort = port;
    ctx.persist();
    ctx.broadcast({ type: 'registry.updated', peers: peersOf(ctx) });
    if (row.svc === 'vite' || opts.profile === 'test') {
      return;
    }
    const kind = classifyPort(row.svc, opts.profile, port);
    const fields = { child: row.svc, preferred: PREFERRED_PORTS[opts.profile][row.svc], actual: port };
    if (row.svc !== 'gateway') {
      if (kind === 'os') {
        deps.log.info({ event: 'supervisor.port.fallback', ...fields }, 'service listening on os-assigned port');
      }
    } else if (kind !== 'preferred' && !ctx.state.portNoticeDone) {
      ctx.state.portNoticeDone = true;
      deps.log.warn({ event: 'supervisor.port.fallback', ...fields }, 'gateway preferred port unavailable');
      if (ctx.notices.length < MAX_NOTICES) {
        ctx.notices.push(`port_fallback:gateway:${port}`);
      }
      ctx.persist();
    }
  }

  function onReady(row: Row, handle: ChildHandle, msg: Extract<IpcServiceToSupervisor, { type: 'ready' }>): void {
    const verdict = checkHandshake(msg, opts.bundle);
    if (!verdict.ok) {
      deps.log.error(
        {
          event: 'supervisor.handshake.rejected',
          child: row.svc,
          expected: verdict.error.expected.slice(0, 12),
          actual: verdict.error.actual.slice(0, 12),
        },
        'handshake rejected',
      );
      row.handshakeRejected = true;
      ctx.sendTo(row, { type: 'shutdown', grace_ms: 0 });
      row.cancelTimers.push(deps.timers.after(STOP_SLACK_MS, () => life.failChild(row, handle, 'handshake_rejected')));
      return;
    }
    row.readyInfo = {
      contracts_hash: msg.contracts_hash,
      schema_versions: msg.schema_versions,
      app_version: msg.app_version,
    };
    deps.log.info(
      {
        event: 'supervisor.child.ready',
        child: row.svc,
        app_version: msg.app_version,
        schema_versions: msg.schema_versions,
      },
      'child ready',
    );
    life.markReady(row);
  }

  return (row, handle, raw): void => {
    if (row.handle !== handle) {
      return;
    }
    const msg = ServiceMessage.safeParse(raw);
    if (msg.success) {
      if (msg.data.type === 'fatal') {
        row.fatalCode = msg.data.code;
      } else if (msg.data.type === 'listening') {
        onListening(row, msg.data.port);
      } else {
        onReady(row, handle, msg.data);
      }
      return;
    }
    if (row.svc === 'ops-api') {
      const ops = IpcOpsToSupervisor.safeParse(raw);
      if (ops.success) {
        // detached: IPC 메시지 핸들러는 동기 콜백이다 — 실패 응답은 handleOpsRequest가 보내고, 응답 전송 자체의 오류만 로그로 남긴다.
        handleOpsRequest(ops.data, api(), (reply) => {
          handle.send(reply);
        }).catch((e: unknown) => api().onDetachedError(e));
        return;
      }
    }
    deps.log.warn({ event: 'ipc.message.invalid', child: row.svc, type: messageType(raw) }, 'ipc message invalid');
  };
}
