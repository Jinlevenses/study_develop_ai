// UT-GATE-002·042~049 — check-gate-selftest(fixture 규약 검증)와 모든 게이트의 음성 탐침(빈 root·없는 root).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { GATES } from '../lib/registry.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATES_DIR = path.join(HERE, '..');
const SELFTEST = path.join(GATES_DIR, 'check-gate-selftest.mjs');
const CASE_TOKEN = ['$', '{CASE}'].join('');

function lastJson(stdout) {
  try {
    return JSON.parse(stdout.trim().split('\n').pop());
  } catch {
    return null;
  }
}

test('UT-GATE-002 레지스트리의 존재하는 모든 게이트 스크립트는 빈 root와 없는 root에서 exit 2다 [NFR-MAINT-001]', () => {
  const empty = mkdtempSync(path.join(os.tmpdir(), 'fathom-gates-empty-'));
  try {
    const present = GATES.filter((g) => existsSync(path.join(GATES_DIR, g.script)));
    assert.ok(present.length >= 1, 'check:boundaries 는 이 Task 에서 존재한다');
    assert.ok(present.some((g) => g.id === 'check:boundaries'));
    for (const g of present) {
      const script = path.join(GATES_DIR, g.script);
      const onEmpty = spawnSync(process.execPath, [script, '--root', empty, '--json', ...g.args], { encoding: 'utf8' });
      assert.equal(onEmpty.status, 2, `${g.id} on an empty root must exit 2 (vacuous pass guard): ${onEmpty.stdout}`);
      assert.equal(lastJson(onEmpty.stdout)?.exit, 2, `${g.id} --json exit 2 shape`);
      const absent = path.join(empty, 'does-not-exist');
      const onMissing = spawnSync(process.execPath, [script, '--root', absent, '--json', ...g.args], {
        encoding: 'utf8',
      });
      assert.equal(onMissing.status, 2, `${g.id} on a missing root must exit 2`);
      assert.match(lastJson(onMissing.stdout).error, /^engine\//);
    }
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

/**
 * 스텁 게이트로 selftest 샌드박스를 만든다.
 * stub-gate.mjs : <root>/stub.json({exit, violations}) 을 그대로 재생. stub.json 없음(빈 root)·root 없음 → exit 2.
 * lax-gate.mjs  : 존재하는 root 는 stub.json 이 없어도 exit 0, 없는 root 도 exit 0 (vacuous pass 결함 모사).
 */
function sandbox() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fathom-gates-self-'));
  const gatesDir = path.join(dir, 'gates');
  const fixturesDir = path.join(dir, 'fixtures');
  mkdirSync(gatesDir);
  mkdirSync(fixturesDir);
  const stub = (lax) =>
    [
      "import fs from 'node:fs';",
      "import path from 'node:path';",
      "import { fileURLToPath } from 'node:url';",
      'const here = path.dirname(fileURLToPath(import.meta.url));',
      "const root = process.argv[process.argv.indexOf('--root') + 1];",
      "fs.appendFileSync(path.join(here, 'calls.log'), JSON.stringify({ root, argv: process.argv.slice(2) }) + '\\n');",
      'const out = (o) => process.stdout.write(JSON.stringify(o) + "\\n");',
      `const lax = ${lax};`,
      'if (!fs.existsSync(root)) {',
      "  if (lax) { out({ check: 'stub', root, exit: 0, files: 1, errors: 0, warnings: 0, violations: [] }); process.exit(0); }",
      "  out({ check: 'stub', root, exit: 2, error: 'engine/no-root: gone' }); process.exit(2);",
      '}',
      "const file = path.join(root, 'stub.json');",
      'if (!fs.existsSync(file)) {',
      "  if (lax) { out({ check: 'stub', root, exit: 0, files: 1, errors: 0, warnings: 0, violations: [] }); process.exit(0); }",
      "  out({ check: 'stub', root, exit: 2, error: 'engine/no-files: empty' }); process.exit(2);",
      '}',
      "const spec = JSON.parse(fs.readFileSync(file, 'utf8'));",
      'const violations = spec.violations ?? [];',
      "out({ check: 'stub', root, exit: spec.exit, files: 1, errors: violations.filter((v) => v.severity === 'error').length, warnings: 0, violations });",
      'process.exit(spec.exit);',
    ].join('\n');
  writeFileSync(path.join(gatesDir, 'stub-gate.mjs'), stub(false));
  writeFileSync(path.join(gatesDir, 'lax-gate.mjs'), stub(true));
  const reg = [];
  const put = (rel, text) => {
    const abs = path.join(fixturesDir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  };
  const stubJson = (exit, violations = []) => JSON.stringify({ exit, violations });
  const v = (file, line, rule) => ({ file, line, rule, message: 'm', severity: 'error' });
  const addGate = (id, script, args = []) => {
    reg.push({ id, script, stage: 'g1', args, fixture: id.replace(':', '-') });
    return id.replace(':', '-');
  };
  const api = {
    dir,
    gatesDir,
    fixturesDir,
    put,
    stubJson,
    v,
    addGate,
    calls: () => {
      const f = path.join(gatesDir, 'calls.log');
      return existsSync(f)
        ? readFileSync(f, 'utf8')
            .trim()
            .split('\n')
            .map((l) => JSON.parse(l))
        : [];
    },
    /** 정상 fixture 한 벌(clean exit 0, violations exit 1 + 마커 일치). */
    goodFixture: (fx) => {
      put(`${fx}/clean/stub.json`, stubJson(0));
      put(`${fx}/clean/ok.ts`, 'export const ok = 1;\n');
      put(`${fx}/violations/stub.json`, stubJson(1, [v('bad.ts', 2, 'r/one')]));
      put(`${fx}/violations/bad.ts`, 'export const a = 1;\nexport const b = 2; // EXPECT[r/one]\n');
    },
    run: (...args) => {
      writeFileSync(path.join(dir, 'registry.json'), JSON.stringify(reg));
      const r = spawnSync(
        process.execPath,
        [
          SELFTEST,
          '--root',
          dir,
          '--registry',
          path.join(dir, 'registry.json'),
          '--gates-dir',
          gatesDir,
          '--fixtures-dir',
          fixturesDir,
          '--json',
          ...args,
        ],
        { encoding: 'utf8' },
      );
      return { status: r.status, json: lastJson(r.stdout), stdout: r.stdout, stderr: r.stderr };
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
  return api;
}

const rulesOf = (res) => res.json.violations.map((x) => x.rule).sort();

test('UT-GATE-042 실제 check-gate-selftest --only check:boundaries는 exit 0이고 EVADES 한계를 보고한다 [AP-15][NFR-MAINT-001]', () => {
  const r = spawnSync(process.execPath, [SELFTEST, '--only', 'check:boundaries', '--json', '--root', GATES_DIR], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const json = lastJson(r.stdout);
  assert.equal(json.check, 'check:gate-selftest');
  assert.deepEqual(json.checked, ['check:boundaries']);
  assert.equal(json.files, 1);
  assert.deepEqual(json.violations, []);
  assert.ok(json.limitations.length >= 3);
  assert.ok(json.limitations.every((l) => l.gate === 'check:boundaries' && l.rule.startsWith('boundary/')));
  // --allow-missing: 아직 없는 게이트(T-00-06)는 건너뛴다
  const lenient = spawnSync(process.execPath, [SELFTEST, '--allow-missing', '--json', '--root', GATES_DIR], {
    encoding: 'utf8',
  });
  assert.equal(lenient.status, 0, lenient.stdout);
  assert.ok(lastJson(lenient.stdout).checked.includes('check:boundaries'));
});

test('UT-GATE-043 clean≠0·violations≠1·expect 불일치·빈 root≠2·없는 root≠2는 각각 exit 1과 해당 진단이다 [AP-15][NFR-MAINT-001]', () => {
  // 정상 스텁은 통과
  const ok = sandbox();
  try {
    ok.goodFixture(ok.addGate('stub:ok', 'stub-gate.mjs'));
    const r = ok.run();
    assert.equal(r.status, 0, r.stdout);
    assert.equal(r.json.files, 1);
  } finally {
    ok.cleanup();
  }
  // clean ≠ 0
  const a = sandbox();
  try {
    const fx = a.addGate('stub:a', 'stub-gate.mjs');
    a.goodFixture(fx);
    a.put(`${fx}/clean/stub.json`, a.stubJson(1, [a.v('ok.ts', 1, 'r/oops')]));
    const r = a.run();
    assert.equal(r.status, 1);
    assert.deepEqual(rulesOf(r), ['selftest/clean-not-zero']);
    assert.equal(r.json.violations[0].file, 'tools/gates/fixtures/stub-a/clean');
  } finally {
    a.cleanup();
  }
  // violations ≠ 1
  const b = sandbox();
  try {
    const fx = b.addGate('stub:b', 'stub-gate.mjs');
    b.goodFixture(fx);
    b.put(`${fx}/violations/stub.json`, b.stubJson(0));
    const r = b.run();
    assert.equal(r.status, 1);
    assert.deepEqual(rulesOf(r), ['selftest/violations-not-one']);
  } finally {
    b.cleanup();
  }
  // expect 불일치(초과 + 누락 모두 메시지에 담긴다)
  const c = sandbox();
  try {
    const fx = c.addGate('stub:c', 'stub-gate.mjs');
    c.goodFixture(fx);
    c.put(`${fx}/violations/stub.json`, c.stubJson(1, [c.v('bad.ts', 1, 'r/one'), c.v('bad.ts', 2, 'r/extra')]));
    const r = c.run();
    assert.equal(r.status, 1);
    assert.deepEqual(rulesOf(r), ['selftest/expect-mismatch']);
    assert.match(r.json.violations[0].message, /unexpected \[bad\.ts:1:r\/one, bad\.ts:2:r\/extra\]/);
    assert.match(r.json.violations[0].message, /missing \[bad\.ts:2:r\/one\]/);
  } finally {
    c.cleanup();
  }
  // 마커가 없는 violations 는 exit 1 만 단언한다
  const noMarkers = sandbox();
  try {
    const fx = noMarkers.addGate('stub:n', 'stub-gate.mjs');
    noMarkers.goodFixture(fx);
    noMarkers.put(`${fx}/violations/bad.ts`, 'export const a = 1;\n');
    assert.equal(noMarkers.run().status, 0);
  } finally {
    noMarkers.cleanup();
  }
  // 빈 root·없는 root 가 2 가 아님(vacuous pass 결함 모사)
  const d = sandbox();
  try {
    d.goodFixture(d.addGate('stub:d', 'lax-gate.mjs'));
    const r = d.run();
    assert.equal(r.status, 1);
    assert.deepEqual(rulesOf(r), ['selftest/empty-root-not-two', 'selftest/missing-root-not-two']);
  } finally {
    d.cleanup();
  }
});

test('UT-GATE-044 fixture 디렉터리가 없는 게이트는 selftest/fixture-missing(exit 1)이다 [AP-15][NFR-MAINT-001]', () => {
  const sb = sandbox();
  try {
    sb.goodFixture(sb.addGate('stub:ok', 'stub-gate.mjs'));
    sb.addGate('stub:nofx', 'stub-gate.mjs');
    const r = sb.run();
    assert.equal(r.status, 1);
    assert.deepEqual(rulesOf(r), ['selftest/fixture-missing']);
    assert.match(r.json.violations[0].message, /stub:nofx/);
    assert.equal(r.json.violations[0].file, 'tools/gates/fixtures/stub-nofx');
  } finally {
    sb.cleanup();
  }
  // clean 또는 violations 한쪽만 있어도 fixture-missing
  const half = sandbox();
  try {
    const fx = half.addGate('stub:half', 'stub-gate.mjs');
    half.put(`${fx}/clean/stub.json`, half.stubJson(0));
    const r = half.run();
    assert.equal(r.status, 1);
    assert.deepEqual(rulesOf(r), ['selftest/fixture-missing']);
  } finally {
    half.cleanup();
  }
});

test('UT-GATE-045 스크립트가 없으면 exit 2이고 --allow-missing이면 건너뛰며 검사한 게이트가 0개면 exit 2다 [AP-15][NFR-MAINT-001]', () => {
  const sb = sandbox();
  try {
    sb.goodFixture(sb.addGate('stub:ok', 'stub-gate.mjs'));
    sb.addGate('stub:gone', 'not-written.mjs');
    const strict = sb.run();
    assert.equal(strict.status, 2);
    assert.match(strict.json.error, /^engine\/input-missing: stub:gone/);
    const lenient = sb.run('--allow-missing');
    assert.equal(lenient.status, 0, lenient.stdout);
    assert.deepEqual(lenient.json.checked, ['stub:ok']);
    assert.deepEqual(lenient.json.skipped, ['stub:gone']);
    const only = sb.run('--allow-missing', '--only', 'stub:gone');
    assert.equal(only.status, 2, '검사한 게이트가 0개');
    assert.match(only.json.error, /^engine\/no-files: /);
    const unknown = sb.run('--only', 'stub:nope');
    assert.equal(unknown.status, 2);
    assert.match(unknown.json.error, /^engine\/usage: /);
  } finally {
    sb.cleanup();
  }
});

test('UT-GATE-046 selftest.args.json의 CASE 토큰은 케이스 경로로 치환되고 기본 args 뒤에 붙는다 [AP-15][NFR-MAINT-001]', () => {
  const sb = sandbox();
  try {
    const fx = sb.addGate('stub:args', 'stub-gate.mjs', ['--base-arg']);
    sb.goodFixture(fx);
    sb.put(`${fx}/clean/selftest.args.json`, JSON.stringify(['--input', `${CASE_TOKEN}/in.json`, '--tag=x']));
    const r = sb.run();
    assert.equal(r.status, 0, r.stdout);
    const cleanDir = path.join(sb.fixturesDir, fx, 'clean');
    const cleanCall = sb.calls().find((c) => c.root === cleanDir);
    assert.deepEqual(cleanCall.argv.slice(cleanCall.argv.indexOf('--quiet') + 1), [
      '--base-arg',
      '--input',
      `${cleanDir}/in.json`,
      '--tag=x',
    ]);
    // violations 케이스는 자기 args 가 없으므로 기본 args 만
    const violCall = sb.calls().find((c) => c.root === path.join(sb.fixturesDir, fx, 'violations'));
    assert.deepEqual(violCall.argv.slice(violCall.argv.indexOf('--quiet') + 1), ['--base-arg']);
    // 빈 root 탐침에서는 CASE 가 그 빈 임시 디렉터리로 치환된다
    const emptyCall = sb.calls().find((c) => c.argv.includes('--input') && c.root !== cleanDir);
    assert.ok(emptyCall.argv.some((a) => a === `${emptyCall.root}/in.json`));
  } finally {
    sb.cleanup();
  }
});

test('UT-GATE-047 evasions의 EVADES 행은 한계로 보고되고 판정에는 영향이 없다 [AP-15][NFR-MAINT-001]', () => {
  const sb = sandbox();
  try {
    const fx = sb.addGate('stub:eva', 'stub-gate.mjs');
    sb.goodFixture(fx);
    sb.put(`${fx}/evasions/stub.json`, sb.stubJson(0)); // 회피는 탐지되지 않아 exit 0 — 그래도 통과
    sb.put(
      `${fx}/evasions/evade.ts`,
      'export const a = 1;\nexport const b = 2; // EVADES[boundary/cross-service-import] 이유\n',
    );
    const r = sb.run();
    assert.equal(r.status, 0, r.stdout);
    assert.deepEqual(r.json.limitations, [
      { gate: 'stub:eva', file: 'evade.ts', line: 2, rule: 'boundary/cross-service-import' },
    ]);
    assert.equal(
      sb.calls().some((c) => c.root.endsWith(`${path.sep}evasions`)),
      true,
      'evasions 케이스는 실행만 한다',
    );
    // evasions 가 exit 2 로 죽어도 판정 불변
    sb.put(`${fx}/evasions/stub.json`, sb.stubJson(2));
    assert.equal(sb.run().status, 0);
  } finally {
    sb.cleanup();
  }
});

test('UT-GATE-048 --json 출력은 §4.1.1 형식(check·root·exit·files·errors·warnings·violations)에 checked·skipped·limitations를 더한다 [AP-15][NFR-MAINT-001]', () => {
  const sb = sandbox();
  try {
    sb.goodFixture(sb.addGate('stub:one', 'stub-gate.mjs'));
    sb.goodFixture(sb.addGate('stub:two', 'stub-gate.mjs'));
    const r = sb.run('--only', 'stub:two');
    assert.equal(r.status, 0);
    assert.deepEqual(Object.keys(r.json), [
      'check',
      'root',
      'exit',
      'files',
      'errors',
      'warnings',
      'violations',
      'checked',
      'skipped',
      'limitations',
    ]);
    assert.deepEqual(r.json.checked, ['stub:two']);
    assert.equal(r.json.root, sb.dir);
    const text = spawnSync(
      process.execPath,
      [
        SELFTEST,
        '--root',
        sb.dir,
        '--registry',
        path.join(sb.dir, 'registry.json'),
        '--gates-dir',
        sb.gatesDir,
        '--fixtures-dir',
        sb.fixturesDir,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(text.stdout, '[check:gate-selftest] 0 error(s), 0 warning(s), 2 file(s)\n');
  } finally {
    sb.cleanup();
  }
});

test('UT-GATE-049 잘못된 selftest.args.json·레지스트리·알 수 없는 인자는 exit 2다 [AP-15][NFR-MAINT-001]', () => {
  const sb = sandbox();
  try {
    const fx = sb.addGate('stub:bad', 'stub-gate.mjs');
    sb.goodFixture(fx);
    sb.put(`${fx}/clean/selftest.args.json`, '{"not": "an array"}');
    const r = sb.run();
    assert.equal(r.status, 2);
    assert.match(r.json.error, /^engine\/config: .*selftest\.args\.json/);
    const brokenRegistry = spawnSync(
      process.execPath,
      [SELFTEST, '--root', sb.dir, '--registry', path.join(sb.dir, 'nope.json'), '--json'],
      { encoding: 'utf8' },
    );
    assert.equal(brokenRegistry.status, 2);
    assert.equal(spawnSync(process.execPath, [SELFTEST, '--bogus'], { encoding: 'utf8' }).status, 2);
    assert.equal(spawnSync(process.execPath, [SELFTEST, '--only'], { encoding: 'utf8' }).status, 2);
  } finally {
    sb.cleanup();
  }
});
