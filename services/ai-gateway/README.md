# @fathom/svc-ai-gateway

AI 공급자 호출의 유일한 접점. 라우팅·캐시·Jev 판정을 담당하며 첫 기동은 OFFLINE이다.

- 소유 레인: L-AI (ARC-01 §16.1)
- 포트: prod 4764 / dev 4864 · ai.db + ai-cache.db

## 명령

```sh
pnpm --filter @fathom/svc-ai-gateway typecheck
pnpm --filter @fathom/svc-ai-gateway test
pnpm --filter @fathom/svc-ai-gateway test:integration
pnpm --filter @fathom/svc-ai-gateway test:security
```

vitest 직접 실행(워크스페이스 원천 `.ts`를 읽으려면 `source` 조건이 필요하다):

```sh
node --conditions=source node_modules/vitest/vitest.mjs run --project unit --configLoader native
```

## 관련 문서

ARC-01 §16·§17, ADR-008, ADR-005, ADR-016, STD-01 (STD-NAM·STD-TS·STD-DIR 조항)
