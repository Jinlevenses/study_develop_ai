import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MigrationDir } from '../../../src/sqlite/sqlite.js';
import { readMigrationBundle } from '../../../src/sqlite/sqlite.js';

// T-01-01 §4.2-7 (CO-14 d) — 읽기 I/O 실패는 파일명 위반(name_invalid)·번호 빈틈(gap)이 아니라 io_error(78)다.

let sandbox = '';

beforeEach(async () => {
  sandbox = await mkdtemp(path.join(tmpdir(), 'fathom-sk-migrate-io-'));
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

describe('migrate 읽기 I/O 사유', () => {
  it('UT-SK-224 읽을 수 없는 파일(디렉터리가 .sql 이름) → reason io_error, exit 78, detail unreadable [NFR-DATA-006]', async () => {
    const dir = path.join(sandbox, 'mod');
    await mkdir(path.join(dir, '0001_a.sql'), { recursive: true });
    const r = readMigrationBundle([{ module: 'mod', dir }]);
    expect(r).toMatchObject({ ok: false, error: { reason: 'io_error', exitCode: 78 } });
    if (!r.ok) {
      expect(r.error.detail).toMatch(/^unreadable: /);
      expect(r.error.file).toContain('0001_a.sql');
    }
  });

  it('UT-SK-225 읽을 수 없는 디렉터리(없는 경로·파일) → io_error, exit 78 · 기존 사유(name_invalid·gap)는 그대로 [NFR-DATA-006]', async () => {
    const absent: MigrationDir[] = [{ module: 'mod', dir: path.join(sandbox, 'absent') }];
    expect(readMigrationBundle(absent)).toMatchObject({ ok: false, error: { reason: 'io_error', exitCode: 78 } });
    const asFile = path.join(sandbox, 'plain-file');
    await writeFile(asFile, 'x', 'utf8');
    const r = readMigrationBundle([{ module: 'mod', dir: asFile }]);
    expect(r).toMatchObject({ ok: false, error: { reason: 'io_error', exitCode: 78 } });
    if (!r.ok) {
      expect(r.error.detail).toMatch(/^migration directory unreadable: /);
    }
    // 읽기는 되지만 규칙을 어긴 경우는 종전 사유다.
    const dir = path.join(sandbox, 'mod');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, '1_a.sql'), '-- @fathom:module=mod version=1 kind=additive\nSELECT 1;\n', 'utf8');
    expect(readMigrationBundle([{ module: 'mod', dir }])).toMatchObject({
      ok: false,
      error: { reason: 'name_invalid' },
    });
    await rm(path.join(dir, '1_a.sql'));
    await writeFile(path.join(dir, '0002_b.sql'), '-- @fathom:module=mod version=2 kind=additive\nSELECT 2;\n', 'utf8');
    expect(readMigrationBundle([{ module: 'mod', dir }])).toMatchObject({ ok: false, error: { reason: 'gap' } });
  });
});
