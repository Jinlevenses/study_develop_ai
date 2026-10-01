// UT-GATE-065~072 — check:security(ADR-010 8규칙 + CR-60 11규칙) 단위 테스트.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { scanSource } from '../check-security-scan.mjs';
import { compare, loadExpectations } from '../lib/expect.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATES_DIR = path.join(HERE, '..');
const GATE = path.join(GATES_DIR, 'check-security-scan.mjs');
const FIX = path.join(GATES_DIR, 'fixtures', 'check-security-scan');
const FILE = 'services/a/src/x.ts';
const X = (n) => 'x'.repeat(n);

const rulesOf = (src, rel = FILE) => scanSource(rel, src).map((v) => v.rule);

function run(root) {
  const r = spawnSync(process.execPath, [GATE, '--root', root, '--json'], { encoding: 'utf8' });
  let json = null;
  try {
    json = JSON.parse(r.stdout.trim().split('\n').pop());
  } catch {
    json = null;
  }
  return { status: r.status, json };
}

function withRepo(files, fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fathom-gates-sec-'));
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

/** [규칙, 양성 소스, 음성 소스, (선택) 파일 경로] 표 검사. */
function table(rows) {
  for (const [rule, bad, good, rel] of rows) {
    assert.ok(rulesOf(bad, rel).includes(rule), `${rule}: positive must be detected: ${bad}`);
    assert.ok(!rulesOf(good, rel).includes(rule), `${rule}: negative must pass: ${good}`);
  }
}

test('UT-GATE-065 check:security selftest(clean 0·violations 1 + 기대 집합 일치·빈 root 2·없는 root 2)가 통과한다 [NFR-SEC-010][NFR-SEC-011]', () => {
  const r = spawnSync(process.execPath, [path.join(GATES_DIR, 'check-gate-selftest.mjs'), '--only', 'check:security'], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const viol = run(path.join(FIX, 'violations'));
  assert.equal(viol.status, 1);
  const { fp, fn } = compare(loadExpectations(path.join(FIX, 'violations')), viol.json.violations);
  assert.deepEqual({ fp, fn }, { fp: [], fn: [] });
  assert.equal(run(path.join(FIX, 'clean')).status, 0);
});

test('UT-GATE-066 ADR-010 8규칙(eval·new Function·child_process exec·shell:true·dangerouslySetInnerHTML·TLS env·rejectUnauthorized·allocUnsafe)은 양성·음성이 갈린다 [NFR-SEC-010]', () => {
  table([
    ['security/eval', 'eval(code);', 'obj.eval(code); const eval2 = 1;'],
    ['security/eval', 'globalThis.eval(code);', 'type T = { eval(x: string): void };'],
    ['security/new-function', "const f = new Function('a', 'return a');", 'const F = Function; type X = Function;'],
    ['security/child-process-exec', "import { exec } from 'node:child_process';", "import { spawn, execFile } from 'node:child_process';"],
    ['security/child-process-exec', "import { execSync as run } from 'child_process';", "import { exec } from 'node:util';"],
    ['security/child-process-exec', "import cp from 'node:child_process'; cp.exec('ls');", "import cp from 'node:child_process'; cp.spawn('ls', []);"],
    ['security/child-process-exec', "import * as cp from 'child_process'; cp.execSync('ls');", "import * as cp from 'child_process'; const x = { exec: 1 }; x.exec;"],
    ['security/shell-true', "spawn('ls', [], { shell: true });", "spawn('ls', [], { shell: false });"],
    ['security/dangerously-set-inner-html', '<div dangerouslySetInnerHTML={{ __html: h }} />', '<div>{h}</div>', 'apps/web/src/x.tsx'],
    ['security/tls-reject-env', "process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';", "process.env.NODE_EXTRA_CA_CERTS = 'x';"],
    ['security/tls-reject-env', "const k = 'NODE_TLS_REJECT_UNAUTHORIZED';", "const k = 'NODE_TLS';"],
    ['security/reject-unauthorized', 'const a = { rejectUnauthorized: false };', 'const a = { rejectUnauthorized: true };'],
    ['security/buffer-alloc-unsafe', 'Buffer.allocUnsafe(4);', 'Buffer.alloc(4); Buffer.from([1]);'],
    ['security/buffer-alloc-unsafe', 'Buffer.allocUnsafeSlow(4);', 'const allocUnsafe = 1;'],
  ]);
});

test('UT-GATE-067 CR-60 규칙(innerHTML·insertAdjacentHTML·document.write·new Buffer·url.parse·createCipher·weak-hash·backup)은 양성·음성이 갈린다 [NFR-SEC-010][NFR-SEC-011]', () => {
  table([
    ['security/inner-html', 'el.innerHTML = x;', 'const o = { innerHTML: 1 };'],
    ['security/inner-html', 'const s = el.outerHTML;', "const s = 'outerHTML';"],
    ['security/insert-adjacent-html', "el.insertAdjacentHTML('beforeend', x);", "el.insertAdjacentElement('beforeend', x);"],
    ['security/document-write', 'document.write(x);', 'document.writer(x); const document2 = { write: 1 };'],
    ['security/document-write', 'document.writeln(x);', 'document.getElementById(x);'],
    ['security/new-buffer', 'const b = new Buffer(8);', 'const b = Buffer.from([8]);'],
    ['security/url-parse', 'const u = url.parse(s);', 'const u = new URL(s); JSON.parse(s);'],
    ['security/url-parse', "import * as u from 'node:url'; u.parse(s);", "import * as u from 'node:url'; u.fileURLToPath(s);"],
    ['security/url-parse', "import { parse } from 'url'; parse(s);", "import { parse } from 'yaml'; parse(s);"],
    ['security/create-cipher', "createCipher('aes', k);", "createCipheriv('aes-256-gcm', k, iv);"],
    ['security/weak-hash', "createHash('md5');", "createHash('sha256');"],
    ['security/weak-hash', 'createHash(`SHA1`);', 'createHash(algo);'],
    ['security/sqlite-backup', "db.backup('x');", 'function backup() {} backup();'],
  ]);
});

test('UT-GATE-068 주석·문자열 속 단어와 RegExp#exec는 위반이 아니다(토큰 기준 판정) [NFR-SEC-010]', () => {
  const src = [
    '// eval(x); new Function(x); shell: true; el.innerHTML = x;',
    '/* Buffer.allocUnsafe(1); document.write(x) */',
    "const s = 'eval(x) and shell: true and el.innerHTML';",
    'const RE = /(\\d+)/;',
    'RE.exec(line); /(\\d+)/.exec(line); re.execSync;',
    "createHash('sha256'); createCipheriv('aes-256-gcm', k, iv);",
  ].join('\n');
  assert.deepEqual(rulesOf(src), []);
  // 탈출구 주석은 존재하지 않는다(STD-AGT-14): 같은 줄·윗줄 sql-ok·biome-ignore도 위반을 지우지 못한다.
  assert.ok(rulesOf('eval(x); // sql-ok: because').includes('security/eval'));
  assert.ok(rulesOf('// biome-ignore lint/plugin: because\neval(x);').includes('security/eval'));
});

test('UT-GATE-069 secret-literal 6패턴은 src 문자열·테스트·evals 텍스트에서 잡히고 secrets-50 세트는 무시한다 [NFR-SEC-010][NFR-SEC-011]', () => {
  const secrets = [
    '-----BEGIN PRIVATE KEY-----',
    '-----BEGIN RSA PRIVATE KEY-----',
    `sk-ant-${X(24)}`,
    `sk-${X(24)}`,
    `sk-proj-${X(24)}`,
    `AIza${X(35)}`,
    `ghp_${X(36)}`,
    `AKIA${'X'.repeat(16)}`,
  ];
  for (const s of secrets) {
    assert.deepEqual(rulesOf(`const k = '${s}';`), ['security/secret-literal'], s);
    assert.deepEqual(rulesOf(`const k = \`pre-${s}-post\`;`), ['security/secret-literal'], `template: ${s}`);
  }
  assert.deepEqual(rulesOf("const k = 'sk-short'; const m = 'AKIA123';"), [], '짧은 문자열은 비밀이 아니다');
  withRepo(
    {
      'services/a/test/s.test.ts': `export const K = 'sk-ant-${X(24)}';\n`,
      'tests/s.spec.ts': `export const K = 'AKIA${'X'.repeat(16)}';\n`,
      'evals/cases/c.yaml': `key: ghp_${X(36)}\n`,
      'evals/cases/c.json': `{ "k": "AIza${X(35)}" }\n`,
      'evals/sets/secrets-50/leaks.txt': `sk-ant-${X(24)}\n`,
      'services/a/src/ok.ts': 'export const ok = 1;\n',
    },
    (dir) => {
      const res = run(dir);
      assert.equal(res.status, 1);
      assert.deepEqual(
        res.json.violations.map((v) => `${v.file}:${v.line}`),
        ['evals/cases/c.json:1', 'evals/cases/c.yaml:1', 'services/a/test/s.test.ts:1', 'tests/s.spec.ts:1'],
      );
    },
  );
  withRepo({ 'services/a/src/ok.ts': 'export const ok = 1;\n', 'evals/sets/secrets-50/leaks.txt': `sk-ant-${X(24)}\n` }, (dir) =>
    assert.equal(run(dir).status, 0, 'secrets-50은 무시'),
  );
});

test('UT-GATE-070 Math.random은 services/*/src/domain/** 안에서만 위반이다 [NFR-SEC-010]', () => {
  const src = 'export const r = () => Math.random();';
  assert.deepEqual(rulesOf(src, 'services/learning/src/domain/practice/x.ts'), ['security/domain-math-random']);
  assert.deepEqual(rulesOf(src, 'services/learning/src/application/x.ts'), []);
  assert.deepEqual(rulesOf(src, 'apps/web/src/lib/x.ts'), []);
  assert.deepEqual(rulesOf(src, 'packages/shared-kernel/src/domain/x.ts'), []);
  assert.deepEqual(rulesOf('const r = Math.floor(1.5);', 'services/learning/src/domain/x.ts'), []);
});

test('UT-GATE-071 fetch(·new EventSource( 는 apps/web/src/lib/** 밖에서만 위반이고 멤버 호출·메서드 정의는 통과한다 [NFR-SEC-011]', () => {
  const bad = "export const g = (u: string) => fetch(u); export const s = new EventSource('/e');";
  assert.deepEqual(rulesOf(bad, 'apps/web/src/features/x/api.ts'), [
    'security/web-fetch-outside-lib',
    'security/web-fetch-outside-lib',
  ]);
  assert.deepEqual(rulesOf(bad, 'apps/web/src/lib/api.ts'), []);
  assert.deepEqual(rulesOf(bad, 'services/gateway/src/http/x.ts'), []);
  assert.deepEqual(rulesOf('client.fetch(u); window.fetch(u); const c = { fetch(u) { return u; } };', 'apps/web/src/x.ts'), []);
  assert.deepEqual(rulesOf('async function fetch(u) { return u; }', 'apps/web/src/x.ts'), []);
});

test('UT-GATE-072 src 파일이 0개면 exit 2, 위반이 있으면 exit 1, 줄 번호는 토큰 줄이다 [NFR-SEC-010]', () => {
  withRepo({}, (dir) => {
    const res = run(dir);
    assert.equal(res.status, 2);
    assert.match(res.json.error, /^engine\/no-files: /);
  });
  withRepo({ 'services/a/src/x.ts': 'const a = 1;\n\nconst b = new Function("x");\n' }, (dir) => {
    const res = run(dir);
    assert.equal(res.status, 1);
    assert.deepEqual(
      res.json.violations.map((v) => `${v.file}:${v.line}:${v.rule}`),
      ['services/a/src/x.ts:3:security/new-function'],
    );
  });
});
