# @fathom/ui

토큰 변수만 쓰는 공용 UI 컴포넌트·배지·훅(radix-ui 기반).

- 소유 레인: L-WEB-SHELL (ARC-01 §16.1)
- 공개 subpath(barrel 없음, 파일 단위): `./components/*` · `./badges/*` · `./hooks/*` · `./*`

## 명령

```sh
pnpm --filter @fathom/ui typecheck
pnpm --filter @fathom/ui test
pnpm --filter @fathom/ui test:integration
pnpm --filter @fathom/ui test:security
```

vitest 직접 실행(워크스페이스 원천 `.ts`를 읽으려면 `source` 조건이 필요하다):

```sh
node --conditions=source node_modules/vitest/vitest.mjs run --project unit --configLoader native
```

## 관련 문서

ARC-01 §16·§17, ADR-008, ADR-006, STD-01 (STD-NAM·STD-TS·STD-DIR 조항)
