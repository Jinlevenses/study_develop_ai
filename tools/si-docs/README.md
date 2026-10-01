# @fathom/tool-si-docs

SI 산출 보고서(반복·통합 보고) 생성기.

- 소유 레인: L-PLAT (ARC-01 §16.1)

## 명령

```sh
pnpm --filter @fathom/tool-si-docs typecheck
pnpm --filter @fathom/tool-si-docs test
pnpm --filter @fathom/tool-si-docs test:integration
pnpm --filter @fathom/tool-si-docs test:security
```

vitest 직접 실행(워크스페이스 원천 `.ts`를 읽으려면 `source` 조건이 필요하다):

```sh
node --conditions=source node_modules/vitest/vitest.mjs run --project unit --configLoader native
```

## 관련 문서

ARC-01 §16·§17, ADR-008, STD-01 §17, STD-01 (STD-NAM·STD-TS·STD-DIR 조항)
