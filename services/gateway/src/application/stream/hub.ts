import { AiMode } from '@fathom/contracts/common/domain';
import type { IntegrationEventEnvelope } from '@fathom/contracts/events/envelope';
import type { SseResync } from '@fathom/contracts/http/gateway/v1/stream';
import { SseEventData } from '@fathom/contracts/http/gateway/v1/stream';
import type { Result } from '@fathom/shared-kernel/errors/errors';
import { err, ok } from '@fathom/shared-kernel/errors/errors';
import type { Clock } from '@fathom/shared-kernel/time/time';
import { dataFrame, heartbeatFrame, helloFrame, resyncFrame, retryFrame } from './frames.js';
import type { RingEntry } from './ring.js';
import { createRing } from './ring.js';

// SSE 허브(IR-016) — notify inbox 이벤트를 링에 쌓고 연결된 모든 클라이언트에 중계한다. 상태는 메모리뿐이다(재시작 = 새 boot).

export type SseClient = { write(chunk: string): boolean; close(): void };

export interface SseHub {
  /** registerStream에서 1회. */
  attach(o: { readonly bootId: string; readonly appVersion: string; readonly clock: Clock }): void;
  /** notify inbox 콜백. */
  publish(events: readonly IntegrationEventEnvelope[]): void;
  open(
    client: SseClient,
    o: { readonly sid: string; readonly lastEventId: string | undefined },
  ): Result<() => void, 'too_many'>;
  activeStreams(): number;
  closeAll(): void;
}

type Attached = { readonly bootId: string; readonly appVersion: string; readonly clock: Clock };
type Connection = { readonly client: SseClient; readonly sid: string; stalled: number; release(): void };
type Plan =
  | { readonly kind: 'resume'; readonly seq: number; readonly replay: readonly RingEntry[] }
  | { readonly kind: 'resync'; readonly reason: SseResync['reason'] };

const LAST_EVENT_ID_RE = /^([0-9A-HJKMNP-TV-Z]{26})\.(\d{1,15})$/;

type HubOptions = {
  readonly ring: number;
  readonly heartbeatMs: number;
  readonly retryMs: number;
  readonly maxPerSession: number;
};
type Ring = ReturnType<typeof createRing>;
/** 허브 상태 — 함수들은 이 객체를 받아 쓴다(모듈 전역 0). */
type HubState = {
  readonly opts: HubOptions;
  readonly ring: Ring;
  readonly connections: Set<Connection>;
  attached: Attached | null;
  lastAiMode: AiMode; // FR-AI-003 첫 기동 = OFFLINE
};

function need(st: HubState): Attached {
  if (st.attached === null) {
    throw new Error('invariant: sse hub used before attach');
  }
  return st.attached;
}

/** 연속으로 `write()`가 false(백프레셔)를 돌려주면 느린 클라이언트로 보고 끊는다 — 버퍼가 무한히 자라지 않게(IR-016). */
export const MAX_STALLED_WRITES = 32;

function dropConnection(conn: Connection): void {
  conn.release();
  try {
    conn.client.close();
  } catch {
    // 이미 닫힌 소켓 — 해제만으로 충분하다
  }
}

function send(conn: Connection, chunk: string): void {
  try {
    if (conn.client.write(chunk)) {
      conn.stalled = 0;
      return;
    }
  } catch {
    conn.release(); // 쓰기 실패 = 연결 해제(STD-ASY-10)
    return;
  }
  conn.stalled += 1;
  if (conn.stalled >= MAX_STALLED_WRITES) {
    dropConnection(conn);
  }
}

/** `Last-Event-ID` 판정 — 형식 오류 → boot 다름 → 미래 seq → 링 밖 → 재개. */
function plan(ring: Ring, boot: string, lastEventId: string | undefined): Plan {
  const head = ring.head();
  if (lastEventId === undefined) {
    return { kind: 'resume', seq: head, replay: [] };
  }
  const m = LAST_EVENT_ID_RE.exec(lastEventId);
  if (m === null) {
    return { kind: 'resync', reason: 'unknown_last_event_id' };
  }
  const seq = Number(m[2]);
  if (m[1] !== boot) {
    return { kind: 'resync', reason: 'gateway_restarted' };
  }
  if (seq > head) {
    return { kind: 'resync', reason: 'unknown_last_event_id' };
  }
  if (seq < ring.oldest() - 1) {
    return { kind: 'resync', reason: 'ring_overflow' };
  }
  return { kind: 'resume', seq, replay: ring.after(seq) };
}

/** 이벤트 1건 — 검증 → 링 → ai 모드 기억 → 연결 전체에 송신. 링이 중복으로 거르면 송신 0. */
function relay(st: HubState, a: Attached, ev: IntegrationEventEnvelope): void {
  const data = SseEventData.parse({
    type: ev.type,
    schema_version: ev.schema_version,
    event_id: ev.event_id,
    occurred_at: ev.occurred_at,
    correlation_id: ev.correlation_id,
    producer: ev.producer,
    payload: ev.payload,
  });
  const entry = st.ring.push({ event_id: data.event_id, type: data.type, data: JSON.stringify(data) });
  if (entry === null) {
    return;
  }
  if (data.type === 'ai.mode.changed') {
    const mode = AiMode.safeParse(data.payload.mode);
    if (mode.success) {
      st.lastAiMode = mode.data;
    }
  }
  const frame = dataFrame(a.bootId, entry.seq, entry.type, entry.data);
  for (const conn of [...st.connections]) {
    send(conn, frame);
  }
}

function publish(st: HubState, events: readonly IntegrationEventEnvelope[]): void {
  const a = need(st);
  let failure: unknown = null;
  for (const ev of events) {
    try {
      relay(st, a, ev);
    } catch (e) {
      failure ??= e; // 한 이벤트의 결함이 나머지 중계를 막지 않게 끝까지 처리한 뒤 알린다
    }
  }
  if (failure !== null) {
    throw failure instanceof Error ? failure : new Error('invariant: sse publish failed');
  }
}

/** retry → hello → (resync | 재전송) 첫 출력 3단. */
function greet(st: HubState, a: Attached, conn: Connection, decided: Plan): void {
  const resume = decided.kind === 'resume' ? decided.seq : st.ring.head();
  send(conn, retryFrame(st.opts.retryMs));
  send(
    conn,
    helloFrame(a.bootId, resume, { serverTime: a.clock.now(), appVersion: a.appVersion, aiMode: st.lastAiMode }),
  );
  if (decided.kind === 'resync') {
    send(conn, resyncFrame(a.bootId, st.ring.head(), decided.reason));
    return;
  }
  for (const entry of decided.replay) {
    send(conn, dataFrame(a.bootId, entry.seq, entry.type, entry.data));
  }
}

function open(
  st: HubState,
  client: SseClient,
  opts: { readonly sid: string; readonly lastEventId: string | undefined },
): Result<() => void, 'too_many'> {
  const a = need(st);
  if ([...st.connections].filter((c) => c.sid === opts.sid).length >= st.opts.maxPerSession) {
    return err('too_many');
  }
  let timer: NodeJS.Timeout | null = null;
  const conn: Connection = {
    client,
    sid: opts.sid,
    stalled: 0,
    release(): void {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      st.connections.delete(conn);
    },
  };
  st.connections.add(conn);
  greet(st, a, conn, plan(st.ring, a.bootId, opts.lastEventId));
  if (st.connections.has(conn)) {
    timer = setInterval(() => send(conn, heartbeatFrame(a.clock.now())), st.opts.heartbeatMs);
    timer.unref();
  }
  return ok(() => conn.release());
}

function closeAll(st: HubState): void {
  for (const conn of [...st.connections]) {
    dropConnection(conn);
  }
}

export function createSseHub(o: HubOptions): SseHub {
  const st: HubState = {
    opts: o,
    ring: createRing(o.ring),
    connections: new Set(),
    attached: null,
    lastAiMode: 'OFFLINE',
  };
  return {
    attach(a): void {
      st.attached = a;
    },
    publish: (events) => publish(st, events),
    open: (client, opts) => open(st, client, opts),
    activeStreams: () => st.connections.size,
    closeAll: () => closeAll(st),
  };
}
