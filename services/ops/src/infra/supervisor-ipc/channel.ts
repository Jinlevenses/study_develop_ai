// IF-IPC-008~017 — supervisor와의 IPC 채널 어댑터. 테스트는 이 인터페이스의 가짜를 쓴다.
export interface IpcChannel {
  send(msg: unknown): boolean;
  on(cb: (m: unknown) => void): void;
  off(cb: (m: unknown) => void): void;
  connected(): boolean;
}

/** `process.send`가 없으면(IPC 없이 기동) null. */
export function processIpcChannel(): IpcChannel | null {
  if (typeof process.send !== 'function') {
    return null;
  }
  return {
    send(msg: unknown): boolean {
      return process.send?.(msg) ?? false;
    },
    on(cb: (m: unknown) => void): void {
      process.on('message', cb);
    },
    off(cb: (m: unknown) => void): void {
      process.off('message', cb);
    },
    connected(): boolean {
      return process.connected === true;
    },
  };
}
