// STD-LOG-21 — 값 redaction. 순수 모듈(STD-DIR-32): import 0.

export const DEFAULT_SECRET_PATTERNS: readonly RegExp[] = [
  /sk-ant-[\w-]+/g,
  /sk-[\w-]{20,}/g,
  /AIza[\w-]{35}/g,
  /-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/g,
  /fathom_sid=v1\.[^;\s]+/g,
];

const CENSOR = '[REDACTED]';
const TRUNCATED = '[TRUNCATED]';
const MAX_DEPTH = 8;

function asGlobal(pattern: RegExp): RegExp {
  return pattern.global ? pattern : new RegExp(pattern.source, `${pattern.flags}g`);
}

/** 일치 부분을 `[REDACTED]`로 치환한다. 전역 플래그 없는 extra 패턴은 전역으로 복제해 적용한다. */
export function redactString(s: string, extra?: readonly RegExp[]): string {
  let out = s;
  for (const pattern of DEFAULT_SECRET_PATTERNS) {
    out = out.replace(asGlobal(pattern), CENSOR);
  }
  if (extra !== undefined) {
    for (const pattern of extra) {
      out = out.replace(asGlobal(pattern), CENSOR);
    }
  }
  return out;
}

function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function walk(value: unknown, extra: readonly RegExp[] | undefined, depth: number, ancestors: Set<object>): unknown {
  if (typeof value === 'string') {
    return redactString(value, extra);
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  const isArray = Array.isArray(value);
  if (!isArray && !isPlainObject(value)) {
    return value; // Date·Error 등은 그대로 둔다(직렬화는 호출자 몫)
  }
  if (depth > MAX_DEPTH || ancestors.has(value)) {
    return TRUNCATED;
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item: unknown): unknown => walk(item, extra, depth + 1, ancestors));
    }
    return Object.fromEntries(
      Object.keys(value).map((key): [string, unknown] => [
        key,
        walk(Reflect.get(value, key), extra, depth + 1, ancestors),
      ]),
    );
  } finally {
    ancestors.delete(value);
  }
}

/** 깊은 복사하며 모든 문자열에 redaction을 적용한다. 깊이 > 8 또는 순환이면 그 지점을 `'[TRUNCATED]'`로. 입력 불변. */
export function redactValues(value: unknown, extra?: readonly RegExp[]): unknown {
  return walk(value, extra, 0, new Set<object>());
}
