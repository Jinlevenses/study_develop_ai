// UT-GATE-143~150 — check:typo-ko(DS-01 §12 K1·K2·K6·K7·K10·K11) 단위 테스트.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkCss, checkSource, checkTypography } from '../check-typo-ko.mjs';
import { compare, loadExpectations } from '../lib/expect.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATES_DIR = path.join(HERE, '..');
const GATE = path.join(GATES_DIR, 'check-typo-ko.mjs');
const FIX = path.join(GATES_DIR, 'fixtures', 'check-typo-ko');
const TSX = 'apps/web/src/features/x/X.tsx';
const CSS = 'apps/web/src/x.css';

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

const tsx = (text, rel = TSX) => checkSource(rel, text).map((v) => v.rule);
const css = (text, rel = CSS) => checkCss(rel, text).map((v) => v.rule);

function withRepo(files, fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fathom-gates-typo-'));
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

test('UT-GATE-143 check:typo-ko selftest가 통과하고 위반 fixture 7규칙이 기대 집합과 일치한다 [NFR-UX-009]', () => {
  const r = spawnSync(process.execPath, [path.join(GATES_DIR, 'check-gate-selftest.mjs'), '--only', 'check:typo-ko'], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const viol = run(path.join(FIX, 'violations'));
  assert.equal(viol.status, 1);
  const { fp, fn } = compare(loadExpectations(path.join(FIX, 'violations')), viol.json.violations);
  assert.deepEqual({ fp, fn }, { fp: [], fn: [] });
  const seen = new Set(viol.json.violations.map((v) => v.rule));
  for (const rule of [
    'typo-ko/keep-all',
    'typo-ko/no-italic',
    'typo-ko/tabular-nums',
    'typo-ko/px-literal',
    'typo-ko/body-min',
    'typo-ko/measure',
    'design/no-uppercase',
  ]) {
    assert.ok(seen.has(rule), rule);
  }
  assert.equal(run(path.join(FIX, 'clean')).status, 0);
});

test('UT-GATE-144 typo-ko/keep-all — typography.css의 body keep-all 전역 선언이 없거나 파일이 없으면 위반이다 [NFR-UX-009]', () => {
  const ok = '@layer base { body { word-break: keep-all; overflow-wrap: anywhere; } }';
  const typo = (text) =>
    withRepo(text === null ? {} : { 'packages/design-tokens/src/typography.css': text }, (dir) =>
      checkTypography(dir).map((v) => `${v.file}:${v.line}:${v.rule}`),
    );
  assert.deepEqual(typo(ok), []);
  assert.deepEqual(typo('html, body { word-break: keep-all; }'), [], '선택자 목록에 body 포함');
  assert.deepEqual(typo('body { font-size: 15px; }'), ['packages/design-tokens/src/typography.css:1:typo-ko/keep-all']);
  assert.deepEqual(typo('.x { word-break: keep-all; }'), [
    'packages/design-tokens/src/typography.css:1:typo-ko/keep-all',
  ]);
  assert.deepEqual(
    typo('/* body { word-break: keep-all; } */'),
    ['packages/design-tokens/src/typography.css:1:typo-ko/keep-all'],
    '주석 속 선언은 무효',
  );
  assert.deepEqual(typo(null), ['(repo):0:typo-ko/keep-all'], 'typography.css 부재 = 위반');
  withRepo({ 'apps/web/src/a.css': '.a { color: red; }' }, (dir) => {
    const res = run(dir);
    assert.equal(res.status, 1);
    assert.deepEqual(
      res.json.violations.map((v) => `${v.file}:${v.rule}`),
      ['(repo):typo-ko/keep-all'],
    );
  });
});

test('UT-GATE-145 keep-all 예외 — .break-code 블록의 word-break: normal은 통과하고 그 밖의 break-all·normal·클래스 break-all은 위반이다 [NFR-UX-009]', () => {
  assert.deepEqual(css('.break-code { word-break: normal; }'), []);
  assert.deepEqual(css('.break-code, pre, code { word-break: normal; overflow-wrap: anywhere; }'), []);
  assert.deepEqual(css('.a { word-break: normal; }'), ['typo-ko/keep-all']);
  assert.deepEqual(css('.a { word-break: break-all; }'), ['typo-ko/keep-all']);
  assert.deepEqual(css('.a { word-break: keep-all; }'), []);
  assert.deepEqual(
    css('@media (min-width: 40rem) { .a { word-break: break-all; } }'),
    ['typo-ko/keep-all'],
    '중첩 @media 안의 블록도 검사',
  );
  assert.deepEqual(tsx('export const A = <p className="break-all">x</p>;'), ['typo-ko/keep-all']);
  assert.deepEqual(tsx('export const A = <p className="break-normal">x</p>;'), ['typo-ko/keep-all']);
  assert.deepEqual(tsx('export const A = <p className="break-code">x</p>;'), []);
});

test('UT-GATE-146 typo-ko/no-italic — font-style: italic·클래스 italic·<i> 태그는 위반이고 <em>·font-style: normal·제네릭·비교식은 통과한다 [NFR-UX-009]', () => {
  assert.deepEqual(css('.a { font-style: italic; }'), ['typo-ko/no-italic']);
  assert.deepEqual(css('em { font-style: normal; }'), []);
  assert.deepEqual(tsx('export const A = <span className="text-sm italic">x</span>;'), ['typo-ko/no-italic']);
  assert.deepEqual(tsx('export const A = <i>x</i>;'), ['typo-ko/no-italic']);
  assert.deepEqual(tsx('export const A = <i className="icon">x</i>;'), ['typo-ko/no-italic']);
  assert.deepEqual(tsx('export const A = <em>x</em>;'), []);
  assert.deepEqual(
    tsx('export const A = <img src="x" />; type P<i> = Array<i>; const c = (n: number, i: number) => n <i;'),
    [],
  );
  assert.deepEqual(tsx('export const A = <div className="italics-free">x</div>;'), []);
});

test('UT-GATE-147 typo-ko/tabular-nums — data-numeric 요소의 className에 num이 없으면 위반이고 있으면 통과한다 [NFR-UX-009]', () => {
  assert.deepEqual(tsx('export const A = <td data-numeric>1</td>;'), ['typo-ko/tabular-nums']);
  assert.deepEqual(tsx('export const A = <td data-numeric className="text-right">1</td>;'), ['typo-ko/tabular-nums']);
  assert.deepEqual(tsx('export const A = <td data-numeric className="num text-right">1</td>;'), []);
  assert.deepEqual(tsx("export const A = <td data-numeric className={cn('a', 'num')}>1</td>;"), []);
  assert.deepEqual(tsx('export const A = <td className="text-right">1</td>;'), [], 'data-numeric 이 없으면 대상 아님');
  assert.deepEqual(
    tsx('export const A = <Cell data-numeric className="numeric">1</Cell>;'),
    ['typo-ko/tabular-nums'],
    '`numeric`은 `num`이 아니다',
  );
});

test('UT-GATE-148 typo-ko/px-literal — design-tokens 밖의 px 값은 위반이고 0px·1px(헤어라인)·토큰 변수·design-tokens 안은 통과한다 [NFR-UX-009]', () => {
  assert.deepEqual(css('.a { margin: 12px; }'), ['typo-ko/px-literal']);
  assert.deepEqual(
    css('.a { margin: 0.5px 3.5px; }'),
    ['typo-ko/px-literal', 'typo-ko/px-literal'],
    '값마다 1건(같은 줄이면 runGate가 병합)',
  );
  assert.deepEqual(css('.a { border-width: 1px; margin: 0px; }'), []);
  assert.deepEqual(css('.a { margin: var(--space-3); }'), []);
  assert.deepEqual(css('.a { margin: 12px; }', 'packages/design-tokens/src/t.css'), []);
  assert.deepEqual(tsx('export const A = <div className="w-[13px] h-[2.5px]">x</div>;'), [
    'typo-ko/px-literal',
    'typo-ko/px-literal',
  ]);
  assert.deepEqual(tsx('export const A = <div className="w-[var(--w)]">x</div>;'), []);
  assert.deepEqual(tsx('export const A = <div className="w-[13px]">x</div>;', 'packages/design-tokens/src/t.tsx'), []);
});

test('UT-GATE-149 typo-ko/body-min — <p>의 text-2xs·xs·sm와 11px 미만 font-size는 위반이고 span·base·11px 이상은 통과한다 [NFR-UX-009]', () => {
  assert.deepEqual(tsx('export const A = <p className="text-xs">x</p>;'), ['typo-ko/body-min']);
  assert.deepEqual(tsx('export const A = <p className="mt-2 text-sm">x</p>;'), ['typo-ko/body-min']);
  assert.deepEqual(tsx("export const A = <p className={cn('a', 'text-2xs')}>x</p>;"), ['typo-ko/body-min']);
  assert.deepEqual(tsx('export const A = <p className="text-base">x</p>;'), []);
  assert.deepEqual(tsx('export const A = <span className="text-xs">x</span>;'), []);
  assert.deepEqual(css('.a { font-size: 10px; }').sort(), ['typo-ko/body-min', 'typo-ko/px-literal']);
  assert.deepEqual(css('.a { font-size: 11px; }'), ['typo-ko/px-literal']);
  assert.deepEqual(css('.a { font-size: 10px; }', 'packages/design-tokens/src/t.css'), ['typo-ko/body-min']);
  assert.deepEqual(css('.a { font-size: var(--caption-size); }'), []);
});

test('UT-GATE-150 typo-ko/measure·design/no-uppercase — react-markdown은 lib/markdown.tsx에서만, uppercase는 CSS·클래스 모두 위반이다(biome-ignore 사유 필수) [NFR-UX-009]', () => {
  const imp = "import ReactMarkdown from 'react-markdown';\nexport const M = ReactMarkdown;\n";
  assert.deepEqual(tsx(imp, 'apps/web/src/lib/markdown.tsx'), []);
  assert.deepEqual(tsx(imp, 'apps/web/src/features/x/Md.tsx'), ['typo-ko/measure']);
  assert.deepEqual(tsx("const M = await import('react-markdown');", 'packages/ui/src/m.tsx'), ['typo-ko/measure']);
  assert.deepEqual(css('.a { text-transform: uppercase; }'), ['design/no-uppercase']);
  assert.deepEqual(css('.a { text-transform: none; }'), []);
  assert.deepEqual(tsx('export const A = <span className="uppercase tracking-wide">x</span>;'), [
    'design/no-uppercase',
  ]);
  // 탈출구: 사유 필수
  assert.deepEqual(tsx('// biome-ignore lint/plugin: 아이콘 폰트 글리프\nexport const A = <i>x</i>;'), []);
  assert.deepEqual(tsx('// biome-ignore lint/plugin:\nexport const A = <i>x</i>;'), ['typo-ko/no-italic']);
  assert.deepEqual(css('/* biome-ignore lint/plugin: 레거시 임베드 */\n.a { font-style: italic; }'), []);
  assert.deepEqual(css('/* biome-ignore lint/plugin: */\n.a { font-style: italic; }'), ['typo-ko/no-italic']);
  withRepo({ 'packages/design-tokens/src/typography.css': 'body { word-break: keep-all; }' }, (dir) => {
    const ok = run(dir);
    assert.equal(ok.status, 0);
    assert.equal(ok.json.files, 1);
  });
});
