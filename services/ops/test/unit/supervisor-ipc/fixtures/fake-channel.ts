import type { IpcChannel } from '../../../../src/infra/supervisor-ipc/channel.js';

// 가짜 IPC 채널 — 보낸 메시지·on/off 호출을 기록하고, 테스트가 `emit`으로 supervisor 응답을 흉내 낸다.
export type FakeChannel = {
  readonly channel: IpcChannel;
  readonly sent: Record<string, unknown>[];
  readonly state: { connected: boolean; sendResult: boolean; sendThrows: boolean; on: number; off: number };
  emit(message: unknown): void;
  /** 마지막으로 보낸 요청의 id. */
  lastId(): string;
};

export function createFakeChannel(): FakeChannel {
  const listeners = new Set<(m: unknown) => void>();
  const sent: Record<string, unknown>[] = [];
  const state = { connected: true, sendResult: true, sendThrows: false, on: 0, off: 0 };
  const channel: IpcChannel = {
    send(msg: unknown): boolean {
      if (state.sendThrows) {
        throw new Error('channel closed');
      }
      sent.push(msg as Record<string, unknown>);
      return state.sendResult;
    },
    on(cb: (m: unknown) => void): void {
      state.on += 1;
      listeners.add(cb);
    },
    off(cb: (m: unknown) => void): void {
      state.off += 1;
      listeners.delete(cb);
    },
    connected: () => state.connected,
  };
  return {
    channel,
    sent,
    state,
    emit(message: unknown): void {
      for (const l of [...listeners]) {
        l(message);
      }
    },
    lastId(): string {
      const id = sent[sent.length - 1]?.id;
      if (typeof id !== 'string') {
        throw new Error('no request sent yet');
      }
      return id;
    },
  };
}

export const ALL_CURSORS = { gateway: 0, content: 0, learning: 0, 'ai-gateway': 0, 'ops-api': 0 } as const;

export const STATUS_ROW = {
  svc: 'learning',
  state: 'ready',
  pid: 4242,
  port: 4763,
  restarts_60s: 0,
  started_at: 1_790_000_000_000,
  last_exit_code: null,
} as const;
