import { request } from 'node:http';
import { SVC_CODE_OF } from '@fathom/contracts/common/errors';
import { CONTRACTS_HASH } from '@fathom/contracts/events/registry.gen';
import { TEST_CALLER_TOKENS } from '@fathom/testkit/contract';
import { fixedUlid } from '@fathom/testkit/ids';
import type { StackService } from '@fathom/testkit/spawn-stack';
import { APP_ROOT, migrateHome } from '@fathom/testkit/spawn-stack';
import { createTempHome } from '@fathom/testkit/temp-home';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isAlive, launchDirect } from '../support/direct-stack.js';

// SEC-SYS-010~018 — 인코딩된 경로·절대형 요청 대상으로 인증을 건너뛰는 우회(INT-1a 보안 에스컬레이션, T-00-12) 회귀 (NFR-SEC-002·003·019).
// 요청은 node:http로 원문 그대로 보낸다(fetch/URL은 경로를 정규화할 수 있다). 무토큰 기준.

const ALL: readonly StackService[] = ['gateway', 'content', 'learning', 'ai-gateway', 'ops-api'];
const INTERNAL: readonly StackService[] = ['content', 'learning', 'ai-gateway', 'ops-api'];

type Raw = { status: number; contentType: string; requestId: string; text: string; code: string };

function raw(
  port: number,
  method: string,
  target: string,
  headers: Record<string, string> = {},
  payload?: string,
): Promise<Raw> {
  return new Promise<Raw>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: target, method, headers, timeout: 15_000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let code = '';
        try {
          const body: unknown = JSON.parse(text);
          code =
            typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string'
              ? body.code
              : '';
        } catch {
          code = '';
        }
        resolve({
          status: res.statusCode ?? 0,
          contentType: String(res.headers['content-type'] ?? ''),
          requestId: String(res.headers['x-request-id'] ?? ''),
          text,
          code,
        });
      });
    });
    req.on('timeout', () => req.destroy(new Error(`timeout ${method} ${target}`)));
    req.on('error', reject);
    req.end(payload);
  });
}

let home: Awaited<ReturnType<typeof createTempHome>> | undefined;
let direct: Awaited<ReturnType<typeof launchDirect>> | undefined;
const pids: number[] = [];

function portOf(svc: StackService): number {
  const entry = direct?.services[svc];
  if (entry === undefined) {
    throw new Error(`${svc} not launched`);
  }
  return entry.port;
}

beforeAll(async () => {
  home = await createTempHome('fathom-sec-sys010-');
  await migrateHome({ appRoot: APP_ROOT, home: home.path, runtime: 'dist', egress: 'off' });
  direct = await launchDirect({
    home: home.path,
    runtime: 'dist',
    services: [...ALL],
    tokens: TEST_CALLER_TOKENS,
    cliToken: 'C'.repeat(43),
    contractsHash: CONTRACTS_HASH,
  });
  for (const svc of ALL) {
    pids.push(direct.services[svc]?.pid ?? 0);
  }
});

afterAll(async () => {
  await direct?.stop();
  await home?.cleanup();
  for (const pid of pids) {
    expect(isAlive(pid), `pid ${String(pid)} still alive`).toBe(false);
  }
});

describe('보안: 인코딩 경로·절대형 대상 인증 우회', () => {
  it('SEC-SYS-010~013 내부 서비스 4종에 인코딩된 /internal 경로(접두·%2F·비예약 문자)는 무토큰 404 NOTFOUND-900이고 metrics 내용이 없다 [NFR-SEC-003][NFR-SEC-019]', async () => {
    const targets = ['/%69nternal/v1/metrics', '/internal%2Fv1/metrics', '/internal/v1/%6detrics'];
    for (const svc of INTERNAL) {
      for (const target of targets) {
        const res = await raw(portOf(svc), 'GET', target);
        expect(res.status, `${svc} ${target}`).toBe(404);
        expect(res.code, `${svc} ${target}`).toBe(`${SVC_CODE_OF[svc]}-NOTFOUND-900`);
        expect(res.text, `${svc} ${target}`).not.toMatch(/fathom_|# HELP|# TYPE/);
      }
    }
  });

  it('SEC-SYS-014 gateway의 인코딩된 /api 경로는 404 GW-NOTFOUND-900이고 bootstrap_token이 없다 [NFR-SEC-002][NFR-SEC-019]', async () => {
    const port = portOf('gateway');
    const status = await raw(port, 'GET', '/%61pi/v1/cli/status');
    expect(status.status).toBe(404);
    expect(status.code).toBe('GW-NOTFOUND-900');
    const boot = await raw(port, 'POST', '/api/v1/%63li/bootstrap-token');
    expect(boot.status).toBe(404);
    expect(boot.code).toBe('GW-NOTFOUND-900');
    expect(boot.text).not.toContain('bootstrap_token');
  });

  it('SEC-SYS-015 절대형 요청 대상(absolute-form)은 5종 모두 404 NOTFOUND-900이다 [NFR-SEC-003]', async () => {
    for (const svc of ALL) {
      const port = portOf(svc);
      const path = svc === 'gateway' ? '/api/v1/cli/status' : '/internal/v1/metrics';
      const res = await raw(port, 'GET', `http://127.0.0.1:${String(port)}${path}`);
      expect(res.status, svc).toBe(404);
      expect(res.code, svc).toBe(`${SVC_CODE_OF[svc]}-NOTFOUND-900`);
    }
  });

  it('SEC-SYS-016 대조군: 정준 경로 무토큰은 401 AUTH-900(gateway는 GW-AUTH-007)이다 [NFR-SEC-003]', async () => {
    for (const svc of ALL) {
      const path = svc === 'gateway' ? '/api/v1/cli/status' : '/internal/v1/metrics';
      const res = await raw(portOf(svc), 'GET', path);
      expect(res.status, svc).toBe(401);
      expect(res.code, svc).toBe(svc === 'gateway' ? 'GW-AUTH-007' : `${SVC_CODE_OF[svc]}-AUTH-900`);
    }
  });

  it('SEC-SYS-017 잘못된 퍼센트 시퀀스(/internal/v1/%zz)는 5종 모두 400 problem+json VAL-900이다 [NFR-SEC-003][IF-COM-001]', async () => {
    for (const svc of ALL) {
      const res = await raw(portOf(svc), 'GET', '/internal/v1/%zz');
      expect(res.status, svc).toBe(400);
      expect(res.contentType, svc).toContain('application/problem+json');
      expect(res.code, svc).toBe(`${SVC_CODE_OF[svc]}-VAL-900`);
      expect(res.requestId, svc).not.toBe('');
    }
  });

  it('SEC-SYS-018 content: 인코딩 경로 무토큰 quiesce는 404이고 상태를 바꾸지 않아 정준 ops 토큰 quiesce가 이어서 200이다 [NFR-SEC-003][NFR-SEC-019]', async () => {
    const port = portOf('content');
    const json = (extra: Record<string, string>): Record<string, string> => ({
      'content-type': 'application/json',
      'x-request-id': fixedUlid(90),
      ...extra,
    });
    const bypass = await raw(
      port,
      'POST',
      '/%69nternal/v1/admin/quiesce',
      json({ 'idempotency-key': fixedUlid(91) }),
      JSON.stringify({ epoch_id: fixedUlid(92), ack_deadline_ms: 2000 }),
    );
    expect(bypass.status).toBe(404);
    expect(bypass.code).toBe('CT-NOTFOUND-900');
    const auth = { authorization: `Bearer ${TEST_CALLER_TOKENS['ops-api']}` };
    const quiesce = await raw(
      port,
      'POST',
      '/internal/v1/admin/quiesce',
      json({ ...auth, 'idempotency-key': fixedUlid(93) }),
      JSON.stringify({ epoch_id: fixedUlid(94), ack_deadline_ms: 2000 }),
    );
    try {
      expect(quiesce.status).toBe(200);
      expect(quiesce.text).toContain(fixedUlid(94));
    } finally {
      await raw(
        port,
        'POST',
        '/internal/v1/admin/resume',
        json({ ...auth, 'idempotency-key': fixedUlid(95) }),
        JSON.stringify({ epoch_id: fixedUlid(94), outcome: 'completed' }),
      );
    }
  });
});
