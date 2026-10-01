# @fathom/app-web

브라우저 SPA(React 19 + Vite). 개발 중에는 Vite 개발 서버, 운영에서는 gateway가 정적 파일로 제공한다. 서버 데이터는 gateway BFF 경유로만 읽는다.

- 소유 레인: L-WEB-SHELL (web feature 는 L-WEB-<feature>) (ARC-01 §16.1)
- 포트: prod: gateway(4747)가 정적 제공 / dev: Vite 127.0.0.1:5173

## 명령

```sh
pnpm --filter @fathom/app-web typecheck
pnpm --filter @fathom/app-web test
pnpm --filter @fathom/app-web test:integration
pnpm --filter @fathom/app-web test:security
```

vitest 직접 실행(워크스페이스 원천 `.ts`를 읽으려면 `source` 조건이 필요하다):

```sh
node --conditions=source node_modules/vitest/vitest.mjs run --project unit --configLoader native
```

## 관련 문서

ARC-01 §16·§17, ADR-008, ADR-006, STD-01 (STD-NAM·STD-TS·STD-DIR 조항)
