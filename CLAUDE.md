# CLAUDE.md — Fathom · 깊이 (모든 코딩 에이전트에 주입되는 저장소 지침)

**Fathom · 깊이**는 로컬 우선(127.0.0.1 전용) 1인용 개발 학습 서비스다. 6계열 학습(개념이해·실습·문제·디깅·OX·백지노트), FSRS·Elo 숙달, 증거 원장을 제공하고, AI는 선택 사항이다(첫 기동 OFFLINE). 코드는 서비스별(bounded context) 모노레포에서 AI 코딩 에이전트가 병렬로 작성한다.

## 1. 먼저 읽을 것

1. `docs/02-design/11-agent-build-brief.md` — 서비스·포트·트리·공개 API·규약·명령 요약(가장 먼저)
2. 내 Task Brief(`docs/40-impl/briefs/IT-<nn>/T-<nn>-<mm>.md`)의 `allowed_paths`·FR·IF·테스트 번호
3. Brief의 FR 행 → `docs/02-design/09-rtm.md`(IF·테이블·화면·테스트 대역)
4. 정본: `docs/02-design/01-architecture.md`(ARC-01), `adr/ADR-000~016`, `02-interface-spec.md`(IF-01, **코드 블록 = zod 그대로**), `03-database-design.md`(DB-01, DDL), `docs/03-standards/01-dev-standards.md`(STD-01), `docs/04-test/01-test-plan.md`(TST-01)

| 위치 | 내용 |
|---|---|
| `docs/00-brief/` | 사용자 원 요구 UR-01~18, 검증된 기술 사실 |
| `docs/01-planning/` | 요구사항(REQ-01: FR 236·NFR 93), 기획 기준선 |
| `docs/02-design/` | ARC·IF·DB·DCP·AI·SCR·DS·WBS·RTM·리뷰 기록·브리프, `adr/` |
| `docs/03-standards/` · `docs/04-test/` | 개발표준 · 테스트 계획 |
| `spikes/` | 동결된 PoC(읽기 전용 — import·수정 금지) |

## 2. 동결 규칙 (ADR-000 Architecture Freeze Baseline v1.0)

- 서비스 목록·포트·DB 소유·계약(`packages/contracts`)·이벤트 23종·원장 17종·디렉터리 트리·스택 버전·게이트는 **동결**이다.
- 파괴 변경 = **새 ADR + 회고 승인**만. 가산 변경 = CR(ARC §22 대장, 다음 번호 CR-57). 커밋 트레일러 `CR:`/`ADR:` 없이 동결 파일을 바꾸면 `check:frozen`이 실패한다.
- 에이전트(T2)는 동결 파일을 바꾸지 않는다. 필요하면 **작업을 멈추고** `contract_change`(계약)·`scope`(경로) 에스컬레이션.
- 문서 충돌 시: ADR-000 > ADR-001~016 > ARC-01 > IF-01·DB-01 > 나머지. ID·enum·필드명의 모양은 IF-01 코드 블록이 정본.

## 3. 디렉터리 지도

| 경로 | 패키지 | 포트(prod/dev) · DB |
|---|---|---|
| `apps/web` | `@fathom/app-web` | gateway가 정적 제공 / Vite 127.0.0.1:5173 · IndexedDB 큐만 |
| `apps/cli` | `@fathom/app-cli` | `fathom` 명령 |
| `services/gateway` | `@fathom/svc-gateway` | 4747 / 4847 · DB 없음(BFF·SSE·쿠키+CSRF) |
| `services/content` | `@fathom/svc-content` | 4762 / 4862 · `content.db`(catalog·acquisition·itembank·grading·runner) |
| `services/learning` | `@fathom/svc-learning` | 4763 / 4863 · `learning.db`(증거 단일 writer) + `insight.db` |
| `services/ai-gateway` | `@fathom/svc-ai-gateway` | 4764 / 4864 · `ai.db` + `ai-cache.db`(AI 유일 접점) |
| `services/ops` | `@fathom/svc-ops` | supervisor(IPC, 포트 없음) + ops-api 4761 / 4861 · `ops.db` |
| `packages/contracts` | `@fathom/contracts` | zod 계약(라우트·이벤트·원장·AI·팩·정책) |
| `packages/shared-kernel` | `@fathom/shared-kernel` | 17 모듈, import = `@fathom/shared-kernel/<module>/<module>` |
| `packages/{design-tokens,ui,testkit}` | `@fathom/*` | 토큰(원색 유일 위치) · UI 컴포넌트 · 테스트 도구 |
| `tools/{gates,biome-plugins,packc,graph,fake-cli,si-docs}` | `@fathom/tool-*` | 정적 게이트 · 팩 컴파일러 · 보고서 |
| `content/` · `policy/` · `evals/` | — | 콘텐츠 팩 원천 · 정책 YAML · 골드셋 |
| `tests/` | — | 교차 서비스 계약·통합·E2E·카오스·성능·보안 |

서비스 내부: `src/{main,app,config}.ts` · `http/<bc>/` → `application/<bc>/` → `domain/<bc>/`(순수) ← `infra/` · `jobs/` · `migrations/<module>/NNNN_<desc>.sql` · `test/`.

## 4. 명령

| 목적 | 명령 |
|---|---|
| 설치 | `pnpm i --frozen-lockfile` |
| 개발 기동 | `pnpm dev` → `http://127.0.0.1:4847` (supervisor dev 프로파일, `FATHOM_HOME=<repo>/.fathom-dev`) |
| CLI | `pnpm fathom status` · `up` · `down` · `doctor` · `backup` · `restore` · `export` · `import` |
| 타입 · 린트 | `pnpm typecheck` · `pnpm lint` |
| 단위(패키지) | `pnpm --filter <pkg> test` (예: `@fathom/svc-learning`) |
| 교차 테스트 | `pnpm test:contract` · `pnpm test:integration` · `pnpm test:security` · `pnpm test:chaos` |
| E2E | `pnpm test:e2e` (Playwright 1.56.1, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, `playwright install` 금지) |
| 게이트 | `pnpm check:gates` (= `node tools/gates/run-gates.mjs --stage=g1\|g2\|g3`), 개별 `pnpm check:boundaries` 등 |
| 게이트 자체 테스트 | `pnpm --filter @fathom/tool-gates test` (= `node --test "test/*.test.mjs"`) |
| 계약 생성물 | `pnpm contracts:gen` (원천과 같은 커밋) |
| 콘텐츠 | `pnpm content:check` · `pnpm packs:build` |
| 그래프 | `graphify query "…"` · `graphify explain "…"` · `graphify affected "…" --depth 2` · 갱신 `graphify update .` |

Task 완료(G1): `pnpm --filter <pkg> typecheck && pnpm --filter <pkg> test && pnpm lint && node tools/gates/run-gates.mjs --stage=g1 && node tools/gates/check-scope.mjs --task <T-nn-mm>` 전부 exit 0. 게이트 종료 코드: 0 통과 · 1 위반 · 2 엔진 고장(스캔 0파일 포함).

## 5. 코딩 표준 핵심 20 (STD-01 — 조항 ID를 커밋·보고에 인용)

1. **서비스 간 코드 import 0** — 다른 `services/*`·`apps/*`를 import하지 않는다. 공유는 `@fathom/contracts`(zod만)와 `@fathom/shared-kernel`뿐, 호출은 HTTP(`PeerClient`)·이벤트·IPC.
2. **barrel 금지** — `index.ts` 재수출 없이 파일 단위 subpath import(`@fathom/contracts/http/learning/v1/sessions`).
3. **계약 재정의 금지** — 스키마는 IF-01 코드 블록 그대로 옮기고, 다른 레인의 스키마는 import만 한다. 와이어·DB 필드는 `snake_case` 그대로.
4. **모든 경계에서 zod `.strict()` 검증**, 목록 응답 `{items, next_cursor}`, 오류 = RFC 9457 problem+json + `code: <SVC>-<CAT>-<NNN>`.
5. **상태 변경 = `Idempotency-Key`(ULID) 필수**, gateway는 같은 키를 하위로 그대로 전파.
6. **learning만 증거를 쓴다** — `lr_event`는 `infra/ledger/ledger-writer.ts`에서 `INSERT OR IGNORE`로만, `recursive_triggers=ON`.
7. **이벤트는 상태 변경과 같은 트랜잭션**에서 `appendEvent()`로 outbox에 쓰고, 소비는 inbox(event_id 멱등).
8. **SQL은 정적 리터럴만** — `?`/`:name` 바인딩, 조각은 `ident()`·`placeholders()`·`sqlInt()`·UPPER_SNAKE 상수. 템플릿 `${}`·문자열 연결 금지(`// sql-ok: <사유>` 예외).
9. **DB 접근은 `openDb()`만**, 쓰기는 `tx()`(`BEGIN IMMEDIATE`) 안에서 `await` 없이, 타 서비스 DB 파일·`ATTACH` 0, 대량 작업은 단명 자식 job.
10. **`Date`·`boolean`을 바인딩하지 않는다** — 시각은 epoch ms 정수, 불리언은 0/1, ID는 ULID TEXT.
11. **domain은 순수** — `node:*`·fastify·`node:sqlite`·서드파티 import 금지, 시계는 `Clock` 포트, 오류는 `Result<T, DomainError>`(`@fathom/shared-kernel/errors/errors`).
12. **TypeScript 7.0.2 strict** — `any`·`!` 0, enum·namespace 금지(`erasableSyntaxOnly`), 동적 `import(변수)`·`require` 금지.
13. **`process.env` 금지** — 설정은 부트스트랩 봉투, env는 `readAllowedEnv()`(허용 표)만, 도메인 임계는 `policy/*.yaml`(`loadPolicy`).
14. **로그 = pino JSON 한 줄**(`ts, level, svc, req_id, msg`), 비밀·학습자 원문·프롬프트·LLM 출력 0, `console.*` 0.
15. **제출 전 스키마**(`pre-submit/`, `*PreSubmit`)에 정답·해설·모범답안 필드 0, 제출 후 스키마에서 파생 금지.
16. **Jev는 객체 키만** — Jev 코드는 `services/*/src/jev/`·`*.jev.ts`, 항목은 `candidates.k137`처럼 키로 참조(배열 인덱스 금지). 백지노트 제출 전 AI 호출 0.
17. **원색 리터럴은 `packages/design-tokens/`에만**, UI는 토큰 변수만, 한국어 타이포 규칙(`check:typo-ko`).
18. **외부 프로세스는 `safeSpawn(shell:false)`**, 비밀은 stdin, 경로는 `resolveInside()`. 러너 결과는 부모가 판정.
19. **테스트 ID** `<UT|CT|IT|E2E|SEC|CHA|PRF>-<UNIT>-nnn`은 Brief가 배정한 범위만, 제목에 IF·FR ID. 단위 테스트는 무네트워크, AI는 cassette·fake-cli(외부 호출 0).
20. **Git** — Conventional Commits + 트레일러 `Refs:`·`Task:`, Task당 squash 1개, 생성물은 원천과 같은 커밋, `spikes/**`·`graphify-out/`(T0 외)·`.env*`·`*.db` 커밋 금지. 스파이크 이식은 `// ported-from: spikes/<sp>/<path>` 주석.

## 6. graphify 워크플로 (UR-09, STD §18)

- **낯선 영역을 고치기 전에** 그래프를 먼저 본다: `graphify-out/GRAPH_REPORT.md`를 읽고,
  1. `graphify query "<기능 키워드>" --budget 1500`
  2. `graphify explain "<수정할 심볼>"`
  3. `graphify affected "<심볼>" --depth 2` → 영향 범위가 `allowed_paths` 밖이면 구현하지 말고 `scope` 에스컬레이션.
- T2(코딩 에이전트)는 기존 `graphify-out/graph.json`을 **읽기만** 한다. 그래프 갱신 `graphify update .`(삭제·대규모 리팩터 뒤에는 `--force`)은 반복 시작·통합(G3)에서 T0만 실행하고 `graphify-out/`을 커밋한다. 혼자 작업하는 세션에서 큰 변경을 마쳤다면 변경 후 `graphify update .`로 갱신해 다음 작업자가 최신 그래프를 보게 한다(Task 브랜치에는 커밋하지 않음).
- 유용한 질의는 `graphify save-result --question "…" --answer "…" --type query --outcome useful`로 남긴다. graphify가 없으면 감사는 "skipped"(비차단).
