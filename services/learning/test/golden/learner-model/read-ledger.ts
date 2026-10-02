import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { LedgerEventEnvelope } from '@fathom/contracts/ledger/envelope';
import { LedgerEventEnvelope as EnvelopeSchema } from '@fathom/contracts/ledger/envelope';
import { parseJsonStrict, sha256Hex } from '@fathom/shared-kernel/canonical/canonical';
import { REPO_ROOT } from '../../unit/learner-model/support/policy.js';

// 골든 원장(DB-01 §13.1 `fathom.ledger.v1` JSONL)을 직접 읽는다. T-01-02 헬퍼 모듈은 import하지 않는다(병렬 Task) — 파일 형식만 공유한다.
// event 줄의 payload는 정준 JSON **문자열** → JSON.parse 후 envelope 구성, recorded_at 없음 → 0.

export const GOLDEN_SET_NAMES = ['basic', 'two-device', 'corrections'] as const;
export type GoldenSetName = (typeof GOLDEN_SET_NAMES)[number];

export function goldenLedgerPath(set: GoldenSetName): string {
  return path.join(REPO_ROOT, 'packages/testkit/src/golden-ledgers', set, 'ledger.jsonl');
}

export function goldenLedgerPresent(set: GoldenSetName): boolean {
  return existsSync(goldenLedgerPath(set));
}

export type GoldenLedger = { readonly events: LedgerEventEnvelope[]; readonly sha256: string };

/** 파일이 없으면 null. 있으면 event 줄을 envelope로(계약 스키마 .strict() 검증) 읽는다. */
export function readGoldenLedger(set: GoldenSetName): GoldenLedger | null {
  const file = goldenLedgerPath(set);
  if (!existsSync(file)) {
    return null;
  }
  const text = readFileSync(file, 'utf8');
  const events: LedgerEventEnvelope[] = [];
  for (const line of text.split('\n')) {
    if (line === '') {
      continue;
    }
    const row = parseJsonStrict(line);
    if (typeof row !== 'object' || row === null || !('kind' in row) || row.kind !== 'event') {
      continue;
    }
    const { kind: _kind, ext: _ext, payload, ...rest } = row as Record<string, unknown>;
    if (typeof payload !== 'string') {
      throw new Error(`golden ${set}: event payload must be a JSON string`);
    }
    events.push(EnvelopeSchema.parse({ ...rest, payload: parseJsonStrict(payload), recorded_at: 0 }));
  }
  return { events, sha256: sha256Hex(text) };
}
