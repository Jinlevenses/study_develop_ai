import { describe, expect, it } from 'vitest';
import {
  LEDGER_DEVICE_HEAD,
  LEDGER_FIND_CONFLICT,
  LEDGER_HEADS,
  LEDGER_REPLAY,
} from '../../../src/infra/ledger/ledger.sql.js';
import { LEDGER_INSERT } from '../../../src/infra/ledger/ledger-writer.js';
import { docSql, normalizeSql } from './support/doc-sql.js';

describe('DB-01 §6.3 SQL 전사', () => {
  it('UT-LR-069 LEDGER_INSERT·LEDGER_DEVICE_HEAD·LEDGER_FIND_CONFLICT·LEDGER_HEADS = 정본 문장 그대로 [NFR-DATA-001][NFR-DATA-013]', () => {
    for (const [name, sql] of [
      ['LEDGER_INSERT', LEDGER_INSERT],
      ['LEDGER_DEVICE_HEAD', LEDGER_DEVICE_HEAD],
      ['LEDGER_FIND_CONFLICT', LEDGER_FIND_CONFLICT],
      ['LEDGER_HEADS', LEDGER_HEADS],
    ] as const) {
      expect(normalizeSql(sql), name).toBe(normalizeSql(docSql(name)));
    }
  });

  it('UT-LR-069 LEDGER_REPLAY = 정본 + 포락 열(experiment_arm·recorded_at)만 추가, 순서는 총순서 [NFR-DATA-011]', () => {
    const doc = normalizeSql(docSql('LEDGER_REPLAY'));
    expect(doc).toContain('ORDER BY client_ts, device_id, device_seq');
    expect(normalizeSql(LEDGER_REPLAY).replace(', experiment_arm, recorded_at', '')).toBe(doc);
    expect(LEDGER_REPLAY).not.toMatch(/rowid/i);
  });
});
