// UT-GATE-073~079 — check:scope(Task Brief allowed_paths 대조, CR-59) 단위 테스트.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { evaluateScope, parseAllowedPaths } from '../check-scope.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATES_DIR = path.join(HERE, '..');
const GATE = path.join(GATES_DIR, 'check-scope.mjs');

function run(root, ...args) {
  const r = spawnSync(process.execPath, [GATE, '--root', root, '--json', ...args], { encoding: 'utf8' });
  let json = null;
  try {
    json = JSON.parse(r.stdout.trim().split('\n').pop());
  } catch {
    json = null;
  }
  return { status: r.status, json, stderr: r.stderr };
}

const BRIEF = [
  '# Brief',
  '',
  '```yaml',
  'allowed_paths:',
  '  - tools/gates/{check-a,check-b}.mjs   # 중괄호',
  '  - "tools/gates/config/a.json"',
  '',
  '  # 주석 줄',
  "  - 'packages/contracts/src/events/{registry.gen.ts,routing.gen.ts}'",
  '  - packages/contracts/src/http/**',
  'test_ids:',
  '  - UT-X-001',
  '```',
  '',
].join('\n');

/** 임시 저장소: Brief + changed.txt. */
function withRepo(changed, fn, brief = BRIEF) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fathom-gates-scope-'));
  try {
    mkdirSync(path.join(dir, 'docs/40-impl/briefs/IT-00'), { recursive: true });
    writeFileSync(path.join(dir, 'docs/40-impl/briefs/IT-00/T-00-06.md'), brief);
    writeFileSync(path.join(dir, 'changed.txt'), `${changed.join('\n')}\n`);
    return fn(dir, ['--task', 'T-00-06', '--changed-from', path.join(dir, 'changed.txt')]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const rules = (res) => res.json.violations.map((v) => `${v.file}|${v.rule}`);

test('UT-GATE-073 check:scope selftest(--changed-from fixture)가 통과한다 [PR-006][UR-06]', () => {
  const r = spawnSync(process.execPath, [path.join(GATES_DIR, 'check-gate-selftest.mjs'), '--only', 'check:scope'], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('UT-GATE-074 allowed_paths를 yaml 펜스 안·밖, 따옴표·뒤 주석·중괄호 glob까지 줄 단위로 파싱한다 [PR-006][UR-06]', () => {
  assert.deepEqual(parseAllowedPaths(BRIEF), [
    'tools/gates/{check-a,check-b}.mjs',
    'tools/gates/config/a.json',
    'packages/contracts/src/events/{registry.gen.ts,routing.gen.ts}'.replace(/^/, ''),
    'packages/contracts/src/http/**',
  ]);
  // 펜스 밖(일반 마크다운 목록)
  const prose = 'intro\n\nallowed_paths:\n- a/b/**\n- c/{d,e}.ts\n\n다음 문단';
  assert.deepEqual(parseAllowedPaths(prose), ['a/b/**', 'c/{d,e}.ts']);
  // 없음 → []
  assert.deepEqual(parseAllowedPaths('no list here'), []);
  assert.deepEqual(parseAllowedPaths('allowed_paths:\nforbidden:\n  - x'), []);
  // 중괄호 밖 쉼표는 지원하지 않는다: 항목 전체가 하나의 glob(아무것도 맞지 않는다)
  const res = evaluateScope(['a/x.ts', 'b/y.ts'], ['a/**, b/**'], 'T-00-06');
  assert.deepEqual(
    res.map((v) => v.rule),
    ['scope/outside-allowed', 'scope/outside-allowed'],
  );
});

test('UT-GATE-075 allowed_paths 밖 파일은 scope/outside-allowed, 안의 파일은 통과한다 [PR-006][UR-06]', () => {
  withRepo(
    [
      'tools/gates/check-a.mjs',
      'tools/gates/check-b.mjs',
      'tools/gates/config/a.json',
      'packages/contracts/src/http/x.ts',
    ],
    (dir, args) => {
      const res = run(dir, ...args);
      assert.equal(res.status, 0, JSON.stringify(res.json));
      assert.equal(res.json.files, 4);
    },
  );
  withRepo(['tools/gates/check-a.mjs', 'tools/gates/check-c.mjs', 'services/x/src/y.ts'], (dir, args) => {
    const res = run(dir, ...args);
    assert.equal(res.status, 1);
    assert.deepEqual(rules(res), [
      'services/x/src/y.ts|scope/outside-allowed',
      'tools/gates/check-c.mjs|scope/outside-allowed',
    ]);
    assert.ok(res.json.violations.every((v) => v.line === 0));
  });
});

test('UT-GATE-076 graphify-out/·spikes/ 변경은 allowed_paths와 무관하게 항상 위반이다 [PR-006][UR-06]', () => {
  const brief = BRIEF.replace('  - packages/contracts/src/http/**', '  - graphify-out/**\n  - spikes/**');
  withRepo(
    ['graphify-out/graph.json', 'spikes/sp1/x.ts', 'tools/gates/check-a.mjs'],
    (dir, args) => {
      const res = run(dir, ...args);
      assert.equal(res.status, 1);
      assert.deepEqual(rules(res), ['graphify-out/graph.json|scope/graphify-out', 'spikes/sp1/x.ts|scope/spikes']);
    },
    brief,
  );
});

test('UT-GATE-077 생성물은 allowed_paths가 파일을 명시했을 때만 허용한다(넓은 glob 우연 포함은 scope/generated) [PR-006][UR-06]', () => {
  const wide = BRIEF.replace('  - packages/contracts/src/http/**', '  - packages/contracts/src/**');
  withRepo(
    ['packages/contracts/src/events/registry.gen.ts'],
    (dir, args) => {
      const res = run(dir, ...args);
      assert.deepEqual(rules(res), ['packages/contracts/src/events/registry.gen.ts|scope/generated']);
    },
    wide.replace("  - 'packages/contracts/src/events/{registry.gen.ts,routing.gen.ts}'\n", ''),
  );
  // 명시(중괄호 안 파일 이름) → 통과
  withRepo(
    ['packages/contracts/src/events/registry.gen.ts', 'packages/contracts/src/events/routing.gen.ts'],
    (dir, args) => {
      assert.equal(run(dir, ...args).status, 0);
    },
    wide,
  );
  // 다른 생성물 4종의 판정
  const gens = [
    'packages/contracts/.snapshots/events/x.v1.json',
    'docs/40-impl/graph/g.json',
    'docs/40-impl/reports/RTM-INT-1a.md',
    'x/y.gen.ts',
  ];
  const broad = evaluateScope(gens, ['**'], 'T-00-06');
  assert.deepEqual(
    broad.map((v) => v.rule),
    ['scope/generated', 'scope/generated', 'scope/generated', 'scope/generated'],
  );
  const named = evaluateScope(
    gens,
    [
      'packages/contracts/.snapshots/events/**',
      'docs/40-impl/graph/**',
      'docs/40-impl/reports/RTM-*.md',
      'x/{y.gen.ts}',
    ],
    'T-00-06',
  );
  assert.deepEqual(named, []);
});

test('UT-GATE-078 완료 보고 JSON은 자동 허용(해당 Task 것만)이고 변경 0개·Brief 없음·--task 형식 오류는 exit 2다 [PR-006][UR-06]', () => {
  withRepo(['docs/40-impl/reports/tasks/T-00-06.json', 'tools/gates/check-a.mjs'], (dir, args) =>
    assert.equal(run(dir, ...args).status, 0),
  );
  withRepo(['docs/40-impl/reports/tasks/T-00-07.json'], (dir, args) =>
    assert.deepEqual(rules(run(dir, ...args)), ['docs/40-impl/reports/tasks/T-00-07.json|scope/outside-allowed']),
  );
  withRepo([], (dir, args) => {
    const res = run(dir, ...args);
    assert.equal(res.status, 2);
    assert.match(res.json.error, /^engine\/input-missing: no changed files/);
  });
  withRepo(['x'], (dir, args) => {
    const bad = run(dir, '--task', 'T-0-6', '--changed-from', args[3]);
    assert.equal(bad.status, 2);
    assert.match(bad.json.error, /^engine\/usage: --task must match/);
    assert.equal(run(dir, '--changed-from', args[3]).status, 2, '--task 필수');
    const noBrief = run(dir, '--task', 'T-00-99', '--changed-from', args[3]);
    assert.equal(noBrief.status, 2);
    assert.match(noBrief.json.error, /^engine\/input-missing: Task Brief not found/);
    // 항목 0개 Brief
    const custom = path.join(dir, 'empty-brief.md');
    writeFileSync(custom, '# nothing\n');
    const empty = run(dir, '--task', 'T-00-06', '--changed-from', args[3], '--brief', 'empty-brief.md');
    assert.equal(empty.status, 2);
    assert.match(empty.json.error, /no allowed_paths/);
  });
  // -r1 형식 허용
  assert.equal(evaluateScope(['a'], ['a'], 'T-00-06-r1').length, 0);
});

test('UT-GATE-079 임시 git 저장소에서 git 경로(추적 안 된 파일 포함)와 --base 로 변경 파일을 읽는다 [PR-006][UR-06]', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fathom-gates-scope-git-'));
  const git = (...a) =>
    spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], {
      cwd: dir,
      encoding: 'utf8',
    });
  try {
    assert.equal(git('init', '-q').status, 0);
    mkdirSync(path.join(dir, 'docs/40-impl/briefs/IT-00'), { recursive: true });
    mkdirSync(path.join(dir, 'tools/gates'), { recursive: true });
    writeFileSync(path.join(dir, 'docs/40-impl/briefs/IT-00/T-00-06.md'), BRIEF);
    writeFileSync(path.join(dir, 'tools/gates/check-a.mjs'), '// a\n');
    git('add', '-A');
    assert.equal(git('commit', '-q', '-m', 'base').status, 0);
    // 변경 없음 → exit 2
    assert.equal(run(dir, '--task', 'T-00-06').status, 2);
    // 추적된 파일 수정(허용) + 추적 안 된 새 파일(허용 밖)
    writeFileSync(path.join(dir, 'tools/gates/check-a.mjs'), '// changed\n');
    mkdirSync(path.join(dir, 'services/x'), { recursive: true });
    writeFileSync(path.join(dir, 'services/x/new.ts'), 'export {};\n');
    const res = run(dir, '--task', 'T-00-06');
    assert.equal(res.status, 1);
    assert.deepEqual(rules(res), ['services/x/new.ts|scope/outside-allowed']);
    assert.equal(res.json.files, 2);
    // 커밋 후 --base HEAD~1 로 같은 변경을 본다
    git('add', '-A');
    assert.equal(git('commit', '-q', '-m', 'work').status, 0);
    const based = run(dir, '--task', 'T-00-06', '--base', 'HEAD~1');
    assert.equal(based.status, 1);
    assert.deepEqual(rules(based), ['services/x/new.ts|scope/outside-allowed']);
    // 잘못된 base → exit 2
    const wrong = run(dir, '--task', 'T-00-06', '--base', 'no-such-ref');
    assert.equal(wrong.status, 2);
    assert.match(wrong.json.error, /^engine\/git: /);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
