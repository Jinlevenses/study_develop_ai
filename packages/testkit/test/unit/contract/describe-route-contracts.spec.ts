import { describe, expect, it } from 'vitest';
import { planRouteContracts } from '../../../src/contract.js';
import { createFakeServer } from './fake-server.js';
import { CreateThing, GetQuestion, GetThing, ListThings, SafeView, sampleRoutes } from './sample-app.js';

// UT-TK-035 [IR-015] — 래퍼의 케이스 계획이 라우트마다 케이스를 만들고 적합 서버에서 모두 통과한다.
// 케이스를 vitest `it`으로 등록하지 않고 한 `it` 안에서 직접 실행한다: `CT-<svc>-nnn` 제목이 vitest 결과(JSON)로 새어
// RTM·IR-015 계수에 가짜 계약 검증으로 잡히는 일을 막기 위함이다. 샘플 라우트의 ifId(IF-LR-9nnn)는 실제 번호와 겹치지 않는 픽스처다.
describe('describeRouteContracts 케이스 계획', () => {
  it('UT-TK-035 케이스 계획이 C1 표 + 라우트별 케이스를 만들고 적합 서버에서 모두 통과한다 [IR-015]', async () => {
    const plan = planRouteContracts({
      unit: 'LR',
      build: () =>
        Promise.resolve({
          app: createFakeServer(sampleRoutes),
          registeredRoutes: () =>
            sampleRoutes.map(({ route }) => ({
              method: route.method,
              url: route.path.replace(/\{([^}]+)\}/g, ':$1'),
            })),
          close: () => Promise.resolve(),
        }),
      groups: [
        { CreateThing, ListThings, GetThing },
        { GetQuestion, ALL: [CreateThing] },
      ],
      fixtures: new URL('./fixtures/', import.meta.url),
      preSubmitSchemas: [SafeView],
    });
    expect(plan.cases).toHaveLength(1 + 4);
    expect(plan.cases[0]?.title).toContain('[C1]');
    for (const ifId of ['IF-LR-9001', 'IF-LR-9002', 'IF-LR-9003', 'IF-LR-9004']) {
      expect(plan.cases.some((c) => c.title.includes(`[${ifId}]`))).toBe(true);
    }
    await plan.setup();
    try {
      for (const c of plan.cases) {
        await c.run();
      }
    } finally {
      await plan.teardown();
    }
  });
});
