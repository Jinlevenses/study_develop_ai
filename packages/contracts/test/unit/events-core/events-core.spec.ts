import { describe, expect, it } from 'vitest';
import { ConsumerManifest } from '../../../src/events/consumer-manifest.js';
import { EventType, IntegrationEventEnvelope } from '../../../src/events/envelope.js';
import { InboxAck, InboxDeliverRoute, InboxDelivery } from '../../../src/events/inbox.js';

const ULID_A = '01HZX3Y5K7M9N2P4Q6R8S0T1V2';
const ULID_B = '01J0A1B2C3D4E5F6G7H8J9K0M1';
const TRACEPARENT = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';

const envelope = (over: Record<string, unknown> = {}) => ({
  event_id: ULID_A,
  type: 'grading.verdict.issued',
  schema_version: 1,
  producer: 'content',
  producer_seq: 1,
  occurred_at: 1_759_000_000_000,
  correlation_id: ULID_B,
  causation_id: null,
  traceparent: null,
  payload: { any: ['thing', 1] },
  ...over,
});

describe('events/envelope', () => {
  it('UT-CON-001 IntegrationEventEnvelope는 미지 키를 거부하고 EventType 정규식을 강제한다 [NFR-MAINT-003][IF-COM-004]', () => {
    expect(IntegrationEventEnvelope.safeParse(envelope()).success).toBe(true);
    expect(IntegrationEventEnvelope.safeParse(envelope({ unknown_key: 1 })).success).toBe(false);

    for (const ok of ['catalog.pack.activated', 'grading.verdict.issued', 'ai.mode.changed']) {
      expect(EventType.safeParse(ok).success, ok).toBe(true);
    }
    for (const bad of ['Catalog.pack.activated', 'grading.verdict', 'ai.mode.changed2', 'a.b.c.d', 'ai-mode.x.y', '']) {
      expect(EventType.safeParse(bad).success, bad).toBe(false);
    }
    expect(IntegrationEventEnvelope.safeParse(envelope({ type: 'BadType' })).success).toBe(false);
  });

  it('UT-CON-055 envelope traceparent는 W3C 정규식이고 null을 허용한다 [NFR-DATA-013][IF-COM-004]', () => {
    expect(IntegrationEventEnvelope.safeParse(envelope({ traceparent: TRACEPARENT })).success).toBe(true);
    expect(
      IntegrationEventEnvelope.safeParse(
        envelope({ traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-00' }),
      ).success,
    ).toBe(true);
    expect(IntegrationEventEnvelope.safeParse(envelope({ traceparent: null })).success).toBe(true);
    for (const bad of [
      '',
      '01-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      '00-0AF7651916CD43DD8448EB211C80319C-b7ad6b7169203331-01',
      '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-02',
      '00-0af7651916cd43dd8448eb211c80319-b7ad6b7169203331-01',
      '00-0af7651916cd43dd8448eb211c80319c-b7ad6b716920333-01',
    ]) {
      expect(IntegrationEventEnvelope.safeParse(envelope({ traceparent: bad })).success, bad).toBe(false);
    }
    const { traceparent: _omit, ...without } = envelope();
    expect(IntegrationEventEnvelope.safeParse(without).success).toBe(false); // null은 허용하나 생략은 불가
  });

  it('UT-CON-056 envelope producer_seq·schema_version ≥ 1, ULID·producer 형식 [NFR-DATA-013][IF-COM-004]', () => {
    expect(IntegrationEventEnvelope.safeParse(envelope({ producer_seq: 1 })).success).toBe(true);
    expect(IntegrationEventEnvelope.safeParse(envelope({ producer_seq: 0 })).success).toBe(false);
    expect(IntegrationEventEnvelope.safeParse(envelope({ producer_seq: 1.5 })).success).toBe(false);
    expect(IntegrationEventEnvelope.safeParse(envelope({ schema_version: 0 })).success).toBe(false);
    expect(IntegrationEventEnvelope.safeParse(envelope({ producer: 'browser' })).success).toBe(false);
    expect(IntegrationEventEnvelope.safeParse(envelope({ event_id: 'abc' })).success).toBe(false);
    expect(IntegrationEventEnvelope.safeParse(envelope({ causation_id: ULID_B })).success).toBe(true);
    expect(IntegrationEventEnvelope.safeParse(envelope({ causation_id: 'x' })).success).toBe(false);
    expect(IntegrationEventEnvelope.safeParse(envelope({ occurred_at: -1 })).success).toBe(false);
    expect(IntegrationEventEnvelope.safeParse(envelope({ payload: [] })).success).toBe(false); // 최상위 배열 금지
    expect(IntegrationEventEnvelope.safeParse(envelope({ payload: {} })).success).toBe(true);
  });
});

describe('events/consumer-manifest', () => {
  const sub = (over: Record<string, unknown> = {}) => ({
    type: 'catalog.pack.activated',
    schema_versions: [1],
    mode: 'durable',
    on_poison: 'dead_letter',
    reads: ['pack_id', 'changed_concept_ids'],
    ...over,
  });

  it("UT-CON-057 ConsumerManifest reads는 '*'·'a.b_c' 통과, 'A' 거부 [NFR-DATA-013]", () => {
    expect(ConsumerManifest.safeParse({ consumer: 'learning', subscriptions: [sub()] }).success).toBe(true);
    expect(
      ConsumerManifest.safeParse({
        consumer: 'gateway',
        subscriptions: [sub({ mode: 'notify', on_poison: 'drop', reads: ['*'] })],
      }).success,
    ).toBe(true);
    expect(
      ConsumerManifest.safeParse({ consumer: 'learning', subscriptions: [sub({ reads: ['a.b_c'] })] }).success,
    ).toBe(true);
    for (const bad of ['A', 'a..b', '.a', 'a.', 'a-b', '1a', 'a.B']) {
      expect(
        ConsumerManifest.safeParse({ consumer: 'learning', subscriptions: [sub({ reads: [bad] })] }).success,
        bad,
      ).toBe(false);
    }
    expect(ConsumerManifest.safeParse({ consumer: 'learning', subscriptions: [sub({ reads: [] })] }).success).toBe(
      false,
    );
  });

  it('UT-CON-058 ConsumerManifest 구독은 40개까지이고 열거·strict를 강제한다 [NFR-DATA-013]', () => {
    expect(ConsumerManifest.safeParse({ consumer: 'learning', subscriptions: Array(40).fill(sub()) }).success).toBe(
      true,
    );
    expect(ConsumerManifest.safeParse({ consumer: 'learning', subscriptions: Array(41).fill(sub()) }).success).toBe(
      false,
    );
    expect(ConsumerManifest.safeParse({ consumer: 'learning', subscriptions: [] }).success).toBe(true);
    expect(ConsumerManifest.safeParse({ consumer: 'learning', subscriptions: [sub({ mode: 'push' })] }).success).toBe(
      false,
    );
    expect(
      ConsumerManifest.safeParse({ consumer: 'learning', subscriptions: [sub({ on_poison: 'skip' })] }).success,
    ).toBe(false);
    expect(
      ConsumerManifest.safeParse({ consumer: 'learning', subscriptions: [sub({ schema_versions: [] })] }).success,
    ).toBe(false);
    expect(
      ConsumerManifest.safeParse({ consumer: 'learning', subscriptions: [sub({ schema_versions: [0] })] }).success,
    ).toBe(false);
    expect(ConsumerManifest.safeParse({ consumer: 'learning', subscriptions: [sub({ type: 'Bad' })] }).success).toBe(
      false,
    );
    expect(ConsumerManifest.safeParse({ consumer: 'cli', subscriptions: [] }).success).toBe(false);
    expect(ConsumerManifest.safeParse({ consumer: 'learning', subscriptions: [], extra: 1 }).success).toBe(false);
    expect(ConsumerManifest.safeParse({ consumer: 'learning', subscriptions: [sub({ extra: 1 })] }).success).toBe(
      false,
    );
  });
});

describe('events/inbox', () => {
  it('UT-CON-059 InboxDelivery events는 1~100개다 [NFR-DATA-013][IF-COM-004]', () => {
    const ev = envelope();
    expect(InboxDelivery.safeParse({ producer: 'content', events: [ev] }).success).toBe(true);
    expect(InboxDelivery.safeParse({ producer: 'content', events: Array(100).fill(ev) }).success).toBe(true);
    expect(InboxDelivery.safeParse({ producer: 'content', events: [] }).success).toBe(false);
    expect(InboxDelivery.safeParse({ producer: 'content', events: Array(101).fill(ev) }).success).toBe(false);
    expect(InboxDelivery.safeParse({ producer: 'cli', events: [ev] }).success).toBe(false);
    expect(InboxDelivery.safeParse({ producer: 'content', events: [envelope({ extra: 1 })] }).success).toBe(false);
    expect(InboxDelivery.safeParse({ producer: 'content', events: [ev], extra: 1 }).success).toBe(false);
  });

  it('UT-CON-060 InboxAck.acked_through_seq는 비음 정수다 [NFR-DATA-013][IF-COM-004]', () => {
    expect(InboxAck.safeParse({ acked_through_seq: 0 }).success).toBe(true);
    expect(InboxAck.safeParse({ acked_through_seq: 42 }).success).toBe(true);
    expect(InboxAck.safeParse({ acked_through_seq: -1 }).success).toBe(false);
    expect(InboxAck.safeParse({ acked_through_seq: 1.5 }).success).toBe(false);
    expect(InboxAck.safeParse({}).success).toBe(false);
    expect(InboxAck.safeParse({ acked_through_seq: 1, extra: 1 }).success).toBe(false);
  });

  it('UT-CON-061 InboxDeliverRoute 메타가 IF-COM-004 표와 같다 [NFR-DATA-013][IF-COM-004]', () => {
    const r = InboxDeliverRoute;
    expect(r.id).toBe('common.inbox.deliver');
    expect(r.ifId).toBe('IF-COM-004');
    expect(r.method).toBe('POST');
    expect(r.path).toBe('/internal/v1/inbox');
    expect(r.allowedCallers).toEqual(['gateway', 'content', 'learning', 'ai-gateway', 'ops-api']);
    expect(r.idempotent).toBe(false);
    expect(r.paginated).toBe(false);
    expect(r.request.body).toBe(InboxDelivery);
    expect(r.response[200]).toBe(InboxAck);
    expect(r.bodyLimitBytes).toBe(8_388_608);
    expect(r.freeze).toBe('D');
    expect(r.slice).toBe('R0');
    expect(r.fr).toEqual([]);
  });
});
