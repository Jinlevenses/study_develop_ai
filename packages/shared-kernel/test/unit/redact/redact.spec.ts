import { describe, expect, it } from 'vitest';
import { DEFAULT_SECRET_PATTERNS, redactString, redactValues } from '../../../src/redact/redact.js';

const R = '[REDACTED]';

describe('redact', () => {
  it('UT-SK-010 비밀 패턴(키·PEM·Bearer·세션 쿠키·extra)을 가리고 일반 문장은 보존한다 [NFR-AVL-007][NFR-SEC-004]', () => {
    // Arrange
    const aiza = `AIza${'a'.repeat(35)}`;
    const pem = '-----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY-----';
    // Assert
    expect(redactString('key sk-ant-api03-AbC_dEf-123 end')).toBe(`key ${R} end`);
    expect(redactString(`k=sk-${'x'.repeat(20)}`)).toBe(`k=${R}`);
    expect(redactString('sk-short')).toBe('sk-short');
    expect(redactString(`g=${aiza}`)).toBe(`g=${R}`);
    expect(redactString(`before ${pem} after`)).toBe(`before ${R} after`);
    expect(redactString('authorization: Bearer abc.def-ghi==')).toBe(`authorization: ${R}`);
    expect(redactString('cookie: fathom_sid=v1.abc.def; Path=/')).toBe(`cookie: ${R}; Path=/`);
    expect(redactString('내부 코드명 ZEBRA-42', [/ZEBRA-\d+/])).toBe(`내부 코드명 ${R}`);
    const plain = '학습 세션을 시작했습니다. sk 와 key 는 일반 단어입니다.';
    expect(redactString(plain)).toBe(plain);
    expect(DEFAULT_SECRET_PATTERNS).toHaveLength(6);
  });

  it('UT-SK-041 redactValues는 입력을 바꾸지 않고 깊은 복사본을 돌려준다 [NFR-SEC-013]', () => {
    // Arrange
    const input = { a: 'Bearer abc.def', n: { k: ['sk-ant-zzz'] } };
    const snapshot = JSON.stringify(input);
    // Act
    const out = redactValues(input);
    // Assert
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(out).toEqual({ a: R, n: { k: [R] } });
    expect(out).not.toBe(input);
  });

  it('UT-SK-042 깊이가 8을 넘는 지점은 [TRUNCATED]다 [NFR-DATA-010]', () => {
    // Arrange: 루트(0) 아래 컨테이너 9단 중첩
    let nested: unknown = { leaf: 'sk-ant-secret' };
    for (let i = 0; i < 8; i += 1) {
      nested = { child: nested };
    }
    // Act
    const out = redactValues({ root: nested });
    // Assert: root(1)…child 7단=깊이 8까지 보존, 이후 컨테이너는 잘림
    const text = JSON.stringify(out);
    expect(text).toContain('[TRUNCATED]');
    expect(text).not.toContain('sk-ant-secret');
    const shallow = redactValues({ a: { b: { c: { d: 'ok' } } } });
    expect(shallow).toEqual({ a: { b: { c: { d: 'ok' } } } });
  });

  it('UT-SK-043 순환 참조 지점은 [TRUNCATED]다 [NFR-SEC-013]', () => {
    // Arrange
    const loop: Record<string, unknown> = { name: 'x' };
    loop.self = loop;
    // Act
    const out = redactValues(loop);
    // Assert
    expect(out).toEqual({ name: 'x', self: '[TRUNCATED]' });
  });

  it('UT-SK-044 전역 플래그 없는 extra 패턴도 모든 일치를 가린다 [NFR-SEC-013]', () => {
    // Arrange
    const nonGlobal = /CORP-\d+/;
    // Act / Assert
    expect(redactString('CORP-1 and CORP-22', [nonGlobal])).toBe(`${R} and ${R}`);
    expect(nonGlobal.global).toBe(false);
    expect(redactValues({ t: 'CORP-1 CORP-2' }, [nonGlobal])).toEqual({ t: `${R} ${R}` });
  });

  it('UT-SK-045 배열·중첩 객체·비문자열 값을 처리한다 [NFR-DATA-010]', () => {
    // Arrange
    const when = new Date(0);
    const input = { list: ['a', 'Bearer q.r', { deep: 'sk-ant-1' }], n: 1, ok: true, none: null, when };
    // Act
    const out = redactValues(input);
    // Assert
    expect(out).toEqual({ list: ['a', R, { deep: R }], n: 1, ok: true, none: null, when });
    expect(redactValues('Bearer a.b')).toBe(R);
    expect(redactValues(7)).toBe(7);
    expect(redactValues(JSON.parse('{"__proto__":{"x":"Bearer a.b"}}'))).toEqual(JSON.parse('{"__proto__":{"x":"[REDACTED]"}}'));
  });
});
