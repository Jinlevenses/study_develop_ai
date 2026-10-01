# @fathom/app-cli

`fathom` 명령(status·up·down·doctor·backup·restore·export·import). ops-api·supervisor와 HTTP/IPC로만 통신한다.

- 소유 레인: L-CLI (ARC-01 §16.1)

## 명령

```sh
pnpm --filter @fathom/app-cli typecheck
pnpm --filter @fathom/app-cli test
pnpm --filter @fathom/app-cli test:integration
pnpm --filter @fathom/app-cli test:security
```

vitest 직접 실행(워크스페이스 원천 `.ts`를 읽으려면 `source` 조건이 필요하다):

```sh
node --conditions=source node_modules/vitest/vitest.mjs run --project unit --configLoader native
```

## 관련 문서

ARC-01 §16·§17, ADR-008, ADR-012, STD-01 (STD-NAM·STD-TS·STD-DIR 조항)
