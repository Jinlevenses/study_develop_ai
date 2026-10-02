import { AiMode } from '@fathom/contracts/common/domain';
import { SseEventData } from '@fathom/contracts/http/gateway/v1/stream';
import type { IntegrationEventEnvelope } from '@fathom/contracts/events/envelope';
import type { Result } from '@fathom/shared-kernel/errors/errors';
import { err, ok } from '@fathom/shared-kernel/errors/errors';
import type { Clock } from '@fathom/shared-kernel/time/time';
import type { SseResync } from '@fathom/contracts/http/gateway/v1/stream';
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
type Connection = { readonly client: SseClient; readonly sid: string; release(): void };
type Plan =
  | { readonly kind: 'resume'; readonly seq: number; readonly replay: readonly RingEntry[] }
  | { readonly kind: 'resync'; readonly reason: SseResync['reason'] };

const LAST_EVENT_ID_RE = /^([0-9A-HJKMNP-TV-Z]{26})\.(\d{1,15})$/;

export function createSseHub(o: {
  readonly ring: number;
  readonly heartbeatMs: number;
  readonly retryMs: number;
  readonly maxPerSession: number;
}): SseHub {
  const ring = createRing(o.ring);
  const connections = new Set<Connection>();
  let attached: Attached | null = null;
  let lastAiMode: AiMode = 'OFFLINE'; // FR-AI-003 첫 기동

  const need = (): Attached => {
    if (attached === null) {
      throw new Error('invariant: sse hub used before attach');
    }
    return attached;
  };

  function send(conn: Connection, chunk: string): void {
    try {
      conn.client.write(chunk);
    } catch {
      conn.release(); // 쓰기 실패 = 연결 해제(STD-ASY-10)
    }
  }

  /** `Last-Event-ID` 판정 — 형식 오류 → boot 다름 → 미래 seq → 링 밖 → 재개. */
  function plan(boot: string, lastEventId: string | undefined): Plan {
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

  const countFor = (sid: string): number => [...connections].filter((c) => c.sid === sid).length;

  return {
    attach(a): void {
      attached = a;
    },
    publish(events): void {
      const a = need();
      let failure: unknown = null;
      for (const ev of events) {
        try {
          const data = SseEventData.parse({
            type: ev.type,
            schema_version: ev.schema_version,
            event_id: ev.event_id,
            occurred_at: ev.occurred_at,
            correlation_id: ev.correlation_id,
            producer: ev.producer,
            payload: ev.payload,
          });
          const entry = ring.push({ event_id: data.event_id, type: data.type, data: JSON.stringify(data) });
          if (entry === null) {
            continue;
          }
          if (data.type === 'ai.mode.changed') {
            const mode = AiMode.safeParse(data.payload.mode);
            if (mode.success) {
              lastAiMode = mode.data;
            }
          }
          const frame = dataFrame(a.bootId, entry.seq, entry.type, entry.data);
          for (const conn of [...connections]) {
            send(conn, frame);
          }
        } catch (e) {
          failure ??= e; // 한 이벤트의 결함이 나머지 중계를 막지 않게 끝까지 처리한 뒤 알린다
        }
      }
      if (failure !== null) {
        throw failure instanceof Error ? failure : new Error('invariant: sse publish failed');
      }
    },
    open(client, opts): Result<() => void, 'too_many'> {
      const a = need();
      if (countFor(opts.sid) >= o.maxPerSession) {
        return err('too_many');
      }
      let timer: NodeJS.Timeout | null = null;
      const conn: Connection = {
        client,
        sid: opts.sid,
        release(): void {
          if (timer !== null) {
            clearInterval(timer);
            timer = null;
          }
          connections.delete(conn);
        },
      };
      connections.add(conn);
      const decided = plan(a.bootId, opts.lastEventId);
      const resume = decided.kind === 'resume' ? decided.seq : ring.head();
      send(conn, retryFrame(o.retryMs));
      send(
        conn,
        helloFrame(a.bootId, resume, { serverTime: a.clock.now(), appVersion: a.appVersion, aiMode: lastAiMode }),
      );
      if (decided.kind === 'resync') {
        send(conn, resyncFrame(a.bootId, ring.head(), decided.reason));
      } else {
        for (const entry of decided.replay) {
          send(conn, dataFrame(a.bootId, entry.seq, entry.type, entry.data));
        }
      }
      if (connections.has(conn)) {
        timer = setInterval(() => send(conn, heartbeatFrame(a.clock.now())), o.heartbeatMs);
        timer.unref();
      }
      return ok(() => conn.release());
    },
    activeStreams: () => connections.size,
    closeAll(): void {
      for (const conn of [...connections]) {
        conn.release();
        try {
          conn.client.close();
        } catch {
          // 이미 닫힌 소켓 — 종료 경로이므로 무시한다
        }
      }
    },
  };
}
