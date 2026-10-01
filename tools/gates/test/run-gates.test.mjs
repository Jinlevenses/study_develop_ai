// UT-GATE-003·033~041 — run-gates(집계·단계·옵션 전달)와 .github/workflows 구조 단언.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN_GATES = path.join(HERE, '..', 'run-gates.mjs');
const REPO = path.join(HERE, '..', '..', '..');

/** 스텁 게이트 스크립트: 호출 인자를 calls.log에 남기고 정해진 exit·JSON을 낸다. */
function stubSource(mode, code) {
  return [
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
    'const file = fileURLToPath(import.meta.url);',
    "const entry = JSON.stringify({ script: path.basename(file), argv: process.argv.slice(2) }) + '\\n';",
    "fs.appendFileSync(path.join(path.dirname(file), 'calls.log'), entry);",
    `const mode = ${JSON.stringify(mode)};`,
    `const code = ${code};`,
    "if (mode === 'garbage') { process.stdout.write('not json at all\\n'); process.exit(code); }",
    "if (code === 2) { process.stdout.write(JSON.stringify({ check: 'stub', exit: 2, error: 'engine/exception: stub boom' }) + '\\n'); process.exit(2); }",
    "const ok = { check: 'stub', root: process.argv[3], exit: code, files: 3, errors: code === 1 ? 2 : 0, warnings: 1, violations: [] };",
    "process.stdout.write(JSON.stringify(ok) + '\\n');",
    'process.exit(code);',
  ].join('\n');
}

/**
 * 임시 저장소 root + 스텁 gates-dir + 레지스트리를 만든다.
 * gates: [{id, script, stage, args?, code?, mode?, absent?}]
 */
function sandbox(gates, { tsconfig = true, selftest = 0 } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fathom-gates-run-'));
  const root = path.join(dir, 'repo');
  const gatesDir = path.join(dir, 'gates');
  mkdirSync(root);
  mkdirSync(gatesDir);
  if (tsconfig) {
    writeFileSync(path.join(root, 'tsconfig.json'), '{}');
  }
  const registry = [];
  for (const g of gates) {
    registry.push({ id: g.id, script: g.script, stage: g.stage, args: g.args ?? [], fixture: g.id });
    if (!g.absent) {
      writeFileSync(path.join(gatesDir, g.script), stubSource(g.mode ?? 'json', g.code ?? 0));
    }
  }
  if (selftest !== null) {
    writeFileSync(path.join(gatesDir, 'check-gate-selftest.mjs'), stubSource('json', selftest));
  }
  const registryFile = path.join(dir, 'registry.json');
  writeFileSync(registryFile, JSON.stringify(registry));
  const calls = () => {
    try {
      return readFileSync(path.join(gatesDir, 'calls.log'), 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  };
  const run = (...args) => {
    const r = spawnSync(
      process.execPath,
      [RUN_GATES, '--root', root, '--registry', registryFile, '--gates-dir', gatesDir, ...args],
      { encoding: 'utf8' },
    );
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, calls: calls() };
  };
  return { dir, root, run, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const G1 = { id: 'check:boundaries', script: 'check-boundaries.mjs', stage: 'g1', args: ['--engine=both'] };
const G2 = { id: 'check:sql', script: 'check-sql-template.mjs', stage: 'g2' };
const G3 = { id: 'check:rtm', script: 'check-rtm.mjs', stage: 'g3' };

test('UT-GATE-003 tsconfig.json이 없는 root는 exit 2이고 --allow-tokens-only만 경고와 함께 boundaries를 tokens로 강등한다 [NFR-MAINT-001]', () => {
  const sb = sandbox([G1, { id: 'check:sql-typed', script: 'check-sql-typed.mjs', stage: 'g2' }], { tsconfig: false });
  try {
    const refused = sb.run('--stage=g1');
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /engine\/tsgo: tsconfig\.json missing — use --allow-tokens-only/);
    assert.equal(refused.calls.length, 0, '강등 없이 아무 게이트도 실행하지 않는다');
    const json = sb.run('--stage=g1', '--json');
    assert.equal(json.status, 2);
    assert.equal(JSON.parse(json.stdout.trim()).exit, 2);

    const allowed = sb.run('--stage=g2', '--allow-tokens-only');
    assert.equal(allowed.status, 0);
    assert.match(allowed.stderr, /warning: --allow-tokens-only/);
    const boundaries = allowed.calls.find((c) => c.script === 'check-boundaries.mjs');
    assert.ok(boundaries.argv.includes('--engine=tokens'));
    assert.ok(!boundaries.argv.includes('--engine=both'));
    assert.equal(
      allowed.calls.some((c) => c.script === 'check-sql-typed.mjs'),
      false,
      'sql-typed 는 skipped(tokens-only)',
    );
    assert.match(allowed.stdout, /SKIP\s+check:sql-typed\s.*\(tokens-only\)/);
  } finally {
    sb.cleanup();
  }
  const missingRoot = spawnSync(process.execPath, [RUN_GATES, '--root', path.join(os.tmpdir(), 'fathom-absent-root')], {
    encoding: 'utf8',
  });
  assert.equal(missingRoot.status, 2);
});

test('UT-GATE-033 종료 코드 집계는 2 우선 → 1 → 0이다 [PR-005][NFR-MAINT-001]', () => {
  const cases = [
    { codes: [0, 0, 0], want: 0 },
    { codes: [0, 1, 0], want: 1 },
    { codes: [1, 0, 2], want: 2 },
    { codes: [2, 1, 0], want: 2 },
  ];
  for (const { codes, want } of cases) {
    const sb = sandbox(
      [
        { ...G1, code: codes[0] },
        { ...G2, code: codes[1] },
        { id: 'check:deps', script: 'check-deps.mjs', stage: 'g1', code: codes[2] },
      ],
      { tsconfig: true },
    );
    try {
      const r = sb.run('--stage=g2');
      assert.equal(r.status, want, `codes=${codes}: ${r.stdout}`);
      assert.match(r.stdout, new RegExp(`\\[check:gates\\] stage=g2 exit=${want}\\n$`));
    } finally {
      sb.cleanup();
    }
  }
  // 한 줄 형식: PASS|FAIL  <id padEnd 22>  errors= warnings= files=  <ms>ms
  const sb = sandbox([{ ...G1, code: 1 }]);
  try {
    const r = sb.run('--stage=g1');
    assert.match(r.stdout, /^FAIL {2}check:boundaries {8}errors=2 warnings=1 files=3 {2}\d+ms$/m);
    assert.match(r.stdout, /^PASS {2}check:gate-selftest {5}errors=0/m);
  } finally {
    sb.cleanup();
  }
});

test('UT-GATE-034 --warn-only는 위반 exit 1을 0으로 바꾸되 엔진 고장 exit 2는 그대로 둔다 [PR-005][NFR-MAINT-001]', () => {
  const sb = sandbox([{ ...G1, code: 1 }]);
  try {
    const warn = sb.run('--stage=g1', '--warn-only');
    assert.equal(warn.status, 0);
    assert.match(warn.stdout, /^WARN {2}check:boundaries/m, '위반 목록은 그대로 보고');
    assert.match(warn.stdout, /exit=0\n$/);
    const json = JSON.parse(sb.run('--stage=g1', '--warn-only', '--json').stdout.trim());
    assert.equal(json.warn_only, true);
    assert.equal(json.exit, 0);
    assert.equal(json.gates.find((g) => g.id === 'check:boundaries').exit, 1, '게이트 행의 exit 는 원래 값');
  } finally {
    sb.cleanup();
  }
  const broken = sandbox([
    { ...G1, code: 2 },
    { ...G2, code: 1 },
  ]);
  try {
    const r = broken.run('--stage=g2', '--warn-only');
    assert.equal(r.status, 2);
    assert.match(r.stdout, /^ERROR {2}check:boundaries/m);
  } finally {
    broken.cleanup();
  }
});

test('UT-GATE-035 단계는 누적이다(g1 ⊂ g2 ⊂ g3) 그리고 매 실행마다 selftest를 가장 먼저 실행한다 [PR-005][NFR-MAINT-001]', () => {
  const sb = sandbox([G1, G2, G3]);
  try {
    const names = (r) => r.calls.map((c) => c.script);
    const g1 = sb.run('--stage=g1');
    assert.deepEqual(names(g1), ['check-gate-selftest.mjs', 'check-boundaries.mjs']);
    rmSync(path.join(sb.dir, 'gates', 'calls.log'));
    const g2 = sb.run('--stage=g2');
    assert.deepEqual(names(g2), ['check-gate-selftest.mjs', 'check-boundaries.mjs', 'check-sql-template.mjs']);
    rmSync(path.join(sb.dir, 'gates', 'calls.log'));
    const g3 = sb.run('--stage=g3', '--int', 'INT-2');
    assert.deepEqual(names(g3), [
      'check-gate-selftest.mjs',
      'check-boundaries.mjs',
      'check-sql-template.mjs',
      'check-rtm.mjs',
    ]);
    rmSync(path.join(sb.dir, 'gates', 'calls.log'));
    const dflt = sb.run();
    assert.match(dflt.stdout, /stage=g2 exit=0/, '기본 단계 = g2');
    assert.equal(sb.run('--stage=g9').status, 2);
    // 자식 호출 규약: --root <root> --json --quiet <args>
    const first = g1.calls[1].argv;
    assert.deepEqual(first, ['--root', sb.root, '--json', '--quiet', '--engine=both']);
  } finally {
    sb.cleanup();
  }
});

test('UT-GATE-036 게이트 스크립트가 없으면 exit 2이고 --allow-missing이면 skipped(missing)로 경고만 한다 [PR-005][NFR-MAINT-001]', () => {
  const sb = sandbox([G1, { ...G2, absent: true }]);
  try {
    const strict = sb.run('--stage=g2');
    assert.equal(strict.status, 2);
    assert.match(strict.stdout, /^ERROR {2}check:sql /m);
    const lenient = sb.run('--stage=g2', '--allow-missing');
    assert.equal(lenient.status, 0);
    assert.match(lenient.stdout, /^SKIP {2}check:sql\b.*\(missing\)$/m);
    assert.match(lenient.stderr, /check:sql skipped — check-sql-template\.mjs is missing/);
    const json = JSON.parse(sb.run('--stage=g2', '--allow-missing', '--json').stdout.trim());
    assert.equal(json.gates.find((g) => g.id === 'check:sql').skipped, 'missing');
  } finally {
    sb.cleanup();
  }
  // selftest 스크립트 자체가 없을 때도 같은 규칙
  const noSelftest = sandbox([G1], { selftest: null });
  try {
    assert.equal(noSelftest.run('--stage=g1').status, 2);
    assert.equal(noSelftest.run('--stage=g1', '--allow-missing').status, 0);
  } finally {
    noSelftest.cleanup();
  }
});

test('UT-GATE-037 check:scope는 --task가 있을 때만 실행하고 --task·--base는 scope·frozen에 전달한다 [PR-005][NFR-MAINT-001]', () => {
  const scope = { id: 'check:scope', script: 'check-scope.mjs', stage: 'g1' };
  const frozen = { id: 'check:frozen', script: 'check-frozen.mjs', stage: 'g2' };
  const sb = sandbox([G1, scope, frozen]);
  try {
    const without = sb.run('--stage=g2');
    assert.equal(
      without.calls.some((c) => c.script === 'check-scope.mjs'),
      false,
    );
    assert.deepEqual(
      without.calls.find((c) => c.script === 'check-frozen.mjs').argv.slice(4),
      [],
      '--task 없으면 frozen 에도 전달하지 않는다',
    );
    rmSync(path.join(sb.dir, 'gates', 'calls.log'));
    const withTask = sb.run('--stage=g2', '--task', 'T-00-05', '--base', 'main');
    const scopeCall = withTask.calls.find((c) => c.script === 'check-scope.mjs');
    assert.deepEqual(scopeCall.argv.slice(4), ['--task', 'T-00-05', '--base', 'main']);
    assert.deepEqual(withTask.calls.find((c) => c.script === 'check-frozen.mjs').argv.slice(4), [
      '--task',
      'T-00-05',
      '--base',
      'main',
    ]);
    assert.deepEqual(withTask.calls.find((c) => c.script === 'check-boundaries.mjs').argv.slice(4), ['--engine=both']);
  } finally {
    sb.cleanup();
  }
});

test('UT-GATE-038 g3는 --int가 필수이고 manifest에만 --schedule을 주되 INT-7·PG-3에서는 주지 않는다 [PR-005][NFR-MAINT-001]', () => {
  const manifest = { id: 'check:manifest', script: 'check-manifest.mjs', stage: 'g3' };
  const sb = sandbox([G1, manifest, G3]);
  try {
    const noInt = sb.run('--stage=g3');
    assert.equal(noInt.status, 2);
    assert.match(noInt.stderr, /engine\/usage: --stage=g3 requires --int/);
    assert.equal(noInt.calls.length, 0);
    assert.equal(sb.run('--stage=g3', '--int', 'INT-9').status, 2, '알 수 없는 INT');
    const argvOf = (r, script) => r.calls.find((c) => c.script === script).argv.slice(4);
    const int2 = sb.run('--stage=g3', '--int', 'INT-2');
    assert.deepEqual(argvOf(int2, 'check-manifest.mjs'), [
      '--int',
      'INT-2',
      '--schedule',
      'tests/e2e/mode-schedule.json',
    ]);
    assert.deepEqual(argvOf(int2, 'check-rtm.mjs'), ['--int', 'INT-2']);
    for (const id of ['INT-7', 'PG-3']) {
      rmSync(path.join(sb.dir, 'gates', 'calls.log'));
      const r = sb.run('--stage=g3', '--int', id);
      assert.deepEqual(argvOf(r, 'check-manifest.mjs'), ['--int', id]);
      assert.deepEqual(argvOf(r, 'check-rtm.mjs'), ['--int', id]);
    }
    // g1·g2 에서는 --int 가 있어도 manifest·rtm 은 실행되지 않는다
    rmSync(path.join(sb.dir, 'gates', 'calls.log'));
    assert.equal(
      sb.run('--stage=g2', '--int', 'INT-2').calls.some((c) => c.script === 'check-rtm.mjs'),
      false,
    );
  } finally {
    sb.cleanup();
  }
});

test('UT-GATE-039 자식 stdout JSON 파싱 실패·타임아웃성 오류는 그 게이트 exit 2이고 --json 집계 형식을 따른다 [PR-005][NFR-MAINT-001]', () => {
  const sb = sandbox([
    G1,
    { ...G2, mode: 'garbage', code: 0 },
    { id: 'check:deps', script: 'check-deps.mjs', stage: 'g1', code: 1 },
  ]);
  try {
    const r = sb.run('--stage=g2', '--json');
    assert.equal(r.status, 2);
    const json = JSON.parse(r.stdout.trim());
    assert.deepEqual(Object.keys(json), ['stage', 'warn_only', 'exit', 'gates']);
    assert.equal(json.stage, 'g2');
    assert.equal(json.exit, 2);
    const row = json.gates.find((g) => g.id === 'check:sql');
    assert.equal(row.exit, 2);
    assert.match(row.error, /not JSON/);
    for (const g of json.gates) {
      for (const k of ['id', 'script', 'exit', 'errors', 'warnings', 'files', 'ms']) {
        assert.ok(k in g, `${g.id}.${k}`);
      }
    }
    assert.equal(json.gates[0].id, 'check:gate-selftest');
    const deps = json.gates.find((g) => g.id === 'check:deps');
    assert.deepEqual([deps.exit, deps.errors, deps.warnings, deps.files], [1, 2, 1, 3]);
    assert.equal(r.stdout.trim().split('\n').length, 1, '--json 은 stdout 한 줄');
  } finally {
    sb.cleanup();
  }
  // 알 수 없는 인자·옵션 값 누락 → exit 2
  assert.equal(spawnSync(process.execPath, [RUN_GATES, '--bogus'], { encoding: 'utf8' }).status, 2);
  assert.equal(spawnSync(process.execPath, [RUN_GATES, '--task'], { encoding: 'utf8' }).status, 2);
});

const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

test('UT-GATE-040 ci-build.yml은 offline 래퍼·audit fail-closed·게이트 g3·보고서 단계를 포함하고 continue-on-error가 없다 [NFR-PORT-001][NFR-MAINT-009]', () => {
  const y = read('.github/workflows/ci-build.yml');
  for (const needle of [
    '--frozen-lockfile --ignore-scripts',
    'audit --prod --audit-level high',
    'unshare --net',
    'run-gates.mjs --stage=g3',
    'node --test',
    'si:reports',
    'check-rtm.mjs',
    'check-manifest.mjs',
    'timeout-minutes: 90',
    'ubuntu-24.04',
    '.node-version',
    'pnpm@10.33.0',
    'actions/upload-artifact@v4',
    'if: always()',
  ]) {
    assert.ok(y.includes(needle), `ci-build.yml must contain: ${needle}`);
  }
  assert.ok(!y.includes('continue-on-error'), 'audit 와 게이트는 fail-closed(D-TST-08)');
  assert.ok(!/^\t/m.test(y) && !y.includes('\t'), '탭 0');
  for (const line of y.split('\n')) {
    const indent = /^ */.exec(line)[0].length;
    assert.equal(indent % 2, 0, `들여쓰기 2칸 배수: "${line}"`);
  }
  assert.ok(!/pnpm\/action-setup/.test(y), '서드파티 액션은 checkout·setup-node·upload-artifact만');
  const uses = [...y.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
  for (const u of uses) {
    assert.ok(['actions/checkout@v4', 'actions/setup-node@v4', 'actions/upload-artifact@v4'].includes(u), u);
  }
  assert.ok(y.indexOf('unshare --net') < y.indexOf('run-gates.mjs --stage=g3'), 'offline 래퍼 정의가 gates 앞');
  assert.match(y, /--warn-only/);
  assert.match(y, /FATHOM_INT/);
  // si:reports 는 .reports/<INT>/{ut,ct,it,sec}.json 을 읽는다 — UT 결과도 같은 위치(아니면 UT 매핑 요구가 모두 untested)
  assert.match(y, /--outputFile\.json="\.reports\/\$FATHOM_INT\/ut\.json"/);
  assert.ok(!/outputFile\.json=\.reports\/ut\.json/.test(y), 'ut.json 은 .reports/ 직하가 아니라 .reports/<INT>/ 아래');
});

test('UT-GATE-041 ci-matrix.yml은 3 OS x 2 Node 매트릭스이고 live-smoke.yml은 workflow_dispatch만 쓴다 [NFR-PORT-001][NFR-MAINT-009]', () => {
  const m = read('.github/workflows/ci-matrix.yml');
  for (const os of ['ubuntu-24.04', 'windows-2025', 'macos-15']) {
    assert.ok(m.includes(os), os);
  }
  assert.ok(m.includes("'22.22.x'") && m.includes("'24.x'"));
  assert.match(m, /fail-fast: false/);
  assert.match(m, /workflow_dispatch/);
  assert.match(m, /tags:\s*\[\s*'v\*',\s*'rc-\*'\s*\]/);
  assert.ok(m.includes('pnpm check:gates'));
  assert.ok(!m.includes('continue-on-error'));
  assert.ok(!m.includes('\t'));
  const live = read('.github/workflows/live-smoke.yml');
  const onBlock = /^on:\n((?: {2}.*\n|\n)+)/m.exec(live)[1];
  assert.match(onBlock, /workflow_dispatch/);
  assert.ok(!/\b(push|pull_request|schedule)\b/.test(onBlock), 'workflow_dispatch 만');
  assert.ok(live.includes('environment: live'));
  for (const secret of ['TYPESAFE_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) {
    assert.ok(live.includes(`secrets.${secret}`), secret);
    assert.ok(!new RegExp(`${secret}:\\s*['"]?[A-Za-z0-9-]{12,}`).test(live), `${secret} 값 기재 금지`);
  }
  assert.ok(live.includes('pnpm fathom doctor --live'));
  assert.ok(!live.includes('\t'));
});
