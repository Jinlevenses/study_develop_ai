// UT-GATE-001·005·010~019 — tools/gates/lib 공용 라이브러리 단위 테스트(node:test, 의존성 0).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { hasEscape, readJsonc, snake } from '../lib/common.mjs';
import { compare, loadEvasions, loadExpectations } from '../lib/expect.mjs';
import { changedFiles, commitMessages, showAtBase } from '../lib/git.mjs';
import { expandBraces, matchAny, matchGlob } from '../lib/glob.mjs';
import { extractImports } from '../lib/imports.mjs';
import { compareInt, INT_ORDER, intUpper, isIntId } from '../lib/int.mjs';
import { callArgs, deepTokens, maskComments, matchClose, stringPieces, tokenize } from '../lib/lex.mjs';
import { GATES, gatesForStage } from '../lib/registry.mjs';
import { formatJson, formatText } from '../lib/report.mjs';
import { walk } from '../lib/walk.mjs';

/** 소스 문자열 안의 템플릿 치환 시작을 `#{`로 적는다(biome noTemplateCurlyInString 회피). */
const sub = (text) => text.replaceAll('#{', ['$', '{'].join(''));

function tmpdir() {
  return mkdtempSync(path.join(os.tmpdir(), 'fathom-gates-lex-'));
}

function put(root, rel, text) {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

test('UT-GATE-001 tokenize는 주석·문자열·중첩 템플릿·정규식 리터럴·TSX 홑따옴표·줄 번호를 구분한다 [NFR-MAINT-001]', () => {
  // 줄·블록 주석 분리, 줄 번호
  const a = tokenize("const a = 1; // tail\n/* blk\nmore */ const b = 'x';\n");
  assert.deepEqual(
    a.comments.map((c) => [c.kind, c.line]),
    [
      ['line', 1],
      ['block', 2],
    ],
  );
  assert.equal(a.tokens.find((t) => t.t === 'str').line, 3);
  assert.equal(a.lineOf(0), 1);
  // 문자열(홑·쌍따옴표, 이스케이프 보존)
  const s = tokenize(`const x = 'it\\'s'; const y = "q";`).tokens.filter((t) => t.t === 'str');
  assert.deepEqual(
    s.map((t) => t.v),
    ["it\\'s", 'q'],
  );
  // 템플릿 ${} 중첩
  const tpl = tokenize(sub('const t = `a#{b + `c#{d}`}e`;')).tokens.find((t) => t.t === 'tpl');
  assert.equal(tpl.quasis.length, 2);
  assert.equal(tpl.exprs.length, 1);
  assert.ok(tpl.exprs[0].tokens.some((t) => t.t === 'tpl' && t.exprs.length === 1));
  assert.ok([...deepTokens(tokenize(sub('f(`a#{g(1)}`)')).tokens)].some((t) => t.t === 'id' && t.v === 'g'));
  // 정규식 리터럴 vs 나눗셈
  assert.equal(tokenize('const z = a / b / c;').tokens.filter((t) => t.t === 're').length, 0);
  assert.deepEqual(
    tokenize('function f(s) { return /x+/g.test(s); }')
      .tokens.filter((t) => t.t === 're')
      .map((t) => t.v),
    ['/x+/g'],
  );
  assert.equal(tokenize('const r = /[/]a/;').tokens.filter((t) => t.t === 're').length, 1);
  // TSX 텍스트의 홑따옴표 복구: 이후 토큰이 정상 분석된다
  const tsx = tokenize("const el = <p>don't stop</p>;\nconst ok = 'fine';\n");
  const ok = tsx.tokens.find((t) => t.t === 'str');
  assert.equal(ok.v, 'fine');
  assert.equal(ok.line, 2);
  // 보조 함수
  assert.equal(maskComments('a // c\nb', tokenize('a // c\nb').comments), 'a     \nb');
  const toks = tokenize('f(a, [b, c], d)').tokens;
  assert.equal(matchClose(toks, 1), toks.length - 1);
  assert.equal(callArgs(toks, 1).args.length, 3);
  assert.deepEqual(
    [...stringPieces(tokenize(sub('x = `p#{"q"}r`')).tokens, (n) => n)].map((p) => p.text),
    ['p', 'r', 'q'],
  );
});

test('UT-GATE-005 hasEscape는 같은 줄·윗줄의 사유 있는 탈출구만 인정하고 사유 없는 주석은 무효다 [NFR-SEC-010]', () => {
  const lines = [
    'db.exec(sql); // sql-ok: 마이그레이션 실행기',
    '// sql-ok: 마이그레이션 실행기',
    'db.exec(sql);',
    '// sql-ok:',
    'db.exec(a);',
    '// sql-ok:   ',
    'db.exec(b);',
    '// sql-ok: 두 줄 위',
    '',
    'db.exec(c);',
    '// biome-ignore lint/plugin: 이유 있음',
    'db.exec(d);',
  ];
  assert.equal(hasEscape(lines, 1, 'sql-ok'), true, '같은 줄');
  assert.equal(hasEscape(lines, 3, 'sql-ok'), true, '윗줄');
  assert.equal(hasEscape(lines, 5, 'sql-ok'), false, '사유 없음(`// sql-ok:`)');
  assert.equal(hasEscape(lines, 7, 'sql-ok'), false, '사유 공백뿐');
  assert.equal(hasEscape(lines, 10, 'sql-ok'), false, '두 줄 위');
  assert.equal(hasEscape(lines, 12, 'biome-ignore lint/plugin'), true);
  assert.equal(hasEscape(lines, 12, 'sql-ok'), false, '다른 태그');
  assert.equal(hasEscape('x(); // boundary-ok: 문자열 입력\n', 1, 'boundary-ok'), true);
  assert.equal(snake('FooBar-baz Qux'), 'foo_bar_baz_qux');
});

test('UT-GATE-010 extractImports는 9종 kind와 typeOnly를 구분하고 주석·문자열 속 import는 무시한다 [NFR-MAINT-001]', () => {
  const src = [
    "import a from './a.ts';", // 1 static
    "import './side.ts';", // 2 side-effect
    "export { x } from './b.ts';", // 3 export-from
    "export * from './c.ts';", // 4 export-from
    "const m = await import('./d.ts');", // 5 dynamic
    "const r = require('./e.cjs');", // 6 require
    "const g = import.meta.glob('./f/*.ts');", // 7 glob
    'const n = import(target);', // 8 nonliteral-import
    'const q = require(name);', // 9 nonliteral-require
    'const cr = createRequire(import.meta.url);', // 10 create-require
    "import type { T } from './t.ts';", // 11 typeOnly
    "export type { U } from './u.ts';", // 12 typeOnly export
    "import { type V } from './v.ts';", // 13 인라인 type = 값 import
    "const note = \"import x from 'nope'\"; // import y from 'nope2'", // 14 무시
    'const tpl = `import("nope3")`;', // 15 무시
    sub("const nested = `#{await import('./deep.ts')}`;"), // 16 템플릿 식 안의 dynamic
  ].join('\n');
  const got = extractImports(src);
  const by = (line) => got.filter((i) => i.line === line);
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((l) => by(l)[0]?.kind),
    [
      'static',
      'side-effect',
      'export-from',
      'export-from',
      'dynamic',
      'require',
      'glob',
      'nonliteral-import',
      'nonliteral-require',
      'create-require',
    ],
  );
  assert.equal(by(8)[0].spec, null);
  assert.equal(by(1)[0].spec, './a.ts');
  assert.equal(by(11)[0].typeOnly, true);
  assert.equal(by(12)[0].typeOnly, true);
  assert.equal(by(12)[0].kind, 'export-from');
  assert.equal(by(13)[0].typeOnly, false);
  assert.equal(by(1)[0].typeOnly, false);
  assert.equal(by(14).length, 0);
  assert.equal(by(15).length, 0);
  assert.equal(by(16)[0]?.spec, './deep.ts');
  assert.equal(
    got.every((i) => typeof i.typeOnly === 'boolean'),
    true,
  );
});

test('UT-GATE-011 walk는 기본 제외(tools/gates·spikes·docs·fixtures·selftest 보조 파일)를 지키고 root 없음은 engine/no-root다 [NFR-MAINT-001]', () => {
  const root = tmpdir();
  try {
    put(root, 'services/a/src/x.ts', '');
    put(root, 'services/a/src/y.md', '');
    put(root, 'services/a/test/fixtures/f.ts', '');
    put(root, 'services/a/node_modules/m/i.ts', '');
    put(root, 'tools/gates/lib/z.mjs', '');
    put(root, 'tools/si-docs/src/c.ts', '');
    put(root, 'spikes/sp/a.ts', '');
    put(root, 'docs/d.ts', '');
    put(root, 'packages/contracts/dist/o.ts', '');
    put(root, 'apps/web/src/selftest.args.json', '[]');
    put(root, 'apps/web/src/expect.json', '[]');
    put(root, 'apps/web/src/app.tsx', '');
    put(root, '.reports/INT-1a/r.ts', '');
    assert.deepEqual(walk(root, { exts: new Set(['.ts', '.tsx', '.mjs']) }), [
      'apps/web/src/app.tsx',
      'services/a/src/x.ts',
      'tools/si-docs/src/c.ts',
    ]);
    assert.deepEqual(walk(root, { include: ['services/**'], exclude: ['**/*.md'] }), ['services/a/src/x.ts']);
    assert.throws(
      () => walk(path.join(root, 'nope')),
      (e) => e.code === 'engine/no-root',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('UT-GATE-012 glob은 **·*·?·{a,b}(중첩 포함)를 지원한다 [NFR-MAINT-001]', () => {
  assert.deepEqual(expandBraces('a/{b,c}/d').sort(), ['a/b/d', 'a/c/d']);
  assert.deepEqual(expandBraces('x{a,b{1,2}}y').sort(), ['xay', 'xb1y', 'xb2y']);
  assert.equal(matchGlob('services/a/src/x.ts', 'services/*/src/**'), true);
  assert.equal(matchGlob('services/a/b/src/x.ts', 'services/*/src/**'), false, '* 는 / 를 넘지 않는다');
  assert.equal(matchGlob('a/test/x.ts', '**/test/**'), true);
  assert.equal(matchGlob('test/x.ts', '**/test/**'), true, '** 는 0개 디렉터리');
  assert.equal(matchGlob('src/x.ts', '**/test/**'), false);
  assert.equal(matchGlob('a/vitest.config.ts', '**/vitest.config.ts'), true);
  assert.equal(matchGlob('vitest.config.ts', '**/vitest.config.ts'), true);
  assert.equal(matchGlob('a/b.ts', 'a/?.ts'), true);
  assert.equal(matchGlob('a/bb.ts', 'a/?.ts'), false);
  assert.equal(matchGlob('src/a.tsx', 'src/*.{ts,tsx}'), true);
  assert.equal(matchGlob('src/a.js', 'src/*.{ts,tsx}'), false);
  assert.equal(matchGlob('a.b', 'a.b'), true);
  assert.equal(matchGlob('axb', 'a.b'), false, '점은 리터럴');
  assert.equal(matchAny('tests/x.spec.ts', ['nope/**', 'tests/**']), true);
});

test('UT-GATE-013 INT 순서·compareInt·intUpper(범위는 상한)를 계산한다 [NFR-MAINT-001]', () => {
  assert.deepEqual(INT_ORDER, ['INT-1a', 'INT-1b', 'INT-2', 'INT-3', 'INT-4', 'INT-5', 'INT-6', 'INT-7', 'PG-3']);
  assert.equal(isIntId('INT-1b'), true);
  assert.equal(isIntId('INT-8'), false);
  assert.equal(compareInt('INT-1a', 'INT-1b'), -1);
  assert.equal(compareInt('PG-3', 'INT-7'), 1);
  assert.equal(compareInt('INT-4', 'INT-4'), 0);
  assert.throws(() => compareInt('INT-9', 'INT-1a'), RangeError);
  assert.equal(intUpper('INT-2~3'), 'INT-3');
  assert.equal(intUpper('INT-1b'), 'INT-1b');
  assert.equal(intUpper('INT-1a~INT-1b'), 'INT-1b');
  assert.equal(intUpper('INT-2·INT-4'), 'INT-4');
  assert.equal(intUpper('v1 이월'), null);
  assert.equal(intUpper('—'), null);
  assert.equal(intUpper(undefined), null);
});

test('UT-GATE-014 readJsonc는 주석과 끝 쉼표를 허용하고 부재·파싱 실패는 engine/config다 [NFR-MAINT-001]', () => {
  const root = tmpdir();
  try {
    put(root, 'ok.json', '// 머리 주석\n{\n  /* 블록 */ "a": [1, 2,], // 끝 쉼표\n  "u": "http://x//y",\n}\n');
    assert.deepEqual(readJsonc(path.join(root, 'ok.json')), { a: [1, 2], u: 'http://x//y' });
    put(root, 'bad.json', '{ "a": }');
    assert.throws(
      () => readJsonc(path.join(root, 'bad.json')),
      (e) => e.code === 'engine/config',
    );
    assert.throws(
      () => readJsonc(path.join(root, 'absent.json')),
      (e) => e.code === 'engine/config',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function gitInit(root) {
  const run = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 't@example.com');
  run('config', 'user.name', 'T');
  run('config', 'commit.gpgsign', 'false');
  return run;
}

test('UT-GATE-015 git.changedFiles는 수정·추적 안 된 파일·rename 양쪽을 모으고 changedFrom이 우선이다 [NFR-MAINT-001]', () => {
  const root = tmpdir();
  try {
    const run = gitInit(root);
    put(root, 'keep.txt', 'k\n');
    put(root, 'edit.txt', 'e\n');
    put(root, 'old-name.txt', 'rename me, long enough content for similarity\n');
    run('add', '.');
    run('commit', '-q', '-m', 'init');
    put(root, 'edit.txt', 'e2\n');
    put(root, 'new/untracked.txt', 'u\n');
    run('mv', 'old-name.txt', 'new-name.txt');
    assert.deepEqual(changedFiles(root), ['edit.txt', 'new-name.txt', 'new/untracked.txt', 'old-name.txt']);
    // base 지정: <base>...HEAD 합집합
    run('add', '.');
    run('commit', '-q', '-m', 'second');
    assert.deepEqual(changedFiles(root), []);
    assert.deepEqual(changedFiles(root, { base: 'HEAD~1' }), [
      'edit.txt',
      'new-name.txt',
      'new/untracked.txt',
      'old-name.txt',
    ]);
    // changedFrom 우선: git을 부르지 않는다(저장소가 아닌 디렉터리에서도 동작)
    const plain = tmpdir();
    try {
      put(plain, 'list.txt', '# 주석\n\nb.ts\na.ts\nb.ts\n');
      assert.deepEqual(changedFiles(plain, { changedFrom: path.join(plain, 'list.txt') }), ['a.ts', 'b.ts']);
      assert.throws(
        () => changedFiles(plain),
        (e) => e.code === 'engine/git',
      );
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('UT-GATE-016 git.commitMessages는 base..HEAD 로그와 messageFile을 합치고 showAtBase는 없는 경로만 null, 잘못된 base는 engine/git이다 [NFR-MAINT-001]', () => {
  const root = tmpdir();
  try {
    const run = gitInit(root);
    put(root, 'a.txt', 'a\n');
    run('add', '.');
    run('commit', '-q', '-m', 'first\n\nRefs: A');
    put(root, 'b.txt', 'b\n');
    run('add', '.');
    run('commit', '-q', '-m', 'second\n\nTask: T-00-05');
    put(root, 'msg.txt', 'draft message\nCR: CR-57\n');
    assert.equal(commitMessages(root), '', 'base=HEAD → 로그 없음');
    const log = commitMessages(root, { base: 'HEAD~1' });
    assert.match(log, /second/);
    assert.match(log, /Task: T-00-05/);
    assert.doesNotMatch(log, /first/);
    const merged = commitMessages(root, { base: 'HEAD~1', messageFile: path.join(root, 'msg.txt') });
    assert.match(merged, /Task: T-00-05/);
    assert.match(merged, /CR: CR-57/);
    assert.equal(commitMessages(root, { messageFile: path.join(root, 'msg.txt') }), 'draft message\nCR: CR-57\n');
    // showAtBase: 기준에 있는 파일 = 내용, 그 기준에 없는 경로 = null, 알 수 없는 base·git 실패 = engine/git
    assert.equal(showAtBase(root, 'HEAD~1', 'a.txt'), 'a\n');
    assert.equal(showAtBase(root, 'HEAD~1', 'b.txt'), null, 'HEAD~1 에는 b.txt 가 없다');
    assert.equal(showAtBase(root, 'HEAD', 'no/such/file.txt'), null);
    for (const bad of ['no-such-ref', 'HEAD~99']) {
      assert.throws(
        () => showAtBase(root, bad, 'a.txt'),
        (e) => e.code === 'engine/git',
        `invalid base ${bad}`,
      );
    }
    assert.throws(
      () => showAtBase(root, '--output=x', 'a.txt'),
      (e) => e.code === 'engine/usage',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('UT-GATE-017 expect.loadExpectations는 EXPECT·EXPECT-NEXT와 expect.json을 합치고 compare가 fp·fn을 낸다 [NFR-MAINT-001]', () => {
  const root = tmpdir();
  try {
    put(
      root,
      'a/x.ts',
      'one(); // EXPECT[r/one]\n// EXPECT-NEXT[r/two]\ntwo();\nboth(); // EXPECT[r/a] EXPECT[r/b]\nnone();\n',
    );
    put(root, 'a/note.md', 'text EXPECT[md/rule]\n');
    put(root, 'a/data.json', 'EXPECT[ignored/json]');
    put(root, 'expect.json', JSON.stringify([{ file: 'a/data.json', line: 1, rule: 'json/rule' }]));
    const exp = loadExpectations(root);
    assert.deepEqual(
      [...exp].sort(),
      [
        'a/data.json:1:json/rule',
        'a/note.md:1:md/rule',
        'a/x.ts:1:r/one',
        'a/x.ts:3:r/two',
        'a/x.ts:4:r/a',
        'a/x.ts:4:r/b',
      ].sort(),
    );
    put(root, 'e/evade.ts', 'x(); // EVADES[boundary/cross-service-import] 이유\n');
    assert.deepEqual(loadEvasions(root), [{ file: 'e/evade.ts', line: 1, rule: 'boundary/cross-service-import' }]);
    const cmp = compare(new Set(['f:1:r', 'f:2:r']), [
      { file: 'f', line: 1, rule: 'r' },
      { file: 'f', line: 9, rule: 'r' },
    ]);
    assert.equal(cmp.tp, 1);
    assert.deepEqual(cmp.fp, ['f:9:r']);
    assert.deepEqual(cmp.fn, ['f:2:r']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('UT-GATE-018 report.formatJson·formatText는 §4.1.1 출력 형식 키와 요약 줄을 따른다 [NFR-MAINT-001]', () => {
  const v = [
    { file: 'a.ts', line: 3, rule: 'boundary/x', message: 'm', severity: 'error' },
    { file: 'b.ts', line: 1, rule: 'boundary/y', message: 'w', severity: 'warn' },
  ];
  const json = JSON.parse(
    formatJson('check:t', { root: '/r', exit: 1, files: 7, violations: v, extra: { engine: 'both' } }),
  );
  assert.deepEqual(Object.keys(json), ['check', 'root', 'exit', 'files', 'errors', 'warnings', 'violations', 'engine']);
  assert.equal(json.errors, 1);
  assert.equal(json.warnings, 1);
  assert.deepEqual(Object.keys(json.violations[0]), ['file', 'line', 'rule', 'message', 'severity']);
  const err = JSON.parse(formatJson('check:t', { root: '/r', exit: 2, error: 'engine/no-files: x' }));
  assert.deepEqual(err, { check: 'check:t', root: '/r', exit: 2, error: 'engine/no-files: x' });
  const text = formatText('check:t', { root: '/r', exit: 1, files: 7, violations: v }).split('\n');
  assert.equal(text[0], 'a.ts:3  error  boundary/x  m');
  assert.equal(text[2], '[check:t] 1 error(s), 1 warning(s), 7 file(s)');
  assert.equal(formatText('check:t', { root: '/r', exit: 1, files: 7, violations: v }, { quiet: true }), text[2]);
  assert.equal(
    formatText('check:t', { root: '/r', exit: 2, error: 'engine/usage: y' }),
    '[check:t] engine error: engine/usage: y',
  );
});

test('UT-GATE-019 registry는 동결 순서의 게이트 19종과 g1⊂g2⊂g3 누적 단계를 제공한다 [NFR-MAINT-001]', () => {
  assert.equal(GATES.length, 19);
  assert.equal(GATES[0].id, 'check:boundaries');
  assert.deepEqual(GATES[0].args, ['--engine=both']);
  assert.equal(GATES.at(-1).id, 'audit:graph');
  const ids = (s) => gatesForStage(s).map((g) => g.id);
  assert.equal(ids('g1').length, 5);
  assert.equal(ids('g2').length, 16);
  assert.equal(ids('g3').length, 18);
  assert.ok(ids('g1').every((id) => ids('g2').includes(id)));
  assert.ok(ids('g2').every((id) => ids('g3').includes(id)));
  assert.equal(ids('g3').includes('audit:graph'), false, 'audit 단계는 run-gates가 실행하지 않는다');
  assert.throws(() => gatesForStage('g9'), RangeError);
  assert.equal(new Set(GATES.map((g) => g.fixture)).size, GATES.length);
});
