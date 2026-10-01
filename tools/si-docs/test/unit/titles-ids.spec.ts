import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type CliEnv, run } from '../../src/cli.js';
import {
  countIds,
  duplicateProblems,
  itBandProblem,
  locationProblem,
  outOfRangeProblems,
  overlapProblems,
  parseBrief,
  parseProseRanges,
  placementProblems,
} from '../../src/ids.js';
import { collectResults, mergeById, parsePlaywrightJson, parseTap, parseVitestJson } from '../../src/results.js';
import { buildRtm } from '../../src/rtm.js';
import { parseRtmTables } from '../../src/rtm-source.js';
import {
  isTestSourcePath,
  parseTitle,
  scanSource as scanSourceRaw,
  scanSources as scanSourcesRaw,
} from '../../src/titles.js';

const fixture = (name: string): string => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

function makeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'fathom-sid-'));
  dirs.push(root);
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, fake(text));
  }
  return root;
}

function env(): { env: CliEnv; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    env: {
      now: () => 1_790_000_000_000,
      commit: () => 'abc1234',
      nodeVersion: 'v22.22.2',
      out: (l) => out.push(l),
      err: (l) => err.push(l),
    },
  };
}

/** 소스 문자열 안의 템플릿 치환 시작을 `#{`로 적는다(biome noTemplateCurlyInString 회피). */
/**
 * 가짜 테스트 소스 안의 `IT(`·`TEST(` 를 `it(`·`test(` 로 되돌린다. 이 파일 안의 문자열을 정적 스캐너가
 * 실제 테스트 제목으로 읽지 않도록(중복 ID·위치 오탐 방지) 소스 문자열에는 대문자로 적는다.
 */
const fake = (text: string): string => text.replace(/\bIT(?=[.(])/g, 'it').replace(/\bTEST(?=[.(])/g, 'test');

const sub = (text: string): string => text.replaceAll('#{', ['$', '{'].join(''));

const scanSource = (file: string, text: string): ReturnType<typeof scanSourceRaw> => scanSourceRaw(file, fake(text));
const scanSources = (files: { path: string; text: string }[]): ReturnType<typeof scanSourcesRaw> =>
  scanSourcesRaw(files.map((f) => ({ ...f, text: fake(f.text) })));

const SAMPLE = 'UT-LR-012 같은 verdict 재수신은 원장 삽입 0건 [FR-PRG-001][NFR-DATA-013]';

describe('title parser', () => {
  it('UT-SID-001 제목에서 id·요구 2개를 뽑아 RTM 행에 매핑하고 요구 ID가 없으면 no-req 오류를 낸다 [NFR-MAINT-011]', () => {
    const parsed = parseTitle(SAMPLE);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.value.id).toBe('UT-LR-012');
    expect(parsed.value.desc).toBe('같은 verdict 재수신은 원장 삽입 0건');
    expect(parsed.value.reqs).toEqual(['FR-PRG-001', 'NFR-DATA-013']);
    expect(parsed.value.refs).toEqual(['FR-PRG-001', 'NFR-DATA-013']);
    // RTM 행 매핑
    const scan = scanSource('services/learning/test/unit/ledger/x.spec.ts', `IT('${SAMPLE}', () => {});\n`);
    expect(scan.titles).toHaveLength(1);
    const build = buildRtm({
      int: 'INT-1a',
      rows: parseRtmTables(fixture('rtm-mini.md')),
      titles: scan.titles,
      titleErrors: scan.errors,
      results: [],
      manifest: null,
      generatedAt: 1,
      commit: 'x',
    });
    const row = build.json.requirements.find((r) => r.id === 'FR-PRG-001');
    expect(row?.tests.map((t) => t.id)).toEqual(['UT-LR-012']);
    expect(build.json.requirements.find((r) => r.id === 'NFR-DATA-013')?.tests.map((t) => t.id)).toEqual(['UT-LR-012']);
    // 요구 ID 0개
    const none = parseTitle('UT-LR-099 요구 참조가 없는 제목');
    expect(none).toMatchObject({ ok: false, reason: 'no-req' });
    expect(parseTitle('UT-LR-099 이상한 참조 [AP-15][foo]')).toMatchObject({ ok: false, reason: 'no-req' });
    expect(parseTitle('그냥 제목 [FR-PRG-001]')).toMatchObject({ ok: false, reason: 'no-id' });
  });

  it('UT-SID-002 같은 ID가 2파일이면 si/duplicate-id, Brief 범위 밖 ID는 si/out-of-range이며 ids 명령은 exit 1이다 [NFR-MAINT-011]', () => {
    const entries = [
      { id: 'UT-SID-001', file: 'tools/si-docs/test/unit/a.spec.ts', line: 3 },
      { id: 'UT-SID-001', file: 'tools/si-docs/test/unit/b.spec.ts', line: 9 },
      { id: 'UT-SID-002', file: 'tools/si-docs/test/unit/a.spec.ts', line: 20 },
    ];
    const dup = duplicateProblems(entries);
    expect(dup.map((d) => `${d.file}:${d.line}:${d.rule}`)).toEqual([
      'tools/si-docs/test/unit/a.spec.ts:3:si/duplicate-id',
      'tools/si-docs/test/unit/b.spec.ts:9:si/duplicate-id',
    ]);
    // 범위 밖: YAML test_ids 와 산문 대체 둘 다
    const yamlBrief = parseBrief('docs/40-impl/briefs/IT-00/T-00-91.md', fixture('brief-yaml.md'));
    const proseBrief = parseBrief('docs/40-impl/briefs/IT-00/T-00-92.md', fixture('brief-prose.md'));
    const inYaml = [
      { id: 'UT-SID-003', file: 'tools/sample/test/unit/x.spec.ts', line: 1 },
      { id: 'UT-SID-006', file: 'tools/sample/test/unit/x.spec.ts', line: 2 },
      { id: 'UT-SID-006', file: 'elsewhere/test/unit/x.spec.ts', line: 3 },
    ];
    expect(outOfRangeProblems(inYaml, yamlBrief).map((d) => `${d.line}:${d.rule}`)).toEqual(['2:si/out-of-range']);
    const proseEntries = [
      { id: 'UT-CON-005', file: 'packages/contracts/test/unit/a.spec.ts', line: 1 },
      { id: 'UT-CON-004', file: 'packages/contracts/test/unit/a.spec.ts', line: 2 },
      { id: 'UT-CON-099', file: 'packages/contracts/test/unit/a.spec.ts', line: 3 },
      { id: 'UT-CON-100', file: 'packages/contracts/test/unit/a.spec.ts', line: 4 },
    ];
    const proseBriefWithPaths = { ...proseBrief, allowedPaths: ['packages/contracts/test/**'] };
    expect(outOfRangeProblems(proseEntries, proseBriefWithPaths).map((d) => d.line)).toEqual([2, 4]);
    // ids 명령: 중복 + 범위 밖 → exit 1, 깨끗하면 exit 0
    const brief = fixture('brief-yaml.md').replaceAll('tools/sample', 'tools/si-docs');
    const title = (id: string): string => `IT('${id} 동작 [FR-PRG-001]', () => {});\n`;
    const repo = makeRepo({
      'docs/40-impl/briefs/IT-00/T-00-91.md': brief,
      'tools/si-docs/test/unit/a.spec.ts': title('UT-SID-001') + title('UT-SID-002') + title('UT-SID-077'),
      'tools/si-docs/test/unit/b.spec.ts': title('UT-SID-001'),
    });
    const e = env();
    expect(run(['ids', '--root', repo, '--task', 'T-00-91'], e.env)).toBe(1);
    const text = e.out.join('\n');
    expect(text).toMatch(/si\/duplicate-id/);
    expect(text).toMatch(/a\.spec\.ts:3 {2}error {2}si\/out-of-range/);
    const clean = makeRepo({
      'docs/40-impl/briefs/IT-00/T-00-91.md': brief,
      'tools/si-docs/test/unit/a.spec.ts': title('UT-SID-001') + title('UT-SID-002'),
    });
    const e2 = env();
    expect(run(['ids', '--root', clean, '--task', 'T-00-91'], e2.env)).toBe(0);
    expect(e2.out.at(-1)).toBe('[si:ids] 0 error(s), 2 test ID(s) in 1 file(s)');
    expect(run(['ids', '--root', clean, '--task', 'T-99-99'], env().env)).toBe(2);
  });

  it('UT-SID-010 제목 정규식 경계: UNIT 집합·CT-SYS·SEC-SYS·IT-0n 2자리 거부·범위 참조·템플릿 제목 [NFR-MAINT-011][PR-018]', () => {
    for (const unit of [
      'GW',
      'CT',
      'LR',
      'AI',
      'OP',
      'SUP',
      'WEB',
      'CLI',
      'CON',
      'SK',
      'TOK',
      'UI',
      'TK',
      'GATE',
      'PACKC',
      'GRAPH',
      'FCLI',
      'SID',
    ]) {
      expect(parseTitle(`UT-${unit}-001 동작 [FR-AAA-001]`).ok, unit).toBe(true);
    }
    expect(parseTitle('UT-ZZZ-001 동작 [FR-AAA-001]')).toMatchObject({ ok: false, reason: 'no-id' });
    expect(parseTitle('UT-SYS-001 동작 [FR-AAA-001]')).toMatchObject({ ok: false, reason: 'no-id' });
    expect(parseTitle('CT-SYS-008 교차 계약 [IF-COM-003]').ok).toBe(true);
    expect(parseTitle('SEC-SYS-001 교차 보안 [NFR-SEC-001]').ok).toBe(true);
    expect(parseTitle('CT-LR-001 계약 [IF-LR-001]').ok).toBe(true);
    expect(parseTitle('IT-03 반복 번호 [FR-AAA-001]')).toMatchObject({ ok: false, reason: 'no-id' });
    expect(parseTitle('IT-0031 [FR-AAA-001]')).toMatchObject({ ok: false });
    expect(parseTitle('IT-003 통합 [FR-AAA-001]').ok).toBe(true);
    expect(parseTitle('E2E-013 e2e [FR-AAA-001]').ok).toBe(true);
    expect(parseTitle('CHA-001 카오스 [NFR-AVL-002]').ok).toBe(true);
    expect(parseTitle('PRF-001 성능 [NFR-PERF-001]').ok).toBe(true);
    const range = parseTitle('CT-CON-601 헬스 [IF-COM-001~010][NFR-AVL-006]');
    expect(range.ok && range.value.refs).toEqual(['IF-COM-001~010', 'NFR-AVL-006']);
    expect(range.ok && range.value.reqs).toEqual(['NFR-AVL-006']);
    const only = parseTitle('CT-CON-602 범위 참조만 [IF-COM-001~010]');
    expect(only.ok).toBe(true);
    const fr = parseTitle('UT-SID-001 범위 요구 [FR-AAA-001~003]');
    expect(fr.ok && fr.value.reqs).toEqual(['FR-AAA-001', 'FR-AAA-002', 'FR-AAA-003']);
    const dyn = scanSource(
      'tools/si-docs/test/unit/x.spec.ts',
      sub('IT(`UT-SID-001 #{name} [FR-AAA-001]`, () => {});\n'),
    );
    expect(dyn.errors).toEqual([
      {
        file: 'tools/si-docs/test/unit/x.spec.ts',
        line: 1,
        title: sub('UT-SID-001 #{name} [FR-AAA-001]'),
        reason: 'dynamic-title',
      },
    ]);
    expect(dyn.titles).toHaveLength(0);
  });

  it('UT-SID-011 정적 스캔은 it.skip·test.only·.test.mjs 를 읽고 .test() 호출·주석·fixture 경로는 건너뛴다 [NFR-MAINT-011][PR-018]', () => {
    const src = [
      "IT('UT-SID-001 일반 [FR-AAA-001]', () => {});",
      "IT.skip('UT-SID-002 건너뜀 [FR-AAA-001]', () => {});",
      "TEST.only('UT-SID-003 단독 [FR-AAA-001]', () => {});",
      'IT.todo("UT-SID-004 할 일 [FR-AAA-001]");',
      "IT.concurrent('UT-SID-005 동시 [FR-AAA-001]', async () => {});",
      "const ok = /x/.test('UT-SID-099 정규식 검사 [FR-AAA-001]');",
      "// IT('UT-SID-098 주석 [FR-AAA-001]', () => {});",
      " * IT('UT-SID-097 블록 주석 [FR-AAA-001]', () => {});",
      "describe('묶음 제목', () => {});",
      "IT('제목에 ID 없음', () => {});",
    ].join('\n');
    const r = scanSource('tools/si-docs/test/unit/x.spec.ts', src);
    expect(r.titles.map((t) => [t.id, t.line])).toEqual([
      ['UT-SID-001', 1],
      ['UT-SID-002', 2],
      ['UT-SID-003', 3],
      ['UT-SID-004', 4],
      ['UT-SID-005', 5],
    ]);
    expect(r.errors).toEqual([
      { file: 'tools/si-docs/test/unit/x.spec.ts', line: 10, title: '제목에 ID 없음', reason: 'no-id' },
    ]);
    const mjs = scanSources([
      { path: 'tools/gates/test/lex.test.mjs', text: "TEST('UT-GATE-001 어휘 [NFR-MAINT-001]', () => {});\n" },
      {
        path: 'tools/gates/test/fixtures/x.test.mjs',
        text: "TEST('UT-GATE-002 fixture [NFR-MAINT-001]', () => {});\n",
      },
      { path: 'tools/si-docs/test/fixtures/y.spec.ts', text: "IT('UT-SID-001 fixture [FR-AAA-001]', () => {});\n" },
      { path: 'src/not-a-TEST.ts', text: "IT('UT-SID-001 소스 [FR-AAA-001]', () => {});\n" },
    ]);
    expect(mjs.titles.map((t) => t.id)).toEqual(['UT-GATE-001']);
    for (const ok of [
      'apps/web/test/unit/a.spec.ts',
      'services/ops/test/integration/a.spec.ts',
      'packages/ui/test/component/a.spec.tsx',
      'tools/gates/test/lex.test.mjs',
      'tests/e2e/a.spec.ts',
      'tests/perf/run-all.ts',
    ]) {
      expect(isTestSourcePath(ok), ok).toBe(true);
    }
    for (const no of [
      'src/a.spec.ts',
      'tools/gates/test/sub/a.test.mjs',
      'tests/support/a.ts',
      'packages/ui/src/a.spec.ts',
    ]) {
      expect(isTestSourcePath(no), no).toBe(false);
    }
  });

  it('UT-SID-012 vitest JSON 어댑터는 상태를 정규화하고 ID·실패 메시지 첫 줄·소요를 담는다 [NFR-MAINT-011][PR-018]', () => {
    const cases = parseVitestJson(JSON.parse(fixture('vitest-results.json')), 'ut');
    expect(cases.map((c) => [c.id, c.status])).toEqual([
      ['UT-LR-012', 'pass'],
      ['UT-LR-013', 'fail'],
      ['UT-LR-014', 'skip'],
      [null, 'skip'],
    ]);
    expect(cases[0]).toMatchObject({
      durationMs: 12.5,
      suite: 'ut',
      file: '/repo/services/learning/test/unit/ledger/x.spec.ts',
    });
    expect(cases[1]?.message).toBe('AssertionError: expected 1 to be 2');
    expect(parseVitestJson('nope', 'ut')).toEqual([]);
    expect(
      parseVitestJson(
        { testResults: [{ name: 'a', assertionResults: [{ title: 'UT-SK-001 x', status: 'timedOut' }] }] },
        'ut',
      )[0]?.status,
    ).toBe('fail');
  });

  it('UT-SID-013 Playwright JSON 어댑터는 중첩 suites를 재귀하고 마지막 결과를 기준으로 상태를 정한다 [NFR-MAINT-011][PR-018]', () => {
    const cases = parsePlaywrightJson(JSON.parse(fixture('playwright-results.json')), 'e2e');
    expect(cases.map((c) => [c.id, c.status])).toEqual([
      ['E2E-001', 'pass'],
      ['E2E-002', 'pass'],
      ['E2E-003', 'fail'],
      ['E2E-004', 'skip'],
    ]);
    expect(cases[1]?.durationMs).toBe(700);
    expect(cases[2]?.message).toBe('Test timeout of 30000ms exceeded.');
    expect(cases.every((c) => c.suite === 'e2e' && c.file === 'e2e/a.spec.ts')).toBe(true);
  });

  it('UT-SID-014 TAP 어댑터는 ok·not ok·SKIP·TODO를 정규화하고 describe 제목은 id 없음으로 둔다 [NFR-MAINT-011][PR-018]', () => {
    const cases = parseTap(fixture('results.tap'), 'gate', 'gates-ut.tap');
    expect(cases.map((c) => [c.id, c.status])).toEqual([
      ['UT-GATE-001', 'pass'],
      ['UT-GATE-002', 'fail'],
      ['UT-GATE-003', 'skip'],
      ['UT-GATE-004', 'skip'],
      [null, 'pass'],
    ]);
    expect(cases[0]?.durationMs).toBe(4.5);
    expect(cases[1]?.message).toBe('expected exit 2');
    expect(cases[2]?.title).toBe('UT-GATE-003 건너뜀 [NFR-MAINT-001]');
    expect(cases.every((c) => c.suite === 'gate')).toBe(true);
  });

  it('UT-SID-015 같은 ID는 하나라도 fail이면 fail로 합치고 패키지 .reports 입력도 같은 규칙으로 병합한다 [NFR-MAINT-011][PR-018]', () => {
    const vitestText = fixture('vitest-results.json');
    const other = JSON.stringify({
      testResults: [
        {
          name: '/repo/packages/x/test/unit/y.spec.ts',
          assertionResults: [
            {
              title: 'UT-LR-012 같은 ID 다른 파일 [FR-PRG-001]',
              status: 'failed',
              duration: 1,
              failureMessages: ['boom'],
            },
          ],
        },
      ],
    });
    const merged = collectResults([
      { key: 'ut', name: 'ut.json', text: vitestText },
      { key: 'ut', name: 'ut.json', text: other },
      { key: null, name: 'gates-ut.tap', text: fixture('results.tap') },
      { key: 'e2e', name: 'e2e.json', text: fixture('playwright-results.json') },
      { key: 'ut', name: 'broken.json', text: '{ not json' },
    ]);
    const byId = new Map(merged.filter((c) => c.id !== null).map((c) => [c.id, c]));
    expect(byId.get('UT-LR-012')?.status).toBe('fail');
    expect(byId.get('UT-LR-012')?.durationMs).toBe(13.5);
    expect(byId.get('UT-GATE-001')?.suite).toBe('gate');
    expect(byId.get('E2E-003')?.suite).toBe('e2e');
    expect(
      mergeById([
        { id: 'UT-SK-001', title: 'a', status: 'pass', durationMs: 1, suite: 'ut', file: 'a' },
        { id: 'UT-SK-001', title: 'a', status: 'skip', durationMs: 1, suite: 'ut', file: 'b' },
      ])[0]?.status,
    ).toBe('skip');
  });

  it('UT-SID-016 위치 규칙: packages·tools 의 test/integration UT 허용(D-P00-06), services 의 test/integration UT 는 위반 [NFR-MAINT-011][PR-018]', () => {
    const loc = (id: string, file: string): string | null => locationProblem({ id, file, line: 1 });
    // UT
    expect(loc('UT-SK-001', 'packages/shared-kernel/test/unit/a.spec.ts')).toBeNull();
    expect(loc('UT-SK-001', 'packages/shared-kernel/test/property/a.spec.ts')).toBeNull();
    expect(loc('UT-SK-001', 'packages/shared-kernel/test/integration/a.spec.ts')).toBeNull();
    expect(loc('UT-PACKC-001', 'tools/packc/test/integration/a.spec.ts')).toBeNull();
    expect(loc('UT-LR-001', 'services/learning/test/integration/a.spec.ts')).toMatch(/must live in/);
    expect(loc('UT-LR-001', 'services/learning/test/unit/a.spec.ts')).toBeNull();
    expect(loc('UT-LR-001', 'services/content/test/unit/a.spec.ts')).toMatch(/services\/learning\/test/);
    expect(loc('UT-OP-001', 'services/ops/test/unit/a.spec.ts')).toBeNull();
    expect(loc('UT-SUP-001', 'services/ops/test/golden/a.spec.ts')).toBeNull();
    expect(loc('UT-GATE-001', 'tools/gates/test/lex.test.mjs')).toBeNull();
    expect(loc('UT-GATE-001', 'tools/gates/test/sub/lex.test.mjs')).toMatch(/must live in/);
    expect(loc('UT-SK-001', 'packages/shared-kernel/test/contract/a.spec.ts')).toMatch(/must live in/);
    // CT · SEC
    expect(loc('CT-LR-001', 'services/learning/test/contract/a.spec.ts')).toBeNull();
    expect(loc('CT-LR-001', 'services/learning/test/unit/a.spec.ts')).toMatch(/contract/);
    expect(loc('CT-SYS-001', 'tests/contract/a.spec.ts')).toBeNull();
    expect(loc('CT-SYS-001', 'services/learning/test/contract/a.spec.ts')).toMatch(/tests\/contract/);
    expect(loc('SEC-GW-001', 'services/gateway/test/security/a.spec.ts')).toBeNull();
    expect(loc('SEC-SYS-001', 'tests/security/a.spec.ts')).toBeNull();
    expect(loc('SEC-CT-001', 'services/content/test/unit/a.spec.ts')).toMatch(/security/);
    // IT · E2E · CHA · PRF
    expect(loc('IT-210', 'services/content/test/integration/a.spec.ts')).toBeNull();
    expect(loc('IT-010', 'tests/integration/a.spec.ts')).toBeNull();
    expect(loc('IT-010', 'tests/e2e/a.spec.ts')).toMatch(/must live in/);
    expect(loc('E2E-001', 'tests/e2e/a.spec.ts')).toBeNull();
    expect(loc('E2E-001', 'tests/integration/a.spec.ts')).toMatch(/tests\/e2e/);
    expect(loc('CHA-001', 'tests/chaos/a.spec.ts')).toBeNull();
    expect(loc('PRF-001', 'tests/perf/a.ts')).toBeNull();
    expect(loc('PRF-001', 'tests/chaos/a.spec.ts')).toMatch(/tests\/perf/);
    const diags = placementProblems([
      { id: 'UT-LR-001', file: 'services/learning/test/integration/a.spec.ts', line: 7 },
    ]);
    expect(diags).toEqual([
      {
        file: 'services/learning/test/integration/a.spec.ts',
        line: 7,
        rule: 'si/id-location',
        message: expect.stringContaining('UT-LR-001'),
      },
    ]);
  });

  it('UT-SID-017 IT 번호가 위치 대역 밖이면 si/it-band 이다(TST §11.2) [NFR-MAINT-011][PR-018]', () => {
    const band = (id: string, file: string): string | null => itBandProblem({ id, file, line: 1 });
    expect(band('IT-001', 'tests/integration/a.spec.ts')).toBeNull();
    expect(band('IT-099', 'tests/integration/a.spec.ts')).toBeNull();
    expect(band('IT-100', 'tests/integration/a.spec.ts')).toMatch(/tests\/integration/);
    expect(band('IT-150', 'services/gateway/test/integration/a.spec.ts')).toBeNull();
    expect(band('IT-250', 'services/gateway/test/integration/a.spec.ts')).toMatch(/services\/gateway/);
    expect(band('IT-201', 'services/content/test/integration/a.spec.ts')).toBeNull();
    expect(band('IT-399', 'services/learning/test/integration/a.spec.ts')).toBeNull();
    expect(band('IT-400', 'services/ai-gateway/test/integration/a.spec.ts')).toBeNull();
    expect(band('IT-599', 'services/ops/test/integration/a.spec.ts')).toBeNull();
    expect(band('IT-600', 'apps/cli/test/integration/a.spec.ts')).toBeNull();
    expect(band('IT-650', 'tools/gates/test/workspace.test.mjs')).toBeNull();
    expect(band('IT-700', 'tools/gates/test/workspace.test.mjs')).toMatch(/650~699/);
    expect(band('UT-LR-001', 'services/learning/test/unit/a.spec.ts')).toBeNull();
    expect(
      placementProblems([{ id: 'IT-250', file: 'services/gateway/test/integration/a.spec.ts', line: 3 }]).map(
        (d) => d.rule,
      ),
    ).toEqual(['si/it-band']);
  });

  it('UT-SID-018 Brief 사이 같은 ID 범위가 겹치면 si/range-overlap 이다 [NFR-MAINT-011][PR-018]', () => {
    const a = parseBrief('docs/40-impl/briefs/IT-00/T-00-91.md', fixture('brief-yaml.md'));
    const b = {
      ...a,
      taskId: 'T-00-95',
      file: 'docs/40-impl/briefs/IT-00/T-00-95.md',
      ranges: [{ prefix: 'UT-SID', from: 4, to: 12 }],
    };
    const c = {
      ...a,
      taskId: 'T-00-96',
      file: 'docs/40-impl/briefs/IT-00/T-00-96.md',
      ranges: [{ prefix: 'UT-SID', from: 20, to: 30 }],
    };
    const diags = overlapProblems([a, b, c]);
    expect(diags).toHaveLength(2);
    expect(diags.map((d) => d.rule)).toEqual(['si/range-overlap', 'si/range-overlap']);
    expect(diags[0]?.message).toBe('T-00-91 and T-00-95 both include UT-SID-004~005');
    expect(diags[1]?.message).toBe('T-00-91 and T-00-95 both include UT-SID-010');
    expect(overlapProblems([a, c])).toEqual([]);
    expect(
      overlapProblems([
        { ...a, ranges: [{ prefix: 'IT', from: 1, to: 5 }] },
        { ...c, ranges: [{ prefix: 'UT-IT', from: 1, to: 5 }] },
      ]),
    ).toEqual([]);
  });

  it('UT-SID-019 Brief 범위 파서는 YAML test_ids·allowed_paths(주석·중괄호)와 산문 대체(UT-CON 95개)를 읽는다 [NFR-MAINT-011][PR-018]', () => {
    const y = parseBrief('docs/40-impl/briefs/IT-00/T-00-91.md', fixture('brief-yaml.md'));
    expect(y.taskId).toBe('T-00-91');
    expect(y.fromYaml).toBe(true);
    expect(y.ranges).toEqual([
      { prefix: 'UT-SID', from: 1, to: 5 },
      { prefix: 'UT-SID', from: 10, to: 10 },
      { prefix: 'IT', from: 650, to: 652 },
    ]);
    expect(y.allowedPaths).toEqual([
      'tools/sample/src/**',
      'tools/sample/test/unit/**/*.spec.ts',
      'tools/sample/test/golden/**/*.spec.ts',
      'tools/sample/package.json',
    ]);
    const p = parseBrief('docs/40-impl/briefs/IT-00/T-00-92.md', fixture('brief-prose.md'));
    expect(p.fromYaml).toBe(false);
    expect(p.ranges.filter((r) => r.prefix === 'UT-CON').length).toBe(6);
    expect(countIds(p.ranges.filter((r) => r.prefix === 'UT-CON'))).toBe(95);
    expect(p.ranges.some((r) => r.prefix === 'CT-CON' && r.from === 200 && r.to === 210)).toBe(true);
    expect(p.ranges.some((r) => r.prefix === 'IT' && r.from === 20)).toBe(true);
    expect(p.ranges.some((r) => r.prefix === 'E2E' && r.from === 301 && r.to === 303)).toBe(true);
    expect(p.ranges.some((r) => r.prefix === 'UT-ZZZ' || r.prefix === 'UT-NOPE')).toBe(false);
    expect(countIds(parseProseRanges('UT-CON-001·002·003·005·006 + UT-CON-010~099'))).toBe(95);
    const real = readFileSync(new URL('../../../../docs/40-impl/briefs/IT-00/T-00-05.md', import.meta.url), 'utf8');
    const t5 = parseBrief('docs/40-impl/briefs/IT-00/T-00-05.md', real);
    expect(t5.taskId).toBe('T-00-05');
    expect(t5.fromYaml).toBe(true);
    expect(t5.ranges.map((r) => `${r.prefix}-${r.from}~${r.to}`)).toEqual([
      'UT-GATE-1~5',
      'UT-GATE-10~49',
      'UT-SID-1~2',
      'UT-SID-10~39',
      'UT-GRAPH-1~19',
    ]);
    expect(t5.allowedPaths).toContain('tools/gates/test/lex.test.mjs');
    expect(t5.allowedPaths).toContain('.github/workflows/ci-matrix.yml');
  });
});
