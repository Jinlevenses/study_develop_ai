// UT-GATE-113~120 — check:content-ingest(서빙 테이블 단일 수입 포트, STD-DIR-20) 단위 테스트.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkFile } from '../check-content-ingest.mjs';
import { loadSqlConfig } from '../check-sql-template.mjs';
import { compare, loadExpectations } from '../lib/expect.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATES_DIR = path.join(HERE, '..');
const GATE = path.join(GATES_DIR, 'check-content-ingest.mjs');
const FIX = path.join(GATES_DIR, 'fixtures', 'check-content-ingest');
const cfg = loadSqlConfig();
const sql = (s) => `db.prepare(${JSON.stringify(s)});`;
const INGEST = 'services/content/src/application/catalog/ingest/load.ts';
const OVERLAY = 'services/content/src/application/catalog/overlay/apply.ts';
const BROWSE = 'services/content/src/application/catalog/browse.ts';

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

const rules = (rel, src) => checkFile(rel, src, cfg).map((v) => v.rule).sort();

test('UT-GATE-113 check:content-ingest selftest(clean 0·violations 1 + 기대 집합 일치·빈 root 2·없는 root 2)가 통과한다 [FR-CUR-002][FR-CUR-020]', () => {
  const r = spawnSync(process.execPath, [path.join(GATES_DIR, 'check-gate-selftest.mjs'), '--only', 'check:content-ingest'], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const viol = run(path.join(FIX, 'violations'));
  assert.equal(viol.status, 1);
  const { fp, fn } = compare(loadExpectations(path.join(FIX, 'violations')), viol.json.violations);
  assert.deepEqual({ fp, fn }, { fp: [], fn: [] });
  assert.equal(run(path.join(FIX, 'clean')).status, 0);
});

test('UT-GATE-114 writers 안(ingest 디렉터리·pack-load·*-ingest.sql.ts)의 서빙 테이블 쓰기는 통과한다 [FR-CUR-002][FR-CUR-020]', () => {
  const w = sql('INSERT OR IGNORE INTO ct_concept (id) VALUES (?)');
  for (const rel of [
    INGEST,
    'services/content/src/application/itembank/ingest/x.ts',
    'services/content/src/jobs/pack-load.ts',
    'services/content/src/infra/db/catalog-ingest.sql.ts',
    'services/content/src/infra/db/itembank-ingest.sql.ts',
  ]) {
    assert.deepEqual(rules(rel, w), [], rel);
  }
  assert.deepEqual(rules(INGEST, sql('UPDATE ct_pack_active SET pack_id = ?')), []);
  assert.deepEqual(rules(INGEST, sql('DELETE FROM "ct_pack_delta" WHERE 1')), []);
});

test('UT-GATE-115 writers 밖(예: application/catalog/browse.ts)의 INSERT·UPDATE·DELETE는 ingest/write-location이다 [FR-CUR-002][FR-CUR-020]', () => {
  assert.deepEqual(rules(BROWSE, sql('INSERT INTO ct_concept (id) VALUES (?)')), ['ingest/write-location']);
  assert.deepEqual(rules(BROWSE, sql('UPDATE ct_concept SET title = ?')), ['ingest/write-location']);
  assert.deepEqual(rules(BROWSE, sql('DELETE FROM ct_pack')), ['ingest/write-location']);
  assert.deepEqual(rules(BROWSE, sql('INSERT OR IGNORE INTO ib_item_model (id) VALUES (?)')), ['ingest/write-location']);
  assert.deepEqual(rules('services/learning/src/x.ts', sql('INSERT INTO ct_concept (id) VALUES (?)')), ['ingest/write-location']);
});

test('UT-GATE-116 overlay 테이블은 overlay_writers에서 통과하고 비 overlay 서빙 테이블은 overlay 경로에서도 위반이다 [FR-CUR-002][FR-CUR-020]', () => {
  assert.deepEqual(rules(OVERLAY, sql('UPDATE ct_overlay_head SET head = ?')), []);
  assert.deepEqual(rules(OVERLAY, sql('UPDATE ct_search_doc SET body = ?')), []);
  assert.deepEqual(rules(OVERLAY, sql('UPDATE ib_item SET deprecated = 1')), []);
  assert.deepEqual(rules('services/content/src/infra/db/catalog-overlay.sql.ts', sql('UPDATE ib_item SET x = 1')), []);
  assert.deepEqual(rules(OVERLAY, sql('UPDATE ct_concept SET title = ?')), ['ingest/write-location']);
  assert.deepEqual(rules(OVERLAY, sql('INSERT INTO ct_ku (id) VALUES (?)')), ['ingest/write-location']);
  assert.deepEqual(rules(BROWSE, sql('UPDATE ct_overlay_head SET head = ?')), ['ingest/write-location'], 'overlay 테이블도 overlay 경로 밖이면 위반');
});

test('UT-GATE-117 REPLACE INTO·INSERT OR REPLACE INTO 서빙 테이블은 어디서든 ingest/replace다 [FR-CUR-002][FR-CUR-020]', () => {
  assert.deepEqual(rules(INGEST, sql('INSERT OR REPLACE INTO ct_ku (id) VALUES (?)')), ['ingest/replace']);
  assert.deepEqual(rules(INGEST, sql('REPLACE INTO ib_item (id) VALUES (?)')), ['ingest/replace']);
  assert.deepEqual(rules(OVERLAY, sql('INSERT OR REPLACE INTO ib_item (id) VALUES (?)')), ['ingest/replace']);
  assert.deepEqual(rules(BROWSE, sql('REPLACE INTO ib_item (id) VALUES (?)')), ['ingest/replace', 'ingest/write-location']);
});

test('UT-GATE-118 aq_staging_* 쓰기는 서빙 테이블이 아니므로 어디서든 통과한다 [FR-CUR-002][FR-CUR-020]', () => {
  assert.deepEqual(rules(BROWSE, sql('INSERT INTO aq_staging_diff (id) VALUES (?)')), []);
  assert.deepEqual(rules(BROWSE, sql('DELETE FROM aq_staging_item WHERE 1')), []);
  assert.deepEqual(rules(BROWSE, sql('INSERT INTO aq_inbox_item (id) VALUES (?)')), []);
});

test('UT-GATE-119 SELECT … FROM ct_concept·서브쿼리·접두만 같은 다른 테이블 이름은 통과한다 [FR-CUR-002][FR-CUR-020]', () => {
  assert.deepEqual(rules(BROWSE, sql('SELECT id FROM ct_concept WHERE id IN (SELECT id FROM ct_ku)')), []);
  assert.deepEqual(rules(BROWSE, sql('INSERT INTO ct_concept_staging (id) VALUES (?)')), [], '`ct_concept` 뒤 `_staging`은 다른 테이블');
  assert.deepEqual(rules(BROWSE, sql('INSERT INTO ct_pack_active (id) VALUES (?)')), ['ingest/write-location'], '`ct_pack_active`는 별도 서빙 테이블');
});

test('UT-GATE-120 여러 줄 템플릿·인용 식별자·`+` 사슬도 판정하고 진단 줄은 리터럴 시작 줄이다 [FR-CUR-002][FR-CUR-020]', () => {
  const v = checkFile(BROWSE, '\ndb.prepare(`\n  INSERT\n  OR REPLACE INTO "ct_ku" (id)\n  VALUES (?)\n`);', cfg);
  assert.deepEqual(v.map((x) => `${x.line}:${x.rule}`).sort(), ['2:ingest/replace', '2:ingest/write-location']);
  const chain = checkFile(BROWSE, "\n\ndb.exec('DELETE FROM ' + 'ct_pack WHERE 1');", cfg);
  assert.deepEqual(chain.map((x) => `${x.line}:${x.rule}`), ['3:ingest/write-location']);
});
