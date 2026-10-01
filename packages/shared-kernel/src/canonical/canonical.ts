import { createHash } from 'node:crypto';

const FORBIDDEN_JSON_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

function fail(what: string): never {
  throw new Error(`invariant: canonicalJson ${what}`);
}

function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function encode(value: unknown, ancestors: Set<object>, path: string): string {
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        return fail(`non-finite number at ${path}`);
      }
      return JSON.stringify(value);
    case 'object':
      break;
    case 'undefined':
      return fail(`undefined at ${path}`);
    case 'bigint':
      return fail(`bigint at ${path}`);
    case 'function':
      return fail(`function at ${path}`);
    case 'symbol':
      return fail(`symbol at ${path}`);
    default:
      return fail(`unsupported value at ${path}`);
  }
  if (value === null) {
    return 'null';
  }
  if (ancestors.has(value)) {
    return fail(`circular reference at ${path}`);
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const parts: string[] = [];
      for (let i = 0; i < value.length; i += 1) {
        parts.push(encode(value[i], ancestors, `${path}[${i}]`));
      }
      return `[${parts.join(',')}]`;
    }
    if (!isPlainObject(value)) {
      return fail(`non-plain object at ${path}`);
    }
    const entries: string[] = [];
    for (const key of Object.keys(value).sort()) {
      entries.push(`${JSON.stringify(key)}:${encode(Reflect.get(value, key), ancestors, `${path}.${key}`)}`);
    }
    return `{${entries.join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

/**
 * 정준 JSON(NFR-DATA-002): 키 UTF-16 코드 단위 정렬·공백 0·숫자 최단 왕복(`-0` → `0`)·배열 순서 보존.
 * 해시·서명 대상 JSON은 이 함수로만 직렬화한다(STD-TS-24). 표현 불가 값은 결함으로 던진다.
 */
export function canonicalJson(value: unknown): string {
  return encode(value, new Set<object>(), '$');
}

/** 소문자 hex 64. 문자열은 UTF-8. */
export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

/** `JSON.parse` + 프로토타입 오염 키 거부(STD-SEC-08). 결과는 호출자가 즉시 zod로 파싱한다(STD-TS-24). */
export function parseJsonStrict(text: string): unknown {
  return JSON.parse(text, (key: string, value: unknown): unknown => {
    if (FORBIDDEN_JSON_KEYS.has(key)) {
      throw new Error(`invariant: forbidden json key ${key}`);
    }
    return value;
  });
}
