# @fathom/contracts

zod 계약(라우트·이벤트·원장·AI·팩·정책)의 단일 원천. 서비스 간 공유는 이 패키지와 shared-kernel뿐이다.

- 소유 레인: L-CONTRACTS + 공급자/소비자 레인 (ARC-01 §16.1)
- 공개 subpath(barrel 없음, 파일 단위): `./manifests/*.json` · `./events/__consumers__/*.json` · `./*`

## 명령

```sh
pnpm --filter @fathom/contracts typecheck
pnpm --filter @fathom/contracts test
pnpm --filter @fathom/contracts test:integration
pnpm --filter @fathom/contracts test:security
```

vitest 직접 실행(워크스페이스 원천 `.ts`를 읽으려면 `source` 조건이 필요하다):

```sh
node --conditions=source node_modules/vitest/vitest.mjs run --project unit --configLoader native
```

## 관련 문서

ARC-01 §16·§17, ADR-008, IF-01, STD-01 (STD-NAM·STD-TS·STD-DIR 조항)
