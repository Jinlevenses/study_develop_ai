// UT-GATE-004·020~032 — check:boundaries(config/boundaries.json, tokens·tsgo·both 엔진) 단위 테스트.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkFile, evaluateImport, targetUnit } from '../check-boundaries.mjs';
import { compare, loadExpectations } from '../lib/expect.mjs';
import { loadBoundaries } from '../lib/units.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.join(HERE, '..', 'check-boundaries.mjs');
const FIX = path.join(HERE, '..', 'fixtures', 'check-boundaries');
const CLEAN = path.join(FIX, 'clean');
const VIOL = path.join(FIX, 'violations');
const cfg = loadBoundaries();

function run(root, ...args) {
  const r = spawnSync(process.execPath, [GATE, '--root', root, '--json', ...args], { encoding: 'utf8' });
  let json = null;
  try {
    json = JSON.parse(r.stdout.trim().split('\n').pop());
  } catch {
    json = null;
  }
  return { status: r.status, json, stdout: r.stdout, stderr: r.stderr };
}

const cache = new Map();
function cached(root, engine) {
  const key = `${root}|${engine}`;
  if (!cache.has(key)) {
    cache.set(key, run(root, `--engine=${engine}`));
  }
  return cache.get(key);
}

const errorsOf = (res) => res.json.violations.filter((v) => v.severity === 'error');

function tmpdir() {
  return mkdtempSync(path.join(os.tmpdir(), 'fathom-gates-bnd-'));
}

/** evaluateImport 단축: 규칙 ID 목록. */
function rules(fromRel, spec, extra = {}) {
  return evaluateImport({ fromRel, spec, kind: 'static', typeOnly: false, line: 1, ...extra }, cfg).map((v) => v.rule);
}

test('UT-GATE-004 tsgo 초기화 실패·설정 부재·스키마 위반·빈 root·스캔 0개는 exit 2다(tokens는 tsconfig 없이도 위반 exit 1) [NFR-MAINT-001]', () => {
  const copy = tmpdir();
  try {
    cpSync(VIOL, copy, { recursive: true });
    unlinkSync(path.join(copy, 'tsconfig.json'));
    const both = run(copy, '--engine=both');
    assert.equal(both.status, 2);
    assert.match(both.json.error, /^engine\/tsgo: /);
    assert.equal(both.json.exit, 2);
    assert.equal(run(copy, '--engine=tsgo').status, 2);
    assert.equal(run(copy, '--engine=tokens').status, 1, 'tokens 엔진은 tsconfig 없이도 동작');
    // 텍스트 모드 exit 2 = stderr 한 줄
    const text = spawnSync(process.execPath, [GATE, '--root', copy, '--engine=both'], { encoding: 'utf8' });
    assert.equal(text.status, 2);
    assert.match(text.stderr, /^\[check:boundaries\] engine error: engine\/tsgo: .*\n$/);
    assert.equal(text.stdout, '');
    // 프로젝트 파일 0개
    writeFileSync(
      path.join(copy, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { types: [] }, include: ['nothing'] }),
    );
    const none = run(copy, '--engine=tsgo');
    assert.equal(none.status, 2);
    assert.match(none.json.error, /^engine\/tsgo: /);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
  // 설정 부재·스키마 위반·알 수 없는 인자
  const missingCfg = run(CLEAN, '--engine=tokens', '--config', path.join(os.tmpdir(), 'fathom-no-such-config.json'));
  assert.equal(missingCfg.status, 2);
  assert.match(missingCfg.json.error, /^engine\/config: /);
  const dir = tmpdir();
  try {
    const base = JSON.parse(JSON.stringify(cfg));
    for (const [name, mutate] of [
      ['version', (c) => Object.assign(c, { version: 2 })],
      ['units', (c) => Object.assign(c, { units: [] })],
      ['unit-name', (c) => c.units.push({ unit: 'Bad/Name', allow: [] })],
      ['allow', (c) => c.units.push({ unit: 'tools/x', allow: ['services/*'] })],
      ['intra', (c) => delete c.intra.web_feature_cross],
    ]) {
      const bad = JSON.parse(JSON.stringify(base));
      mutate(bad);
      const f = path.join(dir, `${name}.json`);
      writeFileSync(f, JSON.stringify(bad));
      const res = run(CLEAN, '--engine=tokens', '--config', f);
      assert.equal(res.status, 2, `schema violation "${name}" must be exit 2`);
      assert.match(res.json.error, /^engine\/config: /);
    }
    writeFileSync(path.join(dir, 'broken.json'), '{ nope');
    assert.equal(run(CLEAN, '--engine=tokens', '--config', path.join(dir, 'broken.json')).status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(run(CLEAN, '--engine=lexer').status, 2, '제거된 엔진 이름');
  assert.equal(spawnSync(process.execPath, [GATE, '--root', CLEAN, '--bogus'], { encoding: 'utf8' }).status, 2);
  // 빈 root·없는 root·기대 단위 부재·스캔 0개
  const empty = tmpdir();
  try {
    const e = run(empty, '--engine=tokens');
    assert.equal(e.status, 2);
    assert.match(e.json.error, /^engine\/missing-units: /);
    assert.equal(run(path.join(empty, 'absent'), '--engine=tokens').status, 2);
    mkdirSync(path.join(empty, 'services', 'a'), { recursive: true });
    assert.equal(run(empty, '--engine=tokens').status, 2, 'packages/contracts 부재');
    mkdirSync(path.join(empty, 'packages', 'contracts'), { recursive: true });
    const nofiles = run(empty, '--engine=tokens');
    assert.equal(nofiles.status, 2);
    assert.match(nofiles.json.error, /^engine\/no-files: /);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test('UT-GATE-020 violations에서 tokens 엔진은 규칙 밖 별칭 @legacy/b 1건만 놓친다(재현율 = 기대 - 1) [NFR-MAINT-001][QAS-20]', () => {
  const expected = loadExpectations(VIOL);
  assert.ok(expected.size >= 40, `fixture expectations: ${expected.size}`);
  const res = cached(VIOL, 'tokens');
  assert.equal(res.status, 1);
  const { tp, fp, fn } = compare(expected, errorsOf(res));
  assert.deepEqual(fp, [], '초과 보고 0');
  assert.equal(fn.length, 1);
  assert.match(fn[0], /^services\/a\/src\/alias-evasion\.ts:\d+:boundary\/cross-service-import$/);
  assert.equal(tp, expected.size - 1);
});

test('UT-GATE-021 violations에서 tsgo·both 엔진은 기대 집합과 정확히 일치한다(@legacy/b 포함) [NFR-MAINT-001][QAS-20]', () => {
  const expected = loadExpectations(VIOL);
  for (const engine of ['tsgo', 'both']) {
    const res = cached(VIOL, engine);
    assert.equal(res.status, 1, engine);
    const { tp, fp, fn } = compare(expected, errorsOf(res));
    assert.deepEqual({ engine, fp, fn }, { engine, fp: [], fn: [] });
    assert.equal(tp, expected.size);
    assert.equal(res.json.engine, engine);
  }
  assert.ok(cached(VIOL, 'both').json.files > 0);
});

test('UT-GATE-022 clean fixture는 세 엔진 모두 exit 0이고 진단이 없다 [NFR-MAINT-001]', () => {
  for (const engine of ['tokens', 'tsgo', 'both']) {
    const res = cached(CLEAN, engine);
    assert.equal(res.status, 0, `${engine}: ${res.stdout}${res.stderr}`);
    assert.equal(res.json.errors, 0);
    assert.deepEqual(res.json.violations, []);
    assert.ok(res.json.files >= 20, `${engine} scanned ${res.json.files}`);
  }
});

test('UT-GATE-023 단위 간 규칙: cross-service-import·unit-not-allowed·testkit-in-src·spikes-import와 대상 단위 해석 [NFR-MAINT-001][NFR-MAINT-003]', () => {
  assert.equal(targetUnit('@fathom/svc-a/store.ts', 'x'), 'services/a');
  assert.equal(targetUnit('@fathom/app-web', 'x'), 'apps/web');
  assert.equal(targetUnit('@fathom/tool-gates', 'x'), 'tools/gates');
  assert.equal(targetUnit('@fathom/contracts/http/x', 'x'), 'packages/contracts');
  assert.equal(targetUnit('node:fs', 'x'), 'builtin');
  assert.equal(targetUnit('fs/promises', 'x'), 'builtin');
  assert.equal(targetUnit('zod', 'x'), 'external');
  assert.equal(targetUnit('../../b/src/x.ts', 'services/a/src/y.ts'), 'services/b');
  assert.equal(targetUnit('../../../../outside.ts', 'services/a/src/y.ts'), null);
  assert.equal(targetUnit('../../../spikes/p/x.ts', 'services/a/src/y.ts'), 'spikes');
  // cross-service-import
  assert.deepEqual(rules('services/a/src/x.ts', '@fathom/svc-b'), ['boundary/cross-service-import']);
  assert.deepEqual(rules('services/a/src/x.ts', '../../b/src/y.ts'), ['boundary/cross-service-import']);
  assert.deepEqual(rules('apps/web/src/x.ts', '@fathom/svc-a'), ['boundary/cross-service-import']);
  assert.deepEqual(rules('services/a/src/x.ts', '@fathom/app-web'), ['boundary/cross-service-import']);
  assert.deepEqual(rules('services/a/src/x.ts', './y.ts'), [], '자기 단위');
  assert.deepEqual(rules('services/a/src/x.ts', '@fathom/contracts'), []);
  assert.deepEqual(rules('services/a/src/x.ts', '@fathom/shared-kernel/errors/errors'), []);
  assert.deepEqual(rules('apps/web/src/x.ts', '@fathom/ui'), []);
  assert.deepEqual(rules('tools/si-docs/src/x.ts', '@fathom/contracts'), []);
  // unit-not-allowed
  assert.deepEqual(rules('packages/ui/src/x.ts', '@fathom/shared-kernel'), ['boundary/unit-not-allowed']);
  assert.deepEqual(rules('packages/contracts/src/x.ts', '@fathom/shared-kernel'), ['boundary/unit-not-allowed']);
  assert.deepEqual(rules('services/a/src/x.ts', '@fathom/ui'), ['boundary/unit-not-allowed']);
  assert.deepEqual(rules('tools/gates/x.mjs', '@fathom/contracts'), ['boundary/unit-not-allowed']);
  assert.deepEqual(rules('packages/ui/src/x.ts', '@fathom/design-tokens'), []);
  assert.deepEqual(rules('packages/testkit/src/x.ts', '@fathom/ui'), []);
  // testkit-in-src
  assert.deepEqual(rules('services/a/src/x.ts', '@fathom/testkit/clock'), ['boundary/testkit-in-src']);
  assert.deepEqual(rules('packages/ui/src/x.ts', '@fathom/testkit/clock'), ['boundary/testkit-in-src']);
  assert.deepEqual(rules('services/a/test/unit/x.spec.ts', '@fathom/testkit/clock'), []);
  assert.deepEqual(rules('services/a/vitest.config.ts', '@fathom/testkit/vitest-preset'), []);
  assert.deepEqual(rules('tests/e2e/x.spec.ts', '@fathom/testkit/playwright'), []);
  // spikes-import
  assert.deepEqual(rules('services/a/src/x.ts', '../../../spikes/sp7/x.ts'), ['boundary/spikes-import']);
  assert.deepEqual(rules('tests/x.spec.ts', 'spikes/sp7/x.ts'), ['boundary/spikes-import']);
  // fixture 양성 대조
  const reported = new Set(errorsOf(cached(VIOL, 'both')).map((v) => v.rule));
  for (const r of ['cross-service-import', 'unit-not-allowed', 'testkit-in-src', 'spikes-import']) {
    assert.ok(reported.has(`boundary/${r}`), r);
  }
});

test('UT-GATE-024 nonliteral-import·require·create-require는 사유 있는 boundary-ok만 면제하고 사유 없으면 무효다 [NFR-MAINT-001][NFR-MAINT-003]', () => {
  const f = 'services/a/src/x.ts';
  const rulesIn = (src) => checkFile(f, src, cfg).map((v) => `${v.line}:${v.rule}`);
  assert.deepEqual(rulesIn('const m = import(target);\n'), ['1:boundary/nonliteral-import']);
  assert.deepEqual(rulesIn('const m = require(name);\n'), ['1:boundary/nonliteral-import']);
  assert.deepEqual(rulesIn("const m = require('./local.ts');\n"), ['1:boundary/require']);
  assert.deepEqual(rulesIn('const r = createRequire(import.meta.url);\n'), ['1:boundary/create-require']);
  // 같은 줄·윗줄 + 사유 → 면제
  assert.deepEqual(rulesIn('const m = import(target); // boundary-ok: 상수 테이블 경로\n'), []);
  assert.deepEqual(rulesIn('// boundary-ok: 상수 테이블 경로\nconst m = import(target);\n'), []);
  assert.deepEqual(rulesIn('// boundary-ok: 서드파티 로더\nconst r = createRequire(import.meta.url);\n'), []);
  assert.deepEqual(rulesIn("const m = require('./l.ts'); // boundary-ok: CJS 전용\n"), []);
  // 사유 없음·두 줄 위·다른 태그 → 무효
  assert.deepEqual(rulesIn('// boundary-ok:\nconst m = import(target);\n'), ['2:boundary/nonliteral-import']);
  assert.deepEqual(rulesIn('const m = import(target); // boundary-ok:   \n'), ['1:boundary/nonliteral-import']);
  assert.deepEqual(rulesIn('// boundary-ok: 멀다\n\nconst m = import(target);\n'), ['3:boundary/nonliteral-import']);
  assert.deepEqual(rulesIn('// sql-ok: 다른 태그\nconst m = import(target);\n'), ['2:boundary/nonliteral-import']);
  // 탈출구는 cross-service-import 같은 다른 규칙을 면제하지 않는다
  assert.deepEqual(rulesIn("import x from '../../b/src/y.ts'; // boundary-ok: 소용없음\n"), [
    '1:boundary/cross-service-import',
  ]);
  // 주석·문자열 속 텍스트는 위반이 아니다
  assert.deepEqual(rulesIn("// import(target)\nconst s = 'require(x)';\n"), []);
});

test('UT-GATE-025 contracts-builtin·db-path·sqlite-direct는 양성과 clean 대조(허용 위치·test 디렉터리)를 구분한다 [NFR-MAINT-001][NFR-MAINT-002]', () => {
  assert.deepEqual(rules('packages/contracts/src/x.ts', 'node:fs'), ['boundary/contracts-builtin']);
  assert.deepEqual(rules('packages/contracts/src/x.ts', 'path'), ['boundary/contracts-builtin']);
  assert.deepEqual(rules('packages/contracts/src/x.ts', 'zod'), []);
  assert.deepEqual(rules('packages/shared-kernel/src/x.ts', 'node:fs'), []);
  // sqlite-direct (import)
  assert.deepEqual(rules('services/a/src/x.ts', 'node:sqlite'), ['boundary/sqlite-direct']);
  assert.deepEqual(rules('packages/shared-kernel/src/sqlite/open.ts', 'node:sqlite'), []);
  assert.deepEqual(rules('packages/shared-kernel/src/service/boot.ts', 'node:sqlite'), []);
  assert.deepEqual(rules('services/a/test/db.spec.ts', 'node:sqlite'), []);
  // sqlite-direct (new DatabaseSync) · db-path
  const call = (rel, arg) => checkFile(rel, `const d = new DatabaseSync(${arg});\n`, cfg).map((v) => v.rule);
  assert.deepEqual(call('services/a/src/x.ts', "':memory:'"), ['boundary/sqlite-direct']);
  assert.deepEqual(call('packages/shared-kernel/src/sqlite/open.ts', 'path'), []);
  assert.deepEqual(call('services/a/test/db.spec.ts', "':memory:'"), []);
  assert.deepEqual(call('services/b/test/x.spec.ts', "'services/a/data/a.sqlite'"), ['boundary/db-path']);
  assert.deepEqual(call('services/b/src/x.ts', "'services/a/data/a.sqlite'").sort(), [
    'boundary/db-path',
    'boundary/sqlite-direct',
  ]);
  assert.deepEqual(
    call('services/b/src/x.ts', 'join(import.meta.dirname, "..", "..", "a", "data", "a.sqlite")').sort(),
    ['boundary/db-path', 'boundary/sqlite-direct'],
  );
  assert.deepEqual(call('services/b/test/x.spec.ts', 'join(import.meta.dirname, "..", "data", "b.sqlite")'), []);
  assert.deepEqual(call('services/b/test/x.spec.ts', 'dbPath'), []);
  const reported = new Set(errorsOf(cached(VIOL, 'both')).map((v) => v.rule));
  for (const r of ['contracts-builtin', 'db-path', 'sqlite-direct']) {
    assert.ok(reported.has(`boundary/${r}`), r);
  }
});

test('UT-GATE-026 bc-cross는 다른 BC import를 막고 application/<bc>/ports.ts의 import type만 예외로 둔다 [NFR-MAINT-001][NFR-MAINT-003]', () => {
  const from = 'services/content/src/application/itembank/x.ts';
  assert.deepEqual(rules(from, '../catalog/service.ts'), ['boundary/bc-cross']);
  assert.deepEqual(rules(from, '../catalog/ports.ts'), ['boundary/bc-cross'], '값 import는 위반');
  assert.deepEqual(rules(from, '../catalog/ports.ts', { typeOnly: true }), [], 'import type ports.ts 는 예외');
  assert.deepEqual(rules(from, '../catalog/ports.js', { typeOnly: true }), [], '.js 확장자');
  assert.deepEqual(
    rules(from, '../catalog/service.ts', { typeOnly: true }),
    ['boundary/bc-cross'],
    'ports 가 아니면 type 도 위반',
  );
  assert.deepEqual(
    rules(from, '../../domain/catalog/x.ts', { typeOnly: true }),
    ['boundary/bc-cross'],
    'domain 쪽 type 도 위반',
  );
  assert.deepEqual(rules(from, './sibling.ts'), [], '같은 BC');
  assert.deepEqual(rules(from, '../../domain/itembank/x.ts'), [], '같은 BC 의 다른 계층');
  assert.deepEqual(rules('services/content/src/http/catalog/r.ts', '../../application/itembank/x.ts'), [
    'boundary/bc-cross',
  ]);
  assert.deepEqual(rules('services/content/src/http/catalog/r.ts', '../../application/catalog/x.ts'), []);
  assert.deepEqual(
    rules('services/content/test/x.spec.ts', '../src/application/catalog/service.ts'),
    [],
    'test 는 intra 미적용',
  );
  assert.deepEqual(
    rules('services/content/src/application/catalog/x.ts', '../../infra/db/x.ts'),
    [],
    'BC 밖 디렉터리는 BC 가 아니다',
  );
  assert.ok(errorsOf(cached(VIOL, 'both')).some((v) => v.rule === 'boundary/bc-cross'));
});

test('UT-GATE-027 grading-no-catalog(ports 포함)와 domain-impure(내장·fastify·infra·다른 BC·허용 목록) [NFR-MAINT-001][NFR-MAINT-003]', () => {
  const g = 'services/content/src/application/grading/judge.ts';
  assert.deepEqual(rules(g, '../catalog/service.ts').sort(), ['boundary/bc-cross', 'boundary/grading-no-catalog']);
  assert.deepEqual(
    rules(g, '../catalog/ports.ts', { typeOnly: true }),
    ['boundary/grading-no-catalog'],
    'ports 도 금지',
  );
  assert.deepEqual(rules(g, '../itembank/ports.ts', { typeOnly: true }), [], '다른 BC ports 는 허용');
  assert.deepEqual(
    rules('services/content/src/application/itembank/x.ts', '../catalog/ports.ts', { typeOnly: true }),
    [],
  );
  const d = 'services/content/src/domain/catalog/x.ts';
  assert.deepEqual(rules(d, 'node:fs'), ['boundary/domain-impure']);
  assert.deepEqual(rules(d, 'node:sqlite').sort(), ['boundary/domain-impure', 'boundary/sqlite-direct']);
  assert.deepEqual(rules(d, 'fastify'), ['boundary/domain-impure']);
  assert.deepEqual(rules(d, '../../infra/db/x.ts'), ['boundary/domain-impure']);
  assert.deepEqual(rules(d, '../../application/catalog/x.ts'), ['boundary/domain-impure']);
  assert.deepEqual(rules(d, '../itembank/x.ts').sort(), ['boundary/bc-cross', 'boundary/domain-impure']);
  assert.deepEqual(rules(d, 'zod'), ['boundary/domain-impure']);
  assert.deepEqual(rules(d, './y.ts'), []);
  assert.deepEqual(rules(d, './shared/z.ts'), []);
  assert.deepEqual(rules(d, '@fathom/contracts/http/content'), []);
  assert.deepEqual(rules(d, '@fathom/shared-kernel/errors/errors'), []);
  assert.deepEqual(rules(d, '@fathom/shared-kernel/redact/redact'), ['boundary/domain-impure']);
  assert.deepEqual(rules(d, 'es-hangul'), [], 'content 승인 서드파티');
  assert.deepEqual(rules(d, 'ts-fsrs'), ['boundary/domain-impure'], 'learning 전용 서드파티');
  assert.deepEqual(rules('services/learning/src/domain/practice/x.ts', 'ts-fsrs'), []);
  assert.deepEqual(rules('services/content/test/domain/x.spec.ts', 'node:fs'), [], 'test 는 intra 미적용');
});

test('UT-GATE-028 sk-pure·builtin-restricted·web-feature-cross는 위반과 허용 위치를 구분한다 [NFR-MAINT-001][NFR-MAINT-003]', () => {
  const sk = 'packages/shared-kernel/src/errors/x.ts';
  assert.deepEqual(rules(sk, './kinds.ts'), []);
  assert.deepEqual(rules(sk, '../sqlite/open.ts'), ['boundary/sk-pure']);
  assert.deepEqual(rules(sk, 'node:path'), ['boundary/sk-pure']);
  assert.deepEqual(rules(sk, 'zod'), ['boundary/sk-pure']);
  assert.deepEqual(rules(sk, '@fathom/contracts'), ['boundary/sk-pure']);
  assert.deepEqual(rules('packages/shared-kernel/src/redact/x.ts', '../errors/errors.ts'), ['boundary/sk-pure']);
  assert.deepEqual(rules('packages/shared-kernel/src/proc/x.ts', 'node:path'), [], '다른 모듈은 미적용');
  assert.deepEqual(rules('packages/shared-kernel/test/errors/x.spec.ts', 'node:path'), []);
  // builtin-restricted
  assert.deepEqual(rules('services/a/src/x.ts', 'node:child_process'), ['boundary/builtin-restricted']);
  assert.deepEqual(rules('services/a/src/x.ts', 'child_process'), ['boundary/builtin-restricted']);
  assert.deepEqual(rules('services/a/src/x.ts', 'node:worker_threads'), ['boundary/builtin-restricted']);
  assert.deepEqual(rules('packages/shared-kernel/src/proc/spawn.ts', 'node:child_process'), []);
  assert.deepEqual(rules('services/ops/src/supervisor/x.ts', 'node:child_process'), []);
  assert.deepEqual(rules('services/learning/src/infra/workers/boot.ts', 'node:worker_threads'), []);
  assert.deepEqual(rules('services/learning/src/workers/boot.ts', 'node:worker_threads'), []);
  assert.deepEqual(rules('services/content/src/domain/catalog/x.ts', 'node:worker_threads').sort(), [
    'boundary/builtin-restricted',
    'boundary/domain-impure',
  ]);
  assert.deepEqual(rules('services/a/test/x.spec.ts', 'node:child_process'), []);
  assert.deepEqual(rules('tools/packc/src/x.ts', 'node:child_process'), []);
  // web-feature-cross
  const wf = 'apps/web/src/features/a/x.ts';
  assert.deepEqual(rules(wf, '../b/y.ts'), ['boundary/web-feature-cross']);
  assert.deepEqual(rules(wf, './y.ts'), []);
  assert.deepEqual(rules(wf, '../../shared/y.ts'), []);
  assert.deepEqual(rules('apps/web/test/x.spec.ts', '../src/features/a/y.ts'), []);
  const reported = new Set(errorsOf(cached(VIOL, 'both')).map((v) => v.rule));
  for (const r of ['sk-pure', 'builtin-restricted', 'web-feature-cross', 'domain-impure', 'grading-no-catalog']) {
    assert.ok(reported.has(`boundary/${r}`), r);
  }
});

test('UT-GATE-029 intra 규칙은 <unit>/src/** 에만 적용되고 단위 간 규칙은 test·설정 파일에도 적용된다 [NFR-MAINT-001][NFR-MAINT-002]', () => {
  const intraSpecs = ['node:sqlite', 'node:child_process', 'node:worker_threads'];
  for (const from of [
    'services/content/test/unit/x.spec.ts',
    'services/content/vitest.config.ts',
    'packages/shared-kernel/test/x.spec.ts',
  ]) {
    for (const spec of intraSpecs) {
      assert.deepEqual(rules(from, spec), [], `${from} → ${spec}`);
    }
  }
  assert.deepEqual(checkFile('services/a/test/x.spec.ts', "const d = new DatabaseSync(':memory:');\n", cfg), []);
  // 단위 간 규칙은 test 에도
  assert.deepEqual(rules('services/a/test/x.spec.ts', '../../b/src/y.ts'), ['boundary/cross-service-import']);
  assert.deepEqual(rules('services/a/vitest.config.ts', '@fathom/svc-b'), ['boundary/cross-service-import']);
  // 비리터럴·require 규칙도 전 파일
  assert.deepEqual(
    checkFile('services/a/test/x.spec.ts', 'const m = require(x);\n', cfg).map((v) => v.rule),
    ['boundary/nonliteral-import'],
  );
  const clean = cached(CLEAN, 'both');
  assert.equal(clean.json.errors, 0, 'clean 의 test/·vitest.config.ts 대조군');
});

test('UT-GATE-030 tests 단위는 contracts·shared-kernel·testkit만 허용하고 서비스 import는 위반이다 [NFR-MAINT-001][NFR-MAINT-003]', () => {
  const f = 'tests/integration/x.spec.ts';
  assert.deepEqual(rules(f, '@fathom/contracts/http/x'), []);
  assert.deepEqual(rules(f, '@fathom/shared-kernel/clock/clock'), []);
  assert.deepEqual(rules(f, '@fathom/testkit/clock'), []);
  assert.deepEqual(rules(f, '@fathom/svc-gateway'), ['boundary/cross-service-import']);
  assert.deepEqual(rules(f, '@fathom/app-web'), ['boundary/cross-service-import']);
  assert.deepEqual(rules(f, '@fathom/ui'), ['boundary/unit-not-allowed']);
  assert.deepEqual(rules(f, '../../services/a/src/x.ts'), ['boundary/cross-service-import']);
  assert.deepEqual(rules(f, 'node:fs'), []);
  const hit = errorsOf(cached(VIOL, 'both')).filter((v) => v.file === 'tests/x.spec.ts');
  assert.equal(hit.length, 1);
  assert.equal(hit[0].rule, 'boundary/cross-service-import');
});

test('UT-GATE-031 --json 진단은 {file,line,rule,message,severity} 키와 root 기준 posix 경로를 쓴다 [NFR-MAINT-001]', () => {
  const res = cached(VIOL, 'both');
  assert.deepEqual(Object.keys(res.json).slice(0, 7), [
    'check',
    'root',
    'exit',
    'files',
    'errors',
    'warnings',
    'violations',
  ]);
  assert.equal(res.json.check, 'check:boundaries');
  assert.equal(res.json.exit, 1);
  assert.equal(res.json.root, VIOL);
  assert.equal(res.json.errors, res.json.violations.length);
  for (const v of res.json.violations) {
    assert.deepEqual(Object.keys(v), ['file', 'line', 'rule', 'message', 'severity']);
    assert.ok(Number.isInteger(v.line) && v.line > 0);
    assert.match(v.rule, /^boundary\/[a-z-]+$/);
    assert.equal(v.severity, 'error');
    assert.ok(!v.file.includes('\\') && !path.isAbsolute(v.file));
  }
  // 텍스트 모드: 진단 1줄 + 요약, --quiet 은 요약만
  const text = spawnSync(process.execPath, [GATE, '--root', VIOL, '--engine=tokens'], { encoding: 'utf8' });
  const lines = text.stdout.trimEnd().split('\n');
  assert.match(lines[0], /^[^ ]+:\d+ {2}error {2}boundary\/[a-z-]+ {2}/);
  assert.match(lines.at(-1), /^\[check:boundaries\] \d+ error\(s\), 0 warning\(s\), \d+ file\(s\)$/);
  const quiet = spawnSync(process.execPath, [GATE, '--root', VIOL, '--engine=tokens', '--quiet'], { encoding: 'utf8' });
  assert.equal(quiet.stdout.trimEnd().split('\n').length, 1);
  assert.equal(quiet.status, 1);
  const sorted = [...res.json.violations].sort((a, b) =>
    a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || (a.rule < b.rule ? -1 : 1),
  );
  assert.deepEqual(res.json.violations, sorted, 'file→line→rule 정렬');
});

test('UT-GATE-032 같은 입력은 같은 출력 바이트다(2회 실행 stdout 동일, 엔진 both) [NFR-MAINT-001][QAS-20]', () => {
  const a = run(VIOL, '--engine=both');
  const b = run(VIOL, '--engine=both');
  assert.equal(a.stdout, b.stdout);
  const c = run(CLEAN, '--engine=both');
  const d = run(CLEAN, '--engine=both');
  assert.equal(c.stdout, d.stdout);
});
