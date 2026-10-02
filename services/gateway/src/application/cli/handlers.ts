import type { RuntimeProfile } from '@fathom/contracts/common/domain';
import type { CliBootstrapTokenRoute, CliShutdownRoute, CliStatusRoute } from '@fathom/contracts/http/gateway/v1/cli';
import { HealthBoardRoute } from '@fathom/contracts/http/ops/v1/health';
import { SystemShutdownRoute } from '@fathom/contracts/http/ops/v1/system';
import { AppError } from '@fathom/shared-kernel/errors/errors';
import type { PeerCallOptions } from '@fathom/shared-kernel/http-client/http-client';
import type { RouteContext, RouteReply, ServiceDeps } from '@fathom/shared-kernel/service/service';
import type { GatewayContext } from '../../config.js';
import { peerFailureToAppError } from '../../infra/peers/failure.js';
import { requirePeer } from '../../infra/peers/peers.js';
import { toBase64Url } from '../session/crypto.js';

// IF-GW-001·180·181 — CLI API 3종(호출자 `cli`). 하위(ops-api) 실패·Problem은 합성 없이 통과한다(STD-API-04).

const TOKEN_BYTES = 32;

/** 하위 호출에 키·데드라인·추적 정보를 그대로 전파한다(IF §2.7-4). */
function callOpts(c: { deadlineAt: number; requestId: string; traceparent: string }): PeerCallOptions {
  return { deadlineAt: c.deadlineAt, requestId: c.requestId, traceparent: c.traceparent };
}

export function createCliHandlers(
  deps: ServiceDeps<null>,
  ctx: GatewayContext,
): {
  bootstrapToken(
    c: RouteContext<typeof CliBootstrapTokenRoute>,
  ): Promise<RouteReply<typeof CliBootstrapTokenRoute, 201>>;
  status(c: RouteContext<typeof CliStatusRoute>): Promise<RouteReply<typeof CliStatusRoute, 200>>;
  shutdown(c: RouteContext<typeof CliShutdownRoute>): Promise<RouteReply<typeof CliShutdownRoute, 202>>;
} {
  const ops = (): ReturnType<typeof requirePeer> => requirePeer(deps, 'ops-api');
  const profile = (): RuntimeProfile => ctx.opts.profileOverride ?? deps.profile;
  const port = (): number => {
    const p = ctx.listenPort();
    if (p === null) {
      throw new Error('invariant: gateway listen port unknown');
    }
    return p;
  };
  return {
    bootstrapToken(): Promise<RouteReply<typeof CliBootstrapTokenRoute, 201>> {
      const token = toBase64Url(ctx.randomBytes(TOKEN_BYTES));
      const expiresAt = ctx.tokens.issue(token, deps.clock.now());
      // `location` 헤더 없음 — 토큰은 리소스가 아니다(Brief 결정 §10 ⑦). 로그에 토큰 0.
      return Promise.resolve({
        status: 201,
        body: { bootstrap_token: token, expires_at: expiresAt, open_url: `http://127.0.0.1:${port()}/#bt=${token}` },
      });
    },
    async status(c): Promise<RouteReply<typeof CliStatusRoute, 200>> {
      const res = await ops().call(HealthBoardRoute, {}, callOpts(c));
      if (!res.ok) {
        throw peerFailureToAppError(res.error, c.log);
      }
      return {
        status: 200,
        body: {
          app_version: deps.appVersion,
          profile: profile(),
          url: `http://127.0.0.1:${port()}/`,
          health: res.value.body,
        },
      };
    },
    async shutdown(c): Promise<RouteReply<typeof CliShutdownRoute, 202>> {
      if (c.body.op_id !== c.idempotencyKey) {
        throw new AppError('GW-VAL-900', 400, '요청 본문이 스키마를 위반했다.', {
          extra: { errors: [{ path: 'op_id', message: 'Idempotency-Key와 같아야 합니다', rule: 'idem_key_mismatch' }] },
        });
      }
      const res = await ops().call(
        SystemShutdownRoute,
        { body: { op_id: c.body.op_id, grace_ms: c.body.grace_ms } },
        { ...callOpts(c), idempotencyKey: c.body.op_id },
      );
      if (!res.ok) {
        throw peerFailureToAppError(res.error, c.log);
      }
      return { status: 202, body: res.value.body, headers: { location: `/api/v1/cli/operations/${c.body.op_id}` } };
    },
  };
}
