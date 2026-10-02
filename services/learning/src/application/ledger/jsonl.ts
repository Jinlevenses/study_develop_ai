import { Sha256Hex, Ulid } from '@fathom/contracts/common/ids';
import { EpochMs } from '@fathom/contracts/common/time';
import { LedgerEventType } from '@fathom/contracts/ledger/envelope';
import { sha256Hex } from '@fathom/shared-kernel/canonical/canonical';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import { z } from 'zod';
import { LEDGER_EXPORT_ROWS } from '../../infra/ledger/ledger.sql.js';

// DB-01 §13.1 — 원장 JSONL(`fathom.ledger.v1`): header(앵커 ②) · event* · footer. 증분·병합·전량 공용.
// `payload`·`ext`는 저장된 정준 JSON 문자열 그대로(재직렬화 0 → 해시·체크섬 동일, D-19). 생성 열·recorded_at은 내보내지 않는다.
// 이 줄 형식은 파일 포맷이라 contracts 계약이 아니다 — 서비스 안에서 zod로만 검증한다.

export const LEDGER_JSONL_FORMAT = 'fathom.ledger.v1';

const DevicesMap = z.record(Ulid, z.strictObject({ seq: z.number().int().min(1), head_hash: Sha256Hex }));
export const LedgerJsonlHeader = z.strictObject({
  kind: z.literal('header'),
  format: z.literal(LEDGER_JSONL_FORMAT),
  app_version: z.string().min(1),
  created_at: EpochMs,
  source_device_id: Ulid.nullable(),
  since_checkpoint_id: Ulid.nullable(),
  checkpoint_id: Ulid.nullable(),
  devices: DevicesMap,
  root_hash: Sha256Hex,
});
export type LedgerJsonlHeader = z.infer<typeof LedgerJsonlHeader>;

export const LedgerJsonlEvent = z.strictObject({
  kind: z.literal('event'),
  event_id: Ulid,
  device_id: Ulid,
  device_seq: z.number().int().min(1),
  client_ts: EpochMs,
  type: LedgerEventType,
  schema_version: z.number().int().min(1),
  idempotency_key: z.string().min(3).max(200),
  payload: z.string().min(2), // 저장된 정준 JSON 문자열
  prev_hash: Sha256Hex,
  hash: Sha256Hex,
  experiment_arm: z.string().max(40).nullable(),
  ext: z.string().min(2),
});
export type LedgerJsonlEvent = z.infer<typeof LedgerJsonlEvent>;

export const LedgerJsonlFooter = z.strictObject({
  kind: z.literal('footer'),
  events: z.number().int().min(0),
  lines_sha256: Sha256Hex,
});
export type LedgerJsonlFooter = z.infer<typeof LedgerJsonlFooter>;

export type LedgerJsonl = {
  readonly header: LedgerJsonlHeader;
  readonly events: readonly LedgerJsonlEvent[];
  readonly footer: LedgerJsonlFooter;
};

/** 원장 → export 행(`(device_id, device_seq)` 순, 체인 검증 순서). `since`가 있으면 기기별 `device_seq > since[device].seq`만. */
export function readExportEvents(
  db: SqlitePort,
  since: Readonly<Record<string, { readonly seq: number }>> = {},
): LedgerJsonlEvent[] {
  const out: LedgerJsonlEvent[] = [];
  for (const r of db.prepare(LEDGER_EXPORT_ROWS).iterate()) {
    const deviceId = String(r.device_id);
    const seq = Number(r.device_seq);
    if (seq <= (since[deviceId]?.seq ?? 0)) {
      continue;
    }
    out.push(
      LedgerJsonlEvent.parse({
        kind: 'event',
        event_id: r.event_id,
        device_id: deviceId,
        device_seq: seq,
        client_ts: r.client_ts,
        type: r.type,
        schema_version: r.schema_version,
        idempotency_key: r.idempotency_key,
        payload: r.payload,
        prev_hash: r.prev_hash,
        hash: r.hash,
        experiment_arm: r.experiment_arm,
        ext: r.ext,
      }),
    );
  }
  return out;
}

/** header·event 줄 각각에 `\n`을 붙여 이은 바이트의 sha256(footer 절단 조기 탐지, D-20). */
export function linesSha256(headerLine: string, eventLines: readonly string[]): string {
  return sha256Hex([headerLine, ...eventLines].map((l) => `${l}\n`).join(''));
}

/** 줄 직렬화(키 순서 = 정의 순서, 결정적). `JSON.stringify`는 줄 모양만 만든다 — 해시 입력은 payload 문자열 그대로다. */
export function serializeLedgerJsonl(header: LedgerJsonlHeader, events: readonly LedgerJsonlEvent[]): string {
  const headerLine = JSON.stringify(LedgerJsonlHeader.parse(header));
  const eventLines = events.map((e) => JSON.stringify(LedgerJsonlEvent.parse(e)));
  const footer: LedgerJsonlFooter = {
    kind: 'footer',
    events: events.length,
    lines_sha256: linesSha256(headerLine, eventLines),
  };
  return [headerLine, ...eventLines, JSON.stringify(footer)].map((l) => `${l}\n`).join('');
}

/** 파서: header 1줄 → event* → footer 1줄, footer의 `events`·`lines_sha256` 대조. 실패 = throw(줄 번호만, 값 0). */
export function parseLedgerJsonl(text: string): LedgerJsonl {
  const lines = text.split('\n');
  if (lines.at(-1) === '') {
    lines.pop();
  }
  const fail = (reason: string, line: number): never => {
    throw new Error(`invariant: ledger jsonl ${reason} (line ${line})`);
  };
  if (lines.length < 2) {
    return fail('truncated: header and footer required', lines.length);
  }
  const headerLine = lines[0] ?? '';
  const header = LedgerJsonlHeader.safeParse(JSON.parse(headerLine));
  if (!header.success) {
    return fail('header invalid', 1);
  }
  const footerLine = lines.at(-1) ?? '';
  const footer = LedgerJsonlFooter.safeParse(JSON.parse(footerLine));
  if (!footer.success) {
    return fail('footer missing or invalid', lines.length);
  }
  const eventLines = lines.slice(1, -1);
  const events: LedgerJsonlEvent[] = [];
  eventLines.forEach((line, i) => {
    const parsed = LedgerJsonlEvent.safeParse(JSON.parse(line));
    if (!parsed.success) {
      fail('event invalid', i + 2);
      return;
    }
    events.push(parsed.data);
  });
  if (footer.data.events !== events.length) {
    return fail('footer event count mismatch', lines.length);
  }
  if (footer.data.lines_sha256 !== linesSha256(headerLine, eventLines)) {
    return fail('footer lines_sha256 mismatch', lines.length);
  }
  return { header: header.data, events, footer: footer.data };
}
