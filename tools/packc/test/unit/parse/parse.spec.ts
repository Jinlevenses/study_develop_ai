// UT-PACKC-010~015 — parse: frontmatter · YAML(parseYamlStrict) · 본문 · discover · countChars · 인코딩.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DiscoveredFile } from '../../../src/parse/discover.js';
import { classify, discover } from '../../../src/parse/discover.js';
import { splitFrontmatter } from '../../../src/parse/frontmatter.js';
import { loadFile } from '../../../src/parse/load.js';
import {
  conceptLinksOf,
  countChars,
  directivesOf,
  fencesOf,
  h3Block,
  h3Titles,
  parseBody,
} from '../../../src/parse/markdown.js';
import { FIXTURES, materialize, rmTmp, tmpRoot } from '../cli/helpers.js';

let root = '';
afterEach(() => {
  if (root !== '') {
    rmTmp(root);
    root = '';
  }
});

const DOCKERFILE_MD = join(FIXTURES, 'base/content/packs/docker/concepts/docker.dockerfile.md');

function conceptDisc(name: string): DiscoveredFile {
  const d = classify(`packs/docker/concepts/${name}.md`);
  if (d === null || d.type !== 'file') {
    throw new Error('expected a file');
  }
  return d;
}

function put(rel: string, text: string): string {
  root = root === '' ? tmpRoot() : root;
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return root;
}

describe('UT-PACKC-010 frontmatter [FR-CUR-002]', () => {
  it('UT-PACKC-010 splits the frontmatter from the body and rejects a missing one [FR-CUR-002]', () => {
    const ok = splitFrontmatter('---\na: 1\n---\n\n## 이론\n');
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value.yaml).toBe('a: 1');
      expect(ok.value.body).toBe('\n## 이론\n');
    }
    expect(splitFrontmatter('## 이론\n').ok).toBe(false);
    expect(splitFrontmatter(' ---\na: 1\n---\n').ok).toBe(false);
    expect(splitFrontmatter('---\na: 1\n').ok).toBe(false);
  });

  it('UT-PACKC-010 a concept file without frontmatter is a V1 frontmatter error [FR-CUR-002]', () => {
    const r = put('packs/docker/concepts/docker.x.md', '# no frontmatter\n');
    const res = loadFile(r, conceptDisc('docker.x'));
    expect(res.raw).toBeNull();
    expect(res.findings[0]?.rule).toBe('V1');
    expect(res.findings[0]?.message.startsWith('frontmatter:')).toBe(true);
  });
});

describe('UT-PACKC-011 YAML via parseYamlStrict [FR-CUR-002]', () => {
  it('UT-PACKC-011 anchors, aliases and duplicate keys are V1 yaml errors [FR-CUR-002]', () => {
    const r = put('packs/docker/concepts/docker.x.md', '---\na: &x 1\nb: *x\n---\nbody\n');
    const anchor = loadFile(r, conceptDisc('docker.x'));
    expect(anchor.raw).toBeNull();
    expect(anchor.findings[0]?.message.startsWith('yaml:')).toBe(true);
    put('packs/docker/concepts/docker.y.md', '---\na: 1\na: 2\n---\nbody\n');
    const dup = loadFile(r, conceptDisc('docker.y'));
    expect(dup.raw).toBeNull();
    expect(dup.findings[0]?.message.startsWith('yaml:')).toBe(true);
  });

  it('UT-PACKC-011 a plain yaml file parses to data [FR-CUR-002]', () => {
    const r = put('packs/docker/kus/docker.x.yaml', 'schema_v: 1\n');
    const d = classify('packs/docker/kus/docker.x.yaml');
    expect(d?.type).toBe('file');
    if (d?.type === 'file') {
      expect(loadFile(r, d).raw?.data).toEqual({ schema_v: 1 });
    }
  });
});

describe('UT-PACKC-012 body parser [FR-CUR-002]', () => {
  it('UT-PACKC-012 recognises H2/H3, fences and directives; fenced # and :: are inert [FR-CUR-002]', () => {
    const body = [
      '## 이론',
      '### 왜 필요한가',
      'text [x](concept:docker.image-layer)',
      '```mermaid dg_a',
      '# not a heading',
      '::embed[docker.x.i01]',
      '```',
      '::embed[docker.x.i02]',
      '::lab[docker.lab.y]',
      '::oops',
      '## 코드',
      '::needs-enrichment',
      '## 핵심',
      '::ku-list',
    ].join('\n');
    const p = parseBody(body);
    expect(p.sections.map((s) => s.title)).toEqual(['이론', '코드', '핵심']);
    expect(p.h1).toEqual([]);
    const theory = p.sections[0];
    expect(theory).toBeDefined();
    if (theory === undefined) {
      return;
    }
    expect(h3Titles(theory.lines)).toEqual(['왜 필요한가']);
    expect(h3Block(theory.lines, '왜 필요한가')).not.toBeNull();
    expect(fencesOf(theory.lines)).toHaveLength(1);
    expect(fencesOf(theory.lines)[0]?.key).toBe('dg_a');
    expect(directivesOf(theory.lines).map((d) => `${d.name}:${d.arg}`)).toEqual([
      'embed:docker.x.i02',
      'lab:docker.lab.y',
    ]);
    expect(conceptLinksOf(theory.lines)).toEqual(['docker.image-layer']);
    expect(p.malformedDirectives.map((m) => m.text)).toEqual(['::oops']);
    expect(directivesOf(p.sections[1]?.lines ?? []).map((d) => d.name)).toEqual(['needs-enrichment']);
    expect(directivesOf(p.sections[2]?.lines ?? []).map((d) => d.name)).toEqual(['ku-list']);
  });

  it('UT-PACKC-012 an unclosed fence is reported [FR-CUR-002]', () => {
    expect(parseBody('## 이론\n```ts\ncode\n').unclosedFences).toEqual([2]);
    expect(parseBody('# title\n## 이론\n').h1).toEqual(['title']);
  });
});

describe('UT-PACKC-013 discover [FR-CUR-002]', () => {
  it('UT-PACKC-013 classifies every recognised path of the input tree table [FR-CUR-002]', () => {
    const kinds: readonly [string, string][] = [
      ['packs/docker/pack.yaml', 'pack'],
      ['packs/docker/concepts/docker.dockerfile.md', 'concept'],
      ['packs/docker/kus/docker.dockerfile.yaml', 'kus'],
      ['packs/docker/misconceptions/docker.dockerfile.yaml', 'misconceptions'],
      ['packs/docker/items/docker.dockerfile.yaml', 'items'],
      ['packs/docker/item-models/docker.dockerfile.yaml', 'item-models'],
      ['packs/docker/rubrics/x.yaml', 'rubrics'],
      ['templates/t2/ku-cloze.yaml', 'templates-t2'],
      ['templates/dig/generic-01.yaml', 'templates-dig'],
      ['templates/rubrics/solo-5.yaml', 'rubrics'],
      ['sources/registry.yaml', 'sources-registry'],
      ['sources/requests/WP-T-k8s.A.yaml', 'sources-requests'],
      ['review/V7/docker/v7.docker.001.yaml', 'review-v7'],
    ];
    for (const [rel, kind] of kinds) {
      const d = classify(rel);
      expect(d?.type, rel).toBe('file');
      if (d?.type === 'file') {
        expect(d.kind, rel).toBe(kind);
      }
    }
    const rubric = classify('templates/rubrics/solo-5.yaml');
    expect(rubric?.type === 'file' && rubric.common).toBe(true);
    const v7 = classify('review/V7/docker/v7.docker.001.yaml');
    expect(v7?.type === 'file' && v7.packDir).toBe('docker');
  });

  it('UT-PACKC-013 unsupported assets and unknown paths are V1 problems; README, .schemas and CHANGELOG are ignored [FR-CUR-002]', () => {
    for (const [rel, owner] of [
      ['packs/docker/labs/a/task.md', 'WP-05-12'],
      ['packs/docker/cases/a.case.yaml', '.A'],
      ['packs/docker/artifacts/a.yaml', '.A'],
      ['packs/docker/corrections.yaml', 'release'],
      ['blueprints/pack.yaml', 'WP-BP'],
      ['oracles/ml/a.py', 'WP-05-12'],
      ['packs/x.paths/pack.yaml', 'WP-T-paths'],
    ] as const) {
      const d = classify(rel);
      expect(d?.type, rel).toBe('problem');
      if (d?.type === 'problem') {
        expect(d.code).toBe('unsupported-in-it01');
        expect(d.message).toContain(owner);
      }
    }
    for (const rel of [
      'packs/docker/notes.txt',
      'packs/zzz/pack.yaml',
      'misc/a.yaml',
      'templates/other/a.yaml',
      'packs/docker/concepts/sub/a.md',
    ]) {
      const d = classify(rel);
      expect(d?.type, rel).toBe('problem');
      if (d?.type === 'problem') {
        expect(d.code).toBe('unknown-path');
      }
    }
    for (const rel of ['README.md', '.schemas/pack.schema.json', '.source-cache/a/b', 'packs/docker/CHANGELOG.md']) {
      expect(classify(rel), rel).toBeNull();
    }
  });

  it('UT-PACKC-013 discover walks the tree in code-unit order [FR-CUR-002]', () => {
    root = tmpRoot();
    const content = materialize(root);
    const found = discover(content).map((d) => d.rel);
    expect(found).toEqual([...found].sort());
    expect(found).toContain('packs/docker/concepts/docker.dockerfile.md');
    expect(found).toHaveLength(23);
  });
});

describe('UT-PACKC-014 countChars [FR-CUR-002]', () => {
  it('UT-PACKC-014 the DCP-01 section 13.1 docker.dockerfile theory is 921 characters [FR-CUR-002]', () => {
    const text = readFileSync(DOCKERFILE_MD, 'utf8');
    const split = splitFrontmatter(text);
    expect(split.ok).toBe(true);
    if (!split.ok) {
      return;
    }
    const theory = parseBody(split.value.body).sections.find((s) => s.title === '이론');
    expect(theory).toBeDefined();
    expect(countChars(theory?.lines ?? [])).toBe(921);
  });

  it('UT-PACKC-014 strips fences, directives, headings, table rows, link targets and list markers [FR-CUR-002]', () => {
    const p = parseBody(
      [
        '## 이론',
        '### 제목',
        '- **굵게** [링크](https://x.y) `코드`',
        '| a | b |',
        '::ku-list',
        '```ts',
        'long fenced text',
        '```',
        '> 인용',
      ].join('\n'),
    );
    expect(countChars(p.sections[0]?.lines ?? [])).toBe('굵게 링크 코드 인용'.length);
  });
});

describe('UT-PACKC-015 encoding [FR-CUR-002]', () => {
  it('UT-PACKC-015 a BOM or CRLF is a V1 encoding error [FR-CUR-002]', () => {
    root = tmpRoot();
    writeFileSync(join(root, 'bom.yaml'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('a: 1\n')]));
    writeFileSync(join(root, 'crlf.yaml'), 'a: 1\r\nb: 2\r\n');
    writeFileSync(join(root, 'bad.yaml'), Buffer.from([0xff, 0xfe, 0x41]));
    const mk = (name: string): DiscoveredFile => ({
      type: 'file',
      rel: name,
      kind: 'sources-registry',
      track: null,
      name,
      base: name,
      common: false,
      packDir: null,
    });
    for (const [name, text] of [
      ['bom.yaml', 'BOM'],
      ['crlf.yaml', 'CR'],
      ['bad.yaml', 'UTF-8'],
    ] as const) {
      const r = loadFile(root, mk(name));
      expect(r.raw).toBeNull();
      expect(r.findings[0]?.message.startsWith('encoding:')).toBe(true);
      expect(r.findings[0]?.message).toContain(text);
    }
  });
});
