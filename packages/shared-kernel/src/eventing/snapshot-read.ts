import { ServiceName } from '@fathom/contracts/common/ids';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import { OUTBOX_HEAD } from './outbox.sql.js';
import { rowInt, rowStr } from './row.js';
import { SNAPSHOT_DELIVERY, SNAPSHOT_WATERMARK } from './timeline.sql.js';

export type EventingSnapshot = {
  readonly outbox_head_seq: number;
  readonly delivery: Record<ServiceName, number>;
  readonly inbox_watermark: Record<ServiceName, number>;
};

function zeroRecord(): Record<ServiceName, number> {
  return { gateway: 0, content: 0, learning: 0, 'ai-gateway': 0, 'ops-api': 0 };
}

/**
 * epoch 매니페스트용 값 — **사본 연결 전용**(ADR-013 §1-4: seq·커서·워터마크는 사본에서 읽는다).
 * `delivery`는 durable 행만, 두 레코드 모두 ServiceName 5키 전부를 0으로 채운다.
 */
export function readEventingSnapshot(copy: SqlitePort): EventingSnapshot {
  const head = copy.prepare(OUTBOX_HEAD).get();
  const delivery = zeroRecord();
  for (const row of copy.prepare(SNAPSHOT_DELIVERY).all()) {
    delivery[ServiceName.parse(rowStr(row, 'dest'))] = rowInt(row, 'last_acked_seq');
  }
  const inboxWatermark = zeroRecord();
  for (const row of copy.prepare(SNAPSHOT_WATERMARK).all()) {
    inboxWatermark[ServiceName.parse(rowStr(row, 'producer'))] = rowInt(row, 'last_producer_seq');
  }
  return {
    outbox_head_seq: head === undefined ? 0 : rowInt(head, 'head'),
    delivery,
    inbox_watermark: inboxWatermark,
  };
}
