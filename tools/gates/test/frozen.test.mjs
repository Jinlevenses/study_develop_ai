// UT-GATE-160~171 — check:frozen(frozen.lock sha256·pending·스냅샷 diff 분류) 단위 테스트.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { diffSchema } from '../check-frozen.mjs';
import { compare, loadExpectations } from '../lib/expect.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATES_DIR = path.join(HERE, '..');
const GATE = path.join(GATES_DIR, 'check-frozen.mjs');
const FIX = path.join(GATES_DIR, 'fixtures', 'check-frozen');
const SNAP = 'packages/contracts/.snapshots/events/x.v1.json';
const sha = (s) => createHash('sha256').update(s).digest('hex');

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

/**
 * 임시 저장소를 만들고 fn(dir, args)를 실행한다.
 * opts: files {rel: text}, lockFiles(자동 계산: files 중 frozen 목록), pending, excluded, changed[], message, base {rel: text}, lockExtra
 */
function scenario(opts, fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fathom-gates-frozen-'));
  const put = (rel, text) => {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  };
  try {
    for (const [rel, text] of Object.entries(opts.files ?? {})) {
      put(rel, text);
    }
    for (const [rel, text] of Object.entries(opts.base ?? {})) {
      put(`base/${rel}`, text);
    }
    const lock = {
      format: 'fathom-frozen-lock/1',
      rules: { change_requires_trailer: ['CR: CR-<nn>', 'ADR: ADR-<nnn>'] },
      files: (opts.frozen ?? []).map(([rel, original]) => ({
        path: rel,
        sha256: sha(original),
        bytes: Buffer.byteLength(original),
      })),
      pending: opts.pending ?? [],
      excluded: (opts.excluded ?? []).map((p) => ({ path: p })),
      ...(opts.lockExtra ?? {}),
    };
    put('frozen.lock', typeof opts.lockText === 'string' ? opts.lockText : JSON.stringify(lock));
    put('changed.txt', `${(opts.changed ?? []).join('\n')}\n`);
    put('msg.txt', opts.message ?? 'feat: x\n\nRefs: T-00-06\n');
    const args = [
      '--lock',
      path.join(dir, 'frozen.lock'),
      '--changed-from',
      path.join(dir, 'changed.txt'),
      '--message-file',
      path.join(dir, 'msg.txt'),
      '--base-dir',
      path.join(dir, 'base'),
      ...(opts.task ? ['--task', opts.task] : []),
    ];
    return fn(dir, args);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const keys = (res) => res.json.violations.map((v) => `${v.file}|${v.rule}|${v.severity}`);
const A0 = '# A\n원본\n';

test('UT-GATE-160 check:frozen selftest(--base-dir·--changed-from·--message-file)가 통과한다 [NFR-MAINT-006]', () => {
  const r = spawnSync(process.execPath, [path.join(GATES_DIR, 'check-gate-selftest.mjs'), '--only', 'check:frozen'], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const violDir = path.join(FIX, 'violations');
  const caseArgs = JSON.parse(readFileSync(path.join(violDir, 'selftest.args.json'), 'utf8')).map((a) =>
    a.split(`\${CASE}`).join(violDir),
  );
  const viol = run(violDir, ...caseArgs);
  assert.equal(viol.status, 1);
  const { fp, fn } = compare(loadExpectations(path.join(FIX, 'violations')), viol.json.violations);
  assert.deepEqual({ fp, fn }, { fp: [], fn: [] });
});

test('UT-GATE-161 sha256이 일치하면 통과하고 files는 lock의 files[] 개수이며 파일이 없으면 frozen/missing이다 [NFR-MAINT-006]', () => {
  scenario({ files: { 'docs/a.md': A0 }, frozen: [['docs/a.md', A0]] }, (dir, args) => {
    const res = run(dir, ...args);
    assert.equal(res.status, 0);
    assert.equal(res.json.files, 1);
  });
  scenario({ files: {}, frozen: [['docs/a.md', A0]] }, (dir, args) => {
    const res = run(dir, ...args);
    assert.equal(res.status, 1);
    assert.deepEqual(keys(res), ['docs/a.md|frozen/missing|error']);
  });
});

test('UT-GATE-162 sha256 불일치 + 트레일러 없음은 위반, `CR: CR-69`·`ADR: ADR-017`이 있으면 warn(changed-with-trailer)이다 [NFR-MAINT-006]', () => {
  const files = { 'docs/a.md': '# A\n수정됨\n' };
  scenario({ files, frozen: [['docs/a.md', A0]] }, (dir, args) => {
    const res = run(dir, ...args);
    assert.equal(res.status, 1);
    assert.deepEqual(keys(res), ['docs/a.md|frozen/changed-without-trailer|error']);
  });
  for (const msg of ['fix: y\n\nCR: CR-69\n', 'fix: y\n\nADR: ADR-017\nRefs: x\n', 'fix: y\n\nCR:   CR-123  \n']) {
    scenario({ files, frozen: [['docs/a.md', A0]], message: msg }, (dir, args) => {
      const res = run(dir, ...args);
      assert.equal(res.status, 0, msg);
      assert.deepEqual(keys(res), ['docs/a.md|frozen/changed-with-trailer|warn']);
    });
  }
  // 트레일러 형식이 어긋나면 무효(대소문자 구분·번호 자릿수·줄 단위)
  for (const msg of ['cr: CR-69\n', 'CR: 69\n', 'CR: CR-6\n', 'ADR: ADR-17\n', 'see CR: CR-69 for details\n']) {
    scenario({ files, frozen: [['docs/a.md', A0]], message: msg }, (dir, args) => {
      assert.equal(run(dir, ...args).status, 1, msg);
    });
  }
});

test('UT-GATE-163 pending — 소유 Task("T-00-12, T-00-13" 파싱)는 통과, 비소유 --task는 위반, --task 없음은 warn이다 [NFR-MAINT-006]', () => {
  const pending = [{ glob: 'docs/pending/**', owner_task: 'T-00-12, T-00-13', freeze_at: 'INT-1a' }];
  const base = {
    files: { 'docs/a.md': A0, 'docs/pending/x.md': 'x' },
    frozen: [['docs/a.md', A0]],
    pending,
    changed: ['docs/pending/x.md'],
  };
  scenario({ ...base, task: 'T-00-12' }, (dir, args) => assert.equal(run(dir, ...args).status, 0));
  scenario({ ...base, task: 'T-00-13' }, (dir, args) => assert.equal(run(dir, ...args).status, 0));
  scenario({ ...base, task: 'T-00-12-r1' }, (dir, args) => assert.equal(run(dir, ...args).status, 0));
  scenario({ ...base, task: 'T-00-14' }, (dir, args) => {
    const res = run(dir, ...args);
    assert.equal(res.status, 1);
    assert.deepEqual(keys(res), ['docs/pending/x.md|frozen/pending-not-owner|error']);
  });
  scenario(base, (dir, args) => {
    const res = run(dir, ...args);
    assert.equal(res.status, 0);
    assert.deepEqual(keys(res), ['docs/pending/x.md|frozen/pending-changed|warn']);
  });
  scenario({ ...base, task: 'T-00-14', message: 'feat: z\n\nCR: CR-70\n' }, (dir, args) =>
    assert.equal(run(dir, ...args).status, 0),
  );
  scenario({ ...base, changed: ['docs/other/y.md'], task: 'T-00-14' }, (dir, args) =>
    assert.equal(run(dir, ...args).status, 0),
  );
});

test('UT-GATE-164 --task가 있고 lock 파일 자체가 변경되면 frozen/lock-edit이며 --task가 없으면(T1) 무진단이다 [NFR-MAINT-006]', () => {
  const base = { files: { 'docs/a.md': A0 }, frozen: [['docs/a.md', A0]], changed: ['frozen.lock'] };
  scenario({ ...base, task: 'T-00-06' }, (dir, args) => {
    const res = run(dir, ...args);
    assert.equal(res.status, 1);
    assert.deepEqual(keys(res), ['frozen.lock|frozen/lock-edit|error']);
  });
  scenario(base, (dir, args) => assert.equal(run(dir, ...args).status, 0));
});

test('UT-GATE-165 excluded[] 경로는 모든 규칙에서 무시한다(files·pending·변경 목록) [NFR-MAINT-006]', () => {
  scenario(
    {
      files: { 'docs/a.md': '# A\n수정됨\n', 'docs/pending/x.md': 'x' },
      frozen: [['docs/a.md', A0]],
      excluded: ['docs/a.md', 'docs/pending/x.md'],
      pending: [{ glob: 'docs/pending/**', owner_task: 'T-00-12', freeze_at: 'INT-1a' }],
      changed: ['docs/pending/x.md', 'docs/a.md'],
      task: 'T-00-99',
    },
    (dir, args) => {
      const res = run(dir, ...args);
      assert.equal(res.status, 0, JSON.stringify(res.json.violations));
    },
  );
});

const objSchema = (props, required = ['id']) => ({
  type: 'object',
  properties: props,
  required,
  additionalProperties: false,
});
const snapScenario = (baseSchema, curSchema, message, fn) =>
  scenario(
    {
      files: { [SNAP]: JSON.stringify(curSchema), 'docs/a.md': A0 },
      base: { [SNAP]: JSON.stringify(baseSchema) },
      frozen: [['docs/a.md', A0]],
      changed: [SNAP],
      message,
    },
    fn,
  );

test('UT-GATE-166 스냅샷 파괴 변경(속성 삭제·required 추가·enum 값 삭제)은 ADR 트레일러가 없으면 위반이다 [NFR-MAINT-006]', () => {
  const S = { id: { type: 'string' }, old: { type: 'string' }, kind: { enum: ['a', 'b'] } };
  const cases = [
    ['property removed', objSchema(S), objSchema({ id: S.id, kind: S.kind })],
    ['required added', objSchema({ ...S }, ['id']), objSchema({ ...S }, ['id', 'old'])],
    ['enum value removed', objSchema(S), objSchema({ ...S, kind: { enum: ['a'] } })],
    ['type changed', objSchema(S), objSchema({ ...S, id: { type: 'number' } })],
    [
      'maxLength changed',
      objSchema({ ...S, id: { type: 'string', maxLength: 5 } }),
      objSchema({ ...S, id: { type: 'string', maxLength: 9 } }),
    ],
  ];
  for (const [name, b, c] of cases) {
    snapScenario(b, c, 'feat: x\n', (dir, args) => {
      const res = run(dir, ...args);
      assert.equal(res.status, 1, name);
      assert.deepEqual(keys(res), [`${SNAP}|frozen/destructive-without-adr|error`], name);
    });
    snapScenario(b, c, 'feat: x\n\nCR: CR-70\n', (dir, args) =>
      assert.equal(run(dir, ...args).status, 1, `${name}: CR 만으로는 파괴 변경을 허용하지 않는다`),
    );
    snapScenario(b, c, 'feat: x\n\nADR: ADR-017\n', (dir, args) =>
      assert.equal(run(dir, ...args).status, 0, `${name}: ADR 이 있으면 통과`),
    );
  }
});

test('UT-GATE-167 스냅샷 가산 변경(선택 속성 추가·enum 값 추가)은 CR·ADR 트레일러가 없으면 위반이다 [NFR-MAINT-006]', () => {
  const S = { id: { type: 'string' }, kind: { enum: ['a'] } };
  const cases = [
    ['optional property added', objSchema(S), objSchema({ ...S, extra: { type: 'string' } })],
    ['enum value added', objSchema(S), objSchema({ ...S, kind: { enum: ['a', 'b'] } })],
  ];
  for (const [name, b, c] of cases) {
    snapScenario(b, c, 'feat: x\n', (dir, args) => {
      const res = run(dir, ...args);
      assert.equal(res.status, 1, name);
      assert.deepEqual(keys(res), [`${SNAP}|frozen/additive-without-cr|error`], name);
    });
    snapScenario(b, c, 'feat: x\n\nCR: CR-70\n', (dir, args) => assert.equal(run(dir, ...args).status, 0, name));
    snapScenario(b, c, 'feat: x\n\nADR: ADR-017\n', (dir, args) => assert.equal(run(dir, ...args).status, 0, name));
  }
  // 변화 없음(설명만 바뀜) = 분류 없음
  snapScenario(
    objSchema({ id: { type: 'string' } }),
    { ...objSchema({ id: { type: 'string', description: '설명' } }), title: 't' },
    'feat: x\n',
    (dir, args) => assert.equal(run(dir, ...args).status, 0),
  );
});

test('UT-GATE-168 새 스냅샷 파일(기준 없음)은 무진단이고 스냅샷 파일 삭제는 파괴 변경이다 [NFR-MAINT-006]', () => {
  const frozen = [['docs/a.md', A0]];
  scenario(
    {
      files: { [SNAP]: JSON.stringify(objSchema({ id: { type: 'string' } })), 'docs/a.md': A0 },
      frozen,
      changed: [SNAP],
    },
    (dir, args) => assert.equal(run(dir, ...args).status, 0),
  );
  scenario(
    {
      files: { 'docs/a.md': A0 },
      base: { [SNAP]: JSON.stringify(objSchema({ id: { type: 'string' } })) },
      frozen,
      changed: [SNAP],
    },
    (dir, args) => {
      const res = run(dir, ...args);
      assert.deepEqual(keys(res), [`${SNAP}|frozen/destructive-without-adr|error`]);
    },
  );
  // 스냅샷 디렉터리 밖의 json 변경은 분류 대상이 아니다
  scenario(
    {
      files: { 'other/x.json': '{}', 'docs/a.md': A0 },
      base: { 'other/x.json': '{"a":1}' },
      frozen,
      changed: ['other/x.json'],
    },
    (dir, args) => assert.equal(run(dir, ...args).status, 0),
  );
});

test('UT-GATE-169 lock 부재·JSON 오류·format 오류·files 0개는 exit 2이다 [NFR-MAINT-006]', () => {
  const bad = [
    { lockText: '{ nope', label: 'broken JSON' },
    {
      lockText: JSON.stringify({ format: 'fathom-frozen-lock/2', files: [{ path: 'a', sha256: 'x' }] }),
      label: 'format',
    },
    { lockText: JSON.stringify({ format: 'fathom-frozen-lock/1', files: [] }), label: 'files empty' },
    { lockText: JSON.stringify({ format: 'fathom-frozen-lock/1', files: [{ path: 1 }] }), label: 'files entry' },
  ];
  for (const b of bad) {
    scenario({ ...b, files: { 'docs/a.md': A0 } }, (dir, args) => {
      const res = run(dir, ...args);
      assert.equal(res.status, 2, b.label);
      assert.match(res.json.error, /^engine\/config: /);
    });
  }
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fathom-gates-frozen-'));
  try {
    const res = run(dir, '--lock', path.join(dir, 'absent.lock'));
    assert.equal(res.status, 2);
    assert.match(res.json.error, /^engine\/input-missing: frozen\.lock not found/);
    assert.equal(run(dir, '--task', 'T-1-2').status, 2, '--task 형식 오류');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('UT-GATE-170 diffSchema — 재귀 비교(properties·items·$defs·anyOf)와 파괴 우선·JSON 포인터 보고 [NFR-MAINT-006]', () => {
  const nested = (inner) => ({
    type: 'object',
    properties: { a: { type: 'array', items: { type: 'object', properties: inner, required: [] } } },
  });
  const d1 = diffSchema(nested({ x: { type: 'string' }, y: { type: 'string' } }), nested({ x: { type: 'string' } }));
  assert.deepEqual(d1.destructive, ['/properties/a/items/properties/y (property removed)']);
  const d2 = diffSchema(
    { $defs: { V: { type: 'object', properties: { b: { type: 'string' } } } } },
    { $defs: { V: { type: 'object', properties: { b: { type: 'string' }, c: { type: 'string' } } } } },
  );
  assert.deepEqual(d2.additive, ['/$defs/V/properties/c (optional property added)']);
  assert.deepEqual(d2.destructive, []);
  const d3 = diffSchema({ anyOf: [{ type: 'string' }, { type: 'null' }] }, { anyOf: [{ type: 'string' }] });
  assert.deepEqual(d3.destructive, ['/anyOf/1 (union branch removed)']);
  const d4 = diffSchema({ anyOf: [{ type: 'string' }] }, { anyOf: [{ type: 'string' }, { type: 'null' }] });
  assert.deepEqual(d4.additive, ['/anyOf/1 (union branch added)']);
  // 둘 다 있으면 destructive 목록이 비어 있지 않다(= 파괴로 분류)
  const both = diffSchema(
    { properties: { a: { type: 'string' }, b: { type: 'string' } } },
    { properties: { a: { type: 'number' }, c: { type: 'string' } } },
  );
  assert.ok(both.destructive.length >= 1 && both.additive.length >= 1);
  assert.deepEqual(diffSchema({ type: 'object' }, { type: 'object' }), { destructive: [], additive: [] });
  // 포인터 이스케이프(~ · /)
  const esc = diffSchema({ properties: { 'a/b': { type: 'string' } } }, { properties: {} });
  assert.deepEqual(esc.destructive, ['/properties/a~1b (property removed)']);
});

test('UT-GATE-171 경고(warn)만 있으면 exit 0이고 위반이 있으면 exit 1이며 files는 lock의 files[] 개수이다 [NFR-MAINT-006]', () => {
  scenario(
    {
      files: { 'docs/a.md': '# A\n수정됨\n', 'docs/b.md': 'b' },
      frozen: [
        ['docs/a.md', A0],
        ['docs/b.md', 'b'],
      ],
      message: 'feat: x\n\nCR: CR-70\n',
    },
    (dir, args) => {
      const res = run(dir, ...args);
      assert.equal(res.status, 0);
      assert.equal(res.json.files, 2);
      assert.equal(res.json.errors, 0);
      assert.equal(res.json.warnings, 1);
    },
  );
  scenario({ files: { 'docs/a.md': '# A\n수정됨\n' }, frozen: [['docs/a.md', A0]] }, (dir, args) => {
    const text = spawnSync(process.execPath, [GATE, '--root', dir, ...args], { encoding: 'utf8' });
    assert.equal(text.status, 1);
    assert.match(text.stdout, /^docs\/a\.md:0 {2}error {2}frozen\/changed-without-trailer {2}/m);
    assert.match(text.stdout, /\[check:frozen\] 1 error\(s\), 0 warning\(s\), 1 file\(s\)\n$/);
  });
});
