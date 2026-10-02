// UT-PACKC-001·080~087 — scaffold: R4 §5 표 → Tier C 골격 469 + pack.yaml 20.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseYamlStrict } from '@fathom/shared-kernel/policy/policy';
import { afterEach, describe, expect, it } from 'vitest';
import { PackYaml } from '../../../src/parse/schema/pack.js';
import { parseR4 } from '../../../src/scaffold/r4.js';
import { addDays, englishTitle, renderConcept, renderPackYaml, stage2Kind } from '../../../src/scaffold/render.js';
import { TRACKS, trackOf } from '../../../src/scaffold/tracks.js';
import { FIXTURES, lines, listCases, materialize, REPO_R4, rmTmp, run, tmpRoot } from '../cli/helpers.js';

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

/** 실제 R4로 scaffold한 content 트리(+ base의 templates·registry). */
function scaffolded(): string {
  const root = tmp();
  const content = join(root, 'content');
  const r = run(['scaffold', '--content-dir', content, '--as-of', '2026-10-02']);
  expect(r.code).toBe(0);
  cpSync(join(FIXTURES, 'base/content/templates'), join(content, 'templates'), { recursive: true });
  cpSync(join(FIXTURES, 'base/content/sources'), join(content, 'sources'), { recursive: true });
  return content;
}

const R4_TEXT = readFileSync(REPO_R4, 'utf8');

describe('UT-PACKC-080 R4 parse [FR-CUR-001]', () => {
  it('UT-PACKC-080 the real R4 yields 469 rows, 518 edges and no missing concept file [FR-CUR-001]', () => {
    const t = parseR4(R4_TEXT);
    expect(t.ok).toBe(true);
    if (!t.ok) {
      return;
    }
    expect(t.value.rows).toHaveLength(469);
    expect(t.value.edges).toBe(518);
    const content = tmp();
    const r = run(['scaffold', '--content-dir', join(content, 'content'), '--as-of', '2026-10-02']);
    expect(lines(r.stdout)).toEqual(['scaffold rows=469 edges=518 created=469 skipped=0 packs_created=20']);
    const files = new Set<string>();
    for (const t of readdirSync(join(content, 'content/packs'))) {
      for (const f of readdirSync(join(content, 'content/packs', t, 'concepts'))) {
        files.add(f.replace(/\.md$/, ''));
      }
    }
    expect([...files].sort()).toEqual(t.value.rows.map((x) => x.id).sort());
    const perTrack = new Map<string, number>();
    for (const row of t.value.rows) {
      perTrack.set(row.track, (perTrack.get(row.track) ?? 0) + 1);
    }
    expect(perTrack.get('alg')).toBe(29);
    expect(perTrack.get('data')).toBe(10);
    expect(perTrack.size).toBe(20);
  });
});

describe('UT-PACKC-081 K and layer mapping [FR-CUR-001]', () => {
  const row = (over: Partial<Parameters<typeof renderConcept>[0]> = {}) => ({
    id: 'alg.demo-x',
    track: 'alg',
    titleKo: '데모',
    level: 1 as const,
    primary: 'C' as const,
    secondary: [] as const,
    layer: '이·코·핵' as const,
    prereqs: [] as string[],
    ...over,
  });

  it('UT-PACKC-081 X/Y becomes primary + secondary and a single K has an empty secondary [FR-CUR-001]', () => {
    const t = trackOf('alg');
    expect(t).toBeDefined();
    if (t === undefined) {
      return;
    }
    expect(renderConcept(row({ primary: 'S', secondary: ['P'] }), t, '2026-10-02')).toContain(
      'knowledge_type: { primary: S, secondary: [P] }',
    );
    expect(renderConcept(row(), t, '2026-10-02')).toContain('knowledge_type: { primary: C, secondary: [] }');
  });

  it('UT-PACKC-081 stage2_kind: P is code; 사 or S is case; otherwise code [FR-CUR-001]', () => {
    expect(stage2Kind(row({ primary: 'P' }))).toBe('code');
    expect(stage2Kind(row({ primary: 'P', layer: '이·사·핵' }))).toBe('code');
    expect(stage2Kind(row({ primary: 'S' }))).toBe('case');
    expect(stage2Kind(row({ primary: 'C', layer: '이·사·핵' }))).toBe('case');
    expect(stage2Kind(row({ primary: 'C', layer: '이·핵' }))).toBe('code');
    expect(stage2Kind(row({ primary: 'D' }))).toBe('code');
  });

  it('UT-PACKC-081 the parser reads mixed K and layers from the real R4 [FR-CUR-001]', () => {
    const t = parseR4(R4_TEXT);
    expect(t.ok).toBe(true);
    if (!t.ok) {
      return;
    }
    const by = new Map(t.value.rows.map((r) => [r.id, r]));
    expect(by.get('alg.tree-bst')).toMatchObject({ primary: 'C', secondary: ['P'], layer: '이·코·핵', level: 2 });
    expect(by.get('alg.dp')).toMatchObject({ primary: 'S', secondary: ['P'] });
    expect(by.get('alg.amortized')?.layer).toBe('이·핵');
    expect(by.get('alg.algorithm-engineering')?.layer).toBe('이·사·핵');
    expect(by.get('alg.cache-aware')?.prereqs).toEqual(['alg.amortized', 'cs.memory-hierarchy']);
    expect(by.get('alg.complexity')?.prereqs).toEqual([]);
  });
});

describe('UT-PACKC-082 exact bytes [FR-CUR-001]', () => {
  it('UT-PACKC-082 net.tcp-handshake equals the Brief template [FR-CUR-001]', () => {
    const content = scaffolded();
    const text = readFileSync(join(content, 'packs/net/concepts/net.tcp-handshake.md'), 'utf8');
    expect(text).toBe(`---
schema_v: 1
id: net.tcp-handshake
track: net
level: 2
tier: C
knowledge_type: { primary: C, secondary: [] }
stage2_kind: code
title: { ko: "TCP 연결 수립/종료·상태 (TIME_WAIT)", en: "Tcp handshake" }
summary_ko: "TCP 연결 수립/종료·상태 (TIME_WAIT): 네트워크·프로토콜 트랙의 L2 개념이다."
aliases: ["Tcp handshake"]
tags: []
volatility: stable
required_for_level: null
prereqs: [net.tcp-udp]
sources:
  - { source_id: src.rfc-9293, locator: "/", section: "트랙 기본 출처", usage: link_only, retrieved_at: "2026-10-02" }
review: { valid_as_of: "2026-10-02", review_by: "2029-10-01" }
---

## 이론

TCP 연결 수립/종료·상태 (TIME_WAIT): 네트워크·프로토콜 트랙의 L2 개념이다.

## 코드

::needs-enrichment

## 핵심

- 무엇인가: TCP 연결 수립/종료·상태 (TIME_WAIT)는 무엇이고 어떤 문제를 푸는가?
- 왜 필요한가: TCP 연결 수립/종료·상태 (TIME_WAIT)가 없으면 무엇이 어려워지는가?
- 언제 쓰지 않나: TCP 연결 수립/종료·상태 (TIME_WAIT)를 쓰지 않는 편이 나은 상황은?
`);
    expect(englishTitle('net.tcp-handshake')).toBe('Tcp handshake');
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
  });
});

describe('UT-PACKC-083 idempotence [FR-CUR-001]', () => {
  it('UT-PACKC-083 existing files are never overwritten and a second run creates nothing [FR-CUR-001]', () => {
    const root = tmp();
    const content = join(root, 'content');
    const args = ['scaffold', '--content-dir', content, '--as-of', '2026-10-02'];
    run(args);
    const concept = join(content, 'packs/alg/concepts/alg.complexity.md');
    const pack = join(content, 'packs/alg/pack.yaml');
    writeFileSync(concept, 'edited by an authoring WP\n');
    writeFileSync(pack, 'edited pack\n');
    const second = run(['scaffold', '--content-dir', content, '--as-of', '2027-01-01']);
    expect(lines(second.stdout)).toEqual(['scaffold rows=469 edges=518 created=0 skipped=469 packs_created=0']);
    expect(readFileSync(concept, 'utf8')).toBe('edited by an authoring WP\n');
    expect(readFileSync(pack, 'utf8')).toBe('edited pack\n');
    const parts = readdirSync(join(content, 'packs/alg/concepts'));
    expect(parts.some((f) => f.endsWith('.tmp'))).toBe(false);
  });

  it('UT-PACKC-083 a deleted file is recreated and the rest is skipped [FR-CUR-001]', () => {
    const root = tmp();
    const content = join(root, 'content');
    const args = ['scaffold', '--content-dir', content, '--as-of', '2026-10-02'];
    run(args);
    const path = join(content, 'packs/cs/concepts/cs.memory-hierarchy.md');
    const text = readFileSync(path, 'utf8');
    rmSync(path);
    expect(lines(run(args).stdout)).toEqual(['scaffold rows=469 edges=518 created=1 skipped=468 packs_created=0']);
    expect(readFileSync(path, 'utf8')).toBe(text);
  });
});

describe('UT-PACKC-084 pack.yaml [FR-CUR-001][FR-CUR-009]', () => {
  it('UT-PACKC-084 20 pack.yaml files pass PackYaml and carry the TRACKS table values [FR-CUR-001]', () => {
    const content = scaffolded();
    expect(TRACKS).toHaveLength(20);
    expect(TRACKS.map((t) => t.sort)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    for (const t of TRACKS) {
      const text = readFileSync(join(content, 'packs', t.id, 'pack.yaml'), 'utf8');
      const parsed = parseYamlStrict(text);
      expect(parsed.ok, t.id).toBe(true);
      if (!parsed.ok) {
        continue;
      }
      const pack = PackYaml.parse(parsed.value);
      expect(pack).toMatchObject({ id: t.id, version: '0.1.0', channel: 'seed', content_license: 'repo' });
      expect(pack.track).toMatchObject({
        id: t.id,
        name_ko: t.name_ko,
        name_en: t.name_en,
        track_group: t.group,
        sort_order: t.sort,
        summary_ko: t.summary_ko,
      });
      expect(pack.requires).toEqual({
        packc: '>=0.1.0 <1.0.0',
        policy: { mastery_rules: 'v1', gate_thresholds: 'v1' },
      });
      expect(text.split('\n').slice(0, 2)).toEqual([
        `# content/packs/${t.id}/pack.yaml`,
        '# yaml-language-server: $schema=../../.schemas/pack.schema.json',
      ]);
    }
    expect(trackOf('data')?.group).toBe('app');
    expect(trackOf('linux')?.group).toBe('foundation');
    expect(trackOf('sec')?.group).toBe('security');
    expect(trackOf('llm')?.group).toBe('ai');
    expect(trackOf('lead')?.group).toBe('design_lead');
    expect(renderPackYaml('nope')).toBeNull();
  });

  it('UT-PACKC-084 the docker pack.yaml equals the base fixture copy byte for byte [FR-CUR-001]', () => {
    const content = scaffolded();
    expect(readFileSync(join(content, 'packs/docker/pack.yaml'), 'utf8')).toBe(
      readFileSync(join(FIXTURES, 'base/content/packs/docker/pack.yaml'), 'utf8'),
    );
  });
});

describe('UT-PACKC-085 volatility and review_by [FR-CUR-009]', () => {
  it('UT-PACKC-085 volatility per track and review_by = valid_as_of + 1095 / 180 / 90 days [FR-CUR-009]', () => {
    const content = scaffolded();
    const pick = (path: string): { vol: string; by: string } => {
      const text = readFileSync(join(content, path), 'utf8');
      return { vol: /^volatility: (\w+)$/m.exec(text)?.[1] ?? '', by: /review_by: "([\d-]+)"/.exec(text)?.[1] ?? '' };
    };
    expect(pick('packs/alg/concepts/alg.complexity.md')).toEqual({ vol: 'stable', by: '2029-10-01' });
    expect(pick('packs/k8s/concepts/k8s.pod.md')).toEqual({ vol: 'evolving', by: '2027-03-31' });
    expect(pick('packs/llm/concepts/llm.prompting.md')).toEqual({ vol: 'volatile', by: '2026-12-31' });
    for (const [id, vol] of [
      ['fe', 'evolving'],
      ['cicd', 'evolving'],
      ['cloud', 'evolving'],
      ['ml', 'evolving'],
      ['sec', 'evolving'],
      ['data', 'evolving'],
      ['net', 'stable'],
      ['db', 'stable'],
      ['lead', 'stable'],
    ] as const) {
      expect(trackOf(id)?.volatility, id).toBe(vol);
    }
    expect(addDays('2026-10-02', 90)).toBe('2026-12-31');
    expect(addDays('2027-12-31', 1)).toBe('2028-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });
});

describe('UT-PACKC-086 broken R4 [FR-CUR-001]', () => {
  const header = '| id | 개념 | L | K | 층 | 선수 |\n|---|---|---|---|---|---|\n';
  const doc = (rows: string): string => `### 5.1 \`alg\` x (1)\n\n${header}${rows}\n`;
  const attempt = (text: string): { code: number; stderr: string; wrote: boolean } => {
    const root = tmp();
    const from = join(root, 'R4.md');
    writeFileSync(from, text);
    const content = join(root, 'content');
    const r = run(['scaffold', '--from', from, '--content-dir', content, '--as-of', '2026-10-02']);
    return { code: r.code, stderr: r.stderr, wrote: existsSync(content) };
  };

  it('UT-PACKC-086 an empty table, duplicate ids and missing prerequisites are exit 2 with nothing written [FR-CUR-001]', () => {
    const ok = '| alg.a | 가 | L1 | C | 이·코·핵 | — |\n';
    expect(attempt(doc(ok))).toMatchObject({ code: 0 });
    for (const text of [
      doc(''),
      '# no sections at all\n',
      doc(`${ok}${ok}`),
      doc('| alg.a | 가 | L1 | C | 이·코·핵 | alg.zzz |\n'),
      doc('| cs.a | 가 | L1 | C | 이·코·핵 | — |\n'),
      doc('| alg.a | 가 | L6 | C | 이·코·핵 | — |\n'),
      doc('| alg.a | 가 | L1 | X | 이·코·핵 | — |\n'),
      doc('| alg.a | 가 | L1 | C/P/S | 이·코·핵 | — |\n'),
      doc('| alg.a | 가 | L1 | C | 코·핵 | — |\n'),
      doc('| alg.a | 가 | L1 | C | 이·코·핵 |\n'),
      doc('| Alg.a | 가 | L1 | C | 이·코·핵 | — |\n'),
    ]) {
      const r = attempt(text);
      expect(r.code, text).toBe(2);
      expect(r.stderr.startsWith('packc: ')).toBe(true);
      expect(r.stderr.split('\n').filter((l) => l !== '')).toHaveLength(1);
      expect(r.wrote, text).toBe(false);
    }
  });

  it('UT-PACKC-086 a missing R4 file and an unknown track are exit 2 [FR-CUR-001]', () => {
    const root = tmp();
    expect(run(['scaffold', '--from', join(root, 'nope.md'), '--content-dir', join(root, 'content')]).code).toBe(2);
    const text = `### 5.1 \`zzz\` x\n\n${header}| zzz.a | 가 | L1 | C | 이·코·핵 | — |\n`;
    expect(attempt(text).code).toBe(2);
  });
});

describe('UT-PACKC-087 scaffold + base registry check [FR-CUR-001][FR-CUR-009]', () => {
  it('UT-PACKC-087 the scaffolded tree checks clean (error 0) within the 10 second budget [FR-CUR-009]', () => {
    const content = scaffolded();
    const started = Date.now();
    const r = run(['check', '--content-dir', content]);
    const elapsed = Date.now() - started;
    expect(
      r.code,
      r.stdout
        .split('\n')
        .filter((l) => l.startsWith('error'))
        .slice(0, 5)
        .join('\n'),
    ).toBe(0);
    const summary = lines(r.stdout).at(-1) ?? '';
    expect(summary).toMatch(/^content:check packs=20 files=\d+ errors=0 warnings=\d+$/);
    expect(summary).toContain('files=');
    expect(elapsed).toBeLessThan(10_000);
  });
});

describe('UT-PACKC-001 R-3STAGE on the real scaffold [FR-CUR-005]', () => {
  it('UT-PACKC-001 469 scaffolded concepts have no R-3STAGE finding; r-3stage fixtures each fail [FR-CUR-005]', () => {
    const content = scaffolded();
    const r = run(['check', '--content-dir', content, '--json']);
    const out = JSON.parse(r.stdout);
    expect(out.findings.filter((f: { rule: string }) => f.rule === 'R-3STAGE')).toEqual([]);
    expect(out.summary.errors).toBe(0);
    const cases = listCases().filter((c) => c.rule === 'r-3stage');
    expect(cases.length).toBeGreaterThanOrEqual(3);
    for (const c of cases) {
      const root = tmp();
      const dir = materialize(root, { ...c.spec, overlay: c.dir });
      const res = run(['check', '--content-dir', dir]);
      expect(res.code, c.name).toBe(1);
      expect(res.stdout, c.name).toContain('error R-3STAGE');
    }
  });

  it('UT-PACKC-001 a scaffolded skeleton edited away from the template fails R-3STAGE [FR-CUR-005]', () => {
    const content = scaffolded();
    const path = join(content, 'packs/alg/concepts/alg.complexity.md');
    mkdirSync(join(content, 'packs/alg/concepts'), { recursive: true });
    writeFileSync(path, readFileSync(path, 'utf8').replace('::needs-enrichment', 'handwritten'));
    const r = run(['check', '--content-dir', content, '--pack', 'alg']);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('Tier C code must be exactly ::needs-enrichment');
  });
});
