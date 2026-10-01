import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { InboxConfig } from '../../../../src/eventing/inbox.js';
import { defineInboxHandler } from '../../../../src/eventing/inbox.js';
import type { ServiceDatabase, ServiceDefinition } from '../../../../src/service/types.js';

// 통합 테스트용 content형 서비스 정의 — 자식 프로세스(`service-main.ts`)와 테스트가 같은 def를 쓴다.

export const MAIN = fileURLToPath(new URL('./service-main.ts', import.meta.url));
export const FIXTURE_MIGRATIONS = fileURLToPath(new URL('./migrations/fixture/', import.meta.url));
export const EXEC_ARGV = ['--import', 'tsx', '--conditions=source', '--disable-warning=ExperimentalWarning'];

export const FULL: ServiceDatabase = {
  file: 'content.db',
  applicationId: 1_700_000_002,
  profile: 'full',
  synchronous: 'NORMAL',
  recursiveTriggers: false,
  migrations: [{ module: 'fixture', dir: FIXTURE_MIGRATIONS }],
};
export const META: ServiceDatabase = {
  file: 'derived.db',
  applicationId: 1_700_000_003,
  profile: 'meta',
  synchronous: 'NORMAL',
  recursiveTriggers: false,
  migrations: [],
};

export const Payload = z.object({ n: z.number().int() }).strict();
export const PAYLOADS = { 'a.b.c': { 1: Payload } } as const;

export function consumerInbox(onHandle?: (n: number) => void): InboxConfig {
  return {
    mode: 'durable',
    manifest: {
      consumer: 'content',
      subscriptions: [{ type: 'a.b.c', schema_versions: [1], mode: 'durable', on_poison: 'halt', reads: ['n'] }],
    },
    handlers: [
      defineInboxHandler('a.b.c', { 1: Payload }, (e, p, db) => {
        db.prepare('INSERT INTO fx_item(id, name) VALUES (:id, :name)').run({ id: e.producer_seq, name: `n${p.n}` });
        onHandle?.(p.n);
      }),
    ],
  };
}

export function fixtureDef(over: Partial<ServiceDefinition<null>> = {}): ServiceDefinition<null> {
  return {
    svc: 'content',
    entry: MAIN,
    contractsHash: null,
    databases: [FULL, META],
    peers: [],
    events: null,
    inbox: null,
    register: () => undefined,
    ...over,
  };
}
