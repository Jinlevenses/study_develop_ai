# AGENTS.md — Fathom · 깊이 (Codex 계열 코딩 에이전트 지침, 요약)

> 정본은 [`CLAUDE.md`](CLAUDE.md)다(STD-01 §17.7 — 두 파일은 같은 지침). 이 파일은 그 요약이며, 충돌하면 `CLAUDE.md` > 이 파일.

**Fathom · 깊이** = 로컬 우선(127.0.0.1 전용) 1인용 개발 학습 서비스. 서비스별(bounded context) 모노레포를 AI 코딩 에이전트가 병렬로 작성한다. AI는 선택(첫 기동 OFFLINE).

## 1. 읽기 순서 (STD-AGT-10)
1. `docs/02-design/11-agent-build-brief.md` — 서비스·포트·트리·공개 API·규약·명령
2. 내 Task Brief `docs/40-impl/briefs/IT-<nn>/T-<nn>-<mm>.md` — `allowed_paths`·FR·IF·테스트 ID 범위
3. Brief가 인용한 STD 조항·IF/DB 절·참고 구현 1개만. 저장소 전체를 훑어 재설계하지 않는다.

## 2. 서비스 · 포트 (prod / dev)
gateway 4747/4847 · ops-api 4761/4861 · content 4762/4862 · learning 4763/4863 · ai-gateway 4764/4864 · supervisor = IPC(포트 없음) · web = gateway가 정적 제공(dev Vite 127.0.0.1:5173) · 4765 예약.

## 3. 하지 않는 것
- `allowed_paths` 밖 파일 생성·수정(포맷터가 건드린 무관 파일도 되돌림) → 필요하면 멈추고 `scope` 에스컬레이션.
- 동결 파일 수정: `docs/02-design/frozen.lock` 목록, `packages/contracts/src/{common,admin,ledger,events/envelope.ts,events/consumer-manifest.ts,manifests}/**`, `db-hooks.ts`, ADR·ARC·STD → `contract_change` 에스컬레이션. CR 대장 = `docs/02-design/cr/README.md`.
- Brief에 없는 의존성·스크립트·env·포트 추가, 게이트 끄기·테스트 약화, 다른 `services/*`·`apps/*` import, barrel(`index.ts`), `process.env` 직접 접근, `console.*`, `spikes/**` import, `graphify update/extract` 실행.

## 4. 완료 명령 (G1, 전부 exit 0)
```
pnpm --filter <pkg> typecheck
pnpm --filter <pkg> test
pnpm lint
node tools/gates/run-gates.mjs --stage=g1
node tools/gates/check-scope.mjs --task <T-nn-mm>
```
게이트 종료 코드: 0 통과 · 1 위반 · 2 엔진 고장(스캔 0파일 포함). 완료 보고는 STD-01 §17.5 JSON(`tier`·`model_id`·실행 명령과 종료 코드·`graphify[]`·`rtmUpdates[]`·`deviations[]`).

## 5. graphify 3단 질의 (코드 수정 전, 읽기만)
`graphify query "<기능>" --budget 1500` → `graphify explain "<심볼>"` → `graphify affected "<심볼>" --depth 2`. 영향 범위가 `allowed_paths` 밖이면 구현하지 않고 `scope` 에스컬레이션. graphify가 없으면 `rg`로 대신하고 `graphify: "unavailable"`로 기록.

## 6. 핵심 규약 (STD-01 조항 ID를 커밋·보고에 인용)
계약 = IF-01 코드 블록 그대로(zod `.strict()`, `snake_case`) · 오류 = RFC 9457 + `<SVC>-<CAT>-<NNN>` · 상태 변경 = `Idempotency-Key`(ULID) + 같은 tx outbox(`appendEvent`) · learning만 원장(`INSERT OR IGNORE`) · SQL = 정적 리터럴 + `openDb()`/`tx()` · domain 순수(`Clock`·`Result`) · TypeScript 7.0.2 strict(`any`·`!`·enum 0) · 로그 = pino JSON 한 줄 · 원색은 `packages/design-tokens/`만 · 외부 프로세스 = `safeSpawn(shell:false)` · 테스트 ID = Brief 배정 범위, 제목에 IF·FR ID · Conventional Commits + `Refs:`·`Task:` 트레일러, Task당 squash 1개.
