import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CatalogPackActivatedV1 } from '@fathom/contracts/events/catalog/catalog';
import { EVENT_PAYLOADS } from '@fathom/contracts/events/registry.gen';
import { ROUTING } from '@fathom/contracts/events/routing.gen';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from '../../unit/catalog/support/context.js';
import { createCtx } from '../../unit/catalog/support/context.js';

const CONSUMERS = fileURLToPath(
  new URL('../../../../../packages/contracts/src/events/__consumers__/learning.json', import.meta.url),
);

let c: Ctx;
beforeEach(async () => {
  c = await createCtx();
});
afterEach(() => {
  c.fx.close();
});

describe('CT-CT-501 IF-EV-01 catalog.pack.activated 생산 거울', () => {
  it('CT-CT-501 실제 활성화가 만든 outbox payload가 스키마를 통과하고 learning durable 라우팅·소비 등록이 있다 [IF-EV-01]', async () => {
    // Arrange / Act: 실제 설치·활성화(같은 프로세스 job)
    c.put({ version: '1.0.0', concepts: [{ slug: 'pod' }, { slug: 'service', prereqs: ['pod'] }] });
    const res = c.installer.install(c.req({ kind: 'bundled', track: null }));
    expect(res.ok).toBe(true);
    await c.installer.idle();
    // Assert: 생산 payload
    const activated = c.events().filter((e) => e.type === 'catalog.pack.activated');
    expect(activated).toHaveLength(1);
    const payload = activated[0]?.payload;
    expect(EVENT_PAYLOADS['catalog.pack.activated'][1].safeParse(payload).success).toBe(true);
    const parsed = CatalogPackActivatedV1.parse(payload);
    expect(parsed).toMatchObject({
      pack_id: 'k8s',
      track: 'k8s',
      channel: 'seed',
      previous_version: null,
      catalog_version: 1,
    });
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(CatalogPackActivatedV1.shape).sort());
    // 라우팅: content → learning durable(+ gateway notify)
    expect(ROUTING.content.learning.mode).toBe('durable');
    expect(ROUTING.content.learning.types).toContain('catalog.pack.activated');
    expect(ROUTING.content.gateway.mode).toBe('notify');
    expect(ROUTING.content.gateway.types).toContain('catalog.pack.activated');
    // 소비 등록: learning이 이 타입 v1을 durable로 구독하고, 읽는 필드는 모두 payload에 있다.
    const doc = JSON.parse(readFileSync(CONSUMERS, 'utf8')) as {
      subscriptions: { type: string; schema_versions: number[]; mode: string; reads: string[] }[];
    };
    const sub = doc.subscriptions.find((s) => s.type === 'catalog.pack.activated');
    expect(sub).toMatchObject({ mode: 'durable', schema_versions: [1] });
    for (const field of sub?.reads ?? []) {
      expect(Object.keys(parsed), field).toContain(field);
    }
  });
});
