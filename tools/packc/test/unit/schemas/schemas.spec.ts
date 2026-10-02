// UT-PACKC-090~093 — schemas: JSON Schema 12개(편집기 검증용 · biome 포맷 · 멱등 · --check).
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseYamlStrict } from '@fathom/shared-kernel/policy/policy';
import { afterEach, describe, expect, it } from 'vitest';
import { classify } from '../../../src/parse/discover.js';
import { loadFile } from '../../../src/parse/load.js';
import { formatJson, renderSchemas, SCHEMA_NAMES } from '../../../src/schemas/schemas.js';
import { FIXTURES, lines, REPO_ROOT, rmTmp, run, tmpRoot } from '../cli/helpers.js';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) {
    rmTmp(r);
  }
});
function tmp(): string {
  const r = tmpRoot();
  roots.push(r);
  return r;
}

const NAMES = [
  'concepts',
  'item-models',
  'items',
  'kus',
  'misconceptions',
  'pack',
  'review-v7',
  'rubrics',
  'sources-registry',
  'sources-requests',
  'templates-dig',
  'templates-t2',
];

type Json = Record<string, unknown>;
function isObj(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** JSON Schema의 구조 부분(type·const·enum·properties·required·additionalProperties·propertyNames·items·oneOf/anyOf)만 확인한다. */
function accepts(schema: unknown, value: unknown): boolean {
  if (!isObj(schema)) {
    return true;
  }
  const alt = schema.oneOf ?? schema.anyOf;
  if (Array.isArray(alt)) {
    return alt.some((s) => accepts(s, value));
  }
  if ('const' in schema && schema.const !== value) {
    return false;
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    return false;
  }
  const t = schema.type;
  if (t === 'string' && typeof value !== 'string') {
    return false;
  }
  if ((t === 'number' || t === 'integer') && typeof value !== 'number') {
    return false;
  }
  if (t === 'boolean' && typeof value !== 'boolean') {
    return false;
  }
  if (t === 'null' && value !== null) {
    return false;
  }
  if (t === 'array') {
    if (!Array.isArray(value)) {
      return false;
    }
    return value.every((x) => accepts(schema.items, x));
  }
  if (t === 'object') {
    if (!isObj(value)) {
      return false;
    }
    const props = isObj(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required : [];
    if (!required.every((k) => typeof k === 'string' && k in value)) {
      return false;
    }
    const names =
      isObj(schema.propertyNames) && typeof schema.propertyNames.pattern === 'string'
        ? new RegExp(schema.propertyNames.pattern)
        : null;
    for (const [k, v] of Object.entries(value)) {
      if (names !== null && !names.test(k)) {
        return false;
      }
      if (k in props) {
        if (!accepts(props[k], v)) {
          return false;
        }
      } else if (schema.additionalProperties === false) {
        return false;
      } else if (isObj(schema.additionalProperties) && !accepts(schema.additionalProperties, v)) {
        return false;
      }
    }
  }
  return true;
}

describe('UT-PACKC-090 twelve schemas [FR-CUR-003]', () => {
  it('UT-PACKC-090 the 12 names and byte-deterministic output [FR-CUR-003]', () => {
    const a = renderSchemas();
    const b = renderSchemas();
    expect(a.map((s) => s.name)).toEqual(NAMES);
    expect(a.map((s) => s.file)).toEqual(NAMES.map((n) => `${n}.schema.json`));
    expect(a).toEqual(b);
    expect(Object.values(SCHEMA_NAMES).sort()).toEqual(NAMES);
    for (const s of a) {
      expect(s.text.endsWith('}\n')).toBe(true);
      expect(JSON.parse(s.text).$schema).toContain('json-schema.org');
    }
  });

  it('UT-PACKC-090 the generated files follow the DCP sample header names (kus, items, pack) [FR-CUR-003]', () => {
    const root = tmp();
    const r = run(['schemas', '--content-dir', join(root, 'content')]);
    expect(lines(r.stdout)).toEqual(['schemas written=12']);
    expect(readdirSync(join(root, 'content/.schemas')).sort()).toEqual(NAMES.map((n) => `${n}.schema.json`));
  });
});

describe('UT-PACKC-091 structure acceptance [FR-CUR-003]', () => {
  const samples: readonly [string, string][] = [
    ['pack', 'packs/docker/pack.yaml'],
    ['concepts', 'packs/docker/concepts/docker.dockerfile.md'],
    ['concepts', 'packs/k8s/concepts/k8s.probes.md'],
    ['kus', 'packs/docker/kus/docker.dockerfile.yaml'],
    ['misconceptions', 'packs/docker/misconceptions/docker.dockerfile.yaml'],
    ['items', 'packs/docker/items/docker.dockerfile.yaml'],
    ['items', 'packs/k8s/items/k8s.probes.yaml'],
    ['item-models', 'packs/docker/item-models/docker.dockerfile.yaml'],
    ['templates-t2', 'templates/t2/ku-cloze.yaml'],
    ['templates-dig', 'templates/dig/generic-01.yaml'],
    ['rubrics', 'templates/rubrics/solo-5.yaml'],
    ['sources-registry', 'sources/registry.yaml'],
    ['review-v7', 'review/V7/docker/v7.docker.001.yaml'],
  ];
  const schemas = new Map(renderSchemas().map((s) => [s.name, JSON.parse(s.text)] as const));

  for (const [name, rel] of samples) {
    it(`UT-PACKC-091 ${name}.schema.json accepts ${rel} and rejects an unknown key [FR-CUR-003]`, () => {
      const d = classify(rel);
      expect(d?.type).toBe('file');
      if (d?.type !== 'file') {
        return;
      }
      const loaded = loadFile(join(FIXTURES, 'base/content'), d);
      expect(loaded.raw).not.toBeNull();
      const data = loaded.raw?.data;
      const schema = schemas.get(name);
      expect(accepts(schema, data), rel).toBe(true);
      expect(accepts(schema, { ...(isObj(data) ? data : {}), surprise_key: 1 }), rel).toBe(false);
      if (isObj(data)) {
        const { schema_v: _drop, ...rest } = data;
        expect(accepts(schema, rest), `${rel} without schema_v`).toBe(false);
      }
    });
  }

  it('UT-PACKC-091 the base yaml also parses via parseYamlStrict (guards the sample loader) [FR-CUR-003]', () => {
    expect(parseYamlStrict(readFileSync(join(FIXTURES, 'base/content/sources/registry.yaml'), 'utf8')).ok).toBe(true);
  });
});

describe('UT-PACKC-092 --check [FR-CUR-003]', () => {
  it('UT-PACKC-092 a stale or missing file is a stale line and exit 1; identical files are exit 0 [FR-CUR-003]', () => {
    const root = tmp();
    const content = join(root, 'content');
    const missing = run(['schemas', '--check', '--content-dir', content]);
    expect(missing.code).toBe(1);
    expect(lines(missing.stdout)).toEqual(NAMES.map((n) => `stale ${n}.schema.json`));
    run(['schemas', '--content-dir', content]);
    const ok = run(['schemas', '--check', '--content-dir', content]);
    expect(ok.code).toBe(0);
    expect(lines(ok.stdout)).toEqual(['schemas ok']);
    writeFileSync(join(content, '.schemas/kus.schema.json'), '{}\n');
    const stale = run(['schemas', '--check', '--content-dir', content]);
    expect(stale.code).toBe(1);
    expect(lines(stale.stdout)).toEqual(['stale kus.schema.json']);
    const after = readFileSync(join(content, '.schemas/kus.schema.json'), 'utf8');
    expect(after).toBe('{}\n'); // --check는 쓰지 않는다
  });
});

describe('UT-PACKC-093 idempotence and biome format [FR-CUR-003]', () => {
  it('UT-PACKC-093 a second run writes nothing and leaves identical bytes [FR-CUR-003]', () => {
    const root = tmp();
    const content = join(root, 'content');
    run(['schemas', '--content-dir', content]);
    const first = NAMES.map((n) => readFileSync(join(content, `.schemas/${n}.schema.json`), 'utf8'));
    const again = run(['schemas', '--content-dir', content]);
    expect(lines(again.stdout)).toEqual(['schemas written=0']);
    expect(NAMES.map((n) => readFileSync(join(content, `.schemas/${n}.schema.json`), 'utf8'))).toEqual(first);
  });

  it('UT-PACKC-093 the output is unchanged by biome format with the repository config [FR-CUR-003]', () => {
    const root = tmp();
    const content = join(root, 'content');
    run(['schemas', '--content-dir', content]);
    const biome = join(REPO_ROOT, 'node_modules/.bin/biome');
    const out = execFileSync(
      biome,
      ['format', `--config-path=${join(REPO_ROOT, 'biome.json')}`, join(content, '.schemas')],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    expect(out).toContain('No fixes applied');
  });

  it('UT-PACKC-093 formatJson keeps short primitive arrays on one line and expands objects [FR-CUR-003]', () => {
    expect(formatJson({ a: ['x', 'y'], b: {}, c: [], d: [{ e: 1 }], f: 1 })).toBe(
      '{\n  "a": ["x", "y"],\n  "b": {},\n  "c": [],\n  "d": [\n    {\n      "e": 1\n    }\n  ],\n  "f": 1\n}',
    );
    const long = Array.from({ length: 30 }, (_, i) => `value-${i}`);
    expect(formatJson({ k: long }).split('\n').length).toBe(long.length + 4);
  });
});
