# @fathom/tool-packc

콘텐츠·정책 팩 컴파일러와 검사 CLI.

- 소유 레인: L-PACKC (ARC-01 §16.1)

## 명령

```sh
pnpm --filter @fathom/tool-packc typecheck
pnpm --filter @fathom/tool-packc test
pnpm --filter @fathom/tool-packc test:integration
pnpm --filter @fathom/tool-packc test:security
```

vitest 직접 실행(워크스페이스 원천 `.ts`를 읽으려면 `source` 조건이 필요하다):

```sh
node --conditions=source node_modules/vitest/vitest.mjs run --project unit --configLoader native
```

## 관련 문서

ARC-01 §16·§17, ADR-008, ADR-004, STD-01 (STD-NAM·STD-TS·STD-DIR 조항)
