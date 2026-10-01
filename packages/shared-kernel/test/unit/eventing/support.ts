import { fileURLToPath } from 'node:url';
import type { FakeClock } from '@fathom/testkit/clock';
import { createFakeClock } from '@fathom/testkit/clock';
import { fixedUlid } from '@fathom/testkit/ids';
import { z } from 'zod';
import type { EventPayloadRegistry } from '../../../src/eventing/outbox.js';
import type { Logger } from '../../../src/log/log.js';
import { createLogger } from '../../../src/log/log.js';
import type { MetricsRegistry } from '../../../src/metrics/metrics.js';
import { createMetrics } from '../../../src/metrics/metrics.js';
import type { SqlitePort } from '../../../src/sqlite/sqlite.js';
import { migrate, openDb } from '../../../src/sqlite/sqlite.js';

export const INFRA_DIR = fileURLToPath(new URL('../../../infra-migrations/', import.meta.url));
export const APPLICATION_ID = 1_700_000_001;

/** `_infra` 0001~0003이 적용된 메모리 DB. */
export function openInfraDb(clock: FakeClock = createFakeClock()): SqlitePort {
  const db = openDb(':memory:', { synchronous: 'NORMAL' });
  const result = migrate(db, [{ module: '_infra', dir: INFRA_DIR }], {
    dryRun: false,
    profile: 'full',
    applicationId: APPLICATION_ID,
    clock,
  });
  if (!result.ok) {
    throw new Error(`test setup: migrate failed ${result.error.reason}`);
  }
  return db;
}

export type LogCapture = { readonly log: Logger; readonly lines: () => Record<string, unknown>[] };

export function captureLogger(
  clock: FakeClock = createFakeClock(),
  level: 'debug' | 'info' | 'warn' | 'error' = 'debug',
): LogCapture {
  const raw: string[] = [];
  const log = createLogger('content', {
    level,
    bootId: null,
    clock,
    destination: { write: (chunk: string) => void raw.push(chunk) },
  });
  return {
    log,
    lines: (): Record<string, unknown>[] =>
      raw.map((l): Record<string, unknown> => JSON.parse(l) as Record<string, unknown>),
  };
}

export const PayloadN = z.object({ n: z.number().int() }).strict();
export const PAYLOADS: EventPayloadRegistry = {
  'a.b.c': { 1: PayloadN },
  'x.y.z': { 1: PayloadN },
  'q.r.s': { 1: PayloadN, 2: z.object({ n: z.number().int(), m: z.string() }).strict() },
};

export const CORR = fixedUlid(1);
export const metricsText = (m: MetricsRegistry): string => m.render();
export { createMetrics };
export function seqOf(
  db: SqlitePort,
  sql: string,
  params: Record<string, number | string> = {},
): Record<string, unknown>[] {
  return db.prepare(sql).all(params);
}
