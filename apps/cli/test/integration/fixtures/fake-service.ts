// CLI 통합 fixture(Brief T-00-11 §5) — supervisor 서비스 프로토콜의 축소판. gateway 역할이면 CLI 라우트 3개를 `run/cli.token`으로 인증해 응답한다.
// services/ops 테스트 파일을 참조하지 않는다(단위 자립).
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { BootstrapEnvelope } from '@fathom/contracts/admin/ipc';
import { ulid } from '@fathom/shared-kernel/ids/ids';

function opt(name: string): string | null {
  const prefix = `--fx-${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length) ?? null;
}

process.on('disconnect', () => process.exit(0));
const exitCode = opt('exit');
if (exitCode !== null) {
  const code = Number(exitCode);
  if (code === 78) {
    process.send?.({ type: 'fatal', v: 1, exit_code: 78, code: 'fx_schema_needs_migrate' }, () => process.exit(78));
  } else {
    process.exit(code);
  }
} else {
  process.once('message', (raw: unknown) => {
    start(BootstrapEnvelope.parse(raw)).catch(() => process.exit(70));
  });
}

function problem(res: ServerResponse): void {
  res.writeHead(401, { 'content-type': 'application/problem+json' });
  res.end(
    JSON.stringify({
      type: 'urn:fathom:problem:gw-auth-007',
      title: 'CLI 인증에 실패했습니다',
      status: 401,
      code: 'GW-AUTH-007',
      error_id: ulid(),
      request_id: ulid(),
      retryable: false,
    }),
  );
}

function route(home: string, port: number, profile: string, req: IncomingMessage, res: ServerResponse): void {
  let expected = '';
  try {
    expected = readFileSync(path.join(home, 'run', 'cli.token'), 'utf8').trim();
  } catch {
    expected = '';
  }
  if (expected === '' || req.headers.authorization !== `Bearer ${expected}`) {
    problem(res);
    return;
  }
  const url = req.url ?? '';
  const json = (status: number, body: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.method === 'POST' && url === '/api/v1/cli/bootstrap-token') {
    json(201, { open_url: `http://127.0.0.1:${port}/#bt=${randomBytes(32).toString('base64url')}` });
  } else if (req.method === 'GET' && url === '/api/v1/cli/status') {
    json(200, { app_version: '0.0.0', profile, url: `http://127.0.0.1:${port}/` });
  } else {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{}');
  }
}

async function start(env: BootstrapEnvelope): Promise<void> {
  const server = createServer();
  const listenOn = (p: number): Promise<number> =>
    new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(p, '127.0.0.1', () => {
        server.off('error', reject);
        resolve((server.address() as AddressInfo).port);
      });
    });
  const port = await listenOn(env.listen.port).catch(() => listenOn(0));
  if (env.svc === 'gateway') {
    server.on('request', (req, res) => route(env.home, port, env.profile, req, res));
  }
  process.send?.({ type: 'listening', v: 1, port });
  process.send?.({
    type: 'ready',
    v: 1,
    contracts_hash: opt('hash') ?? env.contracts_hash,
    schema_versions: {},
    app_version: env.app_version,
  });
  process.on('message', (m: unknown) => {
    if (typeof m === 'object' && m !== null && 'type' in m && m.type === 'shutdown') {
      server.close(() => process.exit(0));
      server.closeAllConnections();
    }
  });
}
