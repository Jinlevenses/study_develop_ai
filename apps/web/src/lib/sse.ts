import type { AiMode as AiModeT } from '@fathom/contracts/common/domain';
import { AiMode } from '@fathom/contracts/common/domain';
import { EVENT_PAYLOADS } from '@fathom/contracts/events/registry.gen';
import { SessionStatusRoute } from '@fathom/contracts/http/gateway/v1/session';
import type { SseEventData as SseEventDataT } from '@fathom/contracts/http/gateway/v1/stream';
import { SseEventData, SseHello, SseResync } from '@fathom/contracts/http/gateway/v1/stream';
import type { ApiClient } from './api-client.js';
import { type Invalidation, invalidationsFor, SSE_EVENT_TYPES, type SseEventType } from './invalidation-map.js';

export type SseConnState = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface SseSnapshot {
  readonly state: SseConnState;
  readonly bootId: string | null;
  readonly aiMode: AiModeT;
  readonly lastEventId: string | null;
}

/** 브라우저 `EventSource`의 사용 부분집합 — 테스트는 가짜를 넘긴다(실네트워크 0). */
export interface EventSourceLike {
  readonly readyState: number;
  addEventListener(type: string, listener: (ev: Event) => void): void;
  close(): void;
}

export type ResyncReason = 'gateway_restarted' | 'ring_overflow' | 'unknown_last_event_id' | 'reconnected';

export interface SseDeps {
  readonly EventSourceCtor: new (url: string, init?: EventSourceInit) => EventSourceLike;
  readonly invalidate: (inv: Invalidation) => void;
  readonly api: ApiClient;
  readonly onSessionLost: (code: string) => void;
  readonly onResync: (reason: ResyncReason) => void;
  readonly onFlushAttempts: () => void;
  readonly setTimer: (fn: () => void, ms: number) => unknown;
  readonly clearTimer: (h: unknown) => void;
}

export interface SseConnection {
  start(): void;
  stop(): void;
  getSnapshot(): SseSnapshot;
  subscribe(listener: () => void): () => void;
  on(type: SseEventType, fn: (data: SseEventDataT) => void): () => void;
}

const STREAM_URL = '/api/v1/stream';
const READY_CONNECTING = 0;
const READY_CLOSED = 2;

interface Frame {
  readonly data: unknown;
  readonly lastEventId: string;
}

function readFrame(ev: Event): Frame | null {
  if (!(ev instanceof MessageEvent) || typeof ev.data !== 'string') {
    return null;
  }
  try {
    const data: unknown = JSON.parse(ev.data);
    return { data, lastEventId: ev.lastEventId };
  } catch {
    // 깨진 JSON 프레임 — 그 프레임만 버린다.
    return null;
  }
}

export function reconnectDelayMs(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** (attempt - 1));
}

export function createSseConnection(deps: SseDeps): SseConnection {
  let source: EventSourceLike | null = null;
  let snapshot: SseSnapshot = { state: 'closed', bootId: null, aiMode: 'OFFLINE', lastEventId: null };
  const listeners = new Set<() => void>();
  const handlers = new Map<SseEventType, Set<(data: SseEventDataT) => void>>();
  let manualRecreates = 0;
  let needsFullResync = false;
  let timer: unknown = null;
  let timerPending = false;

  function update(patch: Partial<SseSnapshot>): void {
    const next: SseSnapshot = { ...snapshot, ...patch };
    if (
      next.state === snapshot.state &&
      next.bootId === snapshot.bootId &&
      next.aiMode === snapshot.aiMode &&
      next.lastEventId === snapshot.lastEventId
    ) {
      return;
    }
    snapshot = next;
    for (const l of [...listeners]) {
      l();
    }
  }

  function trackEventId(frame: Frame): void {
    if (frame.lastEventId !== '') {
      update({ lastEventId: frame.lastEventId });
    }
  }

  function onHello(ev: Event): void {
    const frame = readFrame(ev);
    const hello = frame === null ? null : SseHello.safeParse(frame.data);
    if (frame === null || hello === null || !hello.success) {
      return;
    }
    manualRecreates = 0;
    update({ state: 'open', bootId: hello.data.boot_id, aiMode: hello.data.ai_mode });
    trackEventId(frame);
    if (needsFullResync) {
      needsFullResync = false;
      deps.invalidate('all');
      deps.onResync('reconnected');
    }
  }

  function onResync(ev: Event): void {
    const frame = readFrame(ev);
    const resync = frame === null ? null : SseResync.safeParse(frame.data);
    if (frame === null || resync === null || !resync.success) {
      return;
    }
    trackEventId(frame);
    deps.invalidate('all');
    deps.onResync(resync.data.reason);
  }

  function applySideEffects(type: SseEventType, data: SseEventDataT): void {
    if (type === 'ai.mode.changed') {
      const mode = AiMode.safeParse(data.payload.mode);
      if (mode.success) {
        update({ aiMode: mode.data });
      }
    } else if (type === 'ops.health.changed') {
      const health = EVENT_PAYLOADS['ops.health.changed'][1].safeParse(data.payload);
      if (health.success) {
        const ready = (svc: string): boolean => health.data.services.some((s) => s.svc === svc && s.state === 'ready');
        if (ready('content') && ready('learning')) {
          deps.onFlushAttempts();
        }
      }
    }
  }

  function onTyped(type: SseEventType, ev: Event): void {
    const frame = readFrame(ev);
    const parsed = frame === null ? null : SseEventData.safeParse(frame.data);
    if (frame === null || parsed === null || !parsed.success || parsed.data.type !== type) {
      return;
    }
    trackEventId(frame);
    deps.invalidate(invalidationsFor(type, parsed.data.schema_version, parsed.data.payload));
    applySideEffects(type, parsed.data);
    for (const fn of [...(handlers.get(type) ?? [])]) {
      fn(parsed.data);
    }
  }

  async function recover(): Promise<void> {
    update({ state: 'closed' });
    const status = await deps.api.call(SessionStatusRoute, {});
    if (!status.ok && status.kind === 'problem' && status.status === 401) {
      deps.onSessionLost(status.problem.code);
      return;
    }
    if (source === null || timerPending) {
      return;
    }
    manualRecreates += 1;
    timerPending = true;
    timer = deps.setTimer(() => {
      timerPending = false;
      timer = null;
      if (source === null) {
        return;
      }
      needsFullResync = true;
      open('reconnecting');
    }, reconnectDelayMs(manualRecreates));
  }

  function onError(es: EventSourceLike): void {
    if (es !== source) {
      return;
    }
    if (es.readyState === READY_CONNECTING) {
      update({ state: 'reconnecting' });
    } else if (es.readyState === READY_CLOSED) {
      void recover();
    }
  }

  function open(state: SseConnState): void {
    source?.close();
    const es = new deps.EventSourceCtor(STREAM_URL, { withCredentials: true });
    source = es;
    update({ state });
    es.addEventListener('hello', onHello);
    es.addEventListener('resync', onResync);
    for (const type of SSE_EVENT_TYPES) {
      es.addEventListener(type, (ev) => {
        if (es === source) {
          onTyped(type, ev);
        }
      });
    }
    es.addEventListener('error', () => onError(es));
  }

  return {
    start(): void {
      if (source === null) {
        open('connecting');
      }
    },
    stop(): void {
      if (timer !== null) {
        deps.clearTimer(timer);
        timer = null;
      }
      timerPending = false;
      source?.close();
      source = null;
      update({ state: 'closed' });
    },
    getSnapshot(): SseSnapshot {
      return snapshot;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    on(type: SseEventType, fn: (data: SseEventDataT) => void): () => void {
      const set = handlers.get(type) ?? new Set<(data: SseEventDataT) => void>();
      set.add(fn);
      handlers.set(type, set);
      return () => {
        set.delete(fn);
      };
    },
  };
}
