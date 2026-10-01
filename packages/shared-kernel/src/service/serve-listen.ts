import type { Logger } from '@fathom/shared-kernel/log/log';
import type { FastifyInstance } from 'fastify';
import { LISTEN_HOST } from './serve-boot.js';
import type { Step } from './serve-types.js';
import { stepFail, stepOk } from './serve-types.js';

// §4.3.3 listen — 후보 = [봉투 포트, ...폴백, 0]. `EADDRINUSE`면 다음 후보, 다른 오류 = 70. host 인자는 상수 `LISTEN_HOST`뿐이다.

function errnoCode(e: unknown): string | null {
  return typeof e === 'object' && e !== null && 'code' in e && typeof e.code === 'string' ? e.code : null;
}

export async function listenOnLoopback(
  fastify: FastifyInstance,
  candidates: readonly number[],
  log: Logger,
): Promise<Step<number>> {
  let bound = false;
  for (const candidate of new Set(candidates)) {
    try {
      await fastify.listen({ host: LISTEN_HOST, port: candidate });
      bound = true;
      break;
    } catch (e) {
      if (errnoCode(e) !== 'EADDRINUSE') {
        log.error({ event: 'listen.failed', err: e }, 'listen failed');
        return stepFail(70, 'listen_failed');
      }
    }
  }
  const address = fastify.server.address();
  if (!bound || typeof address !== 'object' || address === null) {
    return stepFail(70, 'listen_failed');
  }
  return address.address === LISTEN_HOST ? stepOk(address.port) : stepFail(78, 'listen_host_forbidden');
}
