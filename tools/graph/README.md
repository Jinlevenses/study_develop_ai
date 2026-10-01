# @fathom/tool-graph

graphify 그래프 스냅샷·지표 도구.

- 소유 레인: L-PLAT (ARC-01 §16.1)

## 명령

```sh
pnpm --filter @fathom/tool-graph typecheck
pnpm --filter @fathom/tool-graph test
pnpm --filter @fathom/tool-graph test:integration
pnpm --filter @fathom/tool-graph test:security
```

vitest 직접 실행(워크스페이스 원천 `.ts`를 읽으려면 `source` 조건이 필요하다):

```sh
node --conditions=source node_modules/vitest/vitest.mjs run --project unit --configLoader native
```

## 관련 문서

ARC-01 §16·§17, ADR-008, STD-01 §18, STD-01 (STD-NAM·STD-TS·STD-DIR 조항)
