import { isUlid } from '@fathom/shared-kernel/ids/ids';
import { describe, expect, it } from 'vitest';
import { createUlidSequence, fixedUlid } from '../../../src/ids.js';
import type { StackHandle } from '../../../src/playwright/stack-fixture.js';
import { bootstrapRequest, createRequestCounter, isLoopbackUrl } from '../../../src/playwright/stack-fixture.js';

describe('stack-fixture helpers', () => {
  it('UT-TK-048 isLoopbackUrl은 127.0.0.1·localhost·[::1]만 참이다 [NFR-SEC-019]', () => {
    // isLoopbackUrl은 127.0.0.1·localhost·[::1]만 참이다 [NFR-SEC-019]
    expect(isLoopbackUrl('http://127.0.0.1:4847/app')).toBe(true);
    expect(isLoopbackUrl('http://localhost:5173/')).toBe(true);
    expect(isLoopbackUrl('http://[::1]:4847/')).toBe(true);
    expect(isLoopbackUrl('https://example.com/')).toBe(false);
    expect(isLoopbackUrl('http://127.0.0.1.evil.test/')).toBe(false);
    expect(isLoopbackUrl('http://192.0.2.2:4847/')).toBe(false);
    expect(isLoopbackUrl('not a url')).toBe(false);
    // createRequestCounter는 외부 http·ws 요청만 센다 [NFR-SEC-019]
    {
      // Arrange
      const counter = createRequestCounter();
      // Act
      const results = [
        counter.record('http://127.0.0.1:4847/a'),
        counter.record('data:text/plain,hi'),
        counter.record('blob:http://127.0.0.1/abc'),
        counter.record('https://fonts.example.com/x.woff2'),
        counter.record('wss://push.example.com/'),
        counter.record('garbage'),
      ];
      // Assert
      expect(results).toEqual([false, false, false, true, true, false]);
      expect(counter.count).toBe(2);
      expect(counter.urls).toEqual(['https://fonts.example.com/x.woff2', 'wss://push.example.com/']);
    }
  });

  it('UT-TK-049 bootstrapRequest는 IF-GW-001 요청 모양을 만든다 [NFR-SEC-019]', () => {
    // Arrange
    const handle: StackHandle = {
      gatewayUrl: 'http://127.0.0.1:4847/',
      cliToken: 'tok_abc',
      home: '/tmp/home',
      stop: () => Promise.resolve(),
    };
    // Act
    const { url, init } = bootstrapRequest(handle);
    const second = bootstrapRequest(handle);
    // Assert
    expect(url).toBe('http://127.0.0.1:4847/api/v1/cli/bootstrap-token');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      authorization: 'Bearer tok_abc',
      'content-type': 'application/json',
      'idempotency-key': expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
    });
    expect(init.body).toBe('{"purpose":"open"}');
    // IF-01 §2: 상태 변경 요청은 ULID(26자 Crockford base32 대문자) idempotency-key가 필수이고, 요청마다 새 키다 [NFR-SEC-019]
    const key = (init.headers as Record<string, string>)['idempotency-key'];
    const nextKey = (second.init.headers as Record<string, string>)['idempotency-key'];
    expect(key).toHaveLength(26);
    expect(isUlid(key)).toBe(true);
    expect(nextKey).not.toBe(key);
    // 키 생성기는 주입할 수 있다
    const injected = bootstrapRequest(handle, createUlidSequence(7));
    expect(injected.init.headers).toMatchObject({ 'idempotency-key': fixedUlid(7) });
  });
});
