import { existsSync } from 'node:fs';
import path from 'node:path';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import { openDb } from '@fathom/shared-kernel/sqlite/sqlite';
import { describe, expect, it } from 'vitest';
import { LEARNING_DB, learningDbOptions } from '../../../src/infra/db/open.js';
import { INSIGHT_DB, insightDbOptions } from '../../../src/infra/insight-db/open.js';
import { docSql, runMode, withTempHome } from './helpers/boot.js';

const DEVICE = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const eventRow = (
  n: number,
  over: Record<string, string | number | null> = {},
): Record<string, string | number | null> => ({
  event_id: `01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, '0')}`,
  device_id: DEVICE,
  device_seq: n,
  client_ts: 1_000 + n,
  type: 'card.enrolled',
  schema_version: 1,
  idempotency_key: `card:k8s.probes:definition:p:${n}`,
  payload: '{"card_id":"k8s.probes:definition:p","concept_id":"k8s.probes"}',
  prev_hash: '0'.repeat(64),
  hash: 'b'.repeat(64),
  experiment_arm: null,
  recorded_at: 2_000,
  ext: '{}',
  ext_v: 1,
  ...over,
});

async function migratedDb(home: string, readOnly: boolean, recursive = true): Promise<SqlitePort> {
  expect((await runMode(home, ['--mode=migrate'])).code).toBe(0);
  const opts = learningDbOptions(readOnly);
  return openDb(path.join(home, 'data', 'learning.db'), { ...opts, recursiveTriggers: recursive });
}

describe('learning DB 기술자', () => {
  it('IT-318 LEARNING_DB·INSIGHT_DB 값과 연결 PRAGMA [NFR-DATA-001][CR-04]', async () => {
    await withTempHome(async (home) => {
      // Assert: 기술자 값
      expect(LEARNING_DB).toMatchObject({
        file: 'learning.db',
        applicationId: 0x46544c52,
        profile: 'full',
        synchronous: 'FULL',
        recursiveTriggers: true,
      });
      expect(LEARNING_DB.migrations.map((m) => m.module)).toEqual([
        'ledger',
        'learner-model',
        'practice',
        'curriculum-ref',
      ]);
      expect(INSIGHT_DB).toMatchObject({
        file: 'insight.db',
        applicationId: 0x46544956,
        profile: 'meta',
        synchronous: 'NORMAL',
        recursiveTriggers: false,
      });
      expect(INSIGHT_DB.migrations.map((m) => m.module)).toEqual(['insight']);
      for (const m of [...LEARNING_DB.migrations, ...INSIGHT_DB.migrations]) {
        expect(path.isAbsolute(m.dir), m.module).toBe(true);
        expect(
          existsSync(
            path.join(
              m.dir,
              '0001_' +
                (m.module === 'insight'
                  ? 'insight_views'
                  : m.module === 'ledger'
                    ? 'ledger_core'
                    : m.module === 'learner-model'
                      ? 'projections'
                      : m.module === 'practice'
                        ? 'practice_core'
                        : 'curriculum_ref') +
                '.sql',
            ),
          ),
          m.module,
        ).toBe(true);
      }
      // Act: 실제 연결
      expect((await runMode(home.path, ['--mode=migrate'])).code).toBe(0);
      const pragma = (db: SqlitePort): { sync: number; recursive: number } => ({
        sync: Number(db.prepare('PRAGMA synchronous').get()?.synchronous),
        recursive: Number(db.prepare('PRAGMA recursive_triggers').get()?.recursive_triggers),
      });
      const file = path.join(home.path, 'data', 'learning.db');
      const rw = openDb(file, learningDbOptions(false));
      const ro = openDb(file, learningDbOptions(true));
      const insight = openDb(path.join(home.path, 'data', 'insight.db'), insightDbOptions(false));
      try {
        // Assert
        expect(pragma(rw)).toEqual({ sync: 2, recursive: 1 });
        expect(pragma(ro)).toEqual({ sync: 2, recursive: 1 });
        expect(pragma(insight)).toEqual({ sync: 1, recursive: 0 });
      } finally {
        rw.close();
        ro.close();
        insight.close();
      }
    });
  });

  it('IT-319 원장 불변 장치·멱등 INSERT OR IGNORE·DB-01 §6.3 문장 prepare [NFR-DATA-001]', async () => {
    await withTempHome(async (home) => {
      // Arrange
      const db = await migratedDb(home.path, false);
      try {
        const insert = docSql('LEDGER_INSERT');
        // Act / Assert: 삽입·멱등·STORED 열
        expect(db.prepare(insert).run(eventRow(1)).changes).toBe(1);
        expect(db.prepare(insert).run(eventRow(2, { idempotency_key: 'card:k8s.probes:definition:p:1' })).changes).toBe(
          0,
        );
        expect(
          db
            .prepare('SELECT card_id, concept_id FROM lr_event WHERE event_id = :e')
            .get({ e: String(eventRow(1).event_id) }),
        ).toEqual({
          card_id: 'k8s.probes:definition:p',
          concept_id: 'k8s.probes',
        });
        // UPDATE·DELETE 거부
        expect(() =>
          db.prepare("UPDATE lr_event SET type = 'x' WHERE event_id = :e").run({ e: String(eventRow(1).event_id) }),
        ).toThrow(/ledger is append-only/);
        expect(() =>
          db.prepare('DELETE FROM lr_event WHERE event_id = :e').run({ e: String(eventRow(1).event_id) }),
        ).toThrow(/ledger is append-only/);
        // INSERT OR REPLACE 거부(recursive_triggers = ON)
        expect(() =>
          db
            .prepare(insert.replace('INSERT OR IGNORE', 'INSERT OR REPLACE'))
            .run(eventRow(1, { payload: '{"card_id":"x"}' })),
        ).toThrow(/ledger is append-only/);
        // 소문자 device_id: 평문 INSERT는 CHECK 거부, OR IGNORE는 묵살(changes = 0) — 작성자가 중복 확인해야 하는 함정(D-14)
        const lower = eventRow(3, { device_id: DEVICE.toLowerCase() });
        expect(() => db.prepare(insert.replace('INSERT OR IGNORE', 'INSERT')).run(lower)).toThrow(
          /CHECK constraint failed/,
        );
        expect(db.prepare(insert).run(lower).changes).toBe(0);
        // 완료된 세션 불변
        db.prepare(
          "INSERT INTO lr_session(session_id, template, scope_json, ai_mode_at_start, status, study_day, policy_version, started_at) VALUES (:s, 'standard', '{\"kind\":\"all\"}', 'OFFLINE', 'completed', '2026-10-01', 'ps_0', 1)",
        ).run({ s: '01ARZ3NDEKTSV4RRFFQ69G5FAV' });
        expect(() =>
          db
            .prepare('UPDATE lr_session SET blocks_done = 1 WHERE session_id = :s')
            .run({ s: '01ARZ3NDEKTSV4RRFFQ69G5FAV' }),
        ).toThrow(/ended session is immutable/);
        // 카드 상태 생성 열
        db.prepare(
          "INSERT INTO lr_card_state(card_id, concept_id, facet, response_mode, tier, status, last_ts, state_json) VALUES ('k8s.probes:definition:p', 'k8s.probes', 'definition', 'production', 'A', 'active', 1, '{\"due\":123456,\"lapses\":2}')",
        ).run();
        expect(
          db.prepare("SELECT due_at, lapses FROM lr_card_state WHERE card_id = 'k8s.probes:definition:p'").get(),
        ).toEqual({ due_at: 123456, lapses: 2 });
        // DB-01 §6.3 문장 5개 prepare
        for (const name of [
          'LEDGER_INSERT',
          'LEDGER_DEVICE_HEAD',
          'LEDGER_FIND_CONFLICT',
          'LEDGER_HEADS',
          'LEDGER_REPLAY',
        ]) {
          expect(() => db.prepare(docSql(name)), name).not.toThrow();
        }
      } finally {
        db.close();
      }
      // 대조군: recursive_triggers = OFF 연결은 REPLACE가 덮어쓴다(그래서 ON이 필수)
      const off = openDb(path.join(home.path, 'data', 'learning.db'), {
        synchronous: 'FULL',
        recursiveTriggers: false,
      });
      try {
        const replace = docSql('LEDGER_INSERT').replace('INSERT OR IGNORE', 'INSERT OR REPLACE');
        expect(off.prepare(replace).run(eventRow(1, { payload: '{"card_id":"overwritten"}' })).changes).toBe(1);
        expect(
          off.prepare('SELECT card_id FROM lr_event WHERE event_id = :e').get({ e: String(eventRow(1).event_id) }),
        ).toEqual({ card_id: 'overwritten' });
      } finally {
        off.close();
      }
    });
  });
});
