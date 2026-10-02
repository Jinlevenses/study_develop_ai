import type { StreamOpenRoute } from '@fathom/contracts/http/gateway/v1/stream';
import { AppError } from '@fathom/shared-kernel/errors/errors';
import type { RouteContext, ServiceApp, ServiceDeps } from '@fathom/shared-kernel/service/service';
import type { FastifyReply } from 'fastify';
import type { GatewayContext } from '../../config.js';
import { GATEWAY_LIMITS } from '../../constants.js';
import { registerStreamRoutes } from '../../http/stream/routes.js';
import type { SseClient } from './hub.js';

// SSE 결선(IF-GW-005, IR-016) — 허브를 부트 정보로 연결하고, 종료 시 열린 스트림을 fastify.close 전에 끊는다.

function lastEventIdOf(raw: RouteContext<typeof StreamOpenRoute>['raw']): string | undefined {
  const v = raw.headers['last-event-id'];
  return Array.isArray(v) ? v[0] : v;
}

/** 스트림 핸들러: sid 재검증 → 연결 수 검사(하이잭 전 problem+json) → 하이잭 → 헤더 → 프레임 쓰기. */
export function createStreamHandler(
  ctx: GatewayContext,
): (c: RouteContext<typeof StreamOpenRoute>, reply: FastifyReply) => Promise<void> {
  return (c, reply): Promise<void> => {
    const reader = ctx.sessionReader;
    if (reader === null) {
      throw new Error('invariant: session reader missing');
    }
    const { sid } = reader.read(c.raw.headers);
    let started = false;
    // 첫 쓰기에서 하이잭·헤더를 낸다 — `open`이 too_many로 실패하면 아무것도 쓰지 않아 일반 problem+json을 보낼 수 있다.
    const start = (): void => {
      if (started) {
        return;
      }
      started = true;
      reply.hijack();
      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        'x-accel-buffering': 'no',
        'x-request-id': c.requestId,
      });
    };
    const client: SseClient = {
      write(chunk: string): boolean {
        start();
        if (reply.raw.writableLength > GATEWAY_LIMITS.sseMaxBufferedBytes) {
          reply.raw.destroy(); // 느린 클라이언트 — 버퍼 상한 초과(close 이벤트가 연결을 해제한다)
          return false;
        }
        return reply.raw.write(chunk);
      },
      close(): void {
        if (!started) {
          return;
        }
        if (reply.raw.writableNeedDrain) {
          reply.raw.destroy(); // 밀린 버퍼가 있으면 end()는 끝나지 않는다
        } else {
          reply.raw.end();
        }
      },
    };
    // `close`/`error`는 첫 쓰기 전에 붙인다 — 인증 중 클라이언트가 끊겨 이벤트를 놓치는 일이 없게(STD-ASY-10).
    let release: (() => void) | null = null;
    let gone = false;
    const onGone = (): void => {
      gone = true;
      release?.();
    };
    reply.raw.on('close', onGone);
    reply.raw.on('error', onGone);
    const opened = ctx.hub.open(client, { sid, lastEventId: lastEventIdOf(c.raw) });
    if (!opened.ok) {
      throw new AppError('GW-LIMIT-002', 429, '세션당 SSE 연결 수를 넘었다.');
    }
    release = opened.value;
    if (gone || reply.raw.destroyed || c.raw.socket?.destroyed === true) {
      release(); // 핸들러가 돌기 전에 이미 끊긴 요청 — 'close'는 다시 오지 않는다
    }
    return Promise.resolve();
  };
}

export function registerStream(app: ServiceApp, deps: ServiceDeps<null>, ctx: GatewayContext): void {
  ctx.hub.attach({ bootId: deps.bootId, appVersion: deps.appVersion, clock: deps.clock });
  deps.onShutdown(() => ctx.hub.closeAll());
  registerStreamRoutes(app, createStreamHandler(ctx));
}
