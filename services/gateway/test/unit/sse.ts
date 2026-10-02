import http from 'node:http';

// SSE 테스트 클라이언트 — 실 소켓(`node:http`)으로 연결해 프레임 텍스트를 모은다. Host는 gateway가 기대하는 값으로 덮어쓴다.

export type SseConn = {
  readonly status: number;
  readonly headers: http.IncomingHttpHeaders;
  text(): string;
  /** 누적 텍스트에 `needle`이 나타날 때까지 기다린다(이벤트 기반, 상한 5s). */
  waitFor(needle: string): Promise<void>;
  closed(): Promise<void>;
  close(): void;
};

export type SseResponse =
  | { kind: 'stream'; conn: SseConn }
  | { kind: 'problem'; status: number; body: string; headers: http.IncomingHttpHeaders };

export function openSse(port: number, headers: Record<string, string>): Promise<SseResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/api/v1/stream', method: 'GET', headers });
    req.on('error', reject);
    req.on('response', (res) => {
      if (!(res.headers['content-type'] ?? '').startsWith('text/event-stream')) {
        let body = '';
        res.on('data', (c: Buffer) => {
          body += c.toString('utf8');
        });
        res.on('end', () => resolve({ kind: 'problem', status: res.statusCode ?? 0, body, headers: res.headers }));
        return;
      }
      let acc = '';
      const waiters: { needle: string; ok: () => void }[] = [];
      let ended = false;
      const endWaiters: (() => void)[] = [];
      res.setEncoding('utf8');
      res.on('data', (c: string) => {
        acc += c;
        for (const w of [...waiters]) {
          if (acc.includes(w.needle)) {
            waiters.splice(waiters.indexOf(w), 1);
            w.ok();
          }
        }
      });
      const finish = (): void => {
        ended = true;
        for (const w of endWaiters.splice(0)) {
          w();
        }
      };
      res.on('end', finish);
      res.on('close', finish);
      res.on('error', finish);
      resolve({
        kind: 'stream',
        conn: {
          status: res.statusCode ?? 0,
          headers: res.headers,
          text: () => acc,
          waitFor: (needle) =>
            acc.includes(needle)
              ? Promise.resolve()
              : new Promise<void>((ok, fail) => {
                  const timer = setTimeout(
                    () => fail(new Error(`sse timeout waiting for ${needle}; got ${acc}`)),
                    5000,
                  );
                  timer.unref();
                  waiters.push({
                    needle,
                    ok: () => {
                      clearTimeout(timer);
                      ok();
                    },
                  });
                }),
          closed: () => (ended ? Promise.resolve() : new Promise<void>((ok) => endWaiters.push(ok))),
          close: () => {
            req.destroy();
          },
        },
      });
    });
    req.end();
  });
}
