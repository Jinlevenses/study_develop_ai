# INT-1a 통합 기록 — IT-00 (Iteration 0 · 기반)

> **문서 ID**: INT-1a · **실행일**: 2026-10-02 · **실행 주체**: T0(통합자 + 통합 수정) · **입력**: `docs/40-impl/plans/IT-00-plan.md` · `IT-00-carryover-notes.md` · 완료 보고 `docs/40-impl/reports/tasks/T-00-01~16.json` · WBS §2.7(C-01~C-17)·§4.4(E0-1~E0-11) · TST-01
> **표기**: 티어 별칭만 쓴다(T1 · T2s · T2h · T0). 실제 모델 ID는 이 기록에 없다(STD-AGT-02).
> **규칙**: git 명령 미사용(커밋은 오케스트레이터). 동결 계약·ADR 변경 0. 게이트는 INT-1a 규정대로 `--warn-only`(exit 2는 항상 실패).

## 0. 판정

**INT-1a = PASS (이월 포함).** E0-1~E0-11 전부 충족, C-01~C-17 중 차단 항목 충족(C-06 n/a · C-12 · C-14 · C-15 · C-16은 T0 범위 밖/해당 없음, §1).
`run-gates --stage=g3 --int INT-1a --warn-only` = **exit 0**(18종 중 11 PASS · 7 WARN 위반 113건 → §4, 전부 INT-1b 진입 전 해소 대상으로 IT-01 S0(T-01-01)에 배정).
통합 중 **보안 결함 1건(인증 분류 우회)을 근본 수정**했고, 타이밍 취약 통합 테스트 안정화를 위해 turbo 동시성을 낮췄다(§5).

## 1. 공통 체크리스트 (C-01~C-17)

| # | 항목 | 명령 | exit | 결과 |
|---|---|---|---|---|
| C-01 | Task 보고 전부 `done` | 보고 16건 대조 | — | **13 done · 3 partial**(T-00-07·14·16). partial 사유 3건 모두 통합에서 해소(biome CSS 파싱·E2E-506 CSP) 또는 CO로 이월(T-00-14 루트 `version` = CO-03). §3 |
| C-02 | 쓰기 경로 교집합 0·`graphify-out/`·`spikes/` 수기 변경 0 | `check-scope --task T-00-nn` | n/a | `check:scope`는 **작업 트리 diff** 검사라 전 레인 병합 후에는 Task별 재판정이 불가능하다(현재 diff = 이 통합의 변경뿐 → 정의상 Task 범위 밖). Task별 판정은 각 Task G1 보고에 있음. `spikes/` 변경 0·`AGENTS.md` 불변(`turbo.json` `agentGuidance:false`). **graphify-out/은 T0 생성(허용)** |
| C-03 | 설치·빌드·타입·린트 | `pnpm i --frozen-lockfile --ignore-scripts` | 0 | lockfile 최신 |
| | | `pnpm build` (turbo 12 task) | 0 | web `assetsInlineLimit:0` 반영 후 재빌드 포함 |
| | | `pnpm typecheck` (tsgo 7.0.2) | 0 | |
| | | `pnpm lint` (biome ci, 2133 파일) | **1 → 0** | 최초 11 오류(CSS 파싱 3 · 포맷 3 · `useExhaustiveSwitchCases` 1 등) → §5 수정 후 0 |
| C-04 | 정적 게이트 | `node tools/gates/run-gates.mjs --stage=g3 --int INT-1a --warn-only` | **0** | §4. (`--int` 필수 — 계획서의 명령에 `--int INT-1a` 추가) |
| | | `check:gate-selftest` | 0 | 19파일, 0 오류 |
| | | `pnpm --filter @fathom/tool-gates test` | **1 → 0** | 210/210. 최초 1건 실패(IT-659 `.gitignore` 22줄·IT-655 `overrides`) → §5 |
| C-05 | 테스트 | `pnpm test` (17 task) | 0 | 2회 실행 모두 17/17. 최초 turbo 기본 동시성(10, 4코어)에서 타임아웃 3건 → §5 |
| | | `pnpm test:contract` | 0 | 4/4 (+ 서비스 `test:contract` 없음) |
| | | `pnpm test:integration` (turbo 16 task) | 0 | 동시성 50% 적용 후 2회 연속 통과(88s·92s). 적용 전 4회 중 2회가 타이밍 취약 1건씩 실패(§6 CO-N3) |
| | | `pnpm test:security` | 0 | SEC-GW-001~005·루트 3 |
| | | `pnpm test:e2e` | 0 | 5/5 ×2회(24.8s·23.8s) |
| | | `pnpm test:chaos` · `test:offline` | 0 · 0 | chaos = 파일 0(IT-00 범위 밖) · offline 4/4 |
| | | `pnpm test:determinism` | 0 | `equal=true`(11개 패키지, 같은 커밋 2회 결과 일치) |
| C-06 | domain 라인 커버리지 ≥ 80% | `turbo run test -- --coverage` | — | **n/a** — IT-00에는 `services/*/src/domain/**` 코드 0(커버 대상 0행, 임계는 `include: src/domain/**`). 통과/실패 없음. `coverage-summary.json` 생성 배선이 없음(§6 CO-N6) |
| C-07 | `pnpm audit --prod --audit-level high` 0 · 설치 스크립트 0 · 네이티브 0 | `pnpm audit --prod --audit-level high` | **1 → 0** | 최초 high 1·moderate 1(`lodash-es` ≤4.17.23, `mermaid>chevrotain` 경유, GHSA-r5fr-rjxr-66jc) → `overrides: lodash-es 4.18.1`(§5, CR 추인 필요) → "No known vulnerabilities". `onlyBuiltDependencies: []` 유지 |
| C-08 | `contracts:gen` diff 0 · `check:frozen`·`check:consumers` 0 | `pnpm contracts:gen` | 0 | `files=1101 hash=6cbc7cc3a651`, 작업 트리 변화 0. `check:frozen` 0/32 · `check:consumers` 0/5. 동결 파일 변경 0 |
| C-09 | 서비스 stderr 경고 0 | `E2E-104` | 0 | PASS(마이그레이션·기동·종료 stderr·로그에 경고·비 JSON 줄 0) |
| C-10 | `graphify update .` → `graph:snapshot` → `audit:graph` | §8 | 0·0·0 | 교차 서비스 파일 엣지 **0** |
| C-11 | RTM·PGM, UTR·ITR 생성 | `pnpm si:reports --int INT-1a` | 0 | `docs/40-impl/reports/{UTR,ITR,RTM}-INT-1a.md`. 결과 입력은 이 통합에서 임시로 수집(§6 CO-N5). `check:rtm` PASS(경고 37 = 이후 INT 배정) |
| C-12 | 디자인 루브릭·`/_design` 기준선 | `E2E-506` | 0 | 기준선 3장(dark·light·more) **무수정으로 일치**(CSP 수정이 렌더에 영향 0). 루브릭 평균 채점은 T1 몫 → **이월**(§6) |
| C-13 | OFFLINE 첫 기동 외부 소켓 0 | `E2E-100` | 0 | L1~L4 0, L3 양성 탐침 1건 검출 |
| C-14 | 보고 `model_id`와 오케스트레이터 메타 대조 | — | n/a | T1/오케스트레이터 몫(T0 접근 불가). 이 기록은 별칭만 사용 |
| C-15 | STD-01 부록 A 표본 리뷰 | — | n/a | T1 몫 |
| C-16 | 콘텐츠 진척 경보(비차단) | — | n/a | IT-00 콘텐츠 WP 없음 |
| C-17 | INT 기록 | — | — | 이 문서 |

## 2. 종료 조건 (E0-1~E0-11)

| # | 조건 | 측정·증거 | 판정 |
|---|---|---|---|
| E0-1 | 같은 supervisor로 6개 프로세스 `ready`, `contracts_hash` 동일, 콜드 ≤ 10s | `E2E-107` PASS ×3회. 콜드: dist(`fathom up` 경로) **1.5~2.6s**, src(`pnpm dev` 경로) **2.6~3.0s**. 6 pid 서로 다름·`registry.notices`에 `contracts_hash_mismatch` 0·`supervisor.handshake.rejected` 0 | **충족** |
| E0-2 | 첫 기동 `mode=OFFLINE`, 외부 소켓 0 | `E2E-107`·`E2E-100`(L1~L4 모두 0, 양성 탐침 1건 검출 = 측정기 건전) | **충족** |
| E0-3 | `fathom open` → `#bt=` 교환, 다른 포트 Origin 403·Host 421·포트 불일치 401 | `E2E`/`SEC-GW-001`(cross-origin) · 게이트웨이 `SEC-GW-002~005`(Host 위조 421 GW-AUTH-005 포함) · `IT-104`·`IT-105`(포트 불일치 401) PASS | **충족** |
| E0-4 | `--mode=migrate`(빈 HOME)·`--dry-run`, serve 스키마 불일치 exit 78, 적용 파일 sha256 변경 시 거부 | `services/{content,learning,ai-gateway,ops}/test/integration/migrations/**` 전부 PASS(예: `IT-210~214`: 53+7 테이블·뷰 7·FTS5 3·트리거 19, 변조 시 migrate·serve exit 78). *주의: §6 CO-N4(신규 HOME 첫 `pnpm dev`는 migrate 선행 필요)* | **충족** |
| E0-5 | `lint:hooks` 0 | `node tools/gates/check-hooks.mjs` 0/23 | **충족** |
| E0-6 | g3 `--warn-only` exit 0 · `check:gate-selftest` 0 · 빈 root·tsconfig 부재·tsgo 실패 탐침 exit 2 | g3 exit 0(위반 목록 §4) · selftest 0 · 게이트 단위 테스트 210/210(탐침 포함) · 직접 확인: 빈 root `check-boundaries` exit **2** | **충족** |
| E0-7 | supervisor 강제 종료 → 고아 0, 서비스 kill → ≤ 5s 재시작 | `services/ops/test/integration/supervisor/**`(`IT-521` SIGKILL → 자식 5 + 손자 전부 ≤ 5s 종료 등) PASS. 단 과부하(동시성 10)에서 `IT-521`이 1회 타임아웃 → §6 CO-N3 | **충족** (안정화 조치 적용) |
| E0-8 | `/_design` 토큰·`@fathom/ui` 렌더, 대비 테스트, Playwright 기준 스크린샷 | `packages/design-tokens/test`(UT-TOK-001 DS §3.4 최소값 재현) PASS · `E2E-506` PASS(기준선 3장 일치·외부 요청 0·CSP 위반 0) | **충족** |
| E0-9 | 정책 12종 로드·해시 검증, 해시 변경 + 같은 버전 = exit 78 | `packages/shared-kernel/test/integration/policy` PASS(51/51 통합 포함). `policy/*@v1.yaml` 12 + `policy.lock.json` | **충족** |
| E0-10 | graphify 기준 그래프 + `docs/40-impl/graph/INT-1a/` + 교차 엣지 0 | §8: 5,488 노드·13,038 엣지·217 커뮤니티, 교차 서비스 엣지 0, `audit:graph` 0 오류 | **충족** |
| E0-11 | `modes.manifest.json`·`verification-class.json` 존재, RTM에 검증 등급 열 | `packages/contracts/manifests/{modes.manifest.json,verification-class.json}` 존재, RTM-INT-1a V 열, `check:manifest`·`check:rtm` PASS | **충족** |

## 3. Task 결과 (완료 보고 + 리뷰 판정)

완료 보고 JSON에는 리뷰 판정 필드가 없다. 판정은 오케스트레이터 메모(`IT-00-carryover-notes.md`)에서만 확인된다 — 아래 "리뷰/비고" 열은 그 범위만 적었다.

| Task | 티어 | 보고 | 추가 테스트 | G1 중 실패한 명령(Task 시점) | 리뷰/비고 |
|---|---|---|---|---|---|
| T-00-01 스캐폴드 | T2s | done | 3 | 0 | turbo가 `AGENTS.md`를 덧쓰는 문제 → T1 결정으로 `agentGuidance:false` |
| T-00-02 contracts 코어 | T2s | done | 84 | lint | — |
| T-00-03 kernel 기반·testkit | T2s | done | 85 | lint·g1·scope(r1~r2) | 리뷰 r2 잔여 major 2건(`idempotency-key` 누락·UT-TK-035 중복)은 T2s 보완으로 처리(통합 시점 해소 확인: 전체 green) |
| T-00-04 sqlite·migrate·런타임 | T2s | done | 79 | lint·g1·scope | 리뷰 minor 5건 → §5에서 3건 수정, 2건 이월 |
| T-00-05 게이트 코어·CI | T2s | done | 17 | lint | `fr-iteration.json` 제3 형태 = T1 수용(IT-01 CO-24) |
| T-00-06 게이트 17종 | T2s | done | 150 | lint·g1 | 게이트 오탐/허용표 이슈 → §4 |
| T-00-07 토큰·ui | T2s | **partial** | 5 | lint·g1 | `biome.json` 에스컬레이션 → §5에서 해소 |
| T-00-08 eventing·service | T2s | done | 64 | lint·g1·scope | 에스컬레이션 3건 → §4·§6 |
| T-00-09 contracts content·ai·ops | T2s | done | 68 | 5건(전 레인 동시 실행 영향) | `noImportCycles` 억제 10곳 = T1 수용(CO-23) |
| T-00-10 contracts learning·gateway·gen | T2s | done | 46 | lint·g1 | `HomeAlert.href` `//` 허용 → CR 후보(CO-16) |
| T-00-11 supervisor·CLI | T2s | done | 146 | 6건(동시 실행 영향) | — |
| T-00-12 gateway·content | T2s | done | 108 | 5건 | **리뷰/보완 루프 2개가 동시 실행**(컨테이너 재시작 오인). 최종 트리 검증 완료 — 통합 전 구간에서 gateway 71 단위 + 5 보안, content 19 통합 green 재확인. 보안 에스컬레이션 3건 → §5 근본 수정 |
| T-00-13 learning·ai·ops-api 골격 | T2s | done | 56 | lint·g1·scope | — |
| T-00-14 web 셸 | T2s | **partial** | 5 | 8건 | biome CSS → §5 해소. 루트 `version` 부재 → CO-03 |
| T-00-15 정책 12종 | T1 | done | 10 | lint·g1·scope | `path_weights`·retention 키 → CO-17·18 |
| T-00-16 교차 테스트·E2E | T2s | **partial** | 29 | 6건 | E2E-506 실패(CSP 2건) → §5 해소. 통합 후 E2E 5/5 |

- **G1 1회 통과율**: Task 단위 `typecheck`·`test`는 16/16이 첫 시도 통과. `lint`·`run-gates --stage=g1`·`check-scope`는 **전 Task가 레인 동시 실행 때문에 첫 시도 실패**(깨끗한 Task 1/16). 병합 후 실측은 §1·§4(lint 0, g1은 deps·security 위반으로 exit 1 — 게이트 허용표 누락이지 코드 결함 아님).
- **보완 라운드**: 보고서만으로는 Task별 라운드 수를 알 수 없음(T-00-03 r2 · T-00-12 2루프가 메모에 있는 유일한 기록). 오케스트레이터가 별도 집계 필요.

## 4. 게이트 통계 (`run-gates --stage=g3 --int INT-1a --warn-only`, exit 0)

| 게이트 | 판정 | 위반 | 분류 · 처리 |
|---|---|---|---|
| gate-selftest · boundaries(879파일) · tsconfig-paths · ledger-writer · content-ingest · jev-index · lint:hooks · frozen · consumers · manifest(경고 1) · rtm(경고 37) | PASS | 0 | — |
| check:deps | WARN | 10 | **허용표 누락**(코드 결함 아님): `react-is`·`@testing-library/dom`·`@types/react`·`@types/react-dom`(web·ui), `@types/d3-force`(packc), `vite`(루트·testkit). → CO-05, `deps.json` 가산 CR 후보 |
| check:sql | WARN | 9 | `maintenance.sql.ts` PRAGMA 7(→ CO-07) · `contracts/src/ledger/types.ts:71` `RegExp.exec` **오탐** · `testkit/src/chaos.ts:74` 테스트 도우미 `prepare(sql)` |
| check:sql-typed | WARN | 42 | **게이트 버그**: import된 `*.sql.ts` 상수를 `dynamic-arg`로 오탐(→ CO-06, fixture `clean` 후보) |
| check:db-paths | WARN | 41 | contracts의 DB 파일명 열거(계약상 필수) → CO-08 `db_paths_exempt` 가산 CR 후보 |
| check:ng-g | WARN | 2 | lucide `Sparkles`·`WandSparkles` 식별자(`judge-badge.tsx` import) → CO-10 |
| check:typo-ko | WARN | 8 | **실제 위반 후보**: `packages/ui` `<p>`에 `text-sm` 이하(K11 본문 15px 미만) 8곳 — 수정 시 토큰·스크린샷 기준선 영향 → DS 판정 후 T-01-01 |
| check:security | WARN | 1 | `packages/shared-kernel/test/unit/redact/redact.spec.ts:10` 비밀 모양 리터럴(테스트 데이터) → 허용 표식/예외 필요(CR-60 관련) |

합계: 18종 중 11 PASS(경고만 있는 2종 포함) · 7 WARN, 위반 **113건**(deps 10 · sql 9 · sql-typed 42 · db-paths 41 · ng-g 2 · typo-ko 8 · security 1). **엔진 오류(exit 2) 0건.** 게이트 정확성(자기 실패 증명): 단위 210/210, 빈 root exit 2 직접 확인. INT-1b부터 차단 모드이므로 위 7종은 T-01-01 완료 전까지 G1 `blocked_by`.
`check:gates --stage=g1`(차단 모드)은 현재 deps·security에서 exit 1 — 같은 사유.

## 5. 통합 수정 내역 (변경 파일 전수 + 사유)

비동결 파일만 수정. 계약·ADR·`frozen.lock` 파일 0건(`check:frozen` 0). 모든 수정 뒤 typecheck·lint·관련 테스트 재실행.

| 파일 | 변경 | 사유 |
|---|---|---|
| `biome.json` | `css.parser.tailwindDirectives:true`; `tokens.css`·`typography.css`·`app.css` 포매터 off(overrides) | CO-01: DS-01 §14 바이트 동일 유지 + Tailwind 지시문 파싱. lint 오류 8건 해소 |
| `packages/shared-kernel/src/service/modes.ts` | 마지막 `switch`에 `default: return err('unknown --mode')` | biome `nursery/useExhaustiveSwitchCases` 1건(타입 추론 한계) |
| `apps/web/src/lib/zod-config.ts`(신규) + `apps/web/src/main.tsx`(첫 import) | `z.config({ jitless: true })` | E2E-506: zod 4 JIT 탐침 `Function('')`이 CSP `script-src` eval 위반을 냄. **계약 모듈이 스키마를 만들기 전**에 설정해야 해서 별도 부수효과 모듈을 최상단 import |
| `apps/web/vite.config.ts` | `build.assetsInlineLimit: 0` | 작은 woff2가 `data:` URI로 인라인 → gateway CSP `font-src 'self'` 위반 |
| `packages/shared-kernel/src/service/pipeline.ts` | 인증 등급·cache-control·health 분류를 **원문 `req.url`이 아니라 일치한 라우트의 선언 경로**(`route.path`)로 | **보안(CO-11 일부)**: `/%69nternal/…`·`/%61pi/…`·절대형 대상(`GET http://host/internal/…`)이 learning·ai-gateway·ops-api에서 인증을 건너뜀. 수정 후 위장 경로도 정규형과 같은 401. 잔여(CO-11): 비정준 인코딩 거부·`/api` 호출자 ⊂ `allowedCallers` 검사 |
| `packages/shared-kernel/src/service/app.ts` · `problem.ts` | `frameworkErrors` 훅 연결(파이프라인 생성 후 바인딩) + `FST_ERR_BAD_URL`·`FST_ERR_MAX_PARAM_LENGTH` → `VAL-900` 400 | CO-12: 잘못된 `%` URL이 Fastify 기본 JSON으로 응답 → problem+json |
| `packages/shared-kernel/src/http-client/http-client.ts` | 시험 호출 중 예외 시 `probeInFlight` 해제(catch→rethrow) · 재시도 중 서킷 open이면 마지막 실제 실패 반환 | CO-14(T-00-04 리뷰 minor 2건): half_open 영구 정체·실패 은폐 |
| `packages/shared-kernel/src/jobs/jobs.ts` | `serveJob` `emit()`의 invariant `throw` → abort + exit 70 | CO-14: promise 콜백 미처리 거부로 job이 멈춤 |
| `packages/shared-kernel/test/unit/service/pipeline.spec.ts` | `UT-SK-169`(잘못된 `%` → problem+json 400, `%XX`·절대형 `/internal` → 401) 추가 | 위 두 수정의 회귀 테스트(미사용 ID 169) |
| `services/gateway/test/unit/session-flow.spec.ts` (UT-GW-112·116) · `services/gateway/test/security/gateway.spec.ts` (SEC-GW-002) · `services/content/test/integration/migrations/serve.spec.ts` (IT-227·228) | `/internal` 위장 경로 기대값 404→**401**(허용 집합에 401 추가·코드 동등 비교) | 근본 수정 후 파이프라인이 먼저 401로 거부 — **거부 강도는 동일**(2xx·쿠키·토큰 0 단언 유지). 서비스별 404 가드는 이중 방어로 남김(삭제 안 함) |
| `packages/contracts/test/unit/gen/gen.spec.ts` · `apps/web/test/unit/routing/{chrome,routes}.spec.tsx` | `describe(…, { timeout: 30_000 }, …)` | 단위 테스트가 turbo 동시성 10(4코어)에서 10s 타임아웃(UT-CON-232·UT-WEB-447·442). 단언 변경 0, 프리셋 `testTimeout`(STD §13.4 = 10s, UT-TK 검증) 불변 |
| `turbo.json` | `"concurrency": "50%"` | 타이밍 민감 통합(IT-521 고아 ≤5s 등)이 4코어에서 동시성 10일 때 4회 중 2회 1건씩 실패 → 50%로 2회 연속 통과 |
| `pnpm-workspace.yaml` · `pnpm-lock.yaml` | `overrides: lodash-es 4.18.1` | C-07: high 취약점 해소(전이 의존만, 직접 의존·ARC §18 pin 불변). **CR 추인 필요**(PR-6) |
| `tools/gates/test/workspace.test.mjs` | `.gitignore` 기대 22줄(`.reports/` 추가), `pnpm-workspace.yaml` 기대에 `overrides` | IT-659: `.reports/`는 TST-01 §3의 si-docs 입력(이미 `.gitignore`에 있었음); IT-655: 위 override |

생성물(수기 편집 아님): `graphify-out/**`, `docs/40-impl/graph/INT-1a/**`, `docs/40-impl/reports/{UTR,ITR,RTM}-INT-1a.md`, `.reports/**`(gitignore). `/_design` 기준선 PNG 3장은 **재생성하지 않음**(렌더 동일 확인).

**수정하지 않은 이유(이월 판정)**: shutdown 순서(CO-13)는 ARC §4 종료 순서(1~8)를 바꾸는 설계 변경 → CR. 게이트 허용표·`deps.json`·`sql.json`·`ng-g.json`은 완화 = CR 없이 바꾸지 않음(게이트·테스트 약화 금지). `check:typo-ko` 8건은 시각 기준선 영향.

## 6. 이월 · CR 제안

IT-01 계획서의 CO-01~30과 대조했다. **닫힘**: CO-01(biome — 단 `empty-mcp.json`·`.snapshots` 무시는 lint 통과로 불필요 확인, CO-02 미해당), CO-12, CO-14 중 3/5, CO-11 중 핵심(근본 분류), CO-19(E0-1 `contracts_hash` 동일 확인). 아래는 **남은 항목과 이 통합이 새로 찾은 것**.

| ID | 항목 | 사유 · 제안 | 배정 |
|---|---|---|---|
| CO-03 | 루트 `package.json` `version` 부재(APP_VERSION 0.0.0) | 무영향(E2E 통과, 양쪽 0.0.0)이나 릴리스 전 필요 | T-01-01 |
| CO-05·07·08·10 | 게이트 허용표 갱신(deps 10 · pragma · db_paths_exempt · ng-g) | 완화이므로 CR 필요 — **CR 제안 4건**(다음 번호 CR-69~) | T-01-01 |
| CO-06 | `check:sql-typed` 42건 오탐 | 게이트 버그(`getAliasedSymbol`) + `fixtures/clean` | T-01-01 1순위 |
| CO-09 | testkit egress-recorder 우회 2건 | CR(boundaries·biome override) | T-01-01 |
| CO-11 잔여 | 비정준 인코딩 거부 · `/api` 호출자 ⊂ `allowedCallers` · 서비스별 가드 제거 판단 | 근본 분류는 닫음. 잔여는 교차 SEC 회귀(learning·ai-gateway·ops 대상) 추가와 함께 | T-01-01 |
| CO-13 | SSE 종료가 grace 전체 대기 | 종료 순서 설계 변경 = CR | T-01-01 |
| CO-14 잔여 | migrate I/O 오류 사유 코드 · job 자식 env의 `*_API_KEY` 전달 | 후자는 CR(허용 env 축소) | T-01-01 |
| CO-15~18, 20~30 | 계획서 그대로 | 변경 없음 | 계획서 배정 |
| **CO-N1** | `typo-ko` body-min 8곳(`ai-offline-note`·`card`·`confirm-by-name`·`empty-state`·`error-panel`×3·`input`) | 실제 위반 후보. 수정 시 `/_design` 기준선 재생성 필요(DS 판정) | T-01-01 + DS 판정 |
| **CO-N2** | `check:security` `redact.spec.ts` 비밀 모양 리터럴 | 테스트 데이터용 표식/예외 정의 | T-01-01 |
| **CO-N3** | 타이밍 취약 통합 테스트: `UT-SK-098`(`vacuumInto`, 병렬 쓰기 중 `database is locked` — 전체 패키지 통합 5회 반복 중 1회, 해당 파일만 6회 반복은 0회) · `IT-521` | 근본 조사 필요(백업은 quiesce 아래에서만 쓰므로 실사용 위험 낮음). `turbo concurrency 50%` 임시 조치. ADR-008 §10 문구에 반영하는 CR 제안 | T-01-01 조사 |
| **CO-N4** | 신규 HOME에서 `pnpm dev`·`fathom up`이 `needs_migrate`(exit 78)로 4개 서비스 degraded | 설계상 migrate는 서빙 밖(ARC §1265)이며 테스트 하네스는 `migrateHome`을 먼저 호출. **사용자 첫 기동 경로에 migrate 자동화가 아직 없음** — IT-02 설치/온보딩 전에 T1 결정 필요(`fathom up`이 run_mode migrate 선행 vs 설치기) | T1 판정 → IT-01/02 |
| **CO-N5** | vitest JSON 리포터·node:test TAP 출력이 `.reports/<INT>/`로 가는 배선 없음 | UTR/ITR이 비는 구조. 이 통합은 `vitest --reporter=json`을 패키지별 `.reports/{ut,it,sec}.json`으로 수집해 생성(스크립트는 일회성, 저장소에 미포함) | T-01-01(`test` 스크립트·preset reporters) |
| **CO-N6** | `coverage-summary.json` 생성 배선 없음(C-06 판정 불가) | domain 코드가 생기는 IT-01부터 필요 | T-01-01 |
| **CO-N7** | RTM: `FR-CUR-016` 고아(INT-1a 판정인데 매핑 테스트 0, CO-25와 동일 계열) · `NFR-UX-012` ↔ `E2E-506`이 ITR에서 `unknown` | RTM 매핑 정정 + si-docs의 Playwright `annotations`/`tag` 파싱 점검 | T1(RTM) · T-01-01 |
| **CR 제안** | `lodash-es` override 추인(§5) · turbo `concurrency` · 허용표 4건 · 게이트 버그 수정 | CR 번호는 T1이 대장에 부여 | T1 |
| 리뷰 결손 | C-12 디자인 루브릭 평균 · C-14 `model_id` 대조 · C-15 부록 A 표본 | T1 몫 — 이 통합에서 수행하지 않음 | T1 |

## 7. u 실측

- 계획: WP u 합 **23.4u**(임계 경로 11.0u).
- 실측: **산출 불가** — Task 완료 보고에 시작·종료 시각이 없고 T0는 git 이력을 쓰지 않았다. VC-1(첫 속도 측정점)은 오케스트레이터가 Task 이벤트 타임스탬프로 산출해야 한다. 참고 값: 통합 자체(T0) 소요 약 1세션, 전체 `pnpm test` ≈ 1~2분, 통합 테스트 ≈ 90초, E2E ≈ 25초, 콜드 부트 ≈ 3초.
- 규모: 변경 파일(Task 보고 합) 1,556 · 추가 테스트 합 955(보고 기준) · si-docs 집계 제목 1,248 / 결과 1,226(22건은 이번 범위에서 실행되지 않은 제목).

테스트 결과(이 통합 실측, UTR/ITR 요약): 단위 1,085 · 계약 22 · 통합 101 · 보안 6 · E2E(Playwright) 5 — 전부 PASS, 실패·건너뜀 0.

## 8. graphify 지표

| 항목 | 값 |
|---|---|
| 도구 | graphify 0.9.72, `graphify extract . --code-only`(최초 기준선) → `graphify update .` → `cluster-only --no-label`(LLM 라벨러 없음 → 커뮤니티 이름 = 기본 라벨) |
| 그래프 | **5,488 노드 · 13,038 엣지 · 217 커뮤니티**(최초 5,308/12,959/204 → 통합 수정 후 갱신) |
| 단위별 노드 | contracts 1,192 · shared-kernel 703 · web 577 · ops 416 · ui 346 · gates 331 · testkit 294 · gateway 292 · si-docs 254 · cli 197 · learning 115 · ai-gateway 111 · graph 81 · design-tokens 76 · packc 74 · fake-cli 44 |
| 교차 서비스 엣지 | **0** (`graph:snapshot` 0 · `audit:graph` 0 오류·0 경고, 5,246 파일) |
| god nodes top 10 | `S()` 139 · `Ulid` 89 · `cn()` 83 · `ok()` 81 · `err()` 76 · `EpochMs` 62 · `ServiceName` 62 · `GateEngineError` 59 · `ServiceDeps` 56 · `ServiceApp` 55 (파일 단위 상위: `contracts/scripts/gen.ts` 208 · `common/ids.ts` 179 · `common/schema.ts` 140). **전부 계약·kernel 공통 기반** — 서비스 간 허브 없음 |
| 제외·한계 | `.graphifyignore`(docs·tests·fixtures·spikes·`*.gen.ts` 등) 적용 → 1,673 파일 추출. `.sql` 17개는 `tree_sitter_sql` 미설치로 그래프 기여 0(DDL은 `check:hooks`·통합 테스트가 검증) |
| 산출물 | `graphify-out/{GRAPH_REPORT.md,graph.json,graph.html,manifest.json}`(+ `.graphify_*`·날짜별 스냅샷 디렉터리) · `docs/40-impl/graph/INT-1a/{metrics.json,GRAPH_REPORT.md,god-nodes.txt,god-nodes.json}` — **커밋 대상**(`graphify-out/cache|memory|reflections`는 `.gitignore`) |

## 9. 사건 기록 (사후 참고)

- T-00-12에 리뷰/보완 루프 2개가 동시에 실행(컨테이너 재시작 오인). 최종 트리는 통합에서 gateway 단위 71·보안 5·content 통합 19 재확인으로 일관성 확인.
- 통합 중 `pnpm dev`를 신규 HOME에서 수동 기동해 CO-N4를 발견했다. 기동한 supervisor·vite·자식 프로세스는 모두 SIGTERM으로 정상 종료 확인, 임시 `.fathom-dev/`·임시 HOME 삭제. 이후 모든 스택 기동은 E2E 하네스가 수행·정리했고 종료 후 잔존 프로세스 0을 확인했다.
