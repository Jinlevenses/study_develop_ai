import type { Result } from '@fathom/shared-kernel/errors/errors';
import { err, ok } from '@fathom/shared-kernel/errors/errors';
import { z } from 'zod';

type JsonNode = Readonly<Record<string, unknown>>;

export type Mutation = {
  readonly kind: 'drop_required' | 'unknown_key' | 'type_violation';
  /** 변이가 가해진 최상위 키(`unknown_key`는 추가된 키 `__unknown_key__`). */
  readonly key: string;
  /** 변이 적용 후의 전체 값. */
  readonly mutated: Readonly<Record<string, unknown>>;
};

export const UNKNOWN_KEY = '__unknown_key__';
const SAFE_INT_FLOOR = -Number.MAX_SAFE_INTEGER; // zod `.int()`가 붙이는 경계는 "최솟값"으로 취급하지 않는다.

/**
 * zod 4 스키마 → JSON Schema(결정적). 기본 `io = 'output'`(응답 스키마 검사용).
 * 요청 스키마의 변이·최소 유효 인스턴스는 `.default()` 필드를 선택으로 다루려고 `'input'`을 쓴다.
 */
export function toJsonSchema(schema: z.ZodType, io: 'input' | 'output' = 'output'): object {
  return z.toJSONSchema(schema, { unrepresentable: 'any', io });
}

function isNode(value: unknown): value is JsonNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberOf(node: JsonNode, key: string): number | undefined {
  const value = node[key];
  return typeof value === 'number' ? value : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

const NEEDS_FIXTURE = { reason: 'needs_fixture' } as const;

function build(node: unknown): Result<unknown, { reason: 'needs_fixture' }> {
  if (!isNode(node)) {
    return err(NEEDS_FIXTURE);
  }
  if ('pattern' in node || 'format' in node || 'const' in node || '$ref' in node || 'not' in node) {
    return err(NEEDS_FIXTURE);
  }
  const options = node.anyOf ?? node.oneOf;
  if (Array.isArray(options)) {
    for (const option of options) {
      const attempt = build(option);
      if (attempt.ok) {
        return attempt;
      }
    }
    return err(NEEDS_FIXTURE);
  }
  if ('allOf' in node) {
    return err(NEEDS_FIXTURE);
  }
  if (Array.isArray(node.enum)) {
    return node.enum.length > 0 ? ok(node.enum[0]) : err(NEEDS_FIXTURE);
  }
  const type = Array.isArray(node.type) ? node.type[0] : node.type;
  switch (type) {
    case 'string':
      return ok('a'.repeat(numberOf(node, 'minLength') ?? 0));
    case 'number':
    case 'integer': {
      const min = numberOf(node, 'minimum');
      const max = numberOf(node, 'maximum');
      const exclusiveMin = numberOf(node, 'exclusiveMinimum');
      let value = min !== undefined && min > SAFE_INT_FLOOR ? min : exclusiveMin !== undefined ? exclusiveMin + 1 : 0;
      if (max !== undefined && value > max) {
        value = max;
      }
      return ok(value);
    }
    case 'boolean':
      return ok(false);
    case 'null':
      return ok(null);
    case 'array': {
      const count = numberOf(node, 'minItems') ?? 0;
      const items: unknown[] = [];
      for (let i = 0; i < count; i += 1) {
        const item = build(node.items);
        if (!item.ok) {
          return item;
        }
        items.push(item.value);
      }
      return ok(items);
    }
    case 'object': {
      const properties = isNode(node.properties) ? node.properties : {};
      const out: Record<string, unknown> = {};
      for (const key of stringList(node.required).sort()) {
        const child = build(properties[key]);
        if (!child.ok) {
          return child;
        }
        out[key] = child.value;
      }
      return ok(out);
    }
    default:
      // `{}`(unknown·any)는 어떤 값이든 유효하다.
      return Object.keys(node).length === 0 || type === undefined ? ok(null) : err(NEEDS_FIXTURE);
  }
}

/**
 * 최소 유효 인스턴스. `pattern`·`format`·`const` 없는 원시값만 생성한다(생성 대상 노드 중 하나라도 불가하면 `needs_fixture`).
 */
export function minimalValid(schema: z.ZodType): Result<unknown, { reason: 'needs_fixture' }> {
  return build(toJsonSchema(schema, 'input'));
}

function violationOf(propertyType: unknown): unknown {
  switch (propertyType) {
    case 'string':
      return 12345;
    case 'number':
    case 'integer':
      return 'x';
    case 'boolean':
      return 'x';
    case 'array':
      return {};
    case 'object':
      return 'x';
    default:
      return undefined;
  }
}

/**
 * 최상위 객체 변이: required 키마다 `drop_required`, `unknown_key` 1개, 속성마다 `type_violation`.
 * 순서 = (drop_required 키 정렬순) → unknown_key → (type_violation 키 정렬순). 같은 입력 → 같은 출력.
 */
export function deriveMutations(schema: z.ZodType, valid: unknown): Mutation[] {
  const json = toJsonSchema(schema, 'input');
  if (!isNode(json) || !isNode(valid)) {
    return [];
  }
  const properties = isNode(json.properties) ? json.properties : {};
  const mutations: Mutation[] = [];
  for (const key of stringList(json.required).sort()) {
    const rest = Object.fromEntries(Object.entries(valid).filter(([k]) => k !== key));
    mutations.push({ kind: 'drop_required', key, mutated: rest });
  }
  mutations.push({ kind: 'unknown_key', key: UNKNOWN_KEY, mutated: { ...valid, [UNKNOWN_KEY]: 1 } });
  for (const key of Object.keys(properties).sort()) {
    const property = properties[key];
    const bad = isNode(property) ? violationOf(property.type) : undefined;
    if (bad !== undefined) {
      mutations.push({ kind: 'type_violation', key, mutated: { ...valid, [key]: bad } });
    }
  }
  return mutations;
}
