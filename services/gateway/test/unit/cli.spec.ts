import { mkdtempSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Problem } from '@fathom/contracts/common/problem';
import { CliStatus } from '@fathom/contracts/http/gateway/v1/cli';
import { ActivityView } from '@fathom/contracts/http/gateway/v1/internal';
import { BootstrapTokenResponse } from '@fathom/contracts/http/gateway/v1/session';
import { Operation } from '@fathom/contracts/http/ops/v1/operations';
import { err } from '@fathom/shared-kernel/errors/errors';
import type { PeerFailure } from '@fathom/shared-kernel/http-client/http-client';
import { createLogger } from '@fathom/shared-kernel/log/log';
import { fixedUlid } from '@fathom/testkit/ids';
import { afterEach, describe, expect, it } from 'vitest';
import { GATEWAY_ERROR_REGISTRY } from '../../src/infra/peers/error-registry.js';
import { peerFailureToAppError } from '../../src/infra/peers/failure.js';
import { openSse } from './sse.js';
import type { Rig } from './support.js';
import { APP_VERSION, CLI_TOKEN, CONTENT_AUTH, HOST, healthBoard, makeRig, nextKey, OPS_AUTH } from './support.js';

const rigs: Rig[] = [];
afterEach(async () => {
  for (const r of rigs.splice(0)) {
    await r.close();
  }
});
async function rig(o: Parameters<typeof makeRig>[0] = {}): Promise<Rig> {
  const r = await makeRig(o);
  rigs.push(r);
  return r;
}
const cli = (extra: Record<string, string> = {}): Record<string, string> => ({
  authorization: `Bearer ${CLI_TOKEN}`,
  ...extra,
});
const problem = (body: string): Problem => Problem.parse(JSON.parse(body));

describe('CLI 부트스트랩 토큰 · CLI 토큰', () => {
  it('UT-GW-102 bootstrap-token: 201 BootstrapTokenResponse, open_url = http://127.0.0.1:4747/#bt=<token>, expires_at = now + 60000, 로그에 토큰 0 [NFR-SEC-019][IF-GW-001]', async () => {
    // Arrange
    const r = await rig();
    // Act
    const res = await r.inject('POST', '/api/v1/cli/bootstrap-token', {
      headers: cli({ 'idempotency-key': nextKey() }),
      body: { purpose: 'up' },
    });
    // Assert
    expect(res.status).toBe(201);
    const body = BootstrapTokenResponse.parse(res.json());
    expect(body.open_url).toBe(`http://127.0.0.1:4747/#bt=${body.bootstrap_token}`);
    expect(body.expires_at).toBe(r.clock.now() + 60_000);
    expect(res.headers.location).toBeUndefined();
    expect(r.logs.join('')).not.toContain(body.bootstrap_token);
  });

  it('UT-GW-103 CLI 토큰: 파일 없음 → 401 GW-AUTH-007 → 파일 생성 후 같은 앱에서 200(지연 읽기), 형식 오류 파일 → 401 [NFR-SEC-019][IF-GW-001]', async () => {
    // Arrange
    const r = await rig({ cliToken: null });
    const call = (): ReturnType<Rig['inject']> => r.inject('GET', '/api/v1/cli/status', { headers: cli() });
    // Act / Assert
    const missing = await call();
    expect(missing.status).toBe(401);
    expect(problem(missing.body).code).toBe('GW-AUTH-007');
    const file = path.join(r.home.path, 'run', 'cli.token');
    writeFileSync(file, 'too-short\n');
    expect((await call()).status).toBe(401);
    writeFileSync(file, `${CLI_TOKEN}\n`);
    expect((await call()).status).toBe(200);
  });
});

describe('CLI status · shutdown (하위 ops-api 통과)', () => {
  it('UT-GW-104 status: fake ops HealthBoard → 200 CliStatus(url), connect_failed → 503 GW-DEP-001 + dependency + retry-after: 1, ops Problem → 같은 코드·상태 [FR-SET-015][IF-GW-180]', async () => {
    // Arrange
    const r = await rig();
    // Act
    const ok = await r.inject('GET', '/api/v1/cli/status', { headers: cli() });
    // Assert
    expect(ok.status).toBe(200);
    expect(CliStatus.parse(ok.json())).toEqual({
      app_version: APP_VERSION,
      profile: 'test',
      url: 'http://127.0.0.1:4747/',
      health: healthBoard(),
    });
    // connect_failed
    const down = await rig({
      handlers: { 'ops.health.board': () => err<PeerFailure>({ kind: 'connect_failed', dependency: 'ops-api' }) },
    });
    const unavailable = await down.inject('GET', '/api/v1/cli/status', { headers: cli() });
    expect(unavailable.status).toBe(503);
    expect(problem(unavailable.body)).toMatchObject({ code: 'GW-DEP-001', dependency: 'ops-api' });
    expect(unavailable.headers['retry-after']).toBe('1');
    // 하위 Problem 통과
    const notFound = await rig({
      handlers: {
        'ops.health.board': () =>
          err<PeerFailure>({
            kind: 'problem',
            dependency: 'ops-api',
            status: 404,
            problem: {
              type: 'urn:fathom:problem:op-notfound-900',
              title: '정의되지 않은 라우트',
              status: 404,
              code: 'OP-NOTFOUND-900',
              error_id: fixedUlid(1),
              request_id: fixedUlid(2),
              retryable: false,
            },
          }),
      },
    });
    const passthrough = await notFound.inject('GET', '/api/v1/cli/status', { headers: cli() });
    expect(passthrough.status).toBe(404);
    expect(problem(passthrough.body).code).toBe('OP-NOTFOUND-900');
  });

  it('UT-GW-105 shutdown: 하위 Idempotency-Key = 헤더 키 = op_id, 202 Operation + location, op_id ≠ 키 → 400 GW-VAL-900(idem_key_mismatch), 키 없음 → 400 GW-VAL-901 [FR-SET-015][IF-GW-181]', async () => {
    // Arrange
    const r = await rig();
    const opId = fixedUlid(321);
    // Act
    const res = await r.inject('POST', '/api/v1/cli/shutdown', {
      headers: cli({ 'idempotency-key': opId }),
      body: { op_id: opId, grace_ms: 500 },
    });
    // Assert
    expect(res.status).toBe(202);
    expect(Operation.parse(res.json()).op_id).toBe(opId);
    expect(res.headers.location).toBe(`/api/v1/cli/operations/${opId}`);
    const call = r.ops.calls.find((c) => c.route_id === 'ops.system.shutdown');
    expect(call?.idempotency_key).toBe(opId);
    expect(call?.input.body).toEqual({ op_id: opId, grace_ms: 500 });
    const mismatch = await r.inject('POST', '/api/v1/cli/shutdown', {
      headers: cli({ 'idempotency-key': nextKey() }),
      body: { op_id: opId, grace_ms: 500 },
    });
    expect(mismatch.status).toBe(400);
    expect(problem(mismatch.body)).toMatchObject({
      code: 'GW-VAL-900',
      errors: [{ path: 'op_id', message: 'Idempotency-Key와 같아야 합니다', rule: 'idem_key_mismatch' }],
    });
    const noKey = await r.inject('POST', '/api/v1/cli/shutdown', {
      headers: cli(),
      body: { op_id: opId, grace_ms: 500 },
    });
    expect(noKey.status).toBe(400);
    expect(problem(noKey.body).code).toBe('GW-VAL-901');
  });

  it('UT-GW-106 데드라인·요청 ID 전파: /api 경로는 x-fathom-deadline-ms를 무시하고 서버가 정한 2,000ms를 쓴다 → FakeCall.deadline_header_ms = 1990 [FR-SET-015][IF-GW-180]', async () => {
    // Arrange (T-00-08 파이프라인: 공개 요청의 데드라인은 서버가 정한다 — Brief UT-GW-106의 1490과 다름, deviations[] 참조)
    const r = await rig();
    // Act
    const res = await r.inject('GET', '/api/v1/cli/status', { headers: cli({ 'x-fathom-deadline-ms': '1500' }) });
    // Assert
    expect(res.status).toBe(200);
    const call = r.ops.calls.find((c) => c.route_id === 'ops.health.board');
    expect(call?.deadline_header_ms).toBe(1990);
    expect(call?.request_id).toBe(String(res.headers['x-request-id']));
  });
});

describe('피어 오류 매핑 · 레지스트리', () => {
  it('UT-GW-107 peerFailureToAppError 5종 매핑(timeout → 504 GW-DEP-902, contract_violation → 500 GW-INTERNAL-900 + error 로그) [STD-API-04][FR-SET-015]', () => {
    // Arrange
    const lines: string[] = [];
    const log = createLogger('gateway', {
      level: 'info',
      bootId: null,
      clock: { now: () => 1 },
      destination: { write: (c) => void lines.push(c) },
    });
    const dep = 'ops-api' as const;
    // Act / Assert
    for (const kind of ['connect_failed', 'connect_timeout', 'circuit_open'] as const) {
      expect(peerFailureToAppError({ kind, dependency: dep })).toMatchObject({
        code: 'GW-DEP-001',
        status: 503,
        extra: { dependency: dep },
      });
    }
    for (const kind of ['timeout', 'deadline_exhausted'] as const) {
      expect(peerFailureToAppError({ kind, dependency: dep })).toMatchObject({ code: 'GW-DEP-902', status: 504 });
    }
    const violation = peerFailureToAppError(
      { kind: 'contract_violation', dependency: dep, status: 200, detail: 'secret detail' },
      log,
    );
    expect(violation).toMatchObject({ code: 'GW-INTERNAL-900', status: 500 });
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      level: 'error',
      event: 'gateway.peer.contract_violation',
      dependency: dep,
      status: 200,
    });
    expect(lines.join('')).not.toContain('secret detail');
    const passed = peerFailureToAppError({
      kind: 'problem',
      dependency: 'content',
      status: 409,
      problem: {
        type: 'urn:fathom:problem:ct-conflict-013',
        title: 'x',
        status: 409,
        code: 'CT-CONFLICT-013',
        error_id: fixedUlid(1),
        request_id: fixedUlid(2),
        retryable: false,
        retry_after_ms: 200,
      },
    });
    expect(passed).toMatchObject({ code: 'CT-CONFLICT-013', status: 409, extra: { retry_after_ms: 200 } });
  });

  it('UT-GW-108 GATEWAY_ERROR_REGISTRY에 CT-NOTFOUND-900·LR-CONFLICT-011·OP-DEP-001·AI-POLICY-001 존재, 키 충돌 0 [STD-API-04][FR-SET-015]', () => {
    for (const code of [
      'CT-NOTFOUND-900',
      'LR-CONFLICT-011',
      'OP-DEP-001',
      'AI-POLICY-001',
      'GW-AUTH-005',
      'AI-VAL-900',
    ]) {
      expect(GATEWAY_ERROR_REGISTRY[code], code).toBeDefined();
    }
    expect(GATEWAY_ERROR_REGISTRY['CT-NOTFOUND-900']?.status).toBe(404);
  });
});

describe('등록 라우트 · 활동', () => {
  it('UT-GW-109 registeredRoutes() = 공통 + IF-GW-001~006·180·181·199의 9개 + 정적 `/`·`/*` — 그 밖 /api/v1/* 0개 [NFR-MAINT-001]', async () => {
    // Arrange
    const r = await rig({ webRoot: mkdtempSync(path.join(tmpdir(), 'gw-web-')) });
    // Act
    const routes = r.app
      .registeredRoutes()
      .map((x) => `${x.method} ${x.url}`)
      .sort();
    // Assert
    const api = routes.filter((x) => x.includes('/api/v1/'));
    expect(api).toEqual(
      [
        'POST /api/v1/cli/bootstrap-token',
        'GET /api/v1/cli/status',
        'POST /api/v1/cli/shutdown',
        'POST /api/v1/session/exchange',
        'GET /api/v1/session/csrf',
        'POST /api/v1/session/logout',
        'GET /api/v1/session',
        'GET /api/v1/stream',
      ].sort(),
    );
    expect(routes).toContain('GET /internal/v1/activity');
    expect(routes).toContain('GET /');
    expect(routes).toContain('GET /*');
    expect(routes).toEqual(
      expect.arrayContaining([
        'GET /healthz',
        'GET /readyz',
        'GET /internal/v1/metrics',
        'POST /internal/v1/inbox',
        'POST /internal/v1/admin/shutdown',
      ]),
    );
    // 공통 5 + GW 9 + 정적 2 = 16
    expect(routes).toHaveLength(16);
  });

  it('UT-GW-028 활동: 브라우저 POST·GET이 last_user_activity_at 갱신, CLI 요청·SSE 연결은 미갱신, idle_ms = now − last [FR-AI-010]', async () => {
    // Arrange
    const r = await rig();
    const view = async (): Promise<ActivityView> =>
      ActivityView.parse((await r.inject('GET', '/internal/v1/activity', { headers: OPS_AUTH })).json());
    const s = await r.login();
    const loginAt = r.clock.now();
    r.clock.advance(5000);
    // Act: CLI 요청은 활동이 아니다
    await r.inject('GET', '/api/v1/cli/status', { headers: cli() });
    // Assert
    expect(await view()).toEqual({ last_user_activity_at: loginAt, idle_ms: 5000, active_streams: 0 });
    // 브라우저 GET
    await r.inject('GET', '/api/v1/session', { headers: s.headers() });
    expect((await view()).last_user_activity_at).toBe(r.clock.now());
    // 브라우저 POST
    r.clock.advance(1000);
    await r.inject('POST', '/api/v1/session/logout', { headers: s.mutate() });
    expect(await view()).toEqual({ last_user_activity_at: r.clock.now(), idle_ms: 0, active_streams: 0 });
    r.clock.advance(250);
    expect((await view()).idle_ms).toBe(250);
    // SSE 연결(⑧ 예외: STREAM_PATH)은 활동이 아니다 — last_user_activity_at 불변, idle_ms는 계속 자란다
    const lastBefore = (await view()).last_user_activity_at;
    await r.app.fastify.listen({ host: '127.0.0.1', port: 0 });
    const port = (r.app.fastify.server.address() as AddressInfo).port;
    r.clock.advance(4000);
    const sse = await openSse(port, { host: HOST, ...s.headers() });
    expect(sse.kind).toBe('stream');
    if (sse.kind === 'stream') {
      await sse.conn.waitFor('event: hello');
    }
    const afterStream = await view();
    expect(afterStream.last_user_activity_at).toBe(lastBefore);
    expect(afterStream.idle_ms).toBe(4250);
    expect(afterStream.active_streams).toBe(1);
    if (sse.kind === 'stream') {
      sse.conn.close();
    }
  });

  it('UT-GW-029 /internal/v1/activity: ops-api 토큰 200 ActivityView, content 토큰 403, 토큰 없음 401 [FR-AI-010][IF-GW-199]', async () => {
    const r = await rig();
    expect((await r.inject('GET', '/internal/v1/activity', { headers: OPS_AUTH })).status).toBe(200);
    const content = await r.inject('GET', '/internal/v1/activity', { headers: CONTENT_AUTH });
    expect(content.status).toBe(403);
    expect(problem(content.body).code).toBe('GW-ACL-900');
    const none = await r.inject('GET', '/internal/v1/activity');
    expect(none.status).toBe(401);
    expect(problem(none.body).code).toBe('GW-AUTH-900');
  });
});
