import { SVC_CODE_OF } from '@fathom/contracts/common/errors';
import { CONTRACTS_HASH } from '@fathom/contracts/events/registry.gen';
import { TEST_CALLER_TOKENS } from '@fathom/testkit/contract';
import type { StackService } from '@fathom/testkit/spawn-stack';
import { APP_ROOT, launchStack, migrateHome } from '@fathom/testkit/spawn-stack';
import { createTempHome } from '@fathom/testkit/temp-home';
import { describe, expect, it } from 'vitest';
import { isAlive, launchDirect } from '../support/direct-stack.js';

// SEC-GW-006 — 내부 서비스 호출 인증(Bearer 64 hex)과 호출자 ACL (NFR-SEC-003, IF-01 §2.11).

const SERVICES: readonly StackService[] = ['gateway', 'content', 'learning', 'ai-gateway', 'ops-api'];
const SEEDED_HEX = 'ab'.repeat(32);

async function get(base: string, route: string, bearer: string | null): Promise<{ status: number; code: string }> {
  const headers: Record<string, string> = { accept: '*/*' };
  if (bearer !== null) {
    headers.authorization = bearer;
  }
  const res = await fetch(new URL(route, base), { headers, signal: AbortSignal.timeout(10_000) });
  const text = await res.text();
  let code = '';
  try {
    const body: unknown = JSON.parse(text);
    code =
      typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string' ? body.code : '';
  } catch {
    code = '';
  }
  return { status: res.status, code };
}

describe('보안: 내부 호출 인증', () => {
  it('SEC-GW-006 토큰 없음·무효 토큰은 401이고 허용 목록 밖 호출자는 403이다 [NFR-SEC-003]', async () => {
    const pids: number[] = [];
    // ① 실제 스택(dist): 포트 5개 모두 무인증 metrics는 401, healthz는 무인증 200(대조군)
    const stackHome = await createTempHome('fathom-sec006a-');
    try {
      const stack = await launchStack({ runtime: 'dist', home: stackHome.path });
      try {
        const registry = await stack.registry();
        for (const svc of SERVICES) {
          const entry = registry.services[svc];
          if (entry?.pid === null || entry === undefined || entry.pid === undefined) {
            throw new Error(`${svc} not running`);
          }
          pids.push(entry.pid);
          const base = `http://127.0.0.1:${String(entry.port)}`;
          const prefix = SVC_CODE_OF[svc];
          expect(await get(base, '/internal/v1/metrics', null), `${svc} no token`).toEqual({
            status: 401,
            code: `${prefix}-AUTH-900`,
          });
          expect((await get(base, '/internal/v1/metrics', `Bearer ${SEEDED_HEX}`)).status, `${svc} seeded`).toBe(401);
          expect((await get(base, '/internal/v1/metrics', 'Bearer x')).status, `${svc} malformed`).toBe(401);
          expect((await get(base, '/healthz', null)).status, `${svc} healthz`).toBe(200);
        }
      } finally {
        await stack.stop();
      }
    } finally {
      await stackHome.cleanup();
    }

    // ② 직접 기동(dist, 알려진 토큰): content metrics — learning 토큰 403, ops-api 토큰 200(대조군)
    const directHome = await createTempHome('fathom-sec006b-');
    try {
      await migrateHome({ appRoot: APP_ROOT, home: directHome.path, runtime: 'dist', egress: 'off' });
      const direct = await launchDirect({
        home: directHome.path,
        runtime: 'dist',
        services: ['content'],
        tokens: TEST_CALLER_TOKENS,
        cliToken: 'C'.repeat(43),
        contractsHash: CONTRACTS_HASH,
      });
      try {
        const content = direct.services.content;
        if (content === undefined) {
          throw new Error('content not launched');
        }
        pids.push(content.pid);
        const asLearning = await get(content.baseUrl, '/internal/v1/metrics', `Bearer ${TEST_CALLER_TOKENS.learning}`);
        expect(asLearning).toEqual({ status: 403, code: 'CT-ACL-900' });
        const asOps = await get(content.baseUrl, '/internal/v1/metrics', `Bearer ${TEST_CALLER_TOKENS['ops-api']}`);
        expect(asOps.status).toBe(200);
      } finally {
        await direct.stop();
      }
    } finally {
      await directHome.cleanup();
    }
    for (const pid of pids) {
      expect(isAlive(pid), `pid ${String(pid)} still alive`).toBe(false);
    }
  });
});
