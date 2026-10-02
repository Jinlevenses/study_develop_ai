import type { EventSourceLike } from '../../../../src/lib/sse.js';

/** 실네트워크 0 — SSE 프레임을 직접 쏘는 가짜 EventSource. */
export class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = [];
  readyState = 1;
  closed = false;
  readonly listeners = new Map<string, ((ev: Event) => void)[]>();
  readonly url: string;
  readonly init: EventSourceInit | undefined;
  constructor(url: string, init?: EventSourceInit) {
    this.url = url;
    this.init = init;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: (ev: Event) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close(): void {
    this.closed = true;
    this.readyState = 2;
  }
  emit(type: string, data: string, lastEventId = ''): void {
    for (const l of this.listeners.get(type) ?? []) {
      l(new MessageEvent(type, { data, lastEventId }));
    }
  }
  fail(readyState: 0 | 2): void {
    this.readyState = readyState;
    for (const l of this.listeners.get('error') ?? []) {
      l(new Event('error'));
    }
  }
}
