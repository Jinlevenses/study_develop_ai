import { createFakeClock } from '@fathom/testkit/clock';
import { createUlidSequence, fixedUlid } from '@fathom/testkit/ids';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../../src/canonical/canonical.js';
import { appendEvent, createOutbox } from '../../../src/eventing/outbox.js';
import { CORR, openInfraDb, PAYLOADS } from './support.js';

function setup(over: { onAppended?: () => void; traceparent?: string | null } = {}) {
  const clock = createFakeClock();
  const db = openInfraDb(clock);
  const outbox = createOutbox({
    db,
    svc: 'content',
    clock,
    payloads: PAYLOADS,
    currentTraceparent: () => over.traceparent ?? null,
    onAppended: over.onAppended ?? ((): void => undefined),
    newId: createUlidSequence(100),
  });
  return { clock, db, outbox };
}

describe('appendEvent / createOutbox', () => {
  it('UT-SK-140 바깥 tx 롤백 → outbox 0행, 커밋 → payload = 정준 JSON·traceparent = 컨텍스트 값·seq 증가 [NFR-DATA-013][IF-COM-004]', () => {
    // Arrange
    const tp = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
    const { db, outbox, clock } = setup({ traceparent: tp });
    // Act: 롤백
    expect(() =>
      db.tx(() => {
        appendEvent(outbox, { type: 'a.b.c', schema_version: 1, correlation_id: CORR, payload: { n: 1 } });
        throw new Error('boom');
      }),
    ).toThrow('boom');
    // Assert
    expect(db.prepare('SELECT count(*) AS n FROM outbox').get()).toEqual({ n: 0 });
    // Act: 커밋 2건
    const first = db.tx(() =>
      appendEvent(outbox, {
        type: 'a.b.c',
        schema_version: 1,
        correlation_id: CORR,
        causation_id: fixedUlid(9),
        payload: { n: 1 },
      }),
    );
    clock.advance(5);
    const second = db.tx(() =>
      outbox.append({ type: 'q.r.s', schema_version: 2, correlation_id: CORR, payload: { m: 'x', n: 2 } }),
    );
    // Assert
    expect(second.seq).toBe(first.seq + 1);
    expect(first.event_id).toBe(fixedUlid(101)); // 100은 롤백된 시도가 썼다
    const rows = db
      .prepare(
        'SELECT seq, event_id, type, schema_version, occurred_at, causation_id, traceparent, payload FROM outbox ORDER BY seq',
      )
      .all();
    expect(rows[0]).toMatchObject({
      type: 'a.b.c',
      traceparent: tp,
      causation_id: fixedUlid(9),
      occurred_at: clock.now() - 5,
    });
    expect(rows[1]).toMatchObject({ payload: canonicalJson({ m: 'x', n: 2 }), causation_id: null });
    expect(rows[1]?.payload).toBe('{"m":"x","n":2}');
  });

  it('UT-SK-141 미등록 type/version·payload 위반·비 ULID correlation/causation → 던진다 [NFR-DATA-013]', () => {
    // Arrange
    const { db, outbox } = setup();
    const bad =
      (input: Parameters<typeof appendEvent>[1]): (() => void) =>
      () =>
        db.tx(() => appendEvent(outbox, input));
    // Act / Assert
    expect(bad({ type: 'no.such.type', schema_version: 1, correlation_id: CORR, payload: {} })).toThrow(
      /unknown event no\.such\.type@v1/,
    );
    expect(bad({ type: 'a.b.c', schema_version: 9, correlation_id: CORR, payload: { n: 1 } })).toThrow(
      /unknown event a\.b\.c@v9/,
    );
    expect(bad({ type: 'a.b.c', schema_version: 1, correlation_id: CORR, payload: { n: 'x' } })).toThrow(
      /payload invalid/,
    );
    expect(bad({ type: 'a.b.c', schema_version: 1, correlation_id: 'not-a-ulid', payload: { n: 1 } })).toThrow(
      /correlation_id/,
    );
    expect(
      bad({ type: 'a.b.c', schema_version: 1, correlation_id: CORR, causation_id: 'x', payload: { n: 1 } }),
    ).toThrow(/causation_id/);
    expect(db.prepare('SELECT count(*) AS n FROM outbox').get()).toEqual({ n: 0 });
    // 위반 payload의 원인은 cause로 보존된다
    try {
      db.tx(() => appendEvent(outbox, { type: 'a.b.c', schema_version: 1, correlation_id: CORR, payload: { n: 'x' } }));
    } catch (e) {
      expect(e instanceof Error && e.cause instanceof Error).toBe(true);
    }
  });
});
