import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMetrics } from '../../../src/metrics/metrics.js';
import type { OpenDbOptions, SqlitePort } from '../../../src/sqlite/sqlite.js';
import { classifySqliteError, ident, openDb, placeholders, sqlInt } from '../../../src/sqlite/sqlite.js';

let sandbox = '';
const opened: SqlitePort[] = [];

function open(file: string, opts: OpenDbOptions = { synchronous: 'NORMAL' }): SqlitePort {
  const db = openDb(path.join(sandbox, file), opts);
  opened.push(db);
  return db;
}

function pragmaValue(db: SqlitePort, name: string): unknown {
  const row = db.prepare(`PRAGMA ${name}`).get();
  return row === undefined ? undefined : Object.values(row)[0];
}

beforeEach(async () => {
  sandbox = await mkdtemp(path.join(tmpdir(), 'fathom-sk-sqlite-'));
});
afterEach(async () => {
  for (const db of opened.splice(0)) {
    db.close();
  }
  await rm(sandbox, { recursive: true, force: true });
});

describe('openDb', () => {
  it('UT-SK-001 모르는 옵션 키는 던지고 busy_timeout=5000·foreign_keys=1이다 [NFR-PORT-009]', () => {
    // Arrange / Act / Assert
    const extra: Record<string, unknown> = { synchronous: 'NORMAL', timeout: 0 };
    expect(() => openDb(path.join(sandbox, 'x.db'), extra as unknown as OpenDbOptions)).toThrow(
      /unknown option timeout/,
    );
    const bad: Record<string, unknown> = { synchronous: 'OFF' };
    expect(() => openDb(path.join(sandbox, 'y.db'), bad as unknown as OpenDbOptions)).toThrow(/synchronous/);
    const db = open('a.db');
    expect(pragmaValue(db, 'busy_timeout')).toBe(5000);
    expect(pragmaValue(db, 'foreign_keys')).toBe(1);
    expect(db.readOnly).toBe(false);
    expect(db.path).toBe(path.join(sandbox, 'a.db'));
  });

  it('UT-SK-070 synchronous NORMAL/FULL이 연결에 반영된다 [NFR-PORT-009]', () => {
    expect(pragmaValue(open('n.db', { synchronous: 'NORMAL' }), 'synchronous')).toBe(1);
    expect(pragmaValue(open('f.db', { synchronous: 'FULL' }), 'synchronous')).toBe(2);
  });

  it('UT-SK-071 recursiveTriggers 지정 시에만 ON이다 [NFR-PORT-009]', () => {
    expect(pragmaValue(open('r0.db'), 'recursive_triggers')).toBe(0);
    expect(pragmaValue(open('r1.db', { synchronous: 'FULL', recursiveTriggers: true }), 'recursive_triggers')).toBe(1);
  });

  it('UT-SK-072 쓰기 연결만 journal_size_limit=64MiB를 갖는다 [NFR-DATA-013]', () => {
    const rw = open('j.db');
    expect(pragmaValue(rw, 'journal_size_limit')).toBe(67108864);
    rw.exec('CREATE TABLE t(a INTEGER) STRICT');
    const ro = open('j.db', { readOnly: true, synchronous: 'NORMAL' });
    expect(ro.readOnly).toBe(true);
    expect(pragmaValue(ro, 'journal_size_limit')).not.toBe(67108864);
  });

  it('UT-SK-073 readOnly 연결의 쓰기는 readonly로 분류된다 [NFR-DATA-013]', () => {
    open('ro.db').exec('CREATE TABLE t(a INTEGER) STRICT');
    const ro = open('ro.db', { readOnly: true, synchronous: 'NORMAL' });
    let caught: unknown;
    try {
      ro.prepare('INSERT INTO t(a) VALUES (?)').run(1);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(classifySqliteError(caught).kind).toBe('readonly');
  });

  it('UT-SK-077 명명 바인딩과 위치 바인딩이 모두 동작한다 [NFR-DATA-006]', () => {
    const db = open('named.db');
    db.exec('CREATE TABLE t(a INTEGER, b TEXT) STRICT');
    expect(db.prepare('INSERT INTO t(a, b) VALUES (:a, :b)').run({ a: 1, b: 'x' }).changes).toBe(1);
    expect(db.prepare('INSERT INTO t(a, b) VALUES (?, ?)').run(2, 'y').changes).toBe(1);
    expect(db.prepare('SELECT b FROM t WHERE a = :a').get({ a: 2 })).toEqual({ b: 'y' });
    expect(db.prepare('SELECT a FROM t ORDER BY a').all()).toEqual([{ a: 1 }, { a: 2 }]);
    expect([...db.prepare('SELECT a FROM t ORDER BY a').iterate()].length).toBe(2);
    expect(db.prepare('SELECT a FROM t WHERE a = ?').get(99)).toBeUndefined();
  });

  it('UT-SK-078 close를 두 번 불러도 안전하다 [NFR-DATA-013]', () => {
    const db = open('close.db');
    db.close();
    expect(() => db.close()).not.toThrow();
    expect(() => db.prepare('SELECT 1')).toThrow();
  });

  it('UT-SK-079 fn은 결정적 사용자 함수를 등록한다 [NFR-DATA-013]', () => {
    const db = open('fn.db');
    db.fn('double_it', (x) => (typeof x === 'number' ? x * 2 : null), { deterministic: true });
    expect(db.prepare('SELECT double_it(?) AS v').get(21)).toEqual({ v: 42 });
    db.fn('plain_fn', () => 'ok');
    expect(db.prepare('SELECT plain_fn() AS v').get()).toEqual({ v: 'ok' });
  });
});

describe('바인딩 가드', () => {
  it('UT-SK-003 Date·boolean·undefined·{}는 위치·명명 모두 던지고 null·bigint·Uint8Array는 통과한다 [NFR-DATA-006]', () => {
    // Arrange
    const db = open('bind.db');
    db.exec('CREATE TABLE t(v) ');
    const ins = db.prepare('INSERT INTO t(v) VALUES (?)');
    const insNamed = db.prepare('INSERT INTO t(v) VALUES (:v)');
    const bad: unknown[] = [new Date(0), true, undefined, {}, () => 1, [1], Symbol('s')];
    // Act / Assert
    for (const value of bad) {
      expect(() => ins.run(value as never), `positional ${String(typeof value)}`).toThrow(
        /invariant: sqlite bind \w+ at 0/,
      );
      expect(() => insNamed.run({ v: value } as never), `named ${String(typeof value)}`).toThrow(
        /invariant: sqlite bind \w+ at v/,
      );
    }
    expect(() => ins.run(1, new Date(0) as never)).toThrow(/at 1/);
    expect(() => ins.get(true as never)).toThrow(/boolean at 0/);
    expect(() => ins.all(undefined as never)).toThrow(/undefined at 0/);
    expect(() => [...ins.iterate(new Date() as never)]).toThrow(/Date at 0/);
    expect(db.prepare('SELECT count(*) AS c FROM t').get()).toEqual({ c: 0 });
    expect(ins.run(null).changes).toBe(1);
    expect(ins.run(10n).changes).toBe(1);
    expect(ins.run(new Uint8Array([1, 2, 3])).changes).toBe(1);
    expect(ins.run(Buffer.from('ab')).changes).toBe(1);
    expect(insNamed.run({ v: null }).changes).toBe(1);
    expect(db.prepare('SELECT count(*) AS c FROM t').get()).toEqual({ c: 5 });
  });
});

describe('tx', () => {
  it('UT-SK-002 tx는 BEGIN IMMEDIATE이고 Promise 반환은 ROLLBACK 후 던지며 중첩은 던진다 [NFR-DATA-013]', () => {
    // Arrange
    const file = path.join(sandbox, 'tx.db');
    const db = open('tx.db');
    db.exec('CREATE TABLE t(a INTEGER) STRICT');
    const other = new DatabaseSync(file, { timeout: 0 });
    try {
      // Act: 쓰기 잠금이 tx 시작 시점에 잡힌다(지연 BEGIN이면 다른 연결의 BEGIN IMMEDIATE가 성공한다).
      let otherError: unknown;
      const value = db.tx(() => {
        try {
          other.exec('BEGIN IMMEDIATE');
        } catch (e) {
          otherError = e;
        }
        return db.prepare('INSERT INTO t(a) VALUES (?)').run(1).changes;
      });
      // Assert
      expect(value).toBe(1);
      expect(classifySqliteError(otherError).kind).toBe('busy');
      expect(db.prepare('SELECT count(*) AS c FROM t').get()).toEqual({ c: 1 });

      // Promise 반환
      expect(() => db.tx(() => Promise.resolve(1))).toThrow('invariant: tx fn returned a Promise');
      // 중첩
      expect(() => db.tx(() => db.tx(() => 1))).toThrow('invariant: nested tx');
      // 위 두 실패 뒤 연결은 깨끗하다
      expect(db.tx(() => db.prepare('INSERT INTO t(a) VALUES (?)').run(2).changes)).toBe(1);
      expect(db.prepare('SELECT count(*) AS c FROM t').get()).toEqual({ c: 2 });
    } finally {
      other.close();
    }

    // fn 예외 → ROLLBACK 후 원 오류 그대로
    const db2 = open('tx2.db');
    db2.exec('CREATE TABLE t(a INTEGER NOT NULL) STRICT');
    const boom = new Error('boom');
    let caught: unknown;
    try {
      db2.tx(() => {
        db2.prepare('INSERT INTO t(a) VALUES (?)').run(1);
        throw boom;
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(boom);
    expect(db2.prepare('SELECT count(*) AS c FROM t').get()).toEqual({ c: 0 });
    let constraint: unknown;
    try {
      db2.tx(() => db2.prepare('INSERT INTO t(a) VALUES (?)').run(null));
    } catch (e) {
      constraint = e;
    }
    expect(classifySqliteError(constraint).kind).toBe('constraint');
    expect(db2.prepare('SELECT count(*) AS c FROM t').get()).toEqual({ c: 0 });
  });

  it('UT-SK-080 readOnly 연결의 tx 안 쓰기는 readonly로 분류되고 연결에 열린 트랜잭션이 남지 않는다 [NFR-DATA-013]', () => {
    open('ro-tx.db').exec('CREATE TABLE t(a INTEGER) STRICT');
    const metrics = createMetrics();
    const ro = open('ro-tx.db', { readOnly: true, synchronous: 'NORMAL', metrics });
    let caught: unknown;
    try {
      ro.tx(() => ro.prepare('INSERT INTO t(a) VALUES (?)').run(1));
    } catch (e) {
      caught = e;
    }
    expect(classifySqliteError(caught).kind).toBe('readonly');
    // 같은 연결에서 읽기는 계속 된다(남은 BEGIN 없음).
    expect(ro.prepare('SELECT count(*) AS c FROM t').get()).toEqual({ c: 0 });
    expect(metrics.render()).toContain('sqlite_tx_duration_ms_count{db="ro-tx.db"} 1');
  });

  it('UT-SK-081 tx 소요 시간이 히스토그램에 라벨 db로 기록된다 [NFR-DATA-013]', () => {
    const metrics = createMetrics();
    const db = open('hist.db', { synchronous: 'NORMAL', metrics });
    db.exec('CREATE TABLE t(a INTEGER) STRICT');
    db.tx(() => db.prepare('INSERT INTO t(a) VALUES (?)').run(1));
    const text = metrics.render();
    expect(text).toContain('# TYPE sqlite_tx_duration_ms histogram');
    expect(text).toContain('sqlite_tx_duration_ms_count{db="hist.db"} 1');
    expect(text).toContain('sqlite_tx_duration_ms_bucket{db="hist.db",le="1000"} 1');
    const mem = openDb(':memory:', { synchronous: 'NORMAL', metrics });
    mem.tx(() => 1);
    mem.close();
    expect(metrics.render()).toContain('sqlite_tx_duration_ms_count{db="memory"} 1');
  });
});

describe('classifySqliteError', () => {
  it('UT-SK-004 5·6·19·8·517·기타·비 SQLite 오류를 분류한다 [NFR-AVL-011]', () => {
    const e = (errcode: number): Error => Object.assign(new Error('x'), { errcode });
    expect(classifySqliteError(e(5))).toEqual({ kind: 'busy', errcode: 5 });
    expect(classifySqliteError(e(261))).toEqual({ kind: 'busy', errcode: 261 }); // BUSY_RECOVERY
    expect(classifySqliteError(e(6))).toEqual({ kind: 'locked', errcode: 6 });
    expect(classifySqliteError(e(19))).toEqual({ kind: 'constraint', errcode: 19 });
    expect(classifySqliteError(e(1555))).toEqual({ kind: 'constraint', errcode: 1555 }); // PRIMARYKEY
    expect(classifySqliteError(e(8))).toEqual({ kind: 'readonly', errcode: 8 });
    expect(classifySqliteError(e(517))).toEqual({ kind: 'busy_snapshot', errcode: 517 });
    expect(classifySqliteError(e(1))).toEqual({ kind: 'other', errcode: 1 });
    expect(classifySqliteError(new Error('plain'))).toEqual({ kind: 'other', errcode: null });
    expect(classifySqliteError('str')).toEqual({ kind: 'other', errcode: null });
    expect(classifySqliteError(null)).toEqual({ kind: 'other', errcode: null });
    expect(classifySqliteError({ errcode: 'x' })).toEqual({ kind: 'other', errcode: null });

    // tx 안 517 → 재시도 0, sqlite_busy_snapshot_total +1
    const metrics = createMetrics();
    const db = open('snap.db', { synchronous: 'NORMAL', metrics });
    const injected = Object.assign(new Error('snapshot'), { errcode: 517 });
    let calls = 0;
    // Act
    let caught: unknown;
    try {
      db.tx(() => {
        calls += 1;
        throw injected;
      });
    } catch (e) {
      caught = e;
    }
    // Assert
    expect(caught).toBe(injected);
    expect(calls).toBe(1);
    expect(metrics.render()).toContain('sqlite_busy_snapshot_total{db="snap.db"} 1');
    expect(metrics.render()).not.toMatch(/sqlite_busy_total\{db="snap.db"\} [1-9]/);
    const busy = Object.assign(new Error('busy'), { errcode: 5 });
    expect(() =>
      db.tx(() => {
        throw busy;
      }),
    ).toThrow(busy);
    expect(metrics.render()).toContain('sqlite_busy_total{db="snap.db"} 1');
  });
});

describe('SQL 조각', () => {
  it('UT-SK-074 ident는 식별자만 인용한다 [NFR-DATA-006]', () => {
    expect(ident('lr_event')).toBe('"lr_event"');
    expect(ident('_a1')).toBe('"_a1"');
    for (const bad of ['', '1a', 'a b', 'a"b', 'a;b', 'a-b', 'é']) {
      expect(() => ident(bad), bad).toThrow(/ident invalid/);
    }
  });

  it('UT-SK-075 placeholders는 1~999만 허용한다 [NFR-DATA-006]', () => {
    expect(placeholders(1)).toBe('?');
    expect(placeholders(3)).toBe('?, ?, ?');
    expect(placeholders(999).split(', ').length).toBe(999);
    for (const bad of [0, 1000, -1, 1.5, Number.NaN]) {
      expect(() => placeholders(bad), String(bad)).toThrow(/placeholders/);
    }
  });

  it('UT-SK-076 sqlInt는 안전 정수만 허용한다 [NFR-DATA-006]', () => {
    expect(sqlInt(0)).toBe('0');
    expect(sqlInt(-5)).toBe('-5');
    expect(sqlInt(1179796308)).toBe('1179796308');
    for (const bad of [1.5, 2 ** 53, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => sqlInt(bad), String(bad)).toThrow(/safe integer/);
    }
  });
});
