import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseYamlStrict, policyContentHash, policySetId } from '../../../src/policy/policy.js';

describe('parseYamlStrict', () => {
  it('UT-SK-130 정상 매핑·시퀀스·스칼라 타입을 그대로 돌려준다 [FR-CUR-017][NFR-MAINT-007]', () => {
    const r = parseYamlStrict(
      [
        '# 주석',
        'a: 1',
        'b: 1.5',
        'c: "text"',
        'd: true',
        'e: null',
        'f: [1, 2]',
        'g:',
        '  h: x',
        '  i: { j: 1 }',
        '',
      ].join('\n'),
    );
    expect(r).toEqual({
      ok: true,
      value: { a: 1, b: 1.5, c: 'text', d: true, e: null, f: [1, 2], g: { h: 'x', i: { j: 1 } } },
    });
    expect(parseYamlStrict('')).toEqual({ ok: true, value: null });
    expect(parseYamlStrict('just a string')).toEqual({ ok: true, value: 'just a string' });
  });

  it('UT-SK-131 별칭(*a)과 앵커(&a)·merge 키는 거부한다 [FR-CUR-017][NFR-MAINT-007]', () => {
    const withAlias = parseYamlStrict('a: &x\n  k: 1\nb: *x\n');
    expect(withAlias).toMatchObject({ ok: false, error: { reason: 'yaml_error' } });
    const anchorOnly = parseYamlStrict('a: &x 1\nb: 2\n');
    expect(anchorOnly).toMatchObject({ ok: false, error: { reason: 'yaml_error' } });
    if (!anchorOnly.ok) {
      expect(anchorOnly.error.detail).toContain('&x');
    }
    const merge = parseYamlStrict('base: &b\n  k: 1\nderived:\n  <<: *b\n  z: 2\n');
    expect(merge).toMatchObject({ ok: false, error: { reason: 'yaml_error' } });
    // 문자열 안의 & · *는 평범한 값이다.
    expect(parseYamlStrict('a: "x & y * z"\n')).toEqual({ ok: true, value: { a: 'x & y * z' } });
  });

  it('UT-SK-132 중복 키·다중 문서·문법 오류는 yaml_error다 [FR-CUR-017]', () => {
    expect(parseYamlStrict('a: 1\na: 2\n')).toMatchObject({ ok: false, error: { reason: 'yaml_error' } });
    expect(parseYamlStrict('a: 1\n---\nb: 2\n')).toMatchObject({ ok: false, error: { reason: 'yaml_error' } });
    expect(parseYamlStrict('a: [1, 2\n')).toMatchObject({ ok: false, error: { reason: 'yaml_error' } });
    expect(parseYamlStrict('\ta: 1\n')).toMatchObject({ ok: false, error: { reason: 'yaml_error' } });
    expect(parseYamlStrict('a: 1\n  b: 2\n')).toMatchObject({ ok: false, error: { reason: 'yaml_error' } });
  });

  it('UT-SK-133 !!binary 등 비 core 태그와 비유한 수는 거부한다 [FR-CUR-017][NFR-MAINT-007]', () => {
    expect(parseYamlStrict('a: !!binary aGVsbG8=\n')).toMatchObject({ ok: false, error: { reason: 'yaml_error' } });
    expect(parseYamlStrict('a: !!timestamp 2026-01-01\n')).toMatchObject({
      ok: false,
      error: { reason: 'yaml_error' },
    });
    expect(parseYamlStrict('a: !!set { x }\n')).toMatchObject({ ok: false, error: { reason: 'yaml_error' } });
    expect(parseYamlStrict('a: !custom 1\n')).toMatchObject({ ok: false, error: { reason: 'yaml_error' } });
    expect(parseYamlStrict('a: .nan\n')).toMatchObject({ ok: false, error: { reason: 'yaml_error' } });
    expect(parseYamlStrict('a: .inf\n')).toMatchObject({ ok: false, error: { reason: 'yaml_error' } });
    // core 태그는 허용한다.
    expect(parseYamlStrict('a: !!str 1\nb: !!int "2"\n')).toEqual({ ok: true, value: { a: '1', b: 2 } });
  });

  it('UT-SK-134 __proto__·constructor·prototype 키는 어디에 있어도 거부한다 [FR-CUR-017][NFR-MAINT-007]', () => {
    for (const text of [
      '__proto__:\n  polluted: true\n',
      'a:\n  constructor: 1\n',
      'a:\n  - b:\n      prototype: x\n',
      '"__proto__": 1\n',
    ]) {
      const r = parseYamlStrict(text);
      expect(r, text).toMatchObject({ ok: false, error: { reason: 'yaml_error' } });
      if (!r.ok) {
        expect(r.error.detail, text).toMatch(/forbidden key/);
      }
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('policyContentHash · policySetId', () => {
  it('UT-SK-135 policyContentHash = sha256(정준 JSON)이고 키 순서에 무관하다 [FR-CUR-017][NFR-MAINT-007]', () => {
    const expected = createHash('sha256').update('{"a":1,"b":[1,2,{"c":null}]}').digest('hex');
    expect(policyContentHash({ b: [1, 2, { c: null }], a: 1 })).toBe(expected);
    expect(policyContentHash({ a: 1, b: [1, 2, { c: null }] })).toBe(expected);
    expect(policyContentHash({ a: 1 })).not.toBe(policyContentHash({ a: 2 }));
    expect(policyContentHash(null)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('UT-SK-136 policySetId는 ps_ + 16 hex이고 멤버 순서에 무관하며 overrides를 반영한다 [FR-CUR-017]', () => {
    const a = { version: 'mastery_rules@v1', sha256: 'a'.repeat(64) };
    const b = { version: 'fsrs_params@v1', sha256: 'b'.repeat(64) };
    const id1 = policySetId({ mastery_rules: a, fsrs_params: b }, null);
    const id2 = policySetId({ fsrs_params: b, mastery_rules: a }, null);
    expect(id1).toMatch(/^ps_[0-9a-f]{16}$/);
    expect(id2).toBe(id1);
    expect(policySetId({ mastery_rules: a, fsrs_params: b }, 'c'.repeat(64))).not.toBe(id1);
    expect(policySetId({ mastery_rules: a }, null)).not.toBe(id1);
    const canonical =
      '{"members":{"fsrs_params":{"sha256":"' +
      'b'.repeat(64) +
      '","version":"fsrs_params@v1"},"mastery_rules":{"sha256":"' +
      'a'.repeat(64) +
      '","version":"mastery_rules@v1"}},"overrides_sha256":null}';
    expect(id1).toBe(`ps_${createHash('sha256').update(canonical).digest('hex').slice(0, 16)}`);
  });
});
