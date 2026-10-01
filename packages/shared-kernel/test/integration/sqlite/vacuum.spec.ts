import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SqlitePort } from '../../../src/sqlite/sqlite.js';
import { openDb, vacuumInto } from '../../../src/sqlite/sqlite.js';

const WRITER = fileURLToPath(new URL('./fixtures/writer.ts', import.meta.url));
let sandbox = '';
const opened: SqlitePort[] = [];

beforeEach(async () => {
  sandbox = await mkdtemp(path.join(tmpdir(), 'fathom-sk-vacuum-'));
});
afterEach(async () => {
  for (const db of opened.splice(0)) {
    db.close();
  }
  await rm(sandbox, { recursive: true, force: true });
});

describe('vacuumInto', () => {
  it('UT-SK-098 쓰기가 진행되는 DB에서 사본을 만들고 integrity·sha256·bytes를 돌려준다 [NFR-DATA-003]', async () => {
    // Arrange: 별도 프로세스가 같은 파일에 계속 쓴다.
    const source = path.join(sandbox, 'live.db');
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '--conditions=source', '--disable-warning=ExperimentalWarning', WRITER, source],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    try {
      await new Promise<void>((resolve, reject) => {
        child.stdout.on('data', (chunk: Buffer) => {
          if (chunk.toString('utf8').includes('ready')) {
            resolve();
          }
        });
        child.once('error', reject);
        child.once('exit', (code) => reject(new Error(`writer exited early: ${String(code)}`)));
      });
      const ro = openDb(source, { readOnly: true, synchronous: 'NORMAL' });
      opened.push(ro);
      const dest = path.join(sandbox, 'copy.db');
      // Act
      const r = await vacuumInto(ro, dest);
      // Assert
      expect(r.ok).toBe(true);
      if (!r.ok) {
        return;
      }
      expect(r.value.path).toBe(dest);
      const bytes = await readFile(dest);
      expect(r.value.bytes).toBe(bytes.length);
      expect(r.value.bytes).toBe((await stat(dest)).size);
      expect(r.value.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
      const copy = openDb(dest, { readOnly: true, synchronous: 'NORMAL' });
      opened.push(copy);
      expect(copy.prepare('PRAGMA integrity_check').all()).toEqual([{ integrity_check: 'ok' }]);
      const count = copy.prepare('SELECT count(*) AS c FROM ev').get();
      expect(Number(count?.c)).toBeGreaterThan(0);
      // tmp 파일이 남지 않는다.
      expect((await readdir(sandbox)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    } finally {
      child.kill('SIGKILL');
      await once(child, 'exit');
    }
  });

  it('UT-SK-099 목적지가 이미 있으면 exists이고 원본 파일을 건드리지 않는다 [NFR-DATA-003]', async () => {
    const db = openDb(path.join(sandbox, 'src.db'), { synchronous: 'NORMAL' });
    opened.push(db);
    db.exec('CREATE TABLE t(a INTEGER) STRICT');
    const dest = path.join(sandbox, 'taken.db');
    await writeFile(dest, 'keep me');
    const r = await vacuumInto(db, dest);
    expect(r).toEqual({ ok: false, error: { reason: 'exists', detail: dest } });
    expect(await readFile(dest, 'utf8')).toBe('keep me');
    expect((await readdir(sandbox)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    // 존재하지 않는 디렉터리 → io
    const bad = await vacuumInto(db, path.join(sandbox, 'no', 'such', 'dir', 'x.db'));
    expect(bad).toMatchObject({ ok: false, error: { reason: 'io' } });
  });
});
