# @fathom/svc-learning

학습 세션·FSRS·Elo 숙달을 계산하고 증거 원장(lr_event)의 단일 writer가 되는 서비스.

- 소유 레인: L-LR-* (ARC-01 §16.1)
- 포트: prod 4763 / dev 4863 · learning.db + insight.db

## 명령

```sh
pnpm --filter @fathom/svc-learning typecheck
pnpm --filter @fathom/svc-learning test
pnpm --filter @fathom/svc-learning test:integration
pnpm --filter @fathom/svc-learning test:security
```

vitest 직접 실행(워크스페이스 원천 `.ts`를 읽으려면 `source` 조건이 필요하다):

```sh
node --conditions=source node_modules/vitest/vitest.mjs run --project unit --configLoader native
```

## 관련 문서

ARC-01 §16·§17, ADR-008, ADR-001, ADR-002, ADR-011, STD-01 (STD-NAM·STD-TS·STD-DIR 조항)
