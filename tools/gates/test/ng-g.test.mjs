// UT-GATE-130~142 — check:ng-g(NG-G1~G7 + design/raw-color, config/ng-g.json) 단위 테스트.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkCss, checkPackageJson, checkPolicy, checkSource, loadNgConfig } from '../check-ng-g.mjs';
import { compare, loadExpectations } from '../lib/expect.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATES_DIR = path.join(HERE, '..');
const GATE = path.join(GATES_DIR, 'check-ng-g.mjs');
const FIX = path.join(GATES_DIR, 'fixtures', 'check-ng-g');
const CONFIG = path.join(GATES_DIR, 'config', 'ng-g.json');
const cfg = loadNgConfig();
const POLICY = 'packages/contracts/src/ai/ai-gateway-policy.ts';

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

const src = (rel, text) => checkSource(rel, text, cfg).map((v) => v.rule);

function withRepo(files, fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fathom-gates-ngg-'));
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

test('UT-GATE-130 check:ng-g selftest가 통과하고 SP-7 위반 fixture를 새 규칙 ID로 바꾼 기대 집합과 일치한다 [FR-UX-008][NFR-UX-008][CR-23]', () => {
  const r = spawnSync(process.execPath, [path.join(GATES_DIR, 'check-gate-selftest.mjs'), '--only', 'check:ng-g'], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const viol = run(path.join(FIX, 'violations'));
  assert.equal(viol.status, 1);
  const { fp, fn } = compare(loadExpectations(path.join(FIX, 'violations')), viol.json.violations);
  assert.deepEqual({ fp, fn }, { fp: [], fn: [] });
  const seen = new Set(viol.json.violations.map((v) => v.rule));
  for (const rule of [
    'ng-g1/reward-vocab',
    'ng-g2/social-vocab',
    'ng-g2/network-share',
    'ng-g3/pre-submit-fields',
    'ng-g3/web-renderer-reveal',
    'ng-g4/hard-lock',
    'ng-g4/prereq-redirect',
    'ng-g5/push-api',
    'ng-g5/loss-copy',
    'ng-g5/due-danger',
    'ng-g6/video',
    'ng-g7/blank-note-ai',
    'ng-g7/policy-missing-deny',
    'design/raw-color',
  ]) {
    assert.ok(seen.has(rule), `fixture must exercise ${rule}`);
  }
  assert.equal(run(path.join(FIX, 'clean')).status, 0);
});

test('UT-GATE-131 규칙 ID 대응표 3건: presubmit-field·presubmit-spread→pre-submit-fields, danger-due→due-danger, presubmit-ai-call→blank-note-ai [FR-UX-008][CR-23]', () => {
  const field = src('packages/contracts/src/pre-submit/x.ts', 'export const A = z.object({ answer_key: z.string() });');
  assert.deepEqual(field, ['ng-g3/pre-submit-fields']);
  const spread = src(
    'packages/contracts/src/x.ts',
    'export const QPreSubmitView = z.object({ ...ItemResultPostSubmit.shape, extra: z.string() });',
  );
  assert.deepEqual(spread, ['ng-g3/pre-submit-fields']);
  assert.deepEqual(src('apps/web/src/x.tsx', 'export const C = "overdue-badge bg-destructive text-white";'), [
    'ng-g5/due-danger',
  ]);
  assert.deepEqual(src('services/a/src/blank-note/draft.ts', 'export function autoWriteNote() { return 1; }'), [
    'ng-g7/blank-note-ai',
  ]);
  assert.deepEqual(
    src('services/a/src/blank-note/draft.ts', "import { generate } from '@fathom/shared-kernel/ai-gateway-client.ts';"),
    ['ng-g7/blank-note-ai'],
  );
  // 옛 SP-7 이름은 더 이상 나오지 않는다
  const all = [
    ...field,
    ...spread,
    ...src('apps/web/src/x.tsx', 'export const C = "overdue-badge bg-destructive text-white";'),
    ...src('services/a/src/blank-note/draft.ts', 'export function autoWriteNote() { return 1; }'),
  ];
  for (const old of [
    'ng-g3/presubmit-field',
    'ng-g3/presubmit-spread',
    'ng-g5/danger-due',
    'ng-g7/presubmit-ai-call',
  ]) {
    assert.ok(!all.includes(old), old);
  }
  // post-submit 경로는 AI 호출 허용
  assert.deepEqual(
    src(
      'services/a/src/blank-note/post-submit/f.ts',
      "import { generate } from '@fathom/shared-kernel/ai-gateway-client.ts'; generate({});",
    ),
    [],
  );
});

test('UT-GATE-132 ng-g3/web-renderer-reveal — renderers 안의 pre-submit 코드가 post-submit 계약을 import하면 위반이고 post-submit/ 안은 통과한다 [FR-UX-008][CR-60]', () => {
  const imp =
    "import type { R } from '@fathom/contracts/http/practice/v1/post-submit/attempt-result';\nexport const x = 1;\n";
  assert.deepEqual(src('apps/web/src/features/practice/renderers/mcq/Mcq.tsx', imp), ['ng-g3/web-renderer-reveal']);
  assert.deepEqual(src('apps/web/src/features/practice/renderers/mcq/post-submit/Reveal.tsx', imp), []);
  assert.deepEqual(src('apps/web/src/features/practice/other/Mcq.tsx', imp), [], 'renderers 밖은 범위 밖');
  assert.deepEqual(
    src(
      'apps/web/src/features/practice/renderers/mcq/Mcq.tsx',
      "import type { V } from '@fathom/contracts/http/practice/v1/pre-submit/item-view';",
    ),
    [],
  );
  const dyn = "const m = await import('@fathom/contracts/http/learning/v1/post-submit/result');\n";
  assert.deepEqual(src('apps/web/src/features/learn/renderers/Lesson.tsx', dyn), ['ng-g3/web-renderer-reveal']);
  const v = checkSource('apps/web/src/features/practice/renderers/mcq/Mcq.tsx', `\n\n${imp}`, cfg);
  assert.equal(v[0].line, 3);
});

test('UT-GATE-133 G7 정책 파일은 고정 경로 한 곳만 양성 단언이고 다른 위치의 같은 이름 파일은 인정하지 않는다 [FR-UX-008][NFR-UX-008]', () => {
  const good = 'export const P = { deny_before_submit: ["blank_note.generate"] } as const;\n';
  withRepo({ [POLICY]: good }, (dir) => assert.deepEqual(checkPolicy(dir, cfg), []));
  withRepo(
    { 'packages/contracts/src/ai-gateway-policy.ts': good, 'services/a/src/ai-gateway-policy.ts': good },
    (dir) => {
      const v = checkPolicy(dir, cfg);
      assert.deepEqual(
        v.map((x) => `${x.file}:${x.line}:${x.rule}`),
        ['(repo):0:ng-g7/policy-file-missing'],
      );
    },
  );
  withRepo({ 'services/a/src/x.ts': 'export const x = 1;\n' }, (dir) => {
    const res = run(dir);
    assert.equal(res.status, 1);
    assert.deepEqual(
      res.json.violations.map((v) => v.rule),
      ['ng-g7/policy-file-missing'],
    );
  });
});

test('UT-GATE-134 deny_before_submit에 blank_note.* 가 없거나 키·배열이 없으면 ng-g7/policy-missing-deny 위반이다 [FR-UX-008][NFR-UX-008]', () => {
  const rules = (text) =>
    withRepo({ [POLICY]: text }, (dir) => checkPolicy(dir, cfg).map((v) => `${v.line}:${v.rule}`));
  assert.deepEqual(rules('export const P = {\n  deny_before_submit: ["quiz.generate"],\n};\n'), [
    '2:ng-g7/policy-missing-deny',
  ]);
  assert.deepEqual(rules('export const P = { deny_before_submit: [] };\n'), ['1:ng-g7/policy-missing-deny']);
  assert.deepEqual(rules('export const P = { allow_after_submit: ["blank_note.feedback"] };\n'), [
    '1:ng-g7/policy-missing-deny',
  ]);
  assert.deepEqual(rules('export const P = { deny_before_submit: DENY };\n'), ['1:ng-g7/policy-missing-deny']);
  assert.deepEqual(rules('export const P = { deny_before_submit: ["quiz.generate", "blank_note.complete"] };\n'), []);
});

test('UT-GATE-135 ng-g5/push-api는 features/settings/notify/ 안에서만 허용한다 [FR-UX-008][NFR-UX-008]', () => {
  const api = 'export const ask = () => Notification.requestPermission();';
  assert.deepEqual(src('apps/web/src/features/settings/notify/permission.ts', api), []);
  assert.deepEqual(src('apps/web/src/features/home/push.ts', api), ['ng-g5/push-api']);
  assert.deepEqual(src('apps/web/src/features/home/n.ts', "new Notification('x');"), ['ng-g5/push-api']);
  assert.deepEqual(src('apps/web/src/features/home/p.ts', 'reg.pushManager.subscribe();'), ['ng-g5/push-api']);
  assert.deepEqual(src('apps/web/src/features/home/i.ts', "import w from 'web-push';"), ['ng-g5/push-api']);
  assert.deepEqual(src('apps/web/src/features/settings/notify/i.ts', "import w from 'web-push';"), []);
});

test('UT-GATE-136 설정 가산 어휘(보석·레벨업!·업적 달성·상위 10%·친구·밀린·놓쳤·<iframe·<video·youtube)를 잡는다 [FR-UX-008][NFR-UX-008][CR-23]', () => {
  const copy = (line) => src('apps/web/src/Copy.tsx', `export const T = ${JSON.stringify(line)};`);
  assert.deepEqual(copy('보석 5개 획득'), ['ng-g1/reward-vocab']);
  assert.deepEqual(copy('레벨업! 축하'), ['ng-g1/reward-vocab']);
  assert.deepEqual(copy('업적 달성 완료'), ['ng-g1/reward-vocab']);
  assert.deepEqual(copy('streak bonus 지급'), ['ng-g1/reward-vocab']);
  assert.deepEqual(copy('상위 10% 학습자'), ['ng-g2/social-vocab']);
  assert.deepEqual(copy('상위  3 % 에 진입'), ['ng-g2/social-vocab']);
  assert.deepEqual(copy('친구와 함께'), ['ng-g2/social-vocab']);
  assert.deepEqual(copy('밀린 복습'), ['ng-g5/loss-copy']);
  assert.deepEqual(copy('복습을 놓쳤어요'), ['ng-g5/loss-copy']);
  assert.deepEqual(src('apps/web/src/V.tsx', 'export const E = <iframe src="/x" title="x" />;'), ['ng-g6/video']);
  assert.deepEqual(src('apps/web/src/V.tsx', 'export const E = <video src="/x" controls />;'), ['ng-g6/video']);
  assert.deepEqual(copy('https://www.youtube.com/watch?v=x'), ['ng-g6/video']);
  assert.deepEqual(copy('https://player.vimeo.com/video/1'), ['ng-g6/video']);
});

test('UT-GATE-137 "실패했습니다" 같은 시스템 오류 문구는 손실 카피가 아니다(오탐 제외) [FR-UX-008][NFR-UX-008]', () => {
  assert.deepEqual(src('apps/web/src/Copy.tsx', "export const E = '저장에 실패했습니다. 다시 시도해 주세요.';"), []);
  assert.deepEqual(src('apps/web/src/Copy.tsx', "export const E = '요청을 처리하지 못했습니다';"), []);
  assert.ok(!cfg.loss_copy.test('실패했습니다'));
});

test('UT-GATE-138 design/raw-color — packages/design-tokens/** 안은 통과하고 밖의 hex·rgb()·oklch()는 위반이다(앵커 id #face·var()는 통과) [NFR-UX-008]', () => {
  const css = ':root { --color-fg: #1a1a1a; --color-bg: oklch(0.2 0.01 250); }';
  assert.deepEqual(
    checkCss('packages/design-tokens/src/tokens.css', css, cfg).map((v) => v.rule),
    [],
  );
  assert.deepEqual(
    checkCss('apps/web/src/a.css', '.a { color: #1a1a1a; }', cfg).map((v) => v.rule),
    ['design/raw-color'],
  );
  assert.deepEqual(
    checkCss('apps/web/src/a.css', '.a { color: #abc; background: rgb(1, 2, 3); }', cfg).map((v) => v.rule),
    ['design/raw-color', 'design/raw-color'],
  );
  assert.deepEqual(
    checkCss('apps/web/src/a.css', '.a { color: var(--color-fg); }', cfg).map((v) => v.rule),
    [],
  );
  assert.deepEqual(src('packages/design-tokens/src/t.ts', "export const C = { color: '#ff0000' };"), []);
  assert.deepEqual(src('apps/web/src/t.ts', "export const C = { color: '#ff0000' };"), ['design/raw-color']);
  assert.deepEqual(src('apps/web/src/t.ts', "export const C = { color: '#abc', href: '#face' };"), [
    'design/raw-color',
  ]);
  assert.deepEqual(src('apps/web/src/t.ts', "export const HREF = '#face';"), []);
});

test('UT-GATE-139 NG-G1·G2·G4·G5·G6 기존 규칙(식별자 어휘·navigator.share·routing 잠금·연체 위험색·contracts video) 양성·음성 [FR-UX-008][NFR-UX-008][CR-23]', () => {
  assert.deepEqual(src('apps/web/src/x.ts', 'export const xp = 1; function launchConfetti() {}'), [
    'ng-g1/reward-vocab',
    'ng-g1/reward-vocab',
  ]);
  assert.deepEqual(src('apps/web/src/x.ts', 'export const experience = 1; const taxpayer = 2;'), []);
  assert.deepEqual(src('apps/web/src/x.ts', 'export const leaderboard = [];'), ['ng-g2/social-vocab']);
  assert.deepEqual(src('apps/web/src/x.ts', "navigator.share({ title: 'x' });"), ['ng-g2/network-share']);
  assert.deepEqual(src('services/a/src/routing/r.ts', 'export const isLocked = (c) => c.locked;'), [
    'ng-g4/hard-lock',
    'ng-g4/hard-lock',
  ]);
  assert.deepEqual(src('services/a/src/routing/r.ts', 'export const soft = (c) => c.warn;'), []);
  assert.deepEqual(src('services/a/src/routing/r.ts', 'if (prereqMissing) redirect("/roadmap");'), [
    'ng-g4/prereq-redirect',
  ]);
  assert.deepEqual(src('services/a/src/other/r.ts', 'export const isLocked = (c) => c.locked;'), [], '라우팅 경로 밖');
  assert.deepEqual(src('apps/web/src/x.tsx', 'const c = <p className="due-count text-muted">x</p>;'), []);
  assert.deepEqual(src('apps/web/src/x.tsx', 'const c = <p className="due-count text-red-500">x</p>;'), [
    'ng-g5/due-danger',
  ]);
  assert.deepEqual(src('packages/contracts/src/c.ts', 'export const K = z.enum(["text", "video"]);'), ['ng-g6/video']);
  assert.deepEqual(
    checkCss('apps/web/src/a.css', '.overdue { color: var(--color-danger); }', cfg).map((v) => v.rule),
    ['ng-g5/due-danger'],
  );
  assert.deepEqual(
    checkCss('apps/web/src/a.css', '.coin-spin { opacity: 1; }', cfg).map((v) => v.rule),
    ['ng-g1/reward-vocab'],
  );
});

test('UT-GATE-140 package.json 의존 어휘(canvas-confetti·web-push·react-player·react-share)는 규칙별로 잡는다 [FR-UX-008][NFR-UX-008]', () => {
  const text = JSON.stringify(
    { dependencies: { 'canvas-confetti': '1', 'web-push': '1', 'react-player': '1', 'react-share': '1', react: '19' } },
    null,
    2,
  );
  const v = checkPackageJson('apps/web/package.json', text, cfg);
  assert.deepEqual(v.map((x) => x.rule).sort(), [
    'ng-g1/reward-vocab',
    'ng-g2/social-vocab',
    'ng-g5/push-api',
    'ng-g6/video',
  ]);
  assert.deepEqual(checkPackageJson('apps/web/package.json', '{ "dependencies": { "react": "19" } }', cfg), []);
  assert.deepEqual(checkPackageJson('apps/web/package.json', '{ not json', cfg), []);
});

test('UT-GATE-141 config/ng-g.json 부재·version 오류·잘못된 정규식·필수 키 누락은 exit 2(engine/config)다 [FR-UX-008][NFR-UX-008]', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fathom-gates-nggcfg-'));
  try {
    const good = JSON.parse(readFileSync(CONFIG, 'utf8'));
    const write = (name, obj) => {
      writeFileSync(path.join(dir, name), typeof obj === 'string' ? obj : JSON.stringify(obj));
      return path.join(dir, name);
    };
    const bads = [
      write('v2.json', { ...good, version: 2 }),
      write('broken.json', '{ nope'),
      write('badre.json', { ...good, reward_words: { source: '(' } }),
      write('nokey.json', (({ policy: _p, ...rest }) => rest)(good)),
      write('noregex.json', { ...good, loss_copy: 'plain string' }),
      path.join(dir, 'absent.json'),
    ];
    for (const b of bads) {
      const res = run(path.join(FIX, 'clean'), '--config', b);
      assert.equal(res.status, 2, b);
      assert.match(res.json.error, /^engine\/config: /);
    }
    assert.equal(run(path.join(FIX, 'clean'), '--config', write('same.json', good)).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('UT-GATE-142 설정은 정규식을 {source, flags} 객체로 두고 코드에는 어휘가 하드코딩되어 있지 않다 [FR-UX-008][CR-23]', () => {
  const json = JSON.parse(readFileSync(CONFIG, 'utf8'));
  assert.equal(json.version, 1);
  for (const k of [
    'reward_words',
    'social_words',
    'lock_words',
    'loss_copy',
    'reward_copy',
    'social_copy',
    'video_tag',
    'color_fn',
  ]) {
    assert.equal(typeof json[k].source, 'string', k);
  }
  assert.ok(Array.isArray(json.banned_pre_submit_keys));
  assert.equal(json.policy.file, POLICY);
  assert.deepEqual(json.push_allow_paths, ['apps/web/src/features/settings/notify/**']);
  const code = readFileSync(path.join(GATES_DIR, 'check-ng-g.mjs'), 'utf8');
  const codeLines = code.split('\n').filter((l) => !l.trim().startsWith('//'));
  for (const word of ['confetti', 'leaderboard', '리더보드', '연체', 'answer_key', 'deny_before_submit']) {
    assert.ok(!codeLines.some((l) => l.includes(word)), `${word} appears in code (only comments allowed)`);
  }
});
