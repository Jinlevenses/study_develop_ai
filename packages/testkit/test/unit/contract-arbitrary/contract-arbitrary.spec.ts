import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { deriveMutations, minimalValid, toJsonSchema } from '../../../src/contract-arbitrary.js';

const Strict = z
  .object({
    name: z.string().min(3),
    count: z.number().int().min(2),
    flag: z.boolean(),
    kind: z.enum(['alpha', 'beta']),
    tags: z.array(z.string()).min(2),
    nested: z.object({ inner: z.string() }),
    note: z.string().optional(),
    level: z.number().default(5),
  })
  .strict();

describe('contract-arbitrary', () => {
  it('UT-TK-036 minimalValid는 required 키만 최소값으로 생성하고 결과가 스키마를 통과한다 [IR-015]', () => {
    // Act
    const result = minimalValid(Strict);
    // Assert
    expect(result).toEqual({
      ok: true,
      value: { count: 2, flag: false, kind: 'alpha', name: 'aaa', nested: { inner: '' }, tags: ['', ''] },
    });
    expect(result.ok && Strict.safeParse(result.value).success).toBe(true);
    expect(minimalValid(z.object({}).strict())).toEqual({ ok: true, value: {} });
    expect(minimalValid(z.number().int())).toEqual({ ok: true, value: 0 });
  });

  it('UT-TK-037 pattern·format·const가 있으면 needs_fixture다 [IR-015]', () => {
    const needs = { ok: false, error: { reason: 'needs_fixture' } };
    expect(minimalValid(z.object({ id: z.string().regex(/^[A-Z]+$/) }))).toEqual(needs);
    expect(minimalValid(z.object({ mail: z.string().email() }))).toEqual(needs);
    expect(minimalValid(z.object({ k: z.literal('fixed') }))).toEqual(needs);
    expect(minimalValid(z.object({ deep: z.object({ id: z.string().regex(/x/) }) }))).toEqual(needs);
    // 선택 키·빈 배열 안의 생성 불가 노드는 만들지 않으므로 방해하지 않는다
    expect(
      minimalValid(z.object({ opt: z.string().regex(/x/).optional(), list: z.array(z.string().regex(/x/)) })),
    ).toEqual({
      ok: true,
      value: { list: [] },
    });
  });

  it('UT-TK-038 deriveMutations는 drop_required·unknown_key·type_violation 3규칙을 키 정렬순으로 낸다 [IR-015]', () => {
    // Arrange
    const valid = { count: 2, flag: false, kind: 'alpha', name: 'aaa', nested: { inner: '' }, tags: ['', ''] };
    // Act
    const mutations = deriveMutations(Strict, valid);
    // Assert
    const summary = mutations.map((m) => `${m.kind}:${m.key}`);
    expect(summary).toEqual([
      'drop_required:count',
      'drop_required:flag',
      'drop_required:kind',
      'drop_required:name',
      'drop_required:nested',
      'drop_required:tags',
      'unknown_key:__unknown_key__',
      'type_violation:count',
      'type_violation:flag',
      'type_violation:kind',
      'type_violation:level',
      'type_violation:name',
      'type_violation:nested',
      'type_violation:note',
      'type_violation:tags',
    ]);
    const byKey = (kind: string, key: string): unknown =>
      mutations.find((m) => m.kind === kind && m.key === key)?.mutated;
    expect(byKey('drop_required', 'name')).not.toHaveProperty('name');
    expect(byKey('unknown_key', '__unknown_key__')).toMatchObject({ __unknown_key__: 1, name: 'aaa' });
    expect(byKey('type_violation', 'name')).toMatchObject({ name: 12345 });
    expect(byKey('type_violation', 'count')).toMatchObject({ count: 'x' });
    expect(byKey('type_violation', 'flag')).toMatchObject({ flag: 'x' });
    expect(byKey('type_violation', 'tags')).toMatchObject({ tags: {} });
    expect(byKey('type_violation', 'nested')).toMatchObject({ nested: 'x' });
    // 모든 변이는 스키마가 거부한다(.default 키 삭제는 변이 대상이 아니다)
    for (const mutation of mutations) {
      expect(Strict.safeParse(mutation.mutated).success).toBe(false);
    }
    expect(valid).toEqual({ count: 2, flag: false, kind: 'alpha', name: 'aaa', nested: { inner: '' }, tags: ['', ''] });
  });

  it('UT-TK-039 변이 생성은 결정적이다(2회 deep-equal·JSON 동일) [IR-015]', () => {
    // Arrange
    const valid = { count: 2, flag: false, kind: 'alpha', name: 'aaa', nested: { inner: '' }, tags: ['', ''] };
    // Act
    const first = deriveMutations(Strict, valid);
    const second = deriveMutations(Strict, valid);
    // Assert
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(JSON.stringify(toJsonSchema(Strict))).toBe(JSON.stringify(toJsonSchema(Strict)));
    expect(deriveMutations(Strict, 'not an object')).toEqual([]);
    expect(deriveMutations(z.string(), {})[0]?.kind).toBe('unknown_key');
  });
});
