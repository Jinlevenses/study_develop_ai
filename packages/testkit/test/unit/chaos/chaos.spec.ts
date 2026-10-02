import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '@fathom/shared-kernel/sqlite/sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { killService, lockGate, pauseService, readRows, waitForRow } from '../../../src/chaos.js';

const pidOf = (pid: number) => (): Promise<number> => Promise.resolve(pid);
const failingPidOf = (): Promise<number> => Promise.reject(new Error('spawn-stack: not_running: x'));

describe('chaos 신호', () => {
  it('UT-TK-062 killService는 기본 SIGKILL·지정 신호를 보내고 pidOf 실패를 전파한다 [NFR-AVL-002]', async () => {
    // Arrange
    const sent: [number, string][] = [];
    const signal = (pid: number, sig: NodeJS.Signals): void => {
      sent.push([pid, sig]);
    };
    // Act
    const a = await killService({ pidOf: pidOf(321) }, 'content', undefined, { signal });
    await killService({ pidOf: pidOf(322) }, 'learning', { signal: 'SIGTERM' }, { signal });
    // Assert
    expect(a).toEqual({ pid: 321 });
    expect(sent).toEqual([
      [321, 'SIGKILL'],
      [322, 'SIGTERM'],
    ]);
    await expect(killService({ pidOf: failingPidOf }, 'gateway', undefined, { signal })).rejects.toThrow('not_running');
    expect(sent).toHaveLength(2);
  });

  it('UT-TK-063 pauseService는 SIGSTOP 후 resume이 SIGCONT를 1회만 보내고 win32는 unsupported_platform이다 [NFR-AVL-002]', async () => {
    // Arrange
    const sent: [number, string][] = [];
    const signal = (pid: number, sig: NodeJS.Signals): void => {
      sent.push([pid, sig]);
    };
    // Act
    const paused = await pauseService({ pidOf: pidOf(77) }, 'ai-gateway', { signal, platform: 'linux' });
    expect(sent).toEqual([[77, 'SIGSTOP']]);
    paused.resume();
    paused.resume();
    // Assert
    expect(sent).toEqual([
      [77, 'SIGSTOP'],
      [77, 'SIGCONT'],
    ]);
    await expect(pauseService({ pidOf: pidOf(77) }, 'content', { signal, platform: 'win32' })).rejects.toThrow(
      'chaos: unsupported_platform',
    );
    expect(sent).toHaveLength(2);
  });
});

describe('chaos DB', () => {
  let dir = '';
  let dbPath = '';

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'fathom-chaos-'));
    dbPath = path.join(dir, 't.db');
    const raw = new DatabaseSync(dbPath);
    raw.exec('PRAGMA journal_mode=WAL');
    raw.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL)');
    raw.exec("INSERT INTO t (id, v) VALUES (1, 'a')");
    raw.close();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function insertLater(id: number, delayMs: number): void {
    setTimeout(() => {
      const w = openDb(dbPath, { synchronous: 'NORMAL' });
      try {
        w.prepare('INSERT INTO t (id, v) VALUES (?, ?)').run(id, 'late');
      } finally {
        w.close();
      }
    }, delayMs);
  }

  it('UT-TK-064 readRows·waitForRow는 SELECT/WITH만 허용하고 다른 연결의 삽입을 기다리며 시간 초과 시 wait_timeout이다 [NFR-AVL-002][NFR-DATA-013]', async () => {
    // Arrange / Act
    const rows = await readRows(dbPath, 'SELECT id, v FROM t WHERE id = ?', [1]);
    const cte = await readRows(dbPath, ' with x AS (SELECT 1 AS n) SELECT n FROM x');
    // Assert
    expect(rows).toEqual([{ id: 1, v: 'a' }]);
    expect(cte).toEqual([{ n: 1 }]);
    await expect(readRows(dbPath, "INSERT INTO t (id, v) VALUES (9, 'x')")).rejects.toThrow(
      'invariant: chaos read is SELECT only',
    );
    await expect(readRows(dbPath, 'DELETE FROM t')).rejects.toThrow('SELECT only');
    insertLater(2, 100);
    const found = await waitForRow(dbPath, 'SELECT id FROM t WHERE id = ?', [2], { timeoutMs: 5000 });
    expect(found).toEqual([{ id: 2 }]);
    const timeout = await waitForRow(dbPath, 'SELECT id FROM t WHERE id = ?', [99], { timeoutMs: 150 }).catch(
      (e: unknown) => e,
    );
    expect(timeout).toBeInstanceOf(Error);
    expect(timeout instanceof Error ? timeout.message : '').toContain('chaos: wait_timeout');
    expect(timeout instanceof Error ? timeout.cause : null).toEqual([]);
    expect(await readRows(dbPath, 'SELECT count(*) AS n FROM t')).toEqual([{ n: 2 }]);
  });

  it('UT-TK-065 lockGate는 쓰기 잠금을 쥐고 release 후 다른 연결의 tx 쓰기가 성공하며 데이터를 바꾸지 않는다 [NFR-AVL-002]', async () => {
    // Arrange
    const before = await readRows(dbPath, 'SELECT count(*) AS n FROM t');
    // Act
    const gate = await lockGate(dbPath);
    // Assert: 보유 중 WAL readOnly 읽기 가능
    expect(gate.held).toBe(true);
    expect(await readRows(dbPath, 'SELECT count(*) AS n FROM t')).toEqual(before);
    const blocked = openDb(dbPath, { synchronous: 'NORMAL' });
    blocked.exec('PRAGMA busy_timeout=50');
    expect(() => blocked.exec("INSERT INTO t (id, v) VALUES (5, 'x')")).toThrow();
    blocked.close();
    gate.release();
    gate.release();
    const writer = openDb(dbPath, { synchronous: 'NORMAL' });
    writer.tx(() => writer.prepare('INSERT INTO t (id, v) VALUES (?, ?)').run(6, 'after'));
    writer.close();
    expect(await readRows(dbPath, 'SELECT id FROM t ORDER BY id')).toEqual([{ id: 1 }, { id: 6 }]);
  });

  it('UT-TK-066 waitForRow는 predicate를 따르고 intervalMs를 50으로 제한한다 [NFR-AVL-002]', async () => {
    // Arrange
    insertLater(3, 120);
    insertLater(4, 130);
    // Act
    const rows = await waitForRow(dbPath, 'SELECT id FROM t ORDER BY id', [], {
      timeoutMs: 5000,
      intervalMs: 500,
      predicate: (r) => r.length >= 3,
    });
    // Assert
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const t0 = performance.now();
    await waitForRow(dbPath, 'SELECT id FROM t WHERE id = ?', [777], { timeoutMs: 400, intervalMs: 5000 }).catch(
      () => undefined,
    );
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});
