// UT-GATE-121~129 — check:jev-index(Jev 요청·프롬프트의 위치 참조 금지, SP-7 이식) 단위 테스트.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkSource, checkText } from '../check-jev-index.mjs';
import { compare, loadExpectations } from '../lib/expect.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATES_DIR = path.join(HERE, '..');
const GATE = path.join(GATES_DIR, 'check-jev-index.mjs');
const FIX = path.join(GATES_DIR, 'fixtures', 'check-jev-index');
const JEV = 'services/a/src/jev/x.ts';

function run(root, ...args) {
  const r = spawnSync(process.execPath, [GATE, '--root', root, '--json', ...args], { encoding: 'utf8' });
  let json = null;
  try {
    json = JSON.parse(r.stdout.trim().split('\n').pop());
  } catch {
    json = null;
  }
  return { status: r.status, json };
}

const rules = (rel, src) => checkSource(rel, src).map((v) => v.rule);

function withRepo(files, fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fathom-gates-jev-'));
  try {
    for (const rel of ['services/a/src', 'packages/contracts/src']) {
      mkdirSync(path.join(dir, rel), { recursive: true });
    }
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      writeFileSync(path.join(dir, rel), content);
    }
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('UT-GATE-121 check:jev-index selftest가 통과하고 SP-7 21건(20 error + 1 warn)이 기대 집합과 일치한다 [FR-AI-005][UR-16][IF-EXT-01]', () => {
  const r = spawnSync(
    process.execPath,
    [path.join(GATES_DIR, 'check-gate-selftest.mjs'), '--only', 'check:jev-index'],
    {
      encoding: 'utf8',
    },
  );
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const viol = run(path.join(FIX, 'violations'));
  assert.equal(viol.status, 1);
  const { fp, fn } = compare(
    loadExpectations(path.join(FIX, 'violations')),
    viol.json.violations.filter((v) => v.severity === 'error'),
  );
  assert.deepEqual({ fp, fn }, { fp: [], fn: [] });
  // SP-7에서 이식한 파일만 세면 21건 = 20 error + 1 warn (fixture는 신규 케이스 2건을 더 가진다)
  const ported = viol.json.violations.filter(
    (v) => !v.file.startsWith('services/a/assets/') && v.file !== 'services/a/src/escape-no-reason.jev.ts',
  );
  assert.equal(ported.length, 21);
  assert.equal(ported.filter((v) => v.severity === 'error').length, 20);
  assert.deepEqual(
    ported.filter((v) => v.severity === 'warn').map((v) => v.rule),
    ['jev/index-var'],
  );
  assert.equal(run(path.join(FIX, 'clean')).status, 0);
});

test('UT-GATE-122 범위 ① 경로에 /jev/가 있는 src 파일 ② *.jev.ts ③ @typesafe-ai/sdk import 파일 [FR-AI-005][UR-16]', () => {
  const bad = 'export const a = candidates[3];';
  assert.deepEqual(rules('services/a/src/jev/x.ts', bad), ['jev/index-literal']);
  assert.deepEqual(rules('services/a/src/application/grading/judge-input.jev.ts', bad), ['jev/index-literal']);
  assert.deepEqual(rules('services/a/src/other.ts', `import { jev } from '@typesafe-ai/sdk';\n${bad}`), [
    'jev/index-literal',
  ]);
  assert.deepEqual(rules('services/a/src/other.ts', `import { x } from '@typesafe-ai/sdk/runtime';\n${bad}`), [
    'jev/index-literal',
  ]);
  assert.deepEqual(
    rules('services/a/src/other.ts', "import { x } from '@typesafe-ai/sdk-extra';\nexport const a = candidates[3];"),
    [],
    '이름만 비슷한 패키지는 범위 밖',
  );
});

test('UT-GATE-123 범위 밖의 items[0]·"item 2"는 통과한다 [FR-AI-005][UR-16]', () => {
  const src =
    "export const a = items[0]; export const b = 'Compare item 2 with item 3'; export const c = { index: 0 };";
  assert.deepEqual(rules('services/a/src/application/x.ts', src), []);
  assert.deepEqual(rules('apps/web/src/lib/x.ts', src), []);
  assert.deepEqual(rules('services/a/src/jevelin/x.ts', src), [], '디렉터리 이름이 jev 가 아니면 범위 밖');
  assert.deepEqual(rules('services/a/src/notjev.ts', src), []);
});

test('UT-GATE-124 jev/index-literal·index-var 는 후보 이름 식별자에만 적용되고 비후보 배열 인덱스는 허용한다 [FR-AI-005][UR-16]', () => {
  assert.deepEqual(rules(JEV, 'options.at(0); units[1]; res.items[2]; argv[2]; text.split(",")[0];'), [
    'jev/index-literal',
    'jev/index-literal',
    'jev/index-literal',
  ]);
  const v = checkSource(JEV, 'for (let i = 0; i < units.length; i++) void units[i];');
  assert.deepEqual(
    v.map((x) => `${x.rule}:${x.severity}`),
    ['jev/index-var:warn'],
  );
  assert.deepEqual(rules(JEV, 'const m = /(\\d+)/.exec(t); m[1]; out.units.u01;'), []);
  assert.deepEqual(rules(JEV, '// candidates[3] in a comment\nconst a = 1;'), []);
});

test('UT-GATE-125 jev/index-string — 영어·한국어 위치 표현(item 2·2번 항목·3번째·second candidate·2nd option·candidates[3])을 잡는다 [FR-AI-005][UR-16]', () => {
  for (const text of [
    'Compare item 2 with item 3',
    '항목 2번을 보라',
    '3번째 보기',
    '2번 항목',
    'the second candidate',
    'the 2nd option',
    'candidates[3] is best',
    'Judge Option #1',
  ]) {
    assert.deepEqual(rules(JEV, `export const t = ${JSON.stringify(text)};`), ['jev/index-string'], text);
  }
  for (const text of [
    'item2vec is unrelated',
    'keys look like u01, opt_a',
    'units.u01 and units.u02',
    'first of all',
    'last resort',
  ]) {
    assert.deepEqual(rules(JEV, `export const t = ${JSON.stringify(text)};`), [], text);
  }
  assert.deepEqual(rules(JEV, 'export const t = `Judge Option 1 first`;'), ['jev/index-string']);
});

test('UT-GATE-126 jev/index-interp·index-field — `i + 1` 번호 번호 매김과 { index: 0 }·best_index·selectedIndex 위치 필드 [FR-AI-005][UR-16]', () => {
  assert.deepEqual(rules(JEV, `const l = cs.map((c, i) => \`\${i + 1}. \${c}\`);`), ['jev/index-interp']);
  assert.deepEqual(rules(JEV, `const l = os.map((o, idx) => \`[\${idx}] \${o}\`);`), ['jev/index-interp']);
  assert.deepEqual(rules(JEV, `const l = \`\${key}: \${text}\`;`), []);
  assert.deepEqual(rules(JEV, 'export const F = { best_index: 0, selectedIndex: 1, "idx": 2 };'), [
    'jev/index-field',
    'jev/index-field',
    'jev/index-field',
  ]);
  assert.deepEqual(rules(JEV, 'export const F = { key: "u01", indexing: 1 };'), []);
});

test('UT-GATE-127 `// jev-ok: 사유`는 같은 줄·윗줄 면제이고 사유가 없으면 무효다(md 프롬프트는 <!-- jev-ok: 사유 -->) [FR-AI-005][UR-16]', () => {
  assert.deepEqual(rules(JEV, '// jev-ok: 정렬이 보장된 내부 배열\nconst a = candidates[0];'), []);
  assert.deepEqual(rules(JEV, 'const a = candidates[0]; // jev-ok: 정렬 보장'), []);
  assert.deepEqual(rules(JEV, '// jev-ok:\nconst a = candidates[0];'), ['jev/index-literal']);
  assert.deepEqual(
    rules(JEV, '// sql-ok: 다른 탈출구\nconst a = candidates[0];'),
    ['jev/index-literal'],
    '다른 게이트의 탈출구는 무효',
  );
  assert.deepEqual(
    checkText('p.md', '<!-- jev-ok: 레거시 -->\n항목 2 를 본다.').map((v) => v.rule),
    [],
  );
  assert.deepEqual(
    checkText('p.md', '<!-- jev-ok: -->\n항목 2 를 본다.').map((v) => v.rule),
    ['jev/index-string'],
  );
});

test('UT-GATE-128 프롬프트 md는 **/jev/prompts/**/*.md 만 검사하고 services/*/assets/** 도 포함한다 [FR-AI-005][UR-16][IF-EXT-01]', () => {
  const bad = '먼저 항목 2번을 본다.\n';
  withRepo(
    {
      'services/a/src/ok.ts': 'export const ok = 1;\n',
      'services/a/assets/jev/prompts/AI-J01/1.0.0/prompt.md': bad,
      'services/a/src/jev/prompts/x.md': bad,
      'services/a/assets/other/readme.md': bad,
      'services/a/src/docs/readme.md': bad,
      'services/a/assets/jev/prompts/AI-J01/1.0.0/meta.yaml': 'note: 항목 2\n',
    },
    (dir) => {
      const res = run(dir);
      assert.equal(res.status, 1);
      assert.deepEqual(
        res.json.violations.map((v) => `${v.file}:${v.line}`),
        ['services/a/assets/jev/prompts/AI-J01/1.0.0/prompt.md:1', 'services/a/src/jev/prompts/x.md:1'],
      );
      assert.equal(res.json.files, 1, 'files = 소스 파일 수(src 기준)');
    },
  );
});

test('UT-GATE-129 src 파일이 0개면 exit 2(범위 파일 0개여도 src 전체가 files)이고 Jev 범위 파일이 없어도 src가 있으면 exit 0이다 [FR-AI-005][UR-16]', () => {
  withRepo({}, (dir) => {
    const res = run(dir);
    assert.equal(res.status, 2);
    assert.match(res.json.error, /^engine\/no-files: /);
  });
  withRepo({ 'services/a/src/plain.ts': 'export const x = items[0];\n' }, (dir) => {
    const res = run(dir);
    assert.equal(res.status, 0);
    assert.equal(res.json.files, 1);
  });
  withRepo({ 'services/a/src/jev/x.ts': 'export const x = items[0];\n' }, (dir) => {
    const res = run(dir);
    assert.equal(res.status, 1);
    assert.deepEqual(
      res.json.violations.map((v) => `${v.file}:${v.line}:${v.rule}`),
      ['services/a/src/jev/x.ts:1:jev/index-literal'],
    );
  });
});
