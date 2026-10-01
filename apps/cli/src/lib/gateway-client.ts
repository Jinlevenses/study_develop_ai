import { request } from 'node:http';
import { Problem } from '@fathom/contracts/common/problem';
import { parseJsonStrict } from '@fathom/shared-kernel/canonical/canonical';
import { homePath } from '@fathom/shared-kernel/config/config';
import type { Result } from '@fathom/shared-kernel/errors/errors';
import { err, ok } from '@fathom/shared-kernel/errors/errors';
import type { CliDeps } from './deps.js';

// IF-01 §2.1·§2.2·§2.11(cli 행) · Brief §4.2.6 — gateway는 `node:http`로 127.0.0.1에만 호출한다(fetch·undici 금지, STD-TS-44).
export const GATEWAY_TIMEOUT_MS = 5000;
const MAX_BODY_BYTES = 1024 * 1024;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const OPEN_URL_PATTERN = /^http:\/\/127\.0\.0\.1:\d+\/#bt=[A-Za-z0-9_-]{43}$/;

export type ProblemSummary = { readonly code: string; readonly title: string; readonly error_id: string };
export type GatewayResponse = {
  readonly status: number;
  /** 2xx이고 JSON일 때만 값이 있다(그 밖은 null). */
  readonly body: unknown;
  /** `application/problem+json`을 `Problem`으로 파싱한 결과. */
  readonly problem: ProblemSummary | null;
};
export type GatewayFailure = { readonly kind: 'connect' | 'timeout' | 'protocol' };
export type GatewayResult = Result<GatewayResponse, GatewayFailure>;

export interface GatewayClient {
  get(path: string): Promise<GatewayResult>;
  post(path: string, body: unknown, idempotencyKey: string): Promise<GatewayResult>;
}

/** `run/cli.token`을 읽어 검증한다. 없음·형식 오류 → `CLI-AUTH-001`. */
export async function readCliToken(
  home: string,
  deps: Pick<CliDeps, 'readText'>,
): Promise<Result<string, { code: 'CLI-AUTH-001' }>> {
  const text = await deps.readText(homePath(home, 'run', 'cli.token'));
  const token = text?.trim() ?? '';
  return TOKEN_PATTERN.test(token) ? ok(token) : err({ code: 'CLI-AUTH-001' });
}

/** `open_url`이 `http://127.0.0.1:<port>/#bt=<43자>`일 때만 그 값을 돌려준다. */
export function pickOpenUrl(body: unknown): Result<string, GatewayFailure> {
  const url = typeof body === 'object' && body !== null && 'open_url' in body ? body.open_url : undefined;
  return typeof url === 'string' && OPEN_URL_PATTERN.test(url) ? ok(url) : err({ kind: 'protocol' });
}

export type GatewayClientOptions = {
  readonly port: number;
  readonly token: string;
  readonly appVersion: string;
  readonly timeoutMs?: number;
};

function classify(response: { status: number; contentType: string; text: string }): GatewayResult {
  const isProblem = response.contentType.toLowerCase().startsWith('application/problem+json');
  let parsed: unknown = null;
  if (response.text !== '') {
    try {
      parsed = parseJsonStrict(response.text);
    } catch {
      return err({ kind: 'protocol' });
    }
  }
  if (isProblem) {
    const problem = Problem.safeParse(parsed);
    if (!problem.success) {
      return err({ kind: 'protocol' });
    }
    const { code, title, error_id } = problem.data;
    return ok({ status: response.status, body: null, problem: { code, title, error_id } });
  }
  const success = response.status >= 200 && response.status < 300;
  return ok({ status: response.status, body: success ? parsed : null, problem: null });
}

export function createGatewayClient(o: GatewayClientOptions): GatewayClient {
  const timeoutMs = o.timeoutMs ?? GATEWAY_TIMEOUT_MS;
  function call(
    method: 'GET' | 'POST',
    path: string,
    payload: string | null,
    key: string | null,
  ): Promise<GatewayResult> {
    return new Promise<GatewayResult>((resolve) => {
      const headers: Record<string, string> = {
        authorization: `Bearer ${o.token}`,
        accept: 'application/json',
        'x-fathom-client': `cli/${o.appVersion}`,
      };
      if (payload !== null && key !== null) {
        headers['idempotency-key'] = key;
        headers['content-type'] = 'application/json; charset=utf-8';
        headers['content-length'] = String(Buffer.byteLength(payload, 'utf8'));
      }
      let settled = false;
      // `timeout` 옵션은 소켓 유휴 시간일 뿐이다 — 몇 초마다 몇 바이트씩 흘리는 gateway에 매이지 않도록 요청 전체에 상한을 둔다.
      const total = setTimeout(() => {
        done(err({ kind: 'timeout' }));
        req.destroy();
      }, timeoutMs);
      const done = (r: GatewayResult): void => {
        if (!settled) {
          settled = true;
          clearTimeout(total);
          resolve(r);
        }
      };
      const req = request({ host: '127.0.0.1', port: o.port, method, path, headers, timeout: timeoutMs }, (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > MAX_BODY_BYTES) {
            req.destroy();
            done(err({ kind: 'protocol' }));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => {
          const contentType = res.headers['content-type'];
          done(
            classify({
              status: res.statusCode ?? 0,
              contentType: typeof contentType === 'string' ? contentType : '',
              text: Buffer.concat(chunks).toString('utf8'),
            }),
          );
        });
        res.on('error', () => done(err({ kind: 'protocol' })));
      });
      req.on('timeout', () => {
        done(err({ kind: 'timeout' }));
        req.destroy();
      });
      req.on('error', () => done(err({ kind: 'connect' })));
      req.end(payload ?? undefined);
    });
  }
  return {
    get: (path) => call('GET', path, null, null),
    post: (path, body, idempotencyKey) => call('POST', path, JSON.stringify(body), idempotencyKey),
  };
}
