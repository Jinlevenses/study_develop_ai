# @fathom/svc-gateway

BFF·SSE·쿠키+CSRF를 담당하는 단일 진입 서비스(DB 없음). 정적 웹 번들을 제공하고 하위 서비스로 프록시한다.

- 소유 레인: L-GW (ARC-01 §16.1)
- 포트: prod 4747 / dev 4847

## 명령

```sh
pnpm --filter @fathom/svc-gateway typecheck
pnpm --filter @fathom/svc-gateway test
pnpm --filter @fathom/svc-gateway test:integration
pnpm --filter @fathom/svc-gateway test:security
```

vitest 직접 실행(워크스페이스 원천 `.ts`를 읽으려면 `source` 조건이 필요하다):

```sh
node --conditions=source node_modules/vitest/vitest.mjs run --project unit --configLoader native
```

## 관련 문서

ARC-01 §16·§17, ADR-008, ADR-001, ADR-009, STD-01 (STD-NAM·STD-TS·STD-DIR 조항)
