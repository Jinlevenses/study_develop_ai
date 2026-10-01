import type { BootstrapEnvelope } from '@fathom/contracts/admin/ipc';
import { TEST_CALLER_TOKENS } from '@fathom/testkit/contract';
import { fixedUlid } from '@fathom/testkit/ids';
import type { AllowedEnvName } from '../../../src/config/config.js';
import type { ProcessPort } from '../../../src/service/process-port.js';

export const SELF_TOKEN = 'a1'.repeat(32);

export function envelope(over: Partial<BootstrapEnvelope> = {}): BootstrapEnvelope {
  const peer = (port: number): { url: string } => ({ url: `http://127.0.0.1:${port}` });
  return {
    type: 'bootstrap',
    v: 1,
    svc: 'content',
    boot_id: fixedUlid(7),
    app_version: '0.1.0',
    contracts_hash: 'c'.repeat(64),
    profile: 'test',
    home: '/tmp/fathom-never-created',
    web_root: null,
    listen: { host: '127.0.0.1', port: 0 },
    self_token: SELF_TOKEN,
    callers: { ...TEST_CALLER_TOKENS },
    peers: {
      gateway: peer(4747),
      content: peer(4762),
      learning: peer(4763),
      'ai-gateway': peer(4764),
      'ops-api': peer(4761),
    },
    flags: { safe_mode: false, batch_enabled: false, after_crash: false },
    log_level: 'info',
    ...over,
  };
}

export type FakePort = {
  readonly port: ProcessPort;
  readonly sent: unknown[];
  readonly exits: number[];
  deliver(message: unknown): void;
  disconnect(): void;
  fatal(kind: 'unhandledRejection' | 'uncaughtException', e: unknown): void;
};

export function fakePort(
  opts: { argv?: string[]; hasIpc?: boolean; env?: Partial<Record<AllowedEnvName, string>> } = {},
): FakePort {
  const sent: unknown[] = [];
  const exits: number[] = [];
  const messageHandlers: ((m: unknown) => void)[] = [];
  const disconnectHandlers: (() => void)[] = [];
  const fatalHandlers: ((kind: 'unhandledRejection' | 'uncaughtException', e: unknown) => void)[] = [];
  const port: ProcessPort = {
    argv: opts.argv ?? [],
    hasIpc: opts.hasIpc ?? true,
    send: (m) => void sent.push(m),
    onMessage: (cb) => void messageHandlers.push(cb),
    onDisconnect: (cb) => void disconnectHandlers.push(cb),
    onFatal: (cb) => void fatalHandlers.push(cb),
    env: (name) => opts.env?.[name],
    exit: (code) => void exits.push(code),
  };
  return {
    port,
    sent,
    exits,
    deliver: (m) => {
      for (const h of messageHandlers) {
        h(m);
      }
    },
    disconnect: () => {
      for (const h of disconnectHandlers) {
        h();
      }
    },
    fatal: (kind, e) => {
      for (const h of fatalHandlers) {
        h(kind, e);
      }
    },
  };
}

export function lines(chunks: string[]): Record<string, unknown>[] {
  return chunks.map((c): Record<string, unknown> => JSON.parse(c) as Record<string, unknown>);
}
