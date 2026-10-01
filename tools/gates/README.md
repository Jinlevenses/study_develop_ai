# @fathom/tool-gates

정적 게이트(경계·SQL·Jev·범위 등). 의존성 0(`node:*`만), 테스트는 `node --test`.

- 소유 레인: L-PLAT (ARC-01 §16.1)

## 명령

```sh
pnpm --filter @fathom/tool-gates typecheck
pnpm --filter @fathom/tool-gates test
```

테스트는 `node --test "test/*.test.mjs"`로 직접 실행한다(vitest 미사용).

## 관련 문서

ARC-01 §16·§17, ADR-008, ADR-010, STD-01 (STD-NAM·STD-TS·STD-DIR 조항)
