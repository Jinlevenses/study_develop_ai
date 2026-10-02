import { describe, expect, it } from 'vitest';
import { launchStack, stackFailureOf } from '../../../src/spawn-stack.js';
import type { Fake } from './fake-deps.js';
import { createFake, HOME, LOCK_PATH, SERVICES, SUP_PID, TOKEN, TOKEN_PATH } from './fake-deps.js';

const EGRESS_DIR = `${HOME}/tmp/egress`;

async function launched(fake: Fake): ReturnType<typeof launchStack> {
  return await launchStack({ runtime: 'src', home: HOME, egress: 'off', migrate: false }, fake.deps);
}

describe('spawn-stack stop·관측·부트스트랩', () => {
  it('UT-TK-059 stop은 관측을 down 전에 읽고 pid 사망·lock 부재까지 폴링하며 15s 초과 시 강제 종료한다 [FR-SET-001][NFR-AVL-003]', async () => {
    // Arrange
    const fake = createFake();
    fake.files.set(`${EGRESS_DIR}/1.jsonl`, '{"kind":"connect","target":"1.1.1.1:443"}\n');
    fake.files.set(`${HOME}/logs/gateway/a.jsonl`, '{"msg":"x"}\n');
    const stack = await launched(fake);
    fake.onSpawn = (call) => {
      if (call.args.includes('down')) {
        fake.onSleep = (n) => {
          if (n === 2) {
            fake.alive.clear();
            fake.files.delete(LOCK_PATH);
          }
        };
      }
      return null;
    };
    // Act
    const first = stack.stop();
    const second = stack.stop();
    const report = await first;
    // Assert
    expect(second).toBe(first);
    const downCall = fake.calls.find((c) => c.args.includes('down'));
    expect(downCall?.args.slice(-2)).toEqual(['down', '--profile=test']);
    const downAt = fake.log.indexOf('spawn:down');
    const firstRead = fake.log.findIndex((l) => l.startsWith('read:'));
    const removeAt = fake.log.indexOf(`remove:${EGRESS_DIR}`);
    expect(firstRead).toBeGreaterThanOrEqual(0);
    expect(firstRead).toBeLessThan(downAt);
    expect(removeAt).toBeGreaterThan(downAt);
    expect(fake.log.lastIndexOf(`read:${EGRESS_DIR}/1.jsonl`)).toBeLessThan(removeAt);
    expect(report.forced).toBe(false);
    expect(report.egress.records).toHaveLength(1);
    expect(fake.signals).toHaveLength(0);
    // 15s 초과 → 강제
    const stuck = createFake();
    const stuckStack = await launched(stuck);
    stuck.onSignal = (pid) => {
      stuck.alive.delete(pid);
    };
    const forced = await stuckStack.stop();
    expect(forced.forced).toBe(true);
    expect(stuck.signals.some(([pid, sig]) => pid === SUP_PID && sig === 'SIGKILL')).toBe(true);
    expect(stuck.signals.filter(([, sig]) => sig === 'SIGKILL').length).toBe(1 + SERVICES.length);
    // 강제 후에도 서비스가 남으면 stop_failed
    const zombie = createFake();
    const zombieStack = await launched(zombie);
    const failure = stackFailureOf(await zombieStack.stop().catch((e: unknown) => e));
    expect(failure?.code).toBe('stop_failed');
  });

  it('UT-TK-060 egressRecords·serviceLogs는 유효·깨진 줄과 원문 경고 줄을 분류한다 [NFR-PORT-002][NFR-AVL-001]', async () => {
    // Arrange
    const fake = createFake();
    const stack = await launched(fake);
    expect(await stack.egressRecords()).toEqual({ files: 0, records: [], invalidLines: 0 });
    fake.files.set(
      `${EGRESS_DIR}/7.jsonl`,
      `${JSON.stringify({ kind: 'connect', target: 'a:1', blocked: false })}\n${JSON.stringify({ kind: 'dns', target: 'b' })}\n{broken\n`,
    );
    fake.files.set(
      `${HOME}/logs/content/d.jsonl`,
      [
        JSON.stringify({ level: 'info', msg: 'ok' }),
        JSON.stringify({ raw: 'plain stdout line' }),
        '(node:1) ExperimentalWarning: SQLite is an experimental feature',
        'not json at all',
      ].join('\n'),
    );
    // Act
    const egress = await stack.egressRecords();
    const logs = await stack.serviceLogs();
    // Assert
    expect(egress.files).toBe(1);
    expect(egress.records).toHaveLength(2);
    expect(egress.invalidLines).toBe(1);
    expect(logs.files).toBe(1);
    expect(logs.bySvc).toEqual({ content: 2 });
    expect(logs.rawRecords).toEqual([{ svc: 'content', raw: 'plain stdout line' }]);
    expect(logs.invalidJson).toBe(2);
    expect(logs.warningLines).toHaveLength(1);
    expect(logs.warningLines[0]).toContain('ExperimentalWarning');
  });

  it('UT-TK-061 bootstrapOpenUrl은 IF-GW-001 요청을 보내고 실패 detail에 토큰·URL을 싣지 않는다 [NFR-SEC-019][IF-GW-001]', async () => {
    // Arrange
    const fake = createFake();
    const stack = await launched(fake);
    const bt = 'B'.repeat(43);
    const openUrl = `http://127.0.0.1:5001/#bt=${bt}`;
    fake.fetchResponse = () =>
      new Response(JSON.stringify({ bootstrap_token: bt, expires_at: 1, open_url: openUrl }), { status: 201 });
    // Act
    const first = await stack.bootstrapOpenUrl();
    const second = await stack.bootstrapOpenUrl();
    // Assert
    expect(first).toBe(openUrl);
    expect(second).toBe(openUrl);
    const [a, b] = fake.fetchCalls;
    expect(a?.url).toBe('http://127.0.0.1:5001/api/v1/cli/bootstrap-token');
    expect(a?.init.method).toBe('POST');
    expect(a?.init.body).toBe('{"purpose":"open"}');
    const headers = a?.init.headers;
    expect(headers).toMatchObject({
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json; charset=utf-8',
      accept: 'application/json',
      'x-fathom-client': 'cli/0.0.0',
    });
    const keyA = a?.init.headers && 'idempotency-key' in a.init.headers ? a.init.headers['idempotency-key'] : '';
    const keyB = b?.init.headers && 'idempotency-key' in b.init.headers ? b.init.headers['idempotency-key'] : '';
    expect(keyA).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(keyB).not.toBe(keyA);
    // 400 problem
    fake.fetchResponse = () => new Response(JSON.stringify({ code: 'GW-VAL-901', title: 'x' }), { status: 400 });
    const bad = stackFailureOf(await stack.bootstrapOpenUrl().catch((e: unknown) => e));
    expect(bad?.code).toBe('bootstrap_failed');
    expect(bad?.detail).toContain('400');
    expect(bad?.detail).toContain('GW-VAL-901');
    expect(bad?.detail).not.toContain(TOKEN);
    // 형식 위반 open_url
    fake.fetchResponse = () =>
      new Response(JSON.stringify({ open_url: `http://evil.test/#bt=${bt}` }), { status: 201 });
    const malformed = stackFailureOf(await stack.bootstrapOpenUrl().catch((e: unknown) => e));
    expect(malformed?.code).toBe('bootstrap_failed');
    expect(malformed?.detail).not.toContain(bt);
    expect(fake.files.get(TOKEN_PATH)).toContain(TOKEN);
  });
});
