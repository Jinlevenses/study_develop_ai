import { createFakeClock, FIXED_EPOCH_MS } from '@fathom/testkit/clock';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/errors/errors.js';
import type { LoggerOptions } from '../../../src/log/log.js';
import { createLogger, REDACT_PATHS } from '../../../src/log/log.js';

const BOOT = '01HZX3Y5K7M9N2P4Q6R8S0T1V2';

function harness(over: Partial<LoggerOptions> = {}): {
  lines: string[];
  parsed: () => Record<string, unknown>[];
  logger: ReturnType<typeof createLogger>;
  clock: ReturnType<typeof createFakeClock>;
} {
  const lines: string[] = [];
  const clock = createFakeClock();
  const logger = createLogger('learning', {
    level: 'debug',
    bootId: BOOT,
    clock,
    destination: { write: (chunk: string): void => void lines.push(chunk) },
    ...over,
  });
  return { lines, parsed: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>), logger, clock };
}

describe('log', () => {
  it('UT-SK-057 한 줄 JSON에 필수 필드(ts·level·svc·req_id·msg·boot_id·pid)가 있다 [NFR-AVL-006]', () => {
    // Arrange
    const { logger, lines, parsed, clock } = harness();
    // Act
    logger.info({ event: 'svc.ready' }, 'service ready');
    clock.advance(7);
    logger.warn('later');
    // Assert
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line.endsWith('\n')).toBe(true);
      expect(line.trimEnd()).not.toContain('\n');
    }
    const [first, second] = parsed();
    expect(first).toMatchObject({
      ts: FIXED_EPOCH_MS,
      level: 'info',
      svc: 'learning',
      req_id: null,
      msg: 'service ready',
      boot_id: BOOT,
      pid: process.pid,
      event: 'svc.ready',
    });
    expect(Number.isInteger(first?.ts)).toBe(true);
    expect(second).toMatchObject({ ts: FIXED_EPOCH_MS + 7, level: 'warn', msg: 'later' });
    expect(first).not.toHaveProperty('job');
  });

  it('UT-SK-058 child({req_id})가 요청 ID를 바인딩한다 [NFR-AVL-006]', () => {
    // child({req_id})가 요청 ID를 바인딩한다 [NFR-AVL-006]
    {
      // Arrange
      const { logger, parsed } = harness();
      // Act
      logger.child({ req_id: '01J0A1B2C3D4E5F6G7H8J9K0M1' }).info('in request');
      logger.info('outside');
      // Assert
      const [inside, outside] = parsed();
      expect(inside?.req_id).toBe('01J0A1B2C3D4E5F6G7H8J9K0M1');
      expect(outside?.req_id).toBeNull();
    }
    // req_id 키는 한 줄에 한 번만 나타난다 [NFR-AVL-006]
    {
      // Arrange
      const { logger, lines } = harness();
      // Act
      logger.child({ req_id: 'R1' }).info('bound');
      logger.child({ other: 1 }).info('unbound');
      logger.info({ req_id: 'R2' }, 'merged');
      logger.info('root');
      // Assert
      const counts = lines.map((line) => line.split('"req_id"').length - 1);
      expect(counts).toEqual([1, 1, 1, 1]);
      expect(lines[0]).toContain('"req_id":"R1"');
      expect(lines[1]).toContain('"req_id":null');
      expect(lines[2]).toContain('"req_id":"R2"');
    }
    // child 바인딩과 병합 객체가 모두 req_id를 주면 바인딩이 이기고 키는 한 번만 쓰인다 [NFR-AVL-006]
    {
      const { logger, lines } = harness();
      logger.child({ req_id: 'R1' }).info({ req_id: 'R2', k: 1 }, 'both');
      expect(lines[0]?.split('"req_id"').length).toBe(2);
      expect(lines[0]).toContain('"req_id":"R1"');
      expect(lines[0]).not.toContain('R2');
      expect(lines[0]).toContain('"k":1');
      // setBindings 뒤에도 최신 바인딩을 따른다(캐시 없음)
      const child = logger.child({ other: 1 });
      child.info('before');
      child.setBindings({ req_id: 'R3' });
      child.info({ req_id: 'R4' }, 'after');
      expect(lines[1]).toContain('"req_id":null');
      expect(lines[2]?.split('"req_id"').length).toBe(2);
      expect(lines[2]).toContain('"req_id":"R3"');
    }
  });

  it('UT-SK-059 경로 redaction이 authorization·cookie·callers·*.token을 가린다 [NFR-AVL-007]', () => {
    // Arrange
    const { logger, parsed } = harness();
    // Act
    logger.info(
      {
        req: { headers: { authorization: 'Basic abc', cookie: 'k=v', 'x-fathom-csrf': 'c', accept: 'json' } },
        res: { headers: { 'set-cookie': 'sid=1' } },
        callers: { gateway: 'tok' },
        auth: { token: 'raw-token', api_key: 'k', password: 'p' },
        keep: 'visible',
      },
      'ctx',
    );
    // Assert
    const [line] = parsed();
    expect(line).toMatchObject({
      req: {
        headers: { authorization: '[REDACTED]', cookie: '[REDACTED]', 'x-fathom-csrf': '[REDACTED]', accept: 'json' },
      },
      res: { headers: { 'set-cookie': '[REDACTED]' } },
      callers: '[REDACTED]',
      auth: { token: '[REDACTED]', api_key: '[REDACTED]', password: '[REDACTED]' },
      keep: 'visible',
    });
    expect(REDACT_PATHS).toEqual(
      expect.arrayContaining(['req.headers.authorization', 'req.headers.cookie', 'callers', '*.token']),
    );
    expect(REDACT_PATHS).toHaveLength(16);
  });

  it('UT-SK-060 값 패턴 redaction이 필드 문자열과 extra 패턴을 가린다 [NFR-AVL-007]', () => {
    // 값 패턴 redaction이 필드 문자열과 extra 패턴을 가린다 [NFR-AVL-007]
    {
      // Arrange
      const { logger, parsed } = harness({ extraRedactPatterns: [/CORP-\d+/] });
      // Act
      logger.info({ hdr: 'Bearer abc.def', nested: { list: ['sk-ant-aaa', 'CORP-9', 'fine'] } }, 'values');
      // Assert
      const [line] = parsed();
      expect(line?.hdr).toBe('[REDACTED]');
      expect(line?.nested).toEqual({ list: ['[REDACTED]', '[REDACTED]', 'fine'] });
    }
    // msg·보간 인자·Error 첫 인자·child 바인딩의 비밀도 가린다 [NFR-AVL-007]
    {
      // Arrange
      const { logger, parsed, lines } = harness({ extraRedactPatterns: [/CORP-\d+/] });
      // Act
      logger.info('x Bearer abc.def sk-ant-xyz');
      logger.info({}, 'interp %s and %s', 'sk-ant-zzz', 'CORP-7');
      logger.warn(new Error('boom sk-ant-aaa'));
      logger.error({ err: new Error('inner Bearer q.r') });
      logger.child({ creds: 'Bearer zzz.yyy', req_id: 'R1' }).child({ more: 'sk-ant-bbb' }).info('child');
      // Assert
      const [plain, interp, errFirst, errKey, child] = parsed();
      expect(plain?.msg).toBe('x [REDACTED] [REDACTED]');
      expect(interp?.msg).toBe('interp [REDACTED] and [REDACTED]');
      expect(errFirst?.msg).toBe('boom [REDACTED]');
      expect(errFirst?.err).toMatchObject({ message: 'boom [REDACTED]' });
      expect(errKey?.msg).toBe('inner [REDACTED]');
      expect(child).toMatchObject({ creds: '[REDACTED]', more: '[REDACTED]', req_id: 'R1', msg: 'child' });
      // 객체 보간 인자(%j·%o)의 중첩 비밀도 msg로 펼쳐지기 전에 가린다 [NFR-SEC-004]
      logger.info('obj %j', { k: 'sk-ant-abcdefABCDEF123', nest: { list: ['Bearer abc.def', 'CORP-3'] } });
      logger.info('obj %o', { k: 'sk-ant-abcdefABCDEF123' });
      logger.info('arr %j', ['sk-ant-abcdefABCDEF123']);
      logger.info('err %s', new Error('oops sk-ant-abcdefABCDEF123'));
      logger.info('inst %j', new Map([['a', 1]]));
      class Holder {
        readonly token2 = 'sk-ant-abcdefABCDEF123';
      }
      logger.info('cls %j', new Holder());
      for (const line of lines) {
        expect(line).not.toMatch(/sk-ant-|Bearer |CORP-|zzz\.yyy/);
      }
    }
  });

  it('UT-SK-061 warn의 err에는 stack이 없고 code·type·message가 있다 [NFR-AVL-006]', () => {
    // Arrange
    const { logger, parsed } = harness();
    const e = new AppError('LR-DEP-001', 503, 'busy');
    // Act
    logger.warn({ err: e }, 'dependency down');
    // Assert
    const [line] = parsed();
    expect(line?.err).toEqual({ code: 'LR-DEP-001', type: 'AppError', message: 'LR-DEP-001' });
  });

  it('UT-SK-062 error의 err에는 stack이 있고 비밀은 가려진다 [NFR-AVL-006][NFR-AVL-007]', () => {
    // Arrange
    const { logger, parsed } = harness();
    const plain = new Error('failed with Bearer abc.def');
    // Act
    logger.error({ err: plain }, 'boom');
    logger.fatal(new TypeError('direct'), 'fatal');
    // Assert
    const [errorLine, fatalLine] = parsed();
    const serialized = errorLine?.err as { type: string; message: string; stack?: string };
    expect(serialized.type).toBe('Error');
    expect(serialized.message).toBe('failed with [REDACTED]');
    expect(serialized.stack).toContain('Error: failed with');
    expect(fatalLine?.level).toBe('fatal');
    expect(fatalLine?.err).toMatchObject({ type: 'TypeError', message: 'direct' });
  });

  it('UT-SK-063 job 옵션은 모든 줄에 job 필드를 더하고 level 필터가 동작한다 [NFR-AVL-006]', () => {
    // Arrange
    const { logger, parsed } = harness({ job: 'pack-build', level: 'warn' });
    // Act
    logger.info('dropped');
    logger.warn('kept');
    // Assert
    const lines = parsed();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ job: 'pack-build', msg: 'kept', level: 'warn' });
  });
});
