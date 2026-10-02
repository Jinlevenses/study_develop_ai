# CR 대장 색인 (Change Request Ledger) — Fathom · 깊이

> 소유: T1(WP-00-00) · 기준선: [ADR-000 Architecture Freeze Baseline v1.0](../adr/ADR-000-architecture-freeze.md) · 동결 해시: [`../frozen.lock`](../frozen.lock)
> 이 파일은 **살아 있는 CR 번호 대장**이다. ADR-000 §4와 `CLAUDE.md`의 "다음 번호 CR-57"은 동결 시점(2026-10-01) 기록이며, **현재 다음 번호는 이 파일의 §4가 정본**이다.

## 1. 규칙 (ADR-000 §2 요약)

| 변경 종류 | 경로 | 기록 |
|---|---|---|
| 가산(새 `.optional()` 필드·`'O'` 라우트·테이블·소비자 영향 없는 enum 값·게이트 규칙 추가·스택 가산) | **CR** | 이 대장에 번호 + `CR-<nn>-<slug>.md`(1 CR = 1 파일, STD-01 D-STD-20). 커밋 트레일러 `CR: CR-<nn>` |
| 파괴(F-1~F-12의 삭제·의미 변경·이름 변경·순서 역전) | **ADR-017~ + 회고 승인** | `adr/ADR-<nnn>-*.md`, Accepted 후 `frozen.lock` 재생성. 트레일러 `ADR: ADR-<nnn>` |
| 긴급(보안·데이터 손실) | T1 ADR 초안 + 수정 병합 → 다음 회고 사후 승인 | 미승인 시 되돌림 |

- T2 에이전트는 CR을 발행하지 않는다. 필요하면 작업을 멈추고 `contract_change`·`dependency`·`scope` 에스컬레이션(STD-AGT-12) → T1이 번호를 붙인다.
- 계약 변경을 적용하는 Task는 반복의 첫 직렬 그룹(S0)에서만 실행한다(WBS-01 §2.2 PR-2).

## 2. 번호 구간 색인

| 구간 | 범위 | 상태 | 정본 기록 |
|---|---|---|---|
| CR-01 ~ CR-28 | 기획 기준선 대비 | 반영 완료 | [ARC-01 §22](../01-architecture.md) |
| CR-29 ~ CR-34 | DB-01(29·30)·DCP-01(31~34) 제안 | CR-29·33 의무화(CR-42 묶음), 나머지 반영 | ARC-01 §22, [DRL-01 §2](../10-design-review-log.md) |
| CR-35 ~ CR-56 | PG-2 교차 문서 정합 | 반영 완료 | [DRL-01 §2](../10-design-review-log.md), ARC-01 §22 |
| AI-01 ★ 메모 D-AI-09·10·14·15·16·17·26 | AI 설계 → IF·DB | 반영 완료(D-AI-09 = CR-43) | AI-01 §19 설계 메모, ADR-000 §4 |
| **CR-57 ~ CR-68** | **PG-2 잔여 CR 후보 번호 부여(WP-00-00)** | 아래 §3 | 이 파일 |
| **CR-69 ~ CR-76** | **IT-01 S0 이월(T-01-01)** | 아래 §3.1 | 이 파일 |
| 미결(값) | SIM-PROMO(CR-18~22 값) · SIM-LDI(`ldi_params@v1`) | VC-1(INT-2 진입 조건) | WBS-01 §5.5 |

## 3. CR-57 ~ CR-68 — PG-2 잔여 후보 번호 부여 (2026-10-01, T1 판정)

WBS-01 §4.1 진입 조건("CR 원천 전부를 번호로 받는다")에 따라, STD-01 §19·TST-01 §21·DS-01 §16·SCR-01 DN의 **"CR 후보"** 중 번호가 없던 항목에 번호를 준다. 전부 **가산**(구조 역전 0)이므로 ADR이 필요 없다. 영향 문서의 문구 정정은 해당 문서를 다음에 개정할 때 `CR:` 트레일러와 함께 한다(동결 문서를 이 판정만으로 고치지 않는다).

| CR | 원천 | 결정 | 영향(ARC·문서) | 적용 Task(IT-00) | 상태 |
|---|---|---|---|---|---|
| CR-57 | STD D-STD-09 | `yaml` **2.9.1** 정확 pin을 `@fathom/shared-kernel`(policy 로더·`parseYamlStrict()`)·`tools/packc` 허용 의존에 가산. 옵션 `{schema:'core', uniqueKeys:true, maxAliasCount:0, merge:false}` | ARC §17.1·§18 가산, `deps.json` | T-00-01(pin) · T-00-04(로더) · T-00-06(deps.json) | 승인 · IT-00 적용 |
| CR-58 | STD D-STD-10 · TST §3.1 | `@vitest/coverage-v8` **5.0.2** 루트 devDependency(G2 domain 커버리지 수단) | ARC §18 가산 | T-00-01 | 승인 · IT-00 적용 |
| CR-59 | STD D-STD-14 | `tools/gates/check-scope.mjs`(Task `allowed_paths` 대조) · `run-gates.mjs --stage=g1\|g2\|g3` · `check-graphify-edges.mjs --extract` · 루트 `graph:snapshot` | ADR-010 게이트 표 가산 | T-00-01(스크립트) · T-00-05 · T-00-06 | 승인 · IT-00 적용 |
| CR-60 | STD D-STD-16 · D-STD-02 · SCR DN-11 | 금지 API·SQL·경계 규칙 묶음: `check:security` 어휘(`innerHTML`·`outerHTML`·`insertAdjacentHTML`·`document.write`·`new Buffer(`·`url.parse(`·`crypto.createCipher(`·`createHash('md5'\|'sha1')`·`.backup(`·키 패턴 리터럴(예외 `evals/sets/secrets-50/**`)·domain `Math.random`·web `lib/` 밖 `fetch(`/`EventSource(`) · `check:sql`(서비스 코드 `PRAGMA`·지연 `BEGIN`·content 검색 `LIKE`·`eventing` 밖 outbox INSERT) · `check:boundaries` intra(`sk-pure`·`builtin-restricted`·`web-feature-cross`) · `ng-g.json` G3 범위에 `apps/web/src/features/**/renderers/**`(post-submit 제외). 각 규칙은 음성 fixture 동반 | ADR-010 게이트 표 가산(완화 0) | T-00-05 · T-00-06 | 승인 · IT-00 적용(INT-1a는 warn-only) |
| CR-61 | STD D-STD-24 · TST SEC-GW-009 | gateway CSP 헤더(STD-01 D-STD-24 값, dev 프로파일만 HMR 예외) | ARC §12 보안 헤더 가산 | T-00-12 | 승인 · IT-00 적용 |
| CR-62 | TST D-TST-12 · TST §3.5 | `tools/si-docs/**` 소유 = L-PLAT, `src/{itr,prf,sec,dod,cli}.ts` 가산, 루트 스크립트 `si:reports` | ARC §16.1 레인 표 정정 | T-00-01(스크립트) · T-00-05 | 승인 · IT-00 적용 |
| CR-63 | TST D-TST-04 | `tools/gates/config/boundaries.json`에 `tests` 단위(허용 import = contracts·shared-kernel·testkit) | ADR-010 경계 표 가산 | T-00-05 | 승인 · IT-00 적용 |
| CR-64 | TST D-TST-08 | `ci-build.yml`을 online(설치·`pnpm audit`) / offline(그 밖 전부) 두 단계로 분리, audit 불통 = 실패 | NFR-MAINT-009 해석, AQ-15 | T-00-05 | 승인 · IT-00 적용 |
| CR-65 | TST D-TST-20 · FX-05 | 골든 경로(`packages/testkit/src/golden-ledgers/**` 등)를 `frozen.lock` 대상에 포함, `--update-golden` + 트레일러 `Golden: <사유>` | `frozen.lock` `pending`(freeze_at INT-1b) | (IT-01 골든 원장 WP) | 승인 · **IT-01 적용**(IT-00엔 골든 파일 없음) |
| CR-66 | TST D-TST-01 | STD-01 §16.1 표의 TST-01 위치 `docs/04-test/01-test-plan.md`로 정정(구조 영향 0) | STD-01 §16.1 문구 | — | 승인 · 다음 STD 개정 시 적용 |
| CR-67 | DS DN-D1 · SCR DN-13 | `d2coding@1.3.2`(OFL)를 web 의존·`deps.json` 허용표에 가산(코드 한글 폴백) | ARC §18 폰트 행 가산 | T-00-01(pin) · T-00-06(deps.json) · T-00-07(토큰) | 승인 · IT-00 적용 |
| CR-68 | SCR DN-09 | `check-manifest.mjs` 규칙 `manifest/renderer-missing`(included 모드 format 후보 ∩ 렌더러 레지스트리 키 ≠ ∅, `e2e_id` 일치) | ADR-010 게이트 표 가산 | T-00-06 | 승인 · IT-00 적용 |

- **이미 번호가 있던 후보**(재번호 없음): D-STD-25 → CR-35 · D-TST-15 → CR-44 · SCR DN-01 → CR-36 · SCR DN-12 → CR-45 · AI-01 D-AI-09 → CR-43.
- **CR 아님으로 판정**: STD D-STD-17(`.gitignore` 두 줄 — T-00-01 소유 파일의 일반 변경), D-STD-15·DN-10(`[_]design.tsx` — 라우트 문자열 불변, INT-1a 단위 테스트로 확인).
- **불일치 기록**: DRL-01 §5는 `check:frozen` 가동 주체를 WP-00-15로 적었으나 WBS-01 §4.2는 `check-frozen.mjs`를 WP-00-17 소유로 둔다 → **WBS(소유 경로 정본)를 따른다**(IT-00 = T-00-06).

## 3.1 CR-69 ~ CR-76 · ADR-017 예약 — IT-01 S0 이월(T-01-01) 번호 부여 (2026-10-02, T1 판정)

PLAN-IT-01 §3 "CR 번호는 S0 착수 전 T1이 부여"에 따라 IT-00 이월(CO-xx) 중 CR 후보에 번호를 준다. 적용 Task = **T-01-01**(Brief `docs/40-impl/briefs/IT-01/T-01-01.md`). 영향 문서(ARC §17.1·§18, STD-SQL-04, IF-01 §5 `insight.ts` 블록)의 문구 정정은 다음 개정 때 같은 트레일러로 한다.

| CR | 원천 | 결정 | 영향 | 적용 Task | 상태 |
|---|---|---|---|---|---|
| CR-69 | CO-05 (T-00-06) | `deps.json` 허용표 가산: `react-is` 19.3.0(web) · `@testing-library/dom` 10.4.2·`@types/react` 19.3.0·`@types/react-dom` 19.3.0(web·ui, dev) · `@types/d3-force` 3.0.10(packc, dev) · `vite` 8.3.1 단위에 `(root)`·`packages/testkit` 가산. 새 설치 0 | ARC §17.1·§18 표 가산 | T-01-01 | 승인 · IT-01 적용 |
| CR-70 | CO-07 (T-00-08) | `sql.json` `pragma_allow` += `packages/shared-kernel/src/service/maintenance.sql.ts`(유지보수 PRAGMA 상수 1파일). STD-SQL-04 "팩토리·마이그레이션 실행기" + "서비스 골격의 유지보수 루틴" | STD-SQL-04 문구 | T-01-01 | 승인 · IT-01 적용 |
| CR-71 | CO-08 (T-00-06) | `sql.json` `db_paths_exempt` += `packages/contracts/src/{db-hooks.ts,admin/epoch-manifest.ts,admin/admin-routes.ts}`(DB 파일명 = 계약 데이터, 경로 조립 0) | ADR-010 게이트 예외 표 | T-01-01 | 승인 · IT-01 적용 |
| CR-72 | CO-09 (T-00-03) | `boundaries.json` `builtin_restricted.child_process` += `packages/testkit/src/preload/**`, `biome.json` `noProcessEnv` off override += 같은 경로(테스트 전용 preload) → 정적 import 복귀·biome-ignore 2건 제거 | STD-TS-40·STD-CFG-20 예외 표 | T-01-01 | 승인 · IT-01 적용 |
| CR-73 | CO-16 (T-00-10) | `HomeAlert.action.href` 정규식 `/^\/(?!\/)[A-Za-z0-9/_$.?=&-]*$/`(프로토콜 상대 `//host` 거부). 스냅샷 diff = `pattern` 변경(파괴 분류) → **ADR-017(보안 긴급 경로, 회고 사후 승인)** 트레일러와 함께 | IF-01 §5 `insight.ts` 블록 | T-01-01 | 승인 · IT-01 적용 |
| CR-74 | CO-04 (T-00-01) | 루트 `engines.node` `>=22.18.0`(타입 스트리핑 기본 활성 하한, `.node-version` 22.22.2 불변) | ARC §18 런타임 행 | T-01-01 | 승인 · IT-01 적용 |
| CR-75 | CO-14 (T-00-04 리뷰) | job 자식 env = `ALLOWED_ENV` 중 `*_API_KEY` **제외**(키는 ai-gateway 프로세스만, job 8종 중 키 사용 0) | STD-CFG-21 | T-01-01 | 승인 · IT-01 적용 |
| CR-76 | (INT-1a 이월 실사) | `check:security` `security/secret-literal` 제외 += `packages/shared-kernel/test/unit/redact/**`(redact 단위 테스트 = 비밀 패턴 자체가 시험 대상, `evals/sets/secrets-50/**`와 같은 부류) | ADR-010 게이트 예외 표 | T-01-01 | 승인 · IT-01 적용 |

- **CR 아님(게이트 결함 수정, T1 판정)**: `check:sql-typed` import 별칭 미해석(CO-06) · `check:sql` dynamic-arg가 `packages/contracts/src/**`(SQLite 접근 0 단위)의 `RegExp.exec`를 탐지 · `check:ng-g` `import { Sparkles as AiMark }`의 원 이름 탐지(CO-10) · `check:typo-ko` `<p>`+`text-xs`/`text-sm`(12.5·13.5px = DS-01 K11 캡션 하한 12.5px 이상)을 본문 미달로 판정. 각 수정은 `fixtures/<check>/clean` 회귀 동반.
- **기존 CR 이행**: CO-17 `ComposerPolicyV1.path_weights` = CR-52(DCP DN-22) 전사(`.optional()` 가산).

## 3.2 CR-77 ~ CR-79 — INT-1a 통합 판정 후속 (2026-10-02, T1 판정)

| CR | 원천 | 결정 | 영향 | 적용 | 상태 |
|---|---|---|---|---|---|
| CR-77 | INT-1a C-10 (graphify 기준 그래프) | `graphify-out/`은 **사람이 읽는 산출물만 커밋**: `GRAPH_REPORT.md`·`graph.html`. `graph.json`(≈7MB)·`manifest.json`·`.graphify_*`·`cache/`·날짜 백업 폴더는 매 통합마다 재작성되어 이력을 비대화하므로 `.gitignore` — 로컬에서 `pnpm graph:update`(= `graphify update .`)로 재생성. INT 스냅샷 지표는 `docs/40-impl/graph/INT-<id>/`(metrics·god-nodes)에 계속 커밋 | STD-GRF §18 "graphify-out/ 커밋" 문구, CLAUDE.md §6 | INT-1a 커밋 | 승인 |
| CR-78 | INT-1a C-07 (`pnpm audit --prod --audit-level high`) | `pnpm-workspace.yaml` `overrides: lodash-es 4.18.1`(전이 의존 취약점 해소, 직접 의존 추가 0) | ARC §18 표 주석 | INT-1a 커밋 | 승인 |
| CR-79 | INT-1a CO-N3 (타이밍 민감 테스트) | `turbo.json` `concurrency: "50%"` 임시 상한(4코어 컨테이너 과부하로 UT-SK-098·IT-521 간헐 실패). 근본 원인은 T-01-01에서 조사, 해소 시 제거 | ADR-008 §10 루트 스크립트 | INT-1a 커밋 | 승인(임시) |
| CR-80 | INT-1a C-14 (STD-AGT-02 `model_id`) | 저장소에 푸시되는 산출물(완료 보고·INT 기록·커밋)에는 **실제 모델 ID를 기록하지 않는다**(저장소 정책). `model_id` 필드 = 티어 별칭 `T1`(상위 모델)·`T2s`(하위 모델)·`T2h`(최하위 모델). 실제 모델 대조는 오케스트레이터 워크플로 설정(티어→모델 매핑, 저장소 밖)으로 하며, INT 기록은 "티어 일치"만 판정 | STD-AGT-02 문구, TST C-14 | 전 반복 | 승인 |
| CR-81 | INT-1a 판정 이월(STD-TS-12 A-05) | 동결 파일 `services/ops/src/supervisor/{tokens,ports,bundle,child}.ts`의 `as` 캐스트를 zod 파싱·타입 빌더로 대체하는 **비행동 변경**을 허용(T-01-01). 공개 동작·IPC 계약·테스트 기대값 불변. 적용 커밋에 `CR: CR-81` 트레일러, T1이 `frozen.lock` 해당 4파일 sha256 재계산 | ADR-000 F-? supervisor 동결 항목 | T-01-01 | 승인 |

## 4. 다음 번호

| 종류 | 다음 번호 |
|---|---|
| CR | **CR-82** |
| ADR | **ADR-018** (ADR-017 = CR-73 보안 긴급 경로로 예약, 초안 T1) |

## 5. 관련

- 동결 선언·대상(F-1~F-12)·변경 통제: [ADR-000 §1·§2·§4](../adr/ADR-000-architecture-freeze.md)
- PG-2 정합 개정 기록(CR-35~56, 지적 60건): [10-design-review-log.md](../10-design-review-log.md)
- 기획 기준선 대비 CR(CR-01~28)·설계 CR 표: [01-architecture.md §22](../01-architecture.md)
- `check:frozen`(트레일러·스냅샷 diff 분류): ADR-008 §8, WBS-01 WP-00-17
