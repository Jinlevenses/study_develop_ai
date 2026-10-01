// 통합 fixture(Brief T-00-11 §5) — T-00-08 서비스 프로토콜(봉투 → listen → listening → ready, shutdown·disconnect → exit 0)을 흉내 내는 자립 스크립트.
import { fork, spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { BootstrapEnvelope } from '@fathom/contracts/admin/ipc';
import { ulid } from '@fathom/shared-kernel/ids/ids';

function opt(name: string): string | null {
  const prefix = `--fx-${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (hit !== undefined) {
    return hit.slice(prefix.length);
  }
  return process.argv.includes(`--fx-${name}`) ? '' : null;
}
const mode = process.argv.find((a) => a.startsWith('--mode='))?.slice('--mode='.length) ?? 'serve';

function log(msg: string, extra: Record<string, unknown> = {}): void {
  process.stdout.write(`${JSON.stringify({ ts: Date.now(), level: 'info', svc: 'fixture', msg, ...extra })}\n`);
}
function send(msg: Record<string, unknown>): void {
  process.send?.(msg);
}

if (opt('role') === 'grandchild') {
  process.on('disconnect', () => process.exit(0));
  setInterval(() => undefined, 1000);
} else if (mode !== 'serve') {
  log(`fixture.${mode}.done`, { argv: process.argv.slice(2) });
  process.stderr.write(`fixture ${mode} stderr line\n`);
  process.exit(0);
} else {
  runService();
}

function runService(): void {
  process.on('disconnect', () => process.exit(0));
  const exitCode = opt('exit');
  if (exitCode !== null && exitCode !== '') {
    const code = Number(exitCode);
    if (code === 78) {
      process.send?.({ type: 'fatal', v: 1, exit_code: 78, code: 'fx_schema_needs_migrate' }, () => process.exit(78));
    } else {
      process.exit(code);
    }
    return;
  }
  process.once('message', (raw: unknown) => {
    const env = BootstrapEnvelope.parse(raw);
    start(env).catch(() => process.exit(70));
  });
}

async function start(env: BootstrapEnvelope): Promise<void> {
  const server = createServer((_req, res) => res.end('ok'));
  const port = await listen(server, env.listen.port);
  send({ type: 'listening', v: 1, port });
  log('fixture.ready', {
    after_crash: env.flags.after_crash,
    safe_mode: env.flags.safe_mode,
    batch_enabled: env.flags.batch_enabled,
    boot_id: env.boot_id,
    port,
    fx_svc: env.svc,
  });
  send({
    type: 'ready',
    v: 1,
    contracts_hash: opt('hash') ?? env.contracts_hash,
    schema_versions: {},
    app_version: env.app_version,
  });
  process.on('message', (m: unknown) => onMessage(m, server));
  report(env, port);
  const crashAfter = opt('crash-after-ms');
  if (crashAfter !== null) {
    setTimeout(() => process.exit(1), Number(crashAfter));
  }
  if (opt('raw-line') !== null) {
    process.stdout.write('NATIVE CRASH output (not json)\n');
  }
  if (opt('grandchild') !== null) {
    const gc = fork(new URL(import.meta.url).pathname, ['--fx-role=grandchild'], { execArgv: process.execArgv });
    gc.on('error', () => undefined);
    log('fixture.grandchild', { pid: gc.pid });
  }
  if (opt('sqlite') !== null) {
    await import('node:sqlite');
    const code = 'import(\'node:sqlite\').then(() => process.stdout.write(\'{"msg":"fixture.sqlite.grandchild"}\\n\'))';
    const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', () => undefined);
    log('fixture.sqlite', { grandchild_pid: child.pid });
    if (opt('sqlite-control') !== null) {
      // 양성 대조: NODE_OPTIONS 병합이 없으면 경고가 실제로 출력된다는 증거.
      const { NODE_OPTIONS: _dropped, ...bare } = process.env;
      const control = spawn(process.execPath, ['-e', code], { env: bare, stdio: ['ignore', 'inherit', 'inherit'] });
      control.on('error', () => undefined);
    }
  }
  const ops = opt('ops');
  if (ops !== null) {
    runOps(ops.split(',').filter((s) => s !== ''));
  }
}

function listen(server: ReturnType<typeof createServer>, port: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const attempt = (p: number): void => {
      const onError = (): void => {
        if (p === 0) {
          reject(new Error('listen failed'));
        } else {
          attempt(0);
        }
      };
      server.once('error', onError);
      server.listen(p, '127.0.0.1', () => {
        server.off('error', onError);
        resolve((server.address() as AddressInfo).port);
      });
    };
    attempt(port);
  });
}

function onMessage(m: unknown, server: ReturnType<typeof createServer>): void {
  if (typeof m !== 'object' || m === null || !('type' in m)) {
    return;
  }
  if (m.type === 'shutdown') {
    if (opt('hang-shutdown') !== null) {
      return;
    }
    log('fixture.shutdown', { at: Date.now() });
    server.close(() => process.exit(0));
    server.closeAllConnections();
  } else if (m.type === 'registry.updated') {
    for (const waiter of updateWaiters.splice(0)) {
      waiter();
    }
  } else if (
    m.type === 'svc.ack' ||
    m.type === 'svc.run_mode.result' ||
    m.type === 'status' ||
    m.type === 'logs.tail.result'
  ) {
    const re = 're' in m && typeof m.re === 'string' ? m.re : '';
    pending.get(re)?.(m);
  }
}

const updateWaiters: (() => void)[] = [];
const pending = new Map<string, (m: unknown) => void>();
const responses: Record<string, unknown> = {};

function request(name: string, body: Record<string, unknown>): Promise<void> {
  const id = ulid();
  return new Promise<void>((resolve) => {
    pending.set(id, (m) => {
      responses[name] = m;
      pending.delete(id);
      resolve();
    });
    send({ v: 1, id, ...body });
  });
}

function runOps(steps: string[]): void {
  (async (): Promise<void> => {
    await new Promise<void>((resolve) => {
      updateWaiters.push(resolve);
    });
    for (const step of steps) {
      if (step === 'status') {
        await request('status', { type: 'status.get' });
      } else if (step === 'logs') {
        await request('logs', { type: 'logs.tail', svc: 'content', n: 5 });
      } else if (step === 'restart') {
        await request('restart', { type: 'svc.restart', svc: 'content' });
      } else if (step === 'run_mode') {
        await request('run_mode', {
          type: 'svc.run_mode',
          svc: 'learning',
          args: { mode: 'migrate', dry_run: true, db_copy_dir: null, app_dir: null },
        });
      } else if (step === 'shutdown') {
        await request('shutdown', { type: 'shutdown.all', grace_ms: 3000 });
      }
      writeOpsReport();
    }
  })().catch(() => process.exit(70));
}

let reportPath: string | null = null;
let reportBase: Record<string, unknown> = {};
function report(env: BootstrapEnvelope, port: number): void {
  reportPath = opt('report');
  if (reportPath === null) {
    return;
  }
  reportBase = {
    pid: process.pid,
    env_keys: Object.keys(process.env).sort(),
    envelope: {
      svc: env.svc,
      boot_id: env.boot_id,
      profile: env.profile,
      home: env.home,
      web_root: env.web_root,
      listen: env.listen,
      flags: env.flags,
      peers: env.peers,
      callers_keys: Object.keys(env.callers).sort(),
      self_token_len: env.self_token.length,
    },
    port,
  };
  writeOpsReport();
}
function writeOpsReport(): void {
  if (reportPath !== null) {
    writeFileSync(reportPath, JSON.stringify({ ...reportBase, responses }));
  }
}
