# IT-00 오케스트레이터 메모 (통합 입력)

- T-00-07 escalation(scope): `biome.json`에 `css.parser.tailwindDirectives=true` + `packages/design-tokens/src/{tokens,typography}.css` 포매터 제외(overrides) 필요 — DS-01 §14 바이트 동일성 유지. → INT-1a 통합자 처리.
- T-00-07: G1 게이트 일부 스크립트 미존재(LG-B 진행 중) → INT-1a에서 T0 소급 실행.
- T-00-03 리뷰 r2 잔여 major 2건(오케스트레이터가 T2s 보완 에이전트로 처리): ① testkit `playwright/stack-fixture.ts` bootstrap 요청에 `idempotency-key`(ULID) 누락(IF-GW-001) ② 테스트 ID UT-TK-035 중복.
- T-00-04 리뷰 minor: http-client probeInFlight try/finally, 재시도 중 circuit_open이 마지막 실패를 가림, serveJob invariant 미처리, migrate I/O 오류 사유 코드, job 자식 env에 *_API_KEY 전달 → CR 후보(job 자식 허용 env 축소). INT-1a/IT-01에서 처리.
