# @fathom/shared-kernel

17개 모듈(오류·시계·로깅·DB·설정 등)을 제공하는 공유 커널. import 형식은 `@fathom/shared-kernel/<module>/<module>`.

- 소유 레인: L-PLAT (ARC-01 §16.1)
- 공개 subpath(barrel 없음, 파일 단위): `./*`

## 명령

```sh
pnpm --filter @fathom/shared-kernel typecheck
pnpm --filter @fathom/shared-kernel test
pnpm --filter @fathom/shared-kernel test:integration
pnpm --filter @fathom/shared-kernel test:security
```

vitest 직접 실행(워크스페이스 원천 `.ts`를 읽으려면 `source` 조건이 필요하다):

```sh
node --conditions=source node_modules/vitest/vitest.mjs run --project unit --configLoader native
```

## 관련 문서

ARC-01 §16·§17, ADR-008, ADR-008, STD-01 (STD-NAM·STD-TS·STD-DIR 조항)
