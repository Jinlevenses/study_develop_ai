import { COMMON_ERRORS } from '@fathom/contracts/common/errors';
import { Problem } from '@fathom/contracts/common/problem';
import { fixedUlid } from '@fathom/testkit/ids';
import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '../../../src/errors/errors.js';
import { isUlid } from '../../../src/ids/ids.js';
import { appErrorCode, buildErrorRegistry, isHygienic, toProblem } from '../../../src/service/problem.js';
import { fixtureDef, ThrowRoute } from './routes.js';
import type { Rig } from './support.js';
import { defOf, GATEWAY, rigOf } from './support.js';

const rigs: Rig[] = [];
afterEach(async () => {
  for (const r of rigs.splice(0)) {
    await r.close();
  }
});

const ctx = (over: Partial<Parameters<typeof toProblem>[1]> = {}): Parameters<typeof toProblem>[1] => ({
  svc: 'content',
  requestId: fixedUlid(1),
  instance: '/internal/v1/x?secret=1',
  registry: buildErrorRegistry('content', undefined),
  newId: () => fixedUlid(2),
  ...over,
});

describe('toProblem', () => {
  it('UT-SK-009 핸들러가 경로·SQL·스택을 담은 Error → 500 INTERNAL-900, 본문에 `    at `·/home/·C:\\·SELECT 0, error_id = 같은 error 로그의 error_id [NFR-SEC-012]', async () => {
    // Arrange
    const rig = await rigOf(fixtureDef(defOf('content')));
    rigs.push(rig);
    // Act
    const res = await rig.app.fastify.inject({ method: 'GET', url: '/internal/v1/test/throw/crash', headers: GATEWAY });
    // Assert
    expect(res.statusCode).toBe(500);
    const body = Problem.parse(JSON.parse(res.body));
    expect(body.code).toBe('CT-INTERNAL-900');
    expect(res.body).not.toContain('    at ');
    expect(res.body).not.toContain('/home/');
    expect(res.body).not.toContain('C:\\\\');
    expect(res.body).not.toContain('SELECT ');
    expect(body.detail).toBeUndefined();
    expect(isUlid(body.error_id)).toBe(true);
    const errors = rig.cap.lines().filter((l) => l.event === 'http.error' && l.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.error_id).toBe(body.error_id);
    expect(errors[0]?.code).toBe('CT-INTERNAL-900');
    expect(JSON.stringify(errors[0])).toContain('SELECT'); // 상세는 로그에만 있다
  });

  it('UT-SK-009 AppError detail에 경로가 있으면 detail을 뺀다·4xx는 info(스택 0)·미등록 코드는 결함 [NFR-SEC-012]', async () => {
    // Arrange
    const rig = await rigOf(fixtureDef(defOf('content')));
    rigs.push(rig);
    // Act
    const dirty = await rig.app.fastify.inject({
      method: 'GET',
      url: '/internal/v1/test/throw/app4xx',
      headers: GATEWAY,
    });
    const clean = await rig.app.fastify.inject({
      method: 'GET',
      url: '/internal/v1/test/throw/plain',
      headers: GATEWAY,
    });
    const unregistered = await rig.app.fastify.inject({
      method: 'GET',
      url: '/internal/v1/test/throw/unregistered',
      headers: GATEWAY,
    });
    // Assert
    expect(dirty.statusCode).toBe(404);
    expect(Problem.parse(JSON.parse(dirty.body)).detail).toBeUndefined();
    expect(Problem.parse(JSON.parse(dirty.body)).title).toBe(COMMON_ERRORS['NOTFOUND-900'].title);
    expect(Problem.parse(JSON.parse(clean.body)).detail).toBe('값이 이상하다');
    expect(unregistered.statusCode).toBe(500);
    expect(Problem.parse(JSON.parse(unregistered.body)).code).toBe('CT-INTERNAL-900');
    const lines = rig.cap.lines().filter((l) => l.event === 'http.error');
    expect(lines.map((l) => l.level)).toEqual(['info', 'info', 'error']);
    expect(lines[2]?.msg).toBe('invariant: unregistered error code');
    expect(lines[0]?.err).not.toHaveProperty('stack');
    expect(lines[2]?.err).toHaveProperty('stack');
    expect(ThrowRoute.id).toBe('content.test.throw');
  });

  it('본문은 레지스트리 제목·retryable·extras·instance(쿼리 제거)를 담고 Problem 계약을 통과한다 [IF-COM-001]', () => {
    // Arrange
    const e = new AppError('CT-CONFLICT-002', 409, '처리 중', { extra: { retry_after_ms: 200 } });
    // Act
    const p = toProblem(e, ctx());
    // Assert
    expect(p.status).toBe(409);
    expect(p.level).toBe('info');
    expect(p.logStack).toBe(false);
    expect(Problem.safeParse(p.body).success).toBe(true);
    expect(p.body).toMatchObject({
      type: 'urn:fathom:problem:ct-conflict-002',
      title: COMMON_ERRORS['CONFLICT-002'].title,
      retryable: true,
      retry_after_ms: 200,
      instance: '/internal/v1/x',
      error_id: fixedUlid(2),
      request_id: fixedUlid(1),
    });
    // 같은 코드라도 상태가 레지스트리와 다르면 결함
    expect(toProblem(new AppError('CT-CONFLICT-002', 400), ctx()).body.code).toBe('CT-INTERNAL-900');
    // 서비스 고유 코드는 def.errors로 추가된다
    const registry = buildErrorRegistry('content', {
      'CT-NOTFOUND-001': { status: 404, title: '문항 없음', retryable: false },
    });
    expect(toProblem(new AppError('CT-NOTFOUND-001', 404), ctx({ registry })).body).toMatchObject({
      code: 'CT-NOTFOUND-001',
      title: '문항 없음',
    });
    // errors[].message 위생
    const bad = new AppError('CT-VAL-900', 400, undefined, {
      extra: {
        errors: [
          { path: 'a', message: 'at /home/x/y', rule: 'r' },
          { path: 'b', message: 'fine', rule: 'r' },
        ],
      },
    });
    expect(toProblem(bad, ctx()).body.errors?.map((x) => x.message)).toEqual(['invalid', 'fine']);
    // 5xx = error + stack, 401/403 = warn
    expect(toProblem(new AppError('CT-INTERNAL-900', 500), ctx())).toMatchObject({ level: 'error', logStack: true });
    expect(toProblem(new AppError('CT-AUTH-900', 401), ctx()).level).toBe('warn');
    expect(appErrorCode('learning', 'DEP-910')).toBe('LR-DEP-910');
  });

  it('위생 검사: 스택·절대 경로·SQL(대소문자 구분)을 걸러낸다 [NFR-SEC-012]', () => {
    expect(isHygienic('사용자 입력이 잘못됐다')).toBe(true);
    expect(isHygienic('select 하나')).toBe(true);
    expect(isHygienic('failed\n    at fn (x.ts:1:1)')).toBe(false);
    expect(isHygienic('file /home/u/x')).toBe(false);
    expect(isHygienic("path 'C:\\Users\\x'")).toBe(false);
    expect(isHygienic('SELECT * FROM t')).toBe(false);
    expect(isHygienic('DELETE FROM t')).toBe(false);
  });
});
