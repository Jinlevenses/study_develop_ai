import { buildServiceApp } from '@fathom/shared-kernel/service/service';
import { openDb } from '@fathom/shared-kernel/sqlite/sqlite';
import { createFakeClock } from '@fathom/testkit/clock';
import { TEST_CALLER_TOKENS } from '@fathom/testkit/contract';
import { createFakePeer } from '@fathom/testkit/fakes/peers/peers';
import { describe, expect, it } from 'vitest';
import type { OpsInfra } from '../../../src/config.js';
import { serviceDefinition } from '../../../src/config.js';
import { openInfra } from '../../../src/infra/db/open.js';
import { createFakeChannel } from './fixtures/fake-channel.js';

describe('ops-api openInfra', () => {
  it('UT-OP-197 openInfra(deps, {channel: null}) → supervisor = null, 채널 주입 시 SupervisorControl [FR-SET-002]', async () => {
    // Arrange
    const clock = createFakeClock();
    const db = openDb(':memory:', { synchronous: 'NORMAL' });
    const captured: { infra: OpsInfra | null; withChannel: OpsInfra | null } = { infra: null, withChannel: null };
    const base = serviceDefinition('/unused/main.ts');
    const fake = createFakeChannel();
    try {
      // Act
      const app = await buildServiceApp(
        {
          ...base,
          register: (_app, deps) => {
            captured.infra = openInfra(deps, { channel: null });
            captured.withChannel = openInfra(deps, { channel: fake.channel });
          },
        },
        {
          callerTokens: TEST_CALLER_TOKENS,
          clock,
          home: '/unused',
          dbs: { 'ops.db': db },
          peers: Object.fromEntries(
            (['gateway', 'content', 'learning', 'ai-gateway'] as const).map((p) => [
              p,
              createFakePeer({ peer: p, clock, handlers: {} }),
            ]),
          ),
        },
      );
      await app.close();
      // Assert
      expect(captured.infra?.supervisor).toBeNull();
      expect(Object.keys(captured.infra?.peers ?? {}).sort()).toEqual(['ai-gateway', 'content', 'gateway', 'learning']);
      expect(captured.withChannel?.supervisor).not.toBeNull();
      expect(fake.state.on).toBe(0);
    } finally {
      db.close();
    }
  });
});
