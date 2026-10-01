# @fathom/svc-content

카탈로그·수집·문항은행·채점·러너를 소유하는 콘텐츠 서비스.

- 소유 레인: L-CT-* (ARC-01 §16.1)
- 포트: prod 4762 / dev 4862 · content.db

## 명령

```sh
pnpm --filter @fathom/svc-content typecheck
pnpm --filter @fathom/svc-content test
pnpm --filter @fathom/svc-content test:integration
pnpm --filter @fathom/svc-content test:security
```

vitest 직접 실행(워크스페이스 원천 `.ts`를 읽으려면 `source` 조건이 필요하다):

```sh
node --conditions=source node_modules/vitest/vitest.mjs run --project unit --configLoader native
```

## 관련 문서

ARC-01 §16·§17, ADR-008, ADR-001, ADR-002, ADR-004, ADR-007, STD-01 (STD-NAM·STD-TS·STD-DIR 조항)
