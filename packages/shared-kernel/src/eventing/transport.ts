import http from 'node:http';
import type { Socket } from 'node:net';
import type { ServiceName } from '@fathom/contracts/common/ids';
import { Problem } from '@fathom/contracts/common/problem';
import type { InboxDelivery } from '@fathom/contracts/events/inbox';
import { InboxAck } from '@fathom/contracts/events/inbox';
import { parseJsonStrict } from '@fathom/shared-kernel/canonical/canonical';
import type { Result } from '@fathom/shared-kernel/errors/errors';
import { err, ok } from '@fathom/shared-kernel/errors/errors';
import { ulid } from '@fathom/shared-kernel/ids/ids';

// §4.1.6 [Brief 결정] relay 전용 `node:http` 클라이언트. inbox는 `x-fathom-delivery-attempt`(IF-01 §2.2)가 필요한데
// `PeerClientPort`에는 헤더 주입 수단이 없다. 범위는 `POST /internal/v1/inbox` 1개뿐이다. `fetch`·`undici` 금지.

export type DeliveryFailure = {
  readonly code: 'DEP-CONNECT' | 'DEP-TIMEOUT' | 'DEP-NOPEER' | 'INBOX-HALT' | 'CONTRACT' | `HTTP-${number}`;
  readonly acked_through_seq: number | null;
};
export type InboxTransport = {
  deliver(
    dest: ServiceName,
    body: InboxDelivery,
    attempt: number,
  ): Promise<Result<{ acked_through_seq: number }, DeliveryFailure>>;
};
export type InboxTransportOptions = {
  readonly selfToken: string;
  readonly baseUrl: (dest: ServiceName) => string | null;
  readonly httpRequest?: typeof import('node:http').request;
  readonly connectTimeoutMs?: number;
  readonly deadlineMs?: number;
};

const DEFAULT_CONNECT_TIMEOUT_MS = 300;
const DEFAULT_DEADLINE_MS = 5000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const INBOX_PATH = '/internal/v1/inbox';

type RawOutcome =
  | { readonly kind: 'response'; readonly status: number; readonly body: Buffer }
  | { readonly kind: 'fail'; readonly failure: 'connect' | 'timeout' | 'too_large' };

const failure = (code: DeliveryFailure['code'], acked: number | null = null): Result<never, DeliveryFailure> =>
  err({ code, acked_through_seq: acked });

export function createInboxTransport(opts: InboxTransportOptions): InboxTransport & { close(): void } {
  const request = opts.httpRequest ?? http.request;
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const connectTimeoutMs = opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const deadlineMs = opts.deadlineMs ?? DEFAULT_DEADLINE_MS;

  function send(target: URL, headers: Record<string, string>, payload: Buffer): Promise<RawOutcome> {
    return new Promise<RawOutcome>((resolve) => {
      let settled = false;
      let connectTimer: NodeJS.Timeout | undefined;
      let totalTimer: NodeJS.Timeout | undefined;
      const finish = (outcome: RawOutcome): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(connectTimer);
        clearTimeout(totalTimer);
        resolve(outcome);
      };
      const req = request(
        {
          host: target.hostname,
          port: target.port === '' ? 80 : Number(target.port),
          method: 'POST',
          path: INBOX_PATH,
          headers,
          agent,
        },
        (res: http.IncomingMessage) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_RESPONSE_BYTES) {
              res.destroy();
              req.destroy();
              finish({ kind: 'fail', failure: 'too_large' });
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () => {
            finish({ kind: 'response', status: res.statusCode ?? 0, body: Buffer.concat(chunks) });
          });
          res.on('error', () => {
            finish({ kind: 'fail', failure: 'connect' });
          });
          res.on('close', () => {
            // 본문이 끝나기 전에 연결이 끊김 — 'end' 뒤의 close는 이미 settled라 무시된다.
            finish({ kind: 'fail', failure: 'connect' });
          });
        },
      );
      req.on('socket', (socket: Socket) => {
        if (socket.connecting) {
          connectTimer = setTimeout(() => {
            req.destroy(new Error('connect timeout'));
          }, connectTimeoutMs);
          connectTimer.unref();
          socket.once('connect', () => {
            clearTimeout(connectTimer);
          });
        }
      });
      req.on('error', () => {
        finish({ kind: 'fail', failure: 'connect' });
      });
      totalTimer = setTimeout(() => {
        finish({ kind: 'fail', failure: 'timeout' });
        req.destroy(new Error('response timeout'));
      }, deadlineMs);
      totalTimer.unref();
      req.end(payload);
    });
  }

  function interpret(
    outcome: Extract<RawOutcome, { kind: 'response' }>,
  ): Result<{ acked_through_seq: number }, DeliveryFailure> {
    const text = outcome.body.toString('utf8');
    if (outcome.status === 200) {
      try {
        const ack = InboxAck.safeParse(parseJsonStrict(text));
        return ack.success ? ok({ acked_through_seq: ack.data.acked_through_seq }) : failure('CONTRACT');
      } catch {
        return failure('CONTRACT');
      }
    }
    if (outcome.status === 503) {
      try {
        const problem = Problem.safeParse(parseJsonStrict(text));
        if (problem.success && problem.data.code.endsWith('-DEP-910')) {
          return failure('INBOX-HALT', problem.data.acked_through_seq ?? null);
        }
      } catch {
        // 본문이 JSON이 아니면 일반 HTTP 실패로 분류한다.
      }
    }
    return failure(`HTTP-${outcome.status}`);
  }

  return {
    async deliver(dest, body, attempt): Promise<Result<{ acked_through_seq: number }, DeliveryFailure>> {
      const base = opts.baseUrl(dest);
      if (base === null) {
        return failure('DEP-NOPEER');
      }
      const payload = Buffer.from(JSON.stringify(body), 'utf8');
      const headers: Record<string, string> = {
        authorization: `Bearer ${opts.selfToken}`,
        'content-type': 'application/json; charset=utf-8',
        'content-length': String(payload.length),
        'x-request-id': ulid(),
        'x-fathom-delivery-attempt': String(attempt),
        'x-fathom-deadline-ms': String(deadlineMs),
      };
      const outcome = await send(new URL(base), headers, payload);
      if (outcome.kind === 'fail') {
        if (outcome.failure === 'timeout') {
          return failure('DEP-TIMEOUT');
        }
        return outcome.failure === 'too_large' ? failure('CONTRACT') : failure('DEP-CONNECT');
      }
      return interpret(outcome);
    },
    close(): void {
      agent.destroy();
    },
  };
}
