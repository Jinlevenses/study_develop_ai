import type { ProcessPort } from './process-port.js';

// IPC 수신 큐 — 첫 메시지(부트스트랩 봉투)를 기다린 뒤 같은 채널을 서비스 런타임 처리기로 넘긴다.

export type FirstMessage =
  | { readonly kind: 'message'; readonly value: unknown }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'disconnected' };

export interface IpcInbox {
  first(timeoutMs: number): Promise<FirstMessage>;
  onMessage(handler: (m: unknown) => void): void;
  onDisconnect(handler: () => void): void;
}

export function createIpcInbox(port: ProcessPort): IpcInbox {
  let messageHandler: ((m: unknown) => void) | null = null;
  let disconnectHandler: (() => void) | null = null;
  let waiting: ((r: FirstMessage) => void) | null = null;
  let disconnected = false;
  const queued: unknown[] = [];

  port.onMessage((m: unknown) => {
    if (waiting !== null) {
      const resolve = waiting;
      waiting = null;
      resolve({ kind: 'message', value: m });
    } else if (messageHandler !== null) {
      messageHandler(m);
    } else {
      queued.push(m);
    }
  });
  port.onDisconnect(() => {
    disconnected = true;
    if (waiting !== null) {
      const resolve = waiting;
      waiting = null;
      resolve({ kind: 'disconnected' });
    } else {
      disconnectHandler?.();
    }
  });

  return {
    first(timeoutMs: number): Promise<FirstMessage> {
      const early = queued.shift();
      if (early !== undefined) {
        return Promise.resolve({ kind: 'message', value: early });
      }
      if (disconnected) {
        return Promise.resolve({ kind: 'disconnected' });
      }
      return new Promise<FirstMessage>((resolve) => {
        const timer = setTimeout(() => {
          if (waiting === settle) {
            waiting = null;
            resolve({ kind: 'timeout' });
          }
        }, timeoutMs);
        timer.unref();
        const settle = (r: FirstMessage): void => {
          clearTimeout(timer);
          resolve(r);
        };
        waiting = settle;
      });
    },
    onMessage(handler: (m: unknown) => void): void {
      messageHandler = handler;
      for (const m of queued.splice(0)) {
        handler(m);
      }
    },
    onDisconnect(handler: () => void): void {
      disconnectHandler = handler;
      if (disconnected) {
        handler();
      }
    },
  };
}
