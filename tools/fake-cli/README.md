# @fathom/tool-fake-cli

AI CLI 공급자 대역(테스트·cassette 재생용).

- 소유 레인: L-AI (ARC-01 §16.1)

## 명령

```sh
pnpm --filter @fathom/tool-fake-cli typecheck
pnpm --filter @fathom/tool-fake-cli test
pnpm --filter @fathom/tool-fake-cli test:integration
pnpm --filter @fathom/tool-fake-cli test:security
```

vitest 직접 실행(워크스페이스 원천 `.ts`를 읽으려면 `source` 조건이 필요하다):

```sh
node --conditions=source node_modules/vitest/vitest.mjs run --project unit --configLoader native
```

## 관련 문서

ARC-01 §16·§17, ADR-008, ADR-005, STD-01 (STD-NAM·STD-TS·STD-DIR 조항)
