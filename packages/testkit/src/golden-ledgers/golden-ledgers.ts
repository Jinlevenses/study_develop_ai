import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Sha256Hex, Ulid } from '@fathom/contracts/common/ids';
import { EpochMs } from '@fathom/contracts/common/time';
import { LedgerEventEnvelope, LedgerEventType } from '@fathom/contracts/ledger/envelope';
import { z } from 'zod';

// CR-65 골든 원장(freeze_at INT-1b) 접근 헬퍼. 생성기 = services/learning/test/golden/ledger/generate-golden.ts.
// `fileURLToPath(new URL(...))`로 경로를 만든다 — `--conditions=source`(원본 .ts 해석) 전제.

export const GOLDEN_SETS = ['basic', 'two-device', 'corrections'] as const;
export type GoldenSet = (typeof GOLDEN_SETS)[number];

export function goldenLedgerPath(set: GoldenSet): string {
  return fileURLToPath(new URL(`./${set}/ledger.jsonl`, import.meta.url));
}
export function goldenMetaPath(set: GoldenSet): string {
  return fileURLToPath(new URL(`./${set}/meta.json`, import.meta.url));
}

// DB-01 §13.1 `fathom.ledger.v1` 줄 형식(파일 포맷 — contracts 계약이 아니라 이 헬퍼가 검증한다).
const Devices = z.record(Ulid, z.strictObject({ seq: z.number().int().min(1), head_hash: Sha256Hex }));
export const GoldenLedgerHeader = z.strictObject({
  kind: z.literal('header'),
  format: z.literal('fathom.ledger.v1'),
  app_version: z.string().min(1),
  created_at: EpochMs,
  source_device_id: Ulid.nullable(),
  since_checkpoint_id: Ulid.nullable(),
  checkpoint_id: Ulid.nullable(),
  devices: Devices,
  root_hash: Sha256Hex,
});
export type GoldenLedgerHeader = z.infer<typeof GoldenLedgerHeader>;
export const GoldenLedgerFooter = z.strictObject({
  kind: z.literal('footer'),
  events: z.number().int().min(0),
  lines_sha256: Sha256Hex,
});
export type GoldenLedgerFooter = z.infer<typeof GoldenLedgerFooter>;
const EventLine = z.strictObject({
  kind: z.literal('event'),
  event_id: Ulid,
  device_id: Ulid,
  device_seq: z.number().int().min(1),
  client_ts: EpochMs,
  type: LedgerEventType,
  schema_version: z.number().int().min(1),
  idempotency_key: z.string().min(3).max(200),
  payload: z.string().min(2),
  prev_hash: Sha256Hex,
  hash: Sha256Hex,
  experiment_arm: z.string().max(40).nullable(),
  ext: z.string().min(2),
});

export const GoldenMeta = z.strictObject({
  format: z.literal('fathom.golden-ledger.v1'),
  set: z.enum(GOLDEN_SETS),
  seed: z.number().int(),
  events: z.number().int().min(1),
  devices: Devices,
  root_hash: Sha256Hex,
  types: z.record(z.string(), z.number().int().min(1)),
  ledger_sha256: Sha256Hex,
  generated_by: z.string().min(1),
});
export type GoldenMeta = z.infer<typeof GoldenMeta>;

export type GoldenLedger = {
  readonly header: GoldenLedgerHeader;
  readonly events: LedgerEventEnvelope[];
  readonly footer: GoldenLedgerFooter;
};

/** 골든 원장 파일 → `{header, events, footer}`. 이벤트의 `payload`는 저장 문자열을 파싱한 객체, `recorded_at`은 헤더 `created_at`(수신 시각 대용)이다. */
export function readGoldenLedger(set: GoldenSet): GoldenLedger {
  const lines = readFileSync(goldenLedgerPath(set), 'utf8').split('\n');
  if (lines.at(-1) === '') {
    lines.pop();
  }
  const header = GoldenLedgerHeader.parse(JSON.parse(lines[0] ?? ''));
  const footer = GoldenLedgerFooter.parse(JSON.parse(lines.at(-1) ?? ''));
  const events = lines.slice(1, -1).map((line) => {
    const e = EventLine.parse(JSON.parse(line));
    return LedgerEventEnvelope.parse({
      event_id: e.event_id,
      device_id: e.device_id,
      device_seq: e.device_seq,
      client_ts: e.client_ts,
      type: e.type,
      schema_version: e.schema_version,
      idempotency_key: e.idempotency_key,
      payload: JSON.parse(e.payload),
      prev_hash: e.prev_hash,
      hash: e.hash,
      experiment_arm: e.experiment_arm,
      recorded_at: header.created_at,
    });
  });
  if (footer.events !== events.length) {
    throw new Error(`golden ledger ${set}: footer.events ${footer.events} !== ${events.length}`);
  }
  return { header, events, footer };
}

export function readGoldenMeta(set: GoldenSet): GoldenMeta {
  return GoldenMeta.parse(JSON.parse(readFileSync(goldenMetaPath(set), 'utf8')));
}
