# @fathom/testkit

vitest preset·무네트워크 setup·고정 시계·시드 PRNG 등 테스트 공용 도구.

- 소유 레인: L-TEST (ARC-01 §16.1)
- 공개 subpath(barrel 없음, 파일 단위): `./preload/*.mjs` · `./*`

## 명령

```sh
pnpm --filter @fathom/testkit typecheck
pnpm --filter @fathom/testkit test
pnpm --filter @fathom/testkit test:integration
pnpm --filter @fathom/testkit test:security
```

vitest 직접 실행(워크스페이스 원천 `.ts`를 읽으려면 `source` 조건이 필요하다):

```sh
node --conditions=source node_modules/vitest/vitest.mjs run --project unit --configLoader native
```

## 관련 문서

ARC-01 §16·§17, ADR-008, TST-01 §3, STD-01 §13, STD-01 (STD-NAM·STD-TS·STD-DIR 조항)
