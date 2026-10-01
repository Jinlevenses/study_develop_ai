// UT-GATE-105~112 — check:ledger-writer(증거 원장 단일 writer·INSERT OR IGNORE, CR-27) 단위 테스트.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkFile } from '../check-ledger-writer.mjs';
import { loadSqlConfig } from '../check-sql-template.mjs';
import { compare, loadExpectations } from '../lib/expect.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATES_DIR = path.join(HERE, '..');
const GATE = path.join(GATES_DIR, 'check-ledger-writer.mjs');
const FIX = path.join(GATES_DIR, 'fixtures', 'check-ledger-writer');
const cfg = loadSqlConfig();
const WRITER = cfg.ledger.writer;
const OTHER = 'services/learning/src/application/practice/x.ts';

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

const rules = (rel, src) =>
  checkFile(rel, src, cfg)
    .map((v) => v.rule)
    .sort();
const sql = (s) => `db.prepare(${JSON.stringify(s)});`;

test('UT-GATE-105 check:ledger-writer selftest(clean 0·violations 1 + 기대 집합 일치·빈 root 2·없는 root 2)가 통과한다 [NFR-DATA-013][CR-27]', () => {
  const r = spawnSync(
    process.execPath,
    [path.join(GATES_DIR, 'check-gate-selftest.mjs'), '--only', 'check:ledger-writer'],
    {
      encoding: 'utf8',
    },
  );
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const viol = run(path.join(FIX, 'violations'));
  assert.equal(viol.status, 1);
  const { fp, fn } = compare(loadExpectations(path.join(FIX, 'violations')), viol.json.violations);
  assert.deepEqual({ fp, fn }, { fp: [], fn: [] });
  assert.equal(run(path.join(FIX, 'clean')).status, 0);
});

test('UT-GATE-106 writer 파일의 INSERT OR IGNORE INTO lr_event(문자열·템플릿·인용 식별자)는 통과한다 [NFR-DATA-013][CR-27]', () => {
  assert.deepEqual(rules(WRITER, sql('INSERT OR IGNORE INTO lr_event (event_id) VALUES (?)')), []);
  assert.deepEqual(rules(WRITER, sql('insert or ignore into lr_event (event_id) values (?)')), []);
  assert.deepEqual(
    rules(WRITER, `db.prepare(\`INSERT OR IGNORE INTO "lr_event" (a) VALUES (\${placeholders(1)})\`);`),
    [],
  );
  assert.deepEqual(rules(WRITER, sql('SELECT * FROM lr_event WHERE event_id = ?')), []);
});

test('UT-GATE-107 writer 파일의 INSERT INTO·INSERT OR ABORT/FAIL·INSERT OR REPLACE·ON CONFLICT DO UPDATE는 형태 위반이다 [NFR-DATA-013][CR-27]', () => {
  assert.deepEqual(rules(WRITER, sql('INSERT INTO lr_event (a) VALUES (?)')), ['ledger/insert-form']);
  assert.deepEqual(rules(WRITER, sql('INSERT OR ABORT INTO lr_event (a) VALUES (?)')), ['ledger/insert-form']);
  assert.deepEqual(rules(WRITER, sql('INSERT OR FAIL INTO lr_event (a) VALUES (?)')), ['ledger/insert-form']);
  assert.deepEqual(rules(WRITER, sql('INSERT OR REPLACE INTO lr_event (a) VALUES (?)')), ['ledger/replace']);
  assert.deepEqual(rules(WRITER, sql('REPLACE INTO lr_event (a) VALUES (?)')), ['ledger/replace']);
  assert.deepEqual(
    rules(WRITER, sql('INSERT OR IGNORE INTO lr_event (a) VALUES (?) ON CONFLICT(event_id) DO UPDATE SET a = 1')),
    ['ledger/upsert'],
  );
  assert.deepEqual(
    rules(WRITER, sql('INSERT INTO other (a) VALUES (?) ON CONFLICT(a) DO UPDATE SET a = 1')),
    [],
    'lr_event가 아닌 upsert는 대상 아님',
  );
});

test('UT-GATE-108 writer 밖의 INSERT OR IGNORE도 ledger/writer-location 위반이고 형태 위반은 함께 보고한다 [NFR-DATA-013][CR-27]', () => {
  assert.deepEqual(rules(OTHER, sql('INSERT OR IGNORE INTO lr_event (a) VALUES (?)')), ['ledger/writer-location']);
  assert.deepEqual(rules(OTHER, sql('INSERT INTO lr_event (a) VALUES (?)')), [
    'ledger/insert-form',
    'ledger/writer-location',
  ]);
  assert.deepEqual(rules(OTHER, sql('INSERT OR REPLACE INTO lr_event (a) VALUES (?)')), [
    'ledger/replace',
    'ledger/writer-location',
  ]);
  assert.deepEqual(rules('packages/shared-kernel/src/x.ts', sql('INSERT OR IGNORE INTO lr_event (a) VALUES (?)')), [
    'ledger/writer-location',
  ]);
  assert.deepEqual(rules(OTHER, sql('SELECT * FROM lr_event')), [], '읽기는 어디서나 허용');
});

test('UT-GATE-109 UPDATE·DELETE FROM lr_event는 ledger/mutation이다(writer 안팎 모두) [NFR-DATA-013][CR-27]', () => {
  assert.deepEqual(rules(WRITER, sql('UPDATE lr_event SET a = 1')), ['ledger/mutation']);
  assert.deepEqual(rules(WRITER, sql('UPDATE OR IGNORE lr_event SET a = 1')), ['ledger/mutation']);
  assert.deepEqual(rules(WRITER, sql('DELETE FROM lr_event WHERE 1')), ['ledger/mutation']);
  assert.deepEqual(rules(OTHER, sql('DELETE FROM lr_event')), ['ledger/mutation', 'ledger/writer-location']);
  assert.deepEqual(rules(OTHER, sql('UPDATE lr_card_state SET due = 1')), [], '다른 테이블');
  assert.deepEqual(rules(OTHER, sql('INSERT INTO lr_event_archive (a) VALUES (?)')), [], '접두만 같은 다른 테이블');
});

test('UT-GATE-110 DROP TRIGGER는 어느 테이블이든 src 안에서 위반이다 [NFR-DATA-013][CR-27]', () => {
  assert.deepEqual(rules(OTHER, sql('DROP TRIGGER IF EXISTS trg_lr_event_no_update')), ['ledger/drop-trigger']);
  assert.deepEqual(rules(WRITER, sql('drop trigger trg_other')), ['ledger/drop-trigger']);
  assert.deepEqual(rules(OTHER, sql('DROP TABLE x')), []);
});

test('UT-GATE-111 인용 식별자 "lr_event"와 대소문자·공백 변형을 같은 테이블로 본다 [NFR-DATA-013][CR-27]', () => {
  assert.deepEqual(rules(OTHER, sql('DELETE FROM "lr_event" WHERE 1')), ['ledger/mutation', 'ledger/writer-location']);
  assert.deepEqual(rules(OTHER, sql('delete   from   LR_EVENT')), ['ledger/mutation', 'ledger/writer-location']);
  assert.deepEqual(rules(OTHER, sql('Insert Or Ignore Into "LR_Event" (a) values (?)')), ['ledger/writer-location']);
});

test('UT-GATE-112 여러 줄 템플릿·`+` 사슬 리터럴도 판정하고 진단 줄은 리터럴 시작 줄이다 [NFR-DATA-013][CR-27]', () => {
  const multi = 'db.prepare(`\n  INSERT OR REPLACE\n    INTO\n  lr_event (a)\n  VALUES (?)\n`);';
  const v = checkFile(OTHER, multi, cfg);
  assert.deepEqual(v.map((x) => x.rule).sort(), ['ledger/replace', 'ledger/writer-location']);
  assert.ok(v.every((x) => x.line === 1));
  const chain = "\n\ndb.exec('INSERT INTO ' + 'lr_event (a) ' + 'VALUES (1)');";
  const c = checkFile(WRITER, chain, cfg);
  assert.deepEqual(
    c.map((x) => `${x.line}:${x.rule}`),
    ['3:ledger/insert-form'],
  );
});
