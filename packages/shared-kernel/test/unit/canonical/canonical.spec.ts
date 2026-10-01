import { describe, expect, it } from 'vitest';
import { canonicalJson, parseJsonStrict, sha256Hex } from '../../../src/canonical/canonical.js';

describe('canonical', () => {
  it('UT-SK-011 키 정렬(중첩)·배열 순서·최단 왕복 숫자·같은 값 같은 해시 [NFR-DATA-002]', () => {
    // Arrange
    const a = { b: 1, a: { z: [3, 1, 2], y: 'x' }, c: null };
    const b = { c: null, a: { y: 'x', z: [3, 1, 2] }, b: 1 };
    // Assert: 키 정렬 + 배열 순서 보존
    expect(canonicalJson(a)).toBe('{"a":{"y":"x","z":[3,1,2]},"b":1,"c":null}');
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(sha256Hex(canonicalJson(a))).toBe(sha256Hex(canonicalJson(b)));
    // Assert: 숫자 표기
    expect(canonicalJson(0.1 + 0.2)).toBe('0.30000000000000004');
    expect(canonicalJson(1e21)).toBe('1e+21');
    expect(canonicalJson(-0)).toBe('0');
    expect(canonicalJson([-0, 1.5, 100])).toBe('[0,1.5,100]');
    // Assert: UTF-16 코드 단위 순서
    expect(canonicalJson({ b: 1, a: 2, B: 3, '가': 4, '\u{1F600}': 5 })).toBe(
      '{"B":3,"a":2,"b":1,"가":4,"\u{1F600}":5}',
    );
    expect(canonicalJson('line\n"q"')).toBe('"line\\n\\"q\\""');
  });

  it('UT-SK-035 canonicalJson은 undefined·함수·symbol·bigint를 던진다 [NFR-DATA-002]', () => {
    expect(() => canonicalJson(undefined)).toThrow(/^invariant: canonicalJson/);
    expect(() => canonicalJson({ a: undefined })).toThrow(/^invariant: canonicalJson/);
    expect(() => canonicalJson([undefined])).toThrow(/^invariant: canonicalJson/);
    expect(() => canonicalJson(() => 1)).toThrow(/^invariant: canonicalJson/);
    expect(() => canonicalJson(Symbol('s'))).toThrow(/^invariant: canonicalJson/);
    expect(() => canonicalJson(10n)).toThrow(/^invariant: canonicalJson/);
  });

  it('UT-SK-036 canonicalJson은 NaN·±Infinity를 던진다 [NFR-DATA-002]', () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(/^invariant: canonicalJson/);
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(/^invariant: canonicalJson/);
    expect(() => canonicalJson({ n: Number.NEGATIVE_INFINITY })).toThrow(/^invariant: canonicalJson/);
  });

  it('UT-SK-037 canonicalJson은 Date·Map·Set·클래스 인스턴스를 던지고 null 프로토타입은 허용한다 [NFR-DATA-002]', () => {
    class Box {
      readonly v = 1;
    }
    expect(() => canonicalJson(new Date(0))).toThrow(/^invariant: canonicalJson/);
    expect(() => canonicalJson(new Map())).toThrow(/^invariant: canonicalJson/);
    expect(() => canonicalJson(new Set())).toThrow(/^invariant: canonicalJson/);
    expect(() => canonicalJson(new Box())).toThrow(/^invariant: canonicalJson/);
    const bare = Object.create(null) as Record<string, unknown>;
    bare.k = 1;
    expect(canonicalJson(bare)).toBe('{"k":1}');
  });

  it('UT-SK-038 canonicalJson은 순환 참조를 던지고 공유(비순환) 참조는 허용한다 [NFR-DATA-002]', () => {
    // Arrange
    const loop: Record<string, unknown> = { a: 1 };
    loop.self = loop;
    const shared = { v: 1 };
    // Act / Assert
    expect(() => canonicalJson(loop)).toThrow(/circular/);
    expect(canonicalJson({ x: shared, y: shared })).toBe('{"x":{"v":1},"y":{"v":1}}');
  });

  it('UT-SK-039 parseJsonStrict는 프로토타입 오염 키 3종을 거부한다 [NFR-SEC-012]', () => {
    expect(() => parseJsonStrict('{"__proto__":{"x":1}}')).toThrow('invariant: forbidden json key __proto__');
    expect(() => parseJsonStrict('{"a":{"constructor":1}}')).toThrow('invariant: forbidden json key constructor');
    expect(() => parseJsonStrict('[{"prototype":1}]')).toThrow('invariant: forbidden json key prototype');
    expect(parseJsonStrict('{"a":[1,{"b":null}]}')).toEqual({ a: [1, { b: null }] });
    expect(() => parseJsonStrict('{bad')).toThrow(SyntaxError);
  });

  it('UT-SK-040 sha256Hex는 문자열(UTF-8)과 같은 바이트에서 같은 소문자 hex 64를 낸다 [NFR-DATA-002]', () => {
    // Arrange
    const text = '깊이 fathom';
    // Act
    const fromString = sha256Hex(text);
    const fromBytes = sha256Hex(new TextEncoder().encode(text));
    // Assert
    expect(fromString).toBe(fromBytes);
    expect(fromString).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
