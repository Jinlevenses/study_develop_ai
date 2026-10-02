import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CatalogConceptChangedV1, ConceptRef } from '@fathom/contracts/events/catalog/catalog';
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

describe('CT-CT-502 IF-EV-02 catalog.concept.changed 생산 거울', () => {
  it('CT-CT-502 payload가 스키마를 통과하고 concept가 ConceptRef 전체(16 필드)이며 learning durable 소비 등록이 있다 [IF-EV-02]', async () => {
    // Arrange / Act: v1 → v2(개정·폐기·승급·신규)
    c.put({
      version: '1.0.0',
      concepts: [{ slug: 'pod' }, { slug: 'service', tier: 'C', prereqs: ['pod'] }, { slug: 'old' }],
    });
    c.installer.install(c.req({ kind: 'bundled', track: null }));
    await c.installer.idle();
    c.put({
      version: '1.1.0',
      concepts: [
        { slug: 'pod', rev: 1 },
        { slug: 'service', tier: 'B', prereqs: ['pod'] },
        { slug: 'old', deprecated_by: 'k8s.pod' },
        { slug: 'ingress', prereqs: ['pod'] },
      ],
    });
    c.installer.install(c.req({ kind: 'bundled', track: null }));
    await c.installer.idle();
    // Assert: 생산 payload 전부가 스키마를 통과하고 4가지 change가 모두 나온다.
    const changed = c.events().filter((e) => e.type === 'catalog.concept.changed');
    expect(changed.length).toBe(3 + 4);
    const schema = EVENT_PAYLOADS['catalog.concept.changed'][1];
    for (const e of changed) {
      expect(schema.safeParse(e.payload).success).toBe(true);
      const parsed = CatalogConceptChangedV1.parse(e.payload);
      expect(Object.keys(parsed.concept).sort()).toEqual(Object.keys(ConceptRef.shape).sort());
      expect(Object.keys(parsed.concept)).toHaveLength(16);
      expect(parsed).toMatchObject({ pack_id: 'k8s' });
    }
    expect(new Set(changed.map((e) => e.payload.change))).toEqual(
      new Set(['published', 'revised', 'deprecated', 'tier_promoted']),
    );
    // 라우팅·소비 등록
    expect(ROUTING.content.learning.mode).toBe('durable');
    expect(ROUTING.content.learning.types).toContain('catalog.concept.changed');
    const doc = JSON.parse(readFileSync(CONSUMERS, 'utf8')) as {
      subscriptions: { type: string; schema_versions: number[]; mode: string; reads: string[] }[];
    };
    const sub = doc.subscriptions.find((s) => s.type === 'catalog.concept.changed');
    expect(sub).toMatchObject({ mode: 'durable', schema_versions: [1] });
    for (const field of sub?.reads ?? []) {
      expect(Object.keys(changed[0]?.payload ?? {}), field).toContain(field);
    }
  });
});
