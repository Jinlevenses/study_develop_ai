# @fathom/design-tokens

디자인 토큰(원색 리터럴이 허용되는 유일한 위치)과 한국어 타이포 CSS.

- 소유 레인: L-WEB-SHELL (ARC-01 §16.1)
- 공개 subpath(barrel 없음, 파일 단위): `./tokens.css` · `./typography.css` · `./*`

## 명령

```sh
pnpm --filter @fathom/design-tokens typecheck
pnpm --filter @fathom/design-tokens test
pnpm --filter @fathom/design-tokens test:integration
pnpm --filter @fathom/design-tokens test:security
```

vitest 직접 실행(워크스페이스 원천 `.ts`를 읽으려면 `source` 조건이 필요하다):

```sh
node --conditions=source node_modules/vitest/vitest.mjs run --project unit --configLoader native
```

## 관련 문서

ARC-01 §16·§17, ADR-008, ADR-006, STD-01 (STD-NAM·STD-TS·STD-DIR 조항)
