# @fathom/svc-ops

프로세스 supervisor와 ops-api. 기동·백업·복원·업그레이드를 맡는다.

- 소유 레인: L-OPS (ARC-01 §16.1)
- 포트: supervisor(IPC, 포트 없음) + ops-api prod 4761 / dev 4861 · ops.db

## 명령

```sh
pnpm --filter @fathom/svc-ops typecheck
pnpm --filter @fathom/svc-ops test
pnpm --filter @fathom/svc-ops test:integration
pnpm --filter @fathom/svc-ops test:security
```

vitest 직접 실행(워크스페이스 원천 `.ts`를 읽으려면 `source` 조건이 필요하다):

```sh
node --conditions=source node_modules/vitest/vitest.mjs run --project unit --configLoader native
```

## 관련 문서

ARC-01 §16·§17, ADR-008, ADR-012, ADR-013, STD-01 (STD-NAM·STD-TS·STD-DIR 조항)
