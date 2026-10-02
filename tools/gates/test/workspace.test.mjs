// IT-655~659 — 워크스페이스 스모크(정적 검사, D-B11). 의존성 0: JSON은 JSON.parse, YAML은 줄 비교.
// 실제 `pnpm i --frozen-lockfile --ignore-scripts`는 Task 완료 명령(§6)으로 판정한다.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));
const lines = (rel) => read(rel).replace(/\n$/, '').split('\n');

const UNIT_PREFIX = { apps: 'app', services: 'svc', packages: '', tools: 'tool' };
const UNIT_DIRS = [
  'apps/web',
  'apps/cli',
  'services/gateway',
  'services/content',
  'services/learning',
  'services/ai-gateway',
  'services/ops',
  'packages/contracts',
  'packages/shared-kernel',
  'packages/design-tokens',
  'packages/ui',
  'packages/testkit',
  'tools/gates',
  'tools/packc',
  'tools/graph',
  'tools/fake-cli',
  'tools/si-docs',
];
const unitName = (dir) => {
  const [group, name] = dir.split('/');
  const prefix = UNIT_PREFIX[group];
  return prefix === '' ? `@fathom/${name}` : `@fathom/${prefix}-${name}`;
};

const srcExport = (dir, ext) => ({
  source: `./src/${dir}*.${ext}`,
  types: `./dist/${dir}*.d.ts`,
  default: `./dist/${dir}*.js`,
});
const EXPECTED_EXPORTS = {
  'packages/contracts': {
    './manifests/*.json': './manifests/*.json',
    './events/__consumers__/*.json': './src/events/__consumers__/*.json',
    './*': srcExport('', 'ts'),
  },
  'packages/shared-kernel': { './*': srcExport('', 'ts') },
  'packages/design-tokens': {
    './tokens.css': './src/tokens.css',
    './typography.css': './src/typography.css',
    './*': srcExport('', 'ts'),
  },
  'packages/ui': {
    './components/*': srcExport('components/', 'tsx'),
    './badges/*': srcExport('badges/', 'tsx'),
    './hooks/*': srcExport('hooks/', 'ts'),
    './*': srcExport('', 'ts'),
  },
  'packages/testkit': { './preload/*.mjs': './src/preload/*.mjs', './*': srcExport('', 'ts') },
};

/** §4.2 표의 전 서드파티 이름 → 정확 pin. */
const PINS = {
  typescript: '7.0.2',
  turbo: '2.11.5',
  '@biomejs/biome': '2.5.14',
  tsx: '4.23.15',
  '@types/node': '22.20.4',
  vitest: '5.0.2',
  '@vitest/coverage-v8': '5.0.2',
  vite: '8.3.1',
  '@playwright/test': '1.56.1',
  'playwright-core': '1.56.1',
  '@axe-core/playwright': '4.13.0',
  autocannon: '8.0.0',
  zod: '4.6.5',
  react: '19.3.0',
  'react-dom': '19.3.0',
  'react-is': '19.3.0',
  '@tanstack/react-router': '1.170.41',
  '@tanstack/react-query': '5.104.0',
  zustand: '5.0.15',
  tailwindcss: '4.3.3',
  motion: '13.4.6',
  cmdk: '1.1.1',
  sonner: '2.0.8',
  'lucide-react': '1.49.0',
  '@uiw/react-codemirror': '4.25.12',
  '@codemirror/lang-javascript': '6.2.5',
  '@codemirror/lang-sql': '6.10.0',
  '@codemirror/lang-yaml': '6.1.3',
  'react-markdown': '10.1.0',
  'rehype-sanitize': '6.0.0',
  shiki: '4.4.3',
  mermaid: '12.0.0',
  '@xyflow/react': '12.12.0',
  recharts: '3.10.1',
  pretendard: '1.3.9',
  '@fontsource-variable/geist': '5.3.0',
  '@fontsource-variable/jetbrains-mono': '5.3.0',
  d2coding: '1.3.2',
  idb: '8.0.3',
  'es-hangul': '2.4.0',
  '@vitejs/plugin-react': '6.1.1',
  '@tanstack/router-plugin': '1.168.42',
  '@tailwindcss/vite': '4.3.3',
  'happy-dom': '20.14.5',
  '@testing-library/react': '16.3.3',
  '@testing-library/dom': '10.4.2',
  'fake-indexeddb': '6.2.5',
  '@types/react': '19.3.0',
  '@types/react-dom': '19.3.0',
  fastify: '5.12.5',
  '@fastify/rate-limit': '11.2.0',
  '@fastify/static': '10.1.5',
  '@fastify/cookie': '11.1.2',
  '@fastify/http-proxy': '11.6.3',
  'ts-fsrs': '5.4.2',
  '@typesafe-ai/sdk': '0.6.0',
  '@anthropic-ai/sdk': '0.129.0',
  openai: '7.25.0',
  '@google/genai': '2.25.0',
  pino: '10.3.1',
  ulidx: '2.4.1',
  yaml: '2.9.1',
  'pino-pretty': '13.1.3',
  'radix-ui': '1.6.7',
  'class-variance-authority': '0.7.1',
  'tailwind-merge': '3.7.0',
  clsx: '2.1.1',
  undici: '8.11.2',
  'd3-force': '3.0.0',
  '@types/d3-force': '3.0.10',
};

const FORBIDDEN_DEPS = [
  'typescript-eslint',
  'dependency-cruiser',
  'madge',
  'es-module-lexer',
  'eslint',
  'prettier',
  '@fastify/cors',
  'hono',
  'monaco-editor',
  'vite-plugin-pwa',
  'ts-node',
  'jest',
];

const NT = 'node --disable-warning=ExperimentalWarning --import tsx --conditions=source';
const VT = 'node --conditions=source node_modules/vitest/vitest.mjs';
const vtRoot = (project) => `${VT} run --config tests/vitest.config.ts --project ${project} --configLoader native`;
const check = (name) => `node tools/gates/check-${name}.mjs`;

/** §4.4 표. */
const EXPECTED_ROOT_SCRIPTS = {
  dev: `${NT} apps/cli/src/main.ts up --profile=dev --foreground`,
  fathom: `${NT} apps/cli/src/main.ts`,
  build: 'turbo run build',
  typecheck: 'tsc -p tsconfig.json',
  lint: 'biome ci',
  test: 'turbo run test',
  'test:contract': vtRoot('contract'),
  'test:chaos': vtRoot('chaos'),
  'test:integration': `turbo run test:integration && ${vtRoot('integration')}`,
  'test:security': `turbo run test:security && ${vtRoot('security')}`,
  'test:e2e': 'node --conditions=source node_modules/@playwright/test/cli.js test --config tests/playwright.config.ts',
  'test:perf': `${NT} tests/perf/run-all.ts`,
  'test:coverage': 'turbo run test -- --coverage',
  'test:determinism': 'node tests/support/determinism.mjs',
  'test:offline': 'node tests/support/run-offline.mjs -- pnpm test:e2e --grep @offline',
  'si:reports': `${NT} tools/si-docs/src/cli.ts reports`,
  'contracts:gen': `${NT} packages/contracts/scripts/gen.ts`,
  'policy:lock': `${NT} tools/packc/src/policy/lock-cli.ts`,
  'content:check': `${NT} tools/packc/src/cli.ts check`,
  'content:scaffold': `${NT} tools/packc/src/cli.ts scaffold`,
  'content:schemas': `${NT} tools/packc/src/cli.ts schemas`,
  'content:fetch-sources': `${NT} tools/packc/src/cli.ts fetch-sources`,
  'packs:build': `${NT} tools/packc/src/cli.ts build`,
  'ai:lint-prompts': `${NT} services/ai-gateway/eval/cli.ts lint-prompts`,
  'ai:eval': `${NT} services/ai-gateway/eval/cli.ts eval`,
  'ai:eval:gates': `${NT} services/ai-gateway/eval/cli.ts gates`,
  'ai:record': `${NT} services/ai-gateway/eval/cli.ts record`,
  sim: `${NT} services/learning/sim/cli.ts`,
  'graph:update': 'graphify update .',
  'graph:snapshot': `${NT} tools/graph/src/cli.ts snapshot`,
  'audit:graph': 'node tools/gates/check-graphify-edges.mjs --root . --extract',
  'check:gates': 'node tools/gates/run-gates.mjs',
  'check:boundaries': 'node tools/gates/check-boundaries.mjs --engine=both',
  'check:deps': check('deps'),
  'check:tsconfig-paths': check('tsconfig-paths'),
  'check:gate-selftest': check('gate-selftest'),
  'check:scope': check('scope'),
  'check:sql-typed': check('sql-typed'),
  'check:db-paths': check('db-paths'),
  'check:ledger-writer': check('ledger-writer'),
  'check:content-ingest': check('content-ingest'),
  'check:jev-index': check('jev-index'),
  'check:ng-g': check('ng-g'),
  'check:typo-ko': check('typo-ko'),
  'check:frozen': check('frozen'),
  'check:consumers': check('consumers'),
  'check:manifest': check('manifest'),
  'check:rtm': check('rtm'),
  'check:security': 'node tools/gates/check-security-scan.mjs',
  'check:sql': 'node tools/gates/check-sql-template.mjs',
  'lint:hooks': 'node tools/gates/check-hooks.mjs',
  bundle: 'echo skipped',
};

/** STD-01 §15.3 `.gitignore` 21줄(D-STD-17 두 줄 포함) + `.reports/`(TST-01 §3 si-docs 원천, E2E json reporter 산출물; INT-1a 통합 추가) = 22줄. */
const EXPECTED_GITIGNORE = [
  'node_modules/',
  'dist/',
  'build/',
  'coverage/',
  '.turbo/',
  '*.log',
  '.env',
  '.env.*',
  '!.env.example',
  '*.db',
  '*.db-wal',
  '*.db-shm',
  '*.sqlite',
  '!**/test/fixtures/db/**/*.db',
  '.DS_Store',
  'playwright-report/',
  'test-results/',
  'graphify-out/cache/',
  'graphify-out/memory/',
  'graphify-out/reflections/',
  '.fathom-dev/',
  '.reports/',
  // CR-77: graphify 원시 그래프는 로컬 재생성(pnpm graph:update) — 커밋 대상 아님
  '# CR-77: graphify raw graph regenerated locally (pnpm graph:update)',
  'graphify-out/graph.json',
  'graphify-out/manifest.json',
  'graphify-out/.graphify_*',
  'graphify-out/20*/',
];

/** STD-01 §18.5 `.graphifyignore` 18줄. */
const EXPECTED_GRAPHIFYIGNORE = [
  'node_modules/',
  'dist/',
  'build/',
  'coverage/',
  '.turbo/',
  '.fathom-dev/',
  'graphify-out/',
  'docs/',
  'spikes/',
  'content/',
  'evals/',
  'deploy/',
  'tests/',
  '**/test/**',
  '**/fixtures/**',
  '**/*.spec.ts',
  '**/*.spec.tsx',
  '**/*.gen.ts',
];

function walk(dir, skip) {
  const out = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir === '' ? entry.name : `${dir}/${entry.name}`;
    if (skip(rel)) {
      continue;
    }
    if (entry.isDirectory()) {
      out.push(...walk(rel, skip));
    } else {
      out.push(rel);
    }
  }
  return out;
}

const depsOf = (pkg) => ({ ...pkg.dependencies, ...pkg.devDependencies });

describe('워크스페이스 스모크', () => {
  it('IT-655 pnpm-workspace·.npmrc·.node-version·루트 package.json 기본 필드 [NFR-PORT-002][NFR-PORT-003]', () => {
    assert.deepEqual(
      lines('pnpm-workspace.yaml').filter((l) => l !== ''),
      [
        'packages:',
        '  - apps/*',
        '  - services/*',
        '  - packages/*',
        '  - tools/*',
        'onlyBuiltDependencies: []',
        // INT-1a: pnpm audit --prod high(GHSA-r5fr-rjxr-66jc) 해소 — mermaid>chevrotain 경유 lodash-es를 패치본으로 고정(전이 의존만).
        'overrides:',
        '  lodash-es: 4.18.1',
      ],
    );
    assert.deepEqual(lines('.npmrc'), [
      'engine-strict=true',
      'strict-peer-dependencies=true',
      'auto-install-peers=false',
      'save-exact=true',
    ]);
    assert.equal(read('.node-version'), '22.22.2\n');
    const root = readJson('package.json');
    assert.equal(root.name, 'fathom-workspace');
    assert.equal(root.private, true);
    assert.equal(root.type, 'module');
    assert.equal(root.packageManager, 'pnpm@10.33.0');
    assert.equal(root.engines.node, '>=22.18.0'); // CR-74 (T-01-01)
  });

  it('IT-656 17개 단위 5파일·이름·exports·barrel 없음 [NFR-MAINT-005][NFR-MAINT-001]', () => {
    assert.equal(UNIT_DIRS.length, 17);
    for (const dir of UNIT_DIRS) {
      for (const file of ['package.json', 'tsconfig.json', 'tsconfig.build.json', 'vitest.config.ts', 'README.md']) {
        assert.ok(existsSync(join(ROOT, dir, file)), `${dir}/${file}`);
      }
      const pkg = readJson(`${dir}/package.json`);
      assert.equal(pkg.name, unitName(dir), dir);
      assert.match(pkg.name, /^@fathom\/(app-|svc-|tool-)?[a-z][a-z0-9-]*$/);
      assert.equal(pkg.private, true, dir);
      assert.equal(pkg.type, 'module', dir);
      if (EXPECTED_EXPORTS[dir] === undefined) {
        assert.equal(pkg.exports, undefined, `${dir} exports`);
      } else {
        assert.deepEqual(pkg.exports, EXPECTED_EXPORTS[dir], `${dir} exports`);
      }
    }
    assert.deepEqual(readJson('apps/cli/package.json').bin, { fathom: './bin/fathom.mjs' });
    const barrels = walk('', (rel) =>
      ['node_modules', '.git', 'spikes', 'docs', 'tools/gates/fixtures', 'graphify-out', '.fathom-dev'].some(
        (skip) => rel === skip || rel.endsWith(`/${skip}`) || rel.startsWith(`${skip}/`),
      ),
    ).filter((rel) => /(^|\/)src\/index\.tsx?$/.test(rel));
    assert.deepEqual(barrels, []);
  });

  it('IT-657 모든 의존이 workspace:* 또는 정확 pin이고 PINS와 일치한다 [CON-006][NFR-PORT-003]', () => {
    const manifests = ['.', ...UNIT_DIRS].map((dir) => [
      dir,
      readJson(dir === '.' ? 'package.json' : `${dir}/package.json`),
    ]);
    assert.equal(manifests.length, 18);
    const internal = new Set(UNIT_DIRS.map(unitName));
    for (const [dir, pkg] of manifests) {
      for (const [name, version] of Object.entries(depsOf(pkg))) {
        if (version === 'workspace:*') {
          assert.ok(internal.has(name), `${dir}: ${name}`);
          continue;
        }
        assert.match(version, /^\d+\.\d+\.\d+$/, `${dir}: ${name}`);
        assert.equal(PINS[name], version, `${dir}: ${name}`);
        assert.ok(!FORBIDDEN_DEPS.includes(name), `${dir}: ${name} 금지`);
        if (name === 'typescript') {
          assert.equal(dir, '.', 'typescript는 루트에만');
        }
      }
      for (const key of ['peerDependencies', 'optionalDependencies', 'overrides']) {
        assert.equal(pkg[key], undefined, `${dir}: ${key}`);
      }
    }
    const used = new Set(manifests.flatMap(([, pkg]) => Object.keys(depsOf(pkg))));
    for (const name of Object.keys(PINS)) {
      assert.ok(used.has(name), `PINS의 ${name}이 어느 단위에도 없다`);
    }
    const gates = readJson('tools/gates/package.json');
    assert.deepEqual(depsOf(gates), {});
  });

  it('IT-658 lockfile 형태와 루트 scripts가 §4.4와 같다 [CON-006][NFR-MAINT-005]', () => {
    const lock = read('pnpm-lock.yaml');
    assert.match(lock, /^lockfileVersion: '9\.0'$/m);
    assert.match(lock, /^settings:\n {2}autoInstallPeers: false$/m);
    const importersBlock = lock.slice(lock.indexOf('\nimporters:\n'), lock.indexOf('\npackages:\n'));
    const importers = [...importersBlock.matchAll(/^ {2}([^\s:][^:]*):/gm)].map((m) => m[1]).sort();
    const expected = ['.', ...UNIT_DIRS.filter((dir) => dir !== 'tools/gates')].sort();
    assert.deepEqual(
      importers.filter((k) => k !== 'tools/gates'),
      expected,
    );
    const root = readJson('package.json');
    assert.deepEqual(Object.keys(root.scripts).sort(), Object.keys(EXPECTED_ROOT_SCRIPTS).sort());
    assert.deepEqual(root.scripts, EXPECTED_ROOT_SCRIPTS);
  });

  it('IT-659 .gitignore·.gitattributes·.graphifyignore·fr-iteration.json 시드 [NFR-MAINT-011][NFR-PORT-003]', () => {
    assert.deepEqual(lines('.gitignore'), EXPECTED_GITIGNORE);
    assert.equal(EXPECTED_GITIGNORE.length, 27); // 22 + CR-77 5줄
    assert.deepEqual(lines('.gitattributes'), [
      '* text=auto eol=lf',
      '*.png binary',
      '*.woff2 binary',
      '*.fpack binary',
    ]);
    assert.deepEqual(lines('.graphifyignore'), EXPECTED_GRAPHIFYIGNORE);
    assert.equal(EXPECTED_GRAPHIFYIGNORE.length, 18);

    const fr = readJson('tools/si-docs/data/fr-iteration.json');
    assert.equal(fr.format, 'fathom-fr-iteration/1');
    assert.deepEqual(fr.int_order, ['INT-1a', 'INT-1b', 'INT-2', 'INT-3', 'INT-4', 'INT-5', 'INT-6', 'INT-7']);
    assert.deepEqual(fr.sources, ['docs/01-planning/06-user-story-map.md §4.2', 'docs/04-test/01-test-plan.md §18.1']);
    assert.deepEqual(fr.rules, {
      it_to_int: {
        'IT-01 1a': 'INT-1a',
        'IT-01 1b': 'INT-1b',
        'IT-02': 'INT-2',
        'IT-03': 'INT-3',
        'IT-04': 'INT-4',
        'IT-05': 'INT-5',
        'IT-06': 'INT-6',
        'IT-07': 'INT-7',
      },
      nfr_table_it01: 'USM §4.2 IT-01 1a 열에 있으면 INT-1a, 아니면 INT-1b',
      cross_cutting: '횡단(매 INT) = int_order 전부',
    });
    const ids = Object.keys(fr.assignments);
    assert.equal(ids.filter((id) => id.startsWith('FR-')).length, 236);
    assert.equal(ids.filter((id) => id.startsWith('NFR-')).length, 93);
    assert.equal(ids.length, 329);
    assert.deepEqual(ids, [...ids].sort());
    assert.equal(fr.must_bands.length, 74);
    for (const band of fr.must_bands) {
      assert.ok(fr.assignments[band.req], band.req);
      assert.deepEqual(Object.keys(band).sort(), ['first_int_range', 'levels', 'req']);
    }
    for (const [id, a] of Object.entries(fr.assignments)) {
      assert.equal(a.first_int, a.ints[0], id);
      assert.deepEqual(
        a.ints,
        [...a.ints].sort((x, y) => fr.int_order.indexOf(x) - fr.int_order.indexOf(y)),
        id,
      );
    }
    assert.deepEqual(fr.assignments['FR-SET-008'].ints, ['INT-4']);
    assert.deepEqual(fr.assignments['FR-PRG-002'].ints, ['INT-1b']);
    assert.deepEqual(fr.assignments['FR-STD-018'].ints, ['INT-1b', 'INT-3']);
    assert.deepEqual(fr.assignments['FR-STD-018'].notes, { 'INT-1b': 'BN-1' });
    assert.deepEqual(fr.assignments['FR-PRG-018'].ints, ['INT-2', 'INT-7']);
    assert.deepEqual(fr.assignments['FR-QST-016'].ints, ['INT-3', 'INT-5']);
    assert.deepEqual(fr.assignments['NFR-MAINT-005'].ints, ['INT-1a']);
    assert.deepEqual(fr.assignments['NFR-PORT-002'].ints, ['INT-1b']);
    assert.deepEqual(fr.assignments['FR-SET-001'].notes, { 'INT-1a': '최소' });
    assert.deepEqual(fr.assignments['NFR-UX-012'].ints, fr.int_order);
    assert.deepEqual(fr.assignments['NFR-UX-012'].notes, { 'INT-1a': '횡단' });
  });
});
