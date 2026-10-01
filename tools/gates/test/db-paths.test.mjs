// UT-GATE-098~104 — check:db-paths(STD-SQL-13) 단위 테스트.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkFile } from '../check-db-paths.mjs';
import { loadSqlConfig } from '../check-sql-template.mjs';
import { compare, loadExpectations } from '../lib/expect.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATES_DIR = path.join(HERE, '..');
const GATE = path.join(GATES_DIR, 'check-db-paths.mjs');
const FIX = path.join(GATES_DIR, 'fixtures', 'check-db-paths');
const cfg = loadSqlConfig();

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

const check = (rel, src) => checkFile(rel, src, cfg).map((v) => `${v.rule}|${v.message.split(' ')[0]}`);

test('UT-GATE-098 check:db-paths selftest(clean 0·violations 1 + 기대 집합 일치·빈 root 2·없는 root 2)가 통과한다 [NFR-MAINT-002][AP-01]', () => {
  const r = spawnSync(process.execPath, [path.join(GATES_DIR, 'check-gate-selftest.mjs'), '--only', 'check:db-paths'], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const viol = run(path.join(FIX, 'violations'));
  assert.equal(viol.status, 1);
  const { fp, fn } = compare(loadExpectations(path.join(FIX, 'violations')), viol.json.violations);
  assert.deepEqual({ fp, fn }, { fp: [], fn: [] });
});

test('UT-GATE-099 소유 단위는 자기 DB 이름을 쓸 수 있다(learning→learning·insight, ai-gateway→ai·ai-cache) [NFR-MAINT-002][AP-01]', () => {
  assert.deepEqual(check('services/learning/src/x.ts', "const a = 'learning.db', b = 'insight.db';"), []);
  assert.deepEqual(check('services/ai-gateway/src/x.ts', "const a = 'ai.db', b = 'ai-cache.db';"), []);
  assert.deepEqual(check('services/content/src/x.ts', "const a = `${dir}/content.db`;"), []);
  assert.deepEqual(check('services/ops/src/x.ts', "const a = 'ops.db';"), []);
  assert.equal(run(path.join(FIX, 'clean')).status, 0);
});

test('UT-GATE-100 다른 단위의 DB 이름은 db/foreign-path이고 단위 밖(packages) 코드도 위반이다 [NFR-MAINT-002][AP-01]', () => {
  assert.deepEqual(check('services/content/src/x.ts', "const a = 'learning.db';"), ['db/foreign-path|learning.db']);
  assert.deepEqual(check('services/learning/src/x.ts', "const a = 'content.db';"), ['db/foreign-path|content.db']);
  assert.deepEqual(check('services/gateway/src/x.ts', "const a = 'ops.db';"), ['db/foreign-path|ops.db']);
  assert.deepEqual(check('packages/shared-kernel/src/x.ts', "const a = 'content.db';"), ['db/foreign-path|content.db']);
  assert.deepEqual(check('services/learning/src/x.ts', 'const a = `${dir}/content.db`;'), ['db/foreign-path|content.db']);
});

test('UT-GATE-101 `ai.db`가 `ai-cache.db`에서 오검출되지 않고 이름 앞뒤 문자 경계가 지켜진다 [NFR-MAINT-002][AP-01]', () => {
  // ai-cache.db 하나는 정확히 1건(ai-cache.db)만 — ai.db 로 중복 보고하지 않는다
  assert.deepEqual(check('services/content/src/x.ts', "const a = '/d/ai-cache.db';"), ['db/foreign-path|ai-cache.db']);
  assert.deepEqual(check('services/content/src/x.ts', "const a = '/d/ai.db';"), ['db/foreign-path|ai.db']);
  // 접두·접미가 붙은 다른 이름은 DB 이름이 아니다
  assert.deepEqual(check('services/content/src/x.ts', "const a = 'main.ai.db.bak', b = 'my-ai.db', c = 'ai.dbx', d = 'xai.db';"), []);
  assert.deepEqual(check('services/content/src/x.ts', "const a = 'ai-cache.db.old';"), ['db/foreign-path|ai-cache.db'], '`.db` 뒤 단어 경계는 `.old`에서 성립');
});

test('UT-GATE-102 -wal·-shm 접미 파일 이름도 같은 판정이다 [NFR-MAINT-002][AP-01]', () => {
  assert.deepEqual(check('services/content/src/x.ts', "const a = 'learning.db-wal', b = 'insight.db-shm';"), [
    'db/foreign-path|learning.db',
    'db/foreign-path|insight.db',
  ]);
  assert.deepEqual(check('services/learning/src/x.ts', "const a = 'learning.db-wal', b = 'learning.db-shm';"), []);
});

test('UT-GATE-103 packages/testkit 은 면제(스캔 제외)이고 면제 파일만 있으면 스캔 0파일로 exit 2다 [NFR-MAINT-002][AP-01]', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fathom-gates-dbp-'));
  try {
    for (const rel of ['services/content/src', 'packages/contracts/src', 'packages/testkit/src']) {
      mkdirSync(path.join(dir, rel), { recursive: true });
    }
    writeFileSync(path.join(dir, 'packages/testkit/src/x.ts'), "export const N = ['learning.db', 'ops.db'];\nexport const S = 'ATTACH DATABASE ? AS x';\n");
    const only = run(dir);
    assert.equal(only.status, 2);
    assert.match(only.json.error, /^engine\/no-files: /);
    writeFileSync(path.join(dir, 'services/content/src/ok.ts'), "export const N = 'content.db';\n");
    const both = run(dir);
    assert.equal(both.status, 0);
    assert.equal(both.json.files, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('UT-GATE-104 ATTACH DATABASE ?·DETACH \'x\'·보간 템플릿은 db/attach이고 일반 문장·식별자는 통과한다 [NFR-MAINT-002][AP-01]', () => {
  const at = (src) => checkFile('services/content/src/x.ts', src, cfg).map((v) => v.rule);
  assert.deepEqual(at("db.exec('ATTACH DATABASE ? AS other');"), ['db/attach']);
  assert.deepEqual(at("db.exec(\"DETACH 'other'\");"), ['db/attach']);
  assert.deepEqual(at('db.exec(`ATTACH DATABASE ${p} AS x`);'), ['db/attach']);
  assert.deepEqual(at("db.exec(\"attach database '/tmp/x' as y\");"), ['db/attach']);
  assert.deepEqual(at("db.exec('ATTACH ' + 'DATABASE ? AS z');"), ['db/attach']);
  assert.deepEqual(at("db.prepare('SELECT attachment FROM files WHERE detached = 1');"), []);
  assert.deepEqual(at("const msg = 'Please detach the cable';"), []);
});
