# SP-7 스파이크 보고서 — TS 7(tsgo) 세대의 정적 게이트 4종 (boundaries · Jev 인덱스 · SQL 템플릿 · NG-G)

- 대상 요구: NFR-MAINT-001(서비스 경계, `check:boundaries` 위반 0 + graphify 교차 서비스 직접 엣지 0), NFR-MAINT-002(타 서비스 DB 경로 열기 0), NFR-MAINT-005(`typecheck`·`biome ci` 경고 0), NFR-UX-008·FR-UX-008(NG-G 자동 검사), FR-QST-022·FR-QST-026(정답·해설 제출 후 공개), FR-STD-018(백지노트 제출 전 AI 생성 호출 거부), FR-AI-005(Jev 객체 키 참조), `03-convergence.md` §11 SP-7 행, tech-stack-facts "TS 7 도구 호환성 확인 필요"
- 코드: `/home/user/study_develop_ai/spikes/sp7-static-gates/` (독립 패키지, `npm run spike`)
- 원시 결과: `spikes/sp7-static-gates/results/summary.json` (이 보고서의 모든 수치의 출처, 생성 시각 2026-09-30T23:33:35Z)
- 검증 등급: 전 수치는 **Linux 컨테이너 실측(V-build)**. Windows·macOS·pnpm 워크스페이스는 실행하지 못했으므로 **V-live pending**(§8).

## 1. 가설

> TS 7(tsgo, Go 네이티브 컴파일러)에서는 `require("typescript")`로 얻는 in-process 컴파일러 API(`createProgram`)가 사라져, 그 위에 얹힌 린터(typescript-eslint 등)를 쓸 수 없다. 그래도 (1) check:boundaries, (2) Jev 인덱스 lint, (3) SQL 템플릿 스캔, (4) NG-G lint 4종은 **Biome GritQL 플러그인 · 토큰/정규식 스크립트 · graphify 엣지 · tsgo 실험 API**의 조합으로 구현할 수 있고, 각 검사는 위반 픽스처에서 0이 아닌 종료 코드, 깨끗한 픽스처에서 0을 낸다.

합격 기준(`03-convergence.md`): **4종 검사 PoC 동작**(INT-1a G1 게이트 전). 실패 시 대응: 도구 전용 TS 5.9/6.x를 devDependency로 병행 pin(앱 컴파일은 TS 7 유지), STD-01에 기록.

이 스파이크가 추가로 답한 질문: (a) `tsc` 7.0.2가 픽스처를 타입 검사하는가, (b) 4종 게이트에 TS 5.9가 필요한가, (c) 흔한 TS 기반 도구(typescript-eslint · ts-morph · dependency-cruiser · madge · knip · vitest · tsx · Biome)는 TS 7 옆에서 어떻게 되는가.

## 2. 환경

| 항목 | 값 |
|---|---|
| Node | `v22.22.2` |
| OS | Linux 6.18.44-fc-v50 x86_64 (microVM), 4 vCPU |
| TypeScript | `7.0.2` (`tsc -v` = Version 7.0.2) |
| Biome | `2.5.14` (정확 pin. 호환성 실험 디렉터리에서 `^2.5.15`도 설치돼 동작함) |
| graphify | `0.9.72` (`/root/.local/bin/graphify`, tree-sitter 기반) |
| es-module-lexer | `3.0.2` (TypeScript 구문을 어휘 분석함) |
| tsx / zod / react 타입 | `4.23.15` / `4.6.5` / `19.3.0` (픽스처 컴파일용) |
| 호환성 대조군 | typescript `5.9.3`, `@typescript/typescript6`(6.0.x), typescript-eslint 8.71.0, eslint 10.11, ts-morph 28, dependency-cruiser 18.4, madge 8, knip 6.39, vitest 5.0.3 + vite 8.3.1 |
| 미검증 | Windows, macOS, pnpm 워크스페이스(심볼릭 링크 해석), 비 root 사용자, 실제(비합성) 코드베이스에서의 오탐률 |

## 3. 방법

### 3.1 픽스처 (가짜 모노레포)

`fixture/clean`(28파일), `fixture/violations`(38파일), `fixture/evasions`(19파일). 구조는 `services/a`, `services/b`, `packages/contracts`, `packages/shared-kernel`, `packages/design-tokens`, `apps/web`이다. `tsconfig.json`의 `paths`로 `@fathom/svc-a`, `@fathom/contracts`, 그리고 **명명 규칙을 따르지 않는 별칭 `@legacy/b`**(모듈 해석 없이는 못 잡는 회피 사례)를 둔다.

위반 픽스처의 정답은 소스 안의 `// EXPECT[rule]` 주석 마커다. 각 검사기의 보고를 마커와 대조해 정밀도·재현율을 계산한다(라인 기준 + 규칙 기준). 회피 픽스처는 `EVADES[...]`(잡으면 안 되는 것이 아니라 **못 잡는 것을 일부러 심은 것**), `DETECTS[...]`, `SAFE[...]` 마커로 각 엔진이 실제로 침묵하는지·잡는지를 기록한다.

### 3.2 구현한 검사 4종 (모두 `src/`, 종료 코드 0/1, 엔진 자체 실패는 2)

| 스크립트 | 정책 | 주 엔진 |
|---|---|---|
| `check-boundaries.mjs` | 서비스→서비스 import 금지(허용: `packages/contracts`, `packages/shared-kernel`, `packages/design-tokens`), 타 서비스 SQLite 파일 열기 금지(`new DatabaseSync("<타 서비스 경로>")`) | `tokens`(자체 토크나이저) / `lexer`(es-module-lexer) / `regex` / `tsgo`(`typescript/unstable/sync`) / `both`=tokens ∪ tsgo |
| `check-jev-index.mjs` | Jev 코드(`/jev/`, `*.jev.*`, `@typesafe-ai/sdk` import 파일, `jev/` 아래 `.md` 프롬프트)에서 배열 위치 참조 금지: `candidates[3]`, `.at(0)`, `"item 2"`, `"3번째"`, `` `${i + 1}.` ``, `{ index: 0 }` | 토큰 + 문자열 조각 규칙 |
| `check-sql-template.mjs` (+ `check-sql-typed.mjs`) | `prepare()`/`exec()` 인자가 리터럴이 아니면 위반: 템플릿 `${}`, `+` 연결, `.concat`, 파일 내 오염 변수(`q += ...`), 증명 불가한 동적 인자. 허용: 리터럴, `${}` 없는 템플릿, `ident()`·`placeholders()`·`sqlInt()`, UPPER_SNAKE import 상수, `// sql-ok: <사유>` | 토큰 + 파일 내 이름 기반 데이터 흐름 / tsgo 타입 기반(수신자가 `DatabaseSync`인지 타입으로 판정) |
| `check-ng-g.mjs` | 아래 §4.4 표 | 토큰 + CSS/JSON 전용 스캐너 |

추가로 `run-gates.mjs`(`npm run check:all`)가 4종을 묶어 CI 진입점 역할을 한다(`--root`로 대상 지정).

### 3.3 대안 엔진

- **Biome 2.5.14**: GritQL 플러그인 `biome-plugins/*.grit` 10개 + `noRestrictedImports`(경계용). 플러그인별 적용 범위는 `biome.json`의 `plugins[].includes`로 지정한다.
- **graphify**: `graphify extract <root> --code-only --no-cluster --force --out <tmp>` 후 `graphify-out/graph.json`의 `imports_from`/`re_exports`/`dynamic_import`/`imports` 엣지에서 단위(`services/*`, `apps/*`, `packages/*`)가 다르고 공유 허용 목록에 없는 것을 위반으로 본다(`check-graphify-edges.mjs`).
- **tsgo 실험 API**: `import { API } from "typescript/unstable/sync"` — 네이티브 tsgo 프로세스를 자식으로 띄워 `program.getSourceFile`, `checker.getSymbolAtLocation`을 호출한다.

### 3.4 호환성·규모 측정

`compat/{ts7,ts7-swc,ts5,ts7-sbs,ts7-more}`: 각각 `typescript` 버전을 달리한 설치본에서 `compat/probe.mjs`를 실행해 도구별 동작 여부를 기록한다. 규모 측정은 픽스처를 복제해 **TS 822파일·서비스 102개** 합성 저장소를 만들고 각 검사를 중앙값(반복)으로 측정한다(`SP7_SKIP_SCALE=1`이면 생략).

## 4. 결과

### 4.1 `tsc` 7.0.2와 컴파일러 API

| 항목 | 결과 |
|---|---|
| `tsc -p` clean / violations / evasions | 모두 exit 0, 진단 0 (505ms / 376ms / 262ms). **위반 픽스처도 타입 오류가 없다 → 4종 게이트는 타입 검사가 못 잡는 영역을 다룬다** |
| 음성 대조(`const x: number = "s"`) | exit 1, `TS2322` 정상 보고 |
| `require("typescript")` | 내보내기 키 = `version`, `versionMajorMinor` 뿐. **`createProgram === undefined`** |
| `typescript/unstable/sync` (실험 API) | 동작. 프로젝트 열기 140ms, 소스 32개, 의미 진단 27ms, 프로세스 전체 264ms |

### 4.2 (1) check:boundaries — 위반 13건 기대(픽스처 `violations`), `clean` 오탐 0 기대

| 엔진 | 위반 exit | clean exit | 정밀도 | 재현율 | 시간(위반 픽스처) | 비고 |
|---|---|---|---|---|---|---|
| tokens(자체 토크나이저) | 1 | 0 | 1.00 | 0.92 (12/13) | 123ms | `@legacy/b`(명명 규칙 밖 별칭)만 놓침 |
| es-module-lexer | 1 | **1** | 0.91 | 0.77 | 63ms | **TSX(`App.tsx`)를 파싱 못 해 clean에서 오탐 → 게이트 부적합**. `DatabaseSync` 경로 검사 불가 |
| regex(단순 줄 정규식) | 1 | **1** | 0.71 | 0.77 | 57ms | 주석·문자열 안 `from "…"`에서 clean 오탐 4건 |
| tsgo API | 1 | 0 | 1.00 | 1.00 (13/13) | 291ms | `tsconfig paths`·package exports·심볼릭 링크를 컴파일러가 해석 → `@legacy/b` 검출 |
| **tokens ∪ tsgo(`both`)** | 1 | 0 | **1.00** | **1.00** | 288ms | 권장. 13/13, 오탐 0 |
| Biome GritQL(`boundaries.grit`) | 1 | 0 | 1.00 | 0.77 (10/13) | 86ms | `@legacy/b`, DB 경로 2건 미검출(단일 파일 문맥·호출 인자 문자열 해석 한계) |
| Biome `noRestrictedImports` | 1 | 0 | 1.00 | 0.77 (10/13) | 72ms | 동일. 상대 경로는 깊이별 패턴으로만 근사 |
| **graphify 엣지** | 1 | 0 | — | 파일 단위 **5/5** | 1,503ms(추출 포함) / clean 463ms | 위반 파일 5개 전부, 초과 0. 엣지 단위 13건. `@legacy/b`를 `tsconfig paths`로 해석해 `EXTRACTED` 신뢰도로 보고 |

- graphify 그래프: 노드 182, 엣지 256(`contains` 140, `imports_from` 47, `imports` 35, `re_exports` 19, `calls` 12, `dynamic_import` 1, `indirect_call`(INFERRED) 2). 같은 끝점 간 엣지는 병합되므로 **줄 번호 대조는 불가, 파일 쌍 단위**다.
- **회피 사례(§4.6)**: 비리터럴 동적 import는 tokens가 경고만 내고, `createRequire()` 경유 require와 경로 문자열 참조는 모든 엔진이 침묵한다. 타입 위치 `import()`는 tokens·tsgo가 잡고 Biome은 놓친다.

### 4.3 (2) Jev 인덱스 lint — 기대 21건(오류 20 + 경고 1)

| 엔진 | 위반 exit | clean exit | 정밀도 | 재현율 | 시간 |
|---|---|---|---|---|---|
| tokens | 1 | 0 | **1.00** | **1.00** (21/21) | 88ms |
| Biome GritQL | 1 | 0 | 1.00 | 0.86 (18/21) | 70ms |

Biome가 놓친 3건: ① `units[i]`(변수 인덱스, 경고급) ② `jev/prompts/grade.md`(**Biome 플러그인은 `.md`를 린트하지 않음**) ③ `@typesafe-ai/sdk`를 import한 `uses-sdk.ts`(플러그인 `includes`는 경로 기반이라 "import한 파일" 조건을 표현 못 함). 규칙 ID 기준 점수가 0으로 나오는 것은 Grit 플러그인이 진단 ID를 하나(`jev/index-x`)로 합치는 측정상의 아티팩트이므로 위 라인 기준 값을 본다.

규칙: `jev/index-literal`(`candidates[3]`, `.at(0)`), `jev/index-var`(경고), `jev/index-string`(`item 2`, `항목 2번`, `3번째`, `the second candidate`, `2nd option`, `candidates[3]` 문자열), `jev/index-interp`(`${i + 1}`), `jev/index-field`(`index`, `best_index`, `selectedIndex` 필드).

### 4.4 (3) SQL 템플릿 스캔 — 기대 11건

| 엔진 | 위반 exit | clean exit | 정밀도 | 재현율 | 시간 |
|---|---|---|---|---|---|
| tokens | 1 | 0 | **1.00** | **1.00** (11/11) | 83ms |
| tsgo 타입 기반 | 1 | 0 | 0.91 | 0.91 | 432ms |
| Biome GritQL | 1 | 0 | 0.82 | 0.82 | 67ms |

- tsgo 타입 기반 판정의 라인 불일치 1건은 오염 변수를 대입 지점(23행) 대신 호출 지점(24행)에서 보고한 것이고, 같은 결함은 잡는다.
- Biome는 데이터 흐름이 없어 **대입 지점이 아니라 `prepare(q)` 호출 지점(19, 24행)에서 보고**하므로 라인 기준 FN·FP 각 2건이다. 결함 자체는 잡는다(exit 1). 또한 `db.prepare(asc ? "…" : "…")` 같은 **안전한 삼항이 오탐**이다(회피 픽스처 `SAFE` 행).
- **타입 기반이 이기는 곳**: `db["prepare"](…)`, `db.prepare.bind(db)`, `db.prepare.call(db, …)` 세 가지 회피를 tsgo 타입 기반은 전부 잡고 토큰·Biome은 침묵한다. `RegExp#exec` 오탐은 이름 휴리스틱이 아니라 타입으로 구조적으로 배제된다.
- `// sql-ok: <사유>`(사유 필수; 사유 없는 `// sql-ok:`는 효력 없음이 픽스처로 검증됨)와 Biome의 `// biome-ignore lint/plugin: <사유>`를 같은 탈출구로 인정한다.

### 4.5 (4) NG-G lint — 자동화 가능한 부분

`03-convergence.md` §3.3의 7개 중 정적으로 검사할 수 있는 것과 구현 결과:

| NG-G | 구현한 정적 검사(규칙 ID) | 자동화 수준 |
|---|---|---|
| G1 보상 | `ng-g1/reward-vocab`: 식별자·CSS 이름·`@keyframes`·의존성(`canvas-confetti` 등)·한국어 문구(코인, 폭죽, 경험치) | 어휘 기반. 우회 쉬움(§4.6) |
| G2 소셜 비교 | `ng-g2/social-vocab`, `ng-g2/network-share`(`navigator.share`), 리더보드·친구 어휘 | 어휘 기반. **"스키마에 타 사용자 개념 없음"은 미구현(의미 검사 필요)** |
| G3 제출 전 정답 비공개 | `ng-g3/presubmit-field`(`pre-submit/` 경로 또는 `*PreSubmit*` 이름 스키마에 `answer_key`·`explanation`·`correct_*`·`is_correct`·`model_answer`·`exemplar_note` 등 금지), `ng-g3/presubmit-spread`(pre-submit이 post-submit 형상에서 파생) | 구조 검사. 계약 테스트(FR-QST-022 `[T]`)의 **보완**, 대체 아님 |
| G4 강제 잠금 금지 | `ng-g4/hard-lock`(routing 코드의 `locked`·`unlock`·`hardGate`), `ng-g4/prereq-redirect`(선수 조건에 걸린 `redirect()`) | 경로·어휘 기반 |
| G5 연체 빨간 배지·푸시 | `ng-g5/danger-due`(due·overdue·streak 문맥 + danger/red 색: `className`, `cn()`/`clsx()`, CSS 규칙), `ng-g5/push-api`(`Notification.requestPermission`, `new Notification`, `pushManager`, `web-push` 등), `ng-g5/loss-copy`(연체·스트릭 끊김 문구) | 문맥 휴리스틱 |
| G6 영상 중심 금지 | `ng-g6/video`(`<video>`, 유튜브·비메오 임베드, `react-player` 등 의존성, `packages/contracts`의 video 본문 타입) | 구조·어휘 |
| G7 백지노트 제출 전 AI 생성 금지 | `ng-g7/presubmit-ai-call`(`blank-note/`의 비-`post-submit` 코드가 ai-gateway·anthropic·openai·typesafe-ai import 또는 `generate(`·`autoWrite…` 호출), `ng-g7/policy-file-missing`·`policy-missing-deny`(`ai-gateway-policy.ts`에 `deny_before_submit: ["blank_note.*"]` 존재를 **양성 단언**) | 정적 검사는 경로·import 기준. **실제 강제는 게이트웨이 런타임 거부(FR-STD-018)가 본체** |
| 디자인 lint | `design/raw-color`: `packages/design-tokens/` 밖의 `#rrggbb`/`#rrggbbaa`, `rgb()`·`hsl()`·`oklch()`·`oklab()`·`hwb()`(TS 문자열, 색 키의 3·4자리 hex, CSS 선언) | 리터럴 기반 |

| 엔진 | 위반 exit | clean exit | 정밀도 | 재현율 | 시간 |
|---|---|---|---|---|---|
| tokens (+ CSS·package.json·정책 파일 스캐너) | 1 | 0 | **1.00** | **1.00** (라인 40/40, 규칙 41/41) | 93ms |
| Biome GritQL (TS/TSX/CSS 플러그인 7개) | 1 | 0 | 1.00 | 0.85 (34/40) | 116ms |
| Biome 통합 `biome.json`(픽스처에 동봉, 플러그인 10개) | 1 | 0 | — | — | 129ms 벽시계(Biome 자체 스캔 55ms), 오류 76건 |

Biome가 놓친 6건: `apps/web/package.json` 의존성 3건(**JSON은 플러그인 대상 아님**), `ai-gateway-policy.ts`의 **양성 단언**(파일에 무엇이 "없음"을 표현하지 못함), `...PostSubmitShape` 스프레드 파생, `redirect()`-선수조건 문맥. 즉 **Biome GritQL은 "이 패턴이 있으면 위반"만 가능하고 "이것이 없으면 위반"·비-TS 파일·다중 노드 문맥은 불가**하다.

### 4.6 회피(evasion) 기록 — 정적 게이트의 한계(규칙 위반이지만 침묵하는 사례)

`fixture/evasions`의 23개 행(회피 19 · 검출 확인 3 · 안전 1)을 tokens / tsgo / Biome로 측정했다. 요약:

| 영역 | 침묵하는 사례 |
|---|---|
| design/raw-color | 색 이름 키워드(`{ color: "red" }`), 계산된 hex(`` `#${h}` ``), 런타임 조립(`["#","ff","00","00"].join("")`) |
| ng-g1 | 문자열 값에 숨긴 보상 메커니즘(`"level_up_confetti"`) |
| ng-g5 | `window["Notification"]` 대괄호 접근, 서비스 워커 `showNotification` |
| ng-g3 | 선언 후 `.extend({ answer_key })`로 확장, 계산된 키(`["answer" + "_key"]`) + 이름에 PreSubmit 없음 |
| boundaries | 비리터럴 동적 import(tokens는 **경고만**), `new URL("../../b/…", import.meta.url)` 경로 참조, `createRequire()` 경유 require. (명명 규칙 밖 별칭은 tokens·Biome만 놓치고 tsgo·graphify는 잡음) |
| sql | 대괄호·`bind`·`.call`은 tokens·Biome 침묵, **tsgo 타입 기반은 잡음** |
| jev | 위치 구조분해(`const [first] = candidates`), 호출 결과 인덱스(`Object.values(units)[0]`), 후보 이름 목록 밖의 별칭(`const c = candidates; c[3]`), 숫자를 문자열 연결로 주입(`"Judge item " + (n + 1)`), 위치 소비(`options.shift()`) |

결론: 이 게이트들은 **우연한 위반과 나태한 위반을 잡는 안전망**이지, 악의적 우회를 막는 보안 경계가 아니다. 본체 강제는 계약 테스트·런타임 거부(게이트웨이 정책, 읽기 전용 커넥션, `--permission`)다.

### 4.7 도구 호환성 (TS 7.0.2 옆에서)

| 도구 | `typescript@7.0.2` 단독 | `typescript@5.9.3` | `typescript`=`@typescript/typescript6` + `typescript7`=`typescript@7.0.2` 병행 |
|---|---|---|---|
| `require("typescript").createProgram` | **없음** | 있음 | 있음(6.x) |
| typescript-eslint 8.71 | **실패**: `typescript-eslint does not support TS 7.0.` | 구문·타입 인지(projectService) 모두 OK | 구문·타입 인지 모두 OK |
| ts-morph 28 | OK(22파일·import 21·진단 0). 자체 TS를 동봉해 TS 7과 무관 | OK | OK |
| dependency-cruiser 18.4 | **조용히 `modules=0 violations=0`(거짓 통과)** | 113 모듈, 위반 1 | 113 모듈, 위반 1 |
| dependency-cruiser + `@swc/core` | 113 모듈, 위반 1 (swc 트랜스파일러 경로) | — | — |
| madge 8 | **실패**(`TypeError … reading 'Cjs'`) | — | — |
| knip 6.39 | 실행됨(엔트리 설정 없어 발견 사항 exit 1 — 예상) | — | — |
| vitest 5.0.3 + vite 8.3.1 | OK(1 테스트 통과) | — | — |
| tsx(esbuild) 4.23 | OK | — | — |
| Biome 2.5.14/2.5.15 | OK | — | — |
| `node_modules/.bin/tsc` | 7.0.2 | 5.9.3 | **6.0.x**(별칭 6이 `typescript`를 차지해 `tsc`가 6.x로 해석됨. TS 7은 `node_modules/typescript7/bin/tsc`로 호출해야 함) |

### 4.8 규모 (합성 822 TS 파일 · 서비스 102개, 중앙값)

| 검사 | 시간 |
|---|---|
| boundaries tokens | 129ms |
| boundaries es-module-lexer | 90ms (clean에서 TSX 오탐으로 exit 1 — 게이트 부적합) |
| boundaries tsgo | 643ms |
| Jev 인덱스 tokens | 134ms |
| SQL tokens | 123ms |
| NG-G tokens | 219ms |
| `tsc` 7.0.2 전체 타입 검사 | 357ms |
| Biome(플러그인 전부) | 1,673ms |
| graphify extract | 3,395ms |

`npm run spike` 전체(규모 측정 포함)는 벽시계 72초.

## 5. 합격기준 대비 판정

| # | 기준 | 판정 | 근거 |
|---|---|---|---|
| 1 | 4종 검사 PoC 동작(SP-7 통과 기준) | **PASS** | §4.2~4.5. `check:boundaries`·`check:jev-index`·`check:sql`·`check:ng-g` 모두 위반 픽스처 exit 1(오류 13·20·11·41건), clean exit 0. `npm run demo:clean` = PASS 4/4, `npm run demo:violations` = FAIL 4/4 |
| 2 | 각 검사가 위반에서 비0, clean에서 0 | **PASS** | 위와 같음. 엔진 자체 실패는 exit 2로 구분(fail-closed) |
| 3 | `tsc` 7.0.2가 픽스처를 타입 검사 | **PASS** | clean·violations·evasions 진단 0, 음성 대조 exit 1(TS2322) |
| 4 | Biome(GritQL) 경로로 구현 | **PARTIAL** | boundaries 0.77·Jev 0.86·SQL 0.82·NG-G 0.85 재현율. 정밀도는 경계·Jev·NG-G에서 1.00이나 SQL 0.82(삼항 오탐). 다파일 문맥·JSON/MD·양성 단언 불가. **1차 게이트로는 부족, 보조·에디터 피드백으로 채택** |
| 5 | 정규식/토큰 스크립트 경로 | **PASS(토큰) / FAIL(단순 정규식)** | 토큰 엔진: 경계 P 1.00 R 0.92, Jev 1.00/1.00, SQL 1.00/1.00, NG-G 1.00/1.00. 단순 줄 정규식은 clean 오탐(exit 1)으로 게이트 불가. es-module-lexer도 TSX 파싱 실패로 게이트 불가 |
| 6 | graphify 엣지로 교차 서비스 엣지 검출(NFR-MAINT-001 `[A]`) | **PASS(파일 단위)** | 위반 파일 5/5, 초과 0, clean 0. 줄 단위는 불가(병합 엣지). 명명 규칙 밖 별칭도 해석 |
| 7 | "도구 전용 TS 5.9/6.x를 병행 pin"이 **필요한가**(폴백 발동 조건) | **NOT NEEDED(게이트 4종 기준)** | 4종 게이트와 그 tsgo 엔진은 TS 7만으로 동작. 5.9/6.x는 **typescript-eslint·dependency-cruiser(TS 경로)·madge를 채택할 때만** 필요(§4.7). 채택하지 않는 것을 권고 |

## 6. 설계 권고

### 6.1 구조: 계층형 게이트 (경계·Jev·SQL·NG-G는 "자체 토큰 스크립트"가 1차, Biome·graphify는 보조)

1. **1차 게이트 = 의존성 0의 Node 스크립트 4종**(`tools/gates/check-*.mjs`, 본 스파이크 코드를 이식). 822파일에서 0.12~0.22초, 종료 코드 0/1/2, `--json`·`--root`·`--quiet` 지원. `package.json`:
   ```json
   "check:boundaries": "node tools/gates/check-boundaries.mjs --engine=both",
   "check:jev-index":  "node tools/gates/check-jev-index.mjs",
   "check:sql":        "node tools/gates/check-sql-template.mjs",
   "check:ng-g":       "node tools/gates/check-ng-g.mjs",
   "check:gates":      "node tools/gates/run-gates.mjs"
   ```
   `tokenize()`(179줄)는 주석·문자열·템플릿·정규식 리터럴·TSX 텍스트의 따옴표를 처리하는 **구문 분석기가 아닌 어휘 분석기**다. 공용 라이브러리 `tools/gates/lib/lex.mjs`로 두고 단위 테스트를 붙인다.
2. **check:boundaries는 `--engine=both`(tokens ∪ tsgo)를 CI 기본값**으로 한다. tsgo 엔진 실패는 **exit 2로 fail-closed**(조용히 tokens만으로 강등하지 않음). 이유: `typescript/unstable/sync`는 이름대로 **불안정 API**이므로 `typescript`를 **정확 pin(`7.0.2`, `^` 금지)**하고 엔진 플래그 뒤에 격리한다. 업그레이드 시 `npm run check:boundaries` 자체가 호환성 테스트가 된다.
3. **Biome는 린트·포맷 + `noRestrictedImports`(명명 규칙 기반 경계) + GritQL 플러그인(같은 정책의 에디터 즉시 피드백)**으로 쓴다. `biome.json`은 본 스파이크의 `fixture/clean/biome.json`을 출발점으로 삼고(`plugins[].includes`로 범위 지정, 탈출구 `// biome-ignore lint/plugin: <사유>`), 플러그인 파일은 `tools/biome-plugins/`에 둔다. **Biome 버전은 정확 pin**(`2.5.14`; 2.5.15가 이미 나와 있으므로 업그레이드 시 플러그인 스냅샷 테스트를 돌린다). NFR-MAINT-005 `biome ci` 경고 0에 플러그인 진단(severity=error)이 그대로 포함된다.
4. **graphify는 NFR-MAINT-001의 `[A]` 감사 경로**로 두고 블로킹 게이트로 만들지 않는다(NFR-PORT-007: 선택 도구 부재 허용). 실행: 
   ```
   graphify extract . --code-only --no-cluster --force --out "$TMP"
   node tools/gates/check-graphify-edges.mjs --root . --graph "$TMP/graphify-out/graph.json"
   ```
   교차 서비스 엣지 0을 INT 종료 시점에 확인하고, 파일 쌍 단위 보고를 리뷰 입력으로 쓴다.
5. **TS 5.9/6.x는 병행 pin하지 않는다**(§5-7). STD-01에 다음 문구로 기록한다: "정적 게이트는 TS 컴파일러 API에 의존하지 않는다. typescript-eslint·dependency-cruiser(TS 경로)·madge를 도입하려면 별도 SP가 필요하며, 도입 시 `typescript: npm:@typescript/typescript6` 별칭 + `typescript7: npm:typescript@7.0.2` 병행 패키지를 `tools/` 워크스페이스에만 둔다(앱 패키지는 TS 7 유지, `tsc` 호출은 `typescript7` 경로 명시)". **dependency-cruiser는 TS 7 단독에서 "모듈 0개 위반 0"으로 거짓 통과**하므로 도입 금지 목록에 올린다.

### 6.2 게이트를 "잡히게" 만드는 코드 규약 (STD-01 조항으로 동결)

| 규약 | 이유 |
|---|---|
| 워크스페이스 이름 `@fathom/svc-<name>`, `@fathom/app-<name>`, `@fathom/<pkg>`, `tsconfig paths`의 키는 이 규칙만 허용 | 토큰·Biome 엔진이 별칭을 이름으로 판정한다. 규칙 밖 별칭(`@legacy/b`)은 tsgo·graphify만 잡으므로 "paths 키 규칙 위반 자체를 금지"하는 검사를 추가할 것(미구현, 권고) |
| 동적 `import(variable)`·`createRequire`·`require` 사용 금지, 필요하면 `// boundary-ok: <사유>` | §4.6 회피 사례를 규약으로 차단(현재 tokens는 경고만 냄 — CI에서 경고를 오류로 승격 권고) |
| Jev 호출 코드는 `services/*/src/jev/` 디렉터리 또는 `*.jev.ts`에 두고 프롬프트는 `jev/prompts/*.md` | 범위 판정이 경로 기반(Biome는 경로만 볼 수 있음). 항목 참조는 항상 객체 키(`candidates.k137`) |
| SQL은 리터럴 + `?`/`:name` 바인딩, 식별자는 `ident()`, IN 목록은 `placeholders(n)`, 정수는 `sqlInt(n)`, 정적 SQL 상수는 `UPPER_SNAKE` | 스캐너가 허용하는 유일한 동적 형태. 예외는 `// sql-ok: <사유>` (사유 필수) |
| 제출 전 스키마는 `pre-submit/` 디렉터리 또는 `*PreSubmit*` 이름, 제출 후 스키마는 `post-submit/`, 둘은 **별개 zod 객체로 선언하고 스프레드·확장 파생 금지** | NG-G3 정적 검사가 이름·경로로 범위를 잡는다 |
| 백지노트 코드는 `blank-note/`(제출 후 공개 코드는 `blank-note/post-submit/`), AI는 ai-gateway 클라이언트로만 호출하고 `ai-gateway-policy.ts`에 `deny_before_submit: ["blank_note.*"]` 유지 | NG-G7 정적 양성 단언 + 런타임 거부 |
| 색은 `packages/design-tokens/`에서만 리터럴로 정의 | `design/raw-color` 예외 범위 |
| 라우팅 코드는 `routing/` 또는 `*.route.ts` | NG-G4 범위 |

### 6.3 재사용 코드 조각

tsgo 모듈 해석(별칭·exports·심볼릭 링크를 컴파일러가 해석):
```js
const { API } = await import("typescript/unstable/sync");
const { SyntaxKind } = await import("typescript/unstable/ast");
const api = new API({ cwd: root });
const project = api.updateSnapshot({ openProjects: [path.join(root, "tsconfig.json")] }).getProjects()[0];
const sf = project.program.getSourceFile(abs);
for (const spec of sf.imports) {
  const sym = project.checker.getSymbolAtLocation(spec);       // 모듈 심볼 이름 = "\"<확장자 없는 절대 경로>\""
  const resolved = sym?.name?.replace(/^"|"$/g, "");
}
api.close();
```
SQL 수신자를 타입으로 판정하려면 `DatabaseSync`의 `prepare`/`exec` 심볼 선언을 확인한다(`src/check-sql-typed.mjs`). 이 경로는 대괄호·`bind`·`.call` 회피와 `RegExp#exec` 오탐을 구조적으로 해결하므로 **SQL 게이트의 2차 엔진으로 권고**(재현율 향상 + 오탐 배제, 432ms).

Biome GritQL 작성 시 실측 주의점(2.5.14):
- 플러그인 경로는 설정 파일 기준 상대 경로. 범위는 `{ "path": "x.grit", "includes": ["**/jev/**", "!**/fixtures/**"] }`.
- 파일명은 `$filename <: r".*services/([^/]+)/.*"($own)`처럼 정규식 캡처로 읽을 수 있다(서비스별 규칙을 한 파일로 작성 가능).
- **`not or { A, B }`가 오동작**하므로 제외 조건마다 개별 `not` 절을 쓴다.
- CSS는 `engine biome(1.0)` + `language css;` 헤더가 필요하다.
- 플러그인 진단은 `register_diagnostic(span = $x, message = "<rule-id>: …", severity = "error")`로 내고 메시지 앞머리에 규칙 ID를 둬야 스크립트가 파싱할 수 있다(Biome는 플러그인 진단 카테고리를 하나로 합침).
- JSON·Markdown·양성 단언(없음을 검사)·다중 파일 문맥은 표현 불가 → 그 부분은 토큰 스크립트가 맡는다.

### 6.4 NG-G 매핑 (REQ 갱신 제안)

NFR-UX-008은 "NG-G1~G7 검사 7종 CI 통과"로 적혀 있으나, 정적으로 완결되는 것은 **G1·G4·G5·G6**(어휘·경로·리터럴)이고 **G3·G7은 정적 검사가 보조**(본체는 계약 테스트 403 / 게이트웨이 런타임 거부), **G2의 "스키마에 타 사용자 개념 없음"은 정적 자동화 불가**(리뷰 체크리스트 유지)다. 검증 분류 표에 이 구분을 반영할 것을 권고한다.

## 7. 잔여 위험

| ID | 위험 | 완화 |
|---|---|---|
| R-1 | 정답 마커가 같은 작성자의 픽스처이므로 재현율·정밀도는 **낙관적**이다. 실제 코드에서의 오탐률은 미측정 | R0 첫 통합에서 게이트를 경고 모드로 돌려 오탐 수집 후 오류 승격. 픽스처에 실제 오탐을 회귀 케이스로 추가 |
| R-2 | 이름 기반 휴리스틱(Jev 후보 식별자 `CANDIDATE_NAME`, `INDEX_VARS`; NG-G 어휘)은 정상 코드를 오탐할 수 있고, §4.6의 회피를 못 막는다 | `// jev-ok:`·`// boundary-ok:`·`// sql-ok:` 사유 필수 탈출구 + 리뷰 체크리스트 유지. 악의적 우회는 범위 밖임을 STD-01에 명기 |
| R-3 | 자체 토크나이저의 유지 부담(정규식 vs 나눗셈 판별, JSX 텍스트 따옴표 복구 등). 구문 분석기가 아님 | 공용 라이브러리 + 회귀 픽스처. 더 정확한 구문 분석이 필요해지면 tsgo AST(`typescript/unstable/ast`) 엔진을 추가 |
| R-4 | `typescript/unstable/sync`는 **불안정 API**로 마이너 업그레이드에서 깨질 수 있고, 네이티브 프로세스를 띄운다 | 정확 pin, exit 2 fail-closed, 토큰 엔진은 독립 동작(`--engine=tokens`). TS 업그레이드는 게이트 통과가 조건 |
| R-5 | Biome GritQL은 기능 제약이 크고(§6.3) 마이너 버전별 동작이 달라질 수 있다 | 1차 게이트에서 제외, 정확 pin, 플러그인 스냅샷 테스트 |
| R-6 | graphify는 줄 단위 보고 불가, 선택 도구(없을 수 있음), 합성 저장소 822파일 추출 3.4초 | 감사 경로로 한정(§6.1-4) |
| R-7 | **dependency-cruiser가 TS 7 단독에서 거짓 통과**한다는 사실을 모르고 도입할 위험 | STD-01 도입 금지 목록 + 검증 스크립트(모듈 수 > 0 단언) |
| R-8 | Windows 경로·CRLF·pnpm 심볼릭 링크 해석 미검증. 토크나이저는 줄 끝 `\n`만 기준으로 줄 번호를 계산하고 경로는 posix로 정규화 | **V-live pending**(§8) |
| R-9 | 규모 수치는 픽스처를 복제한 합성 저장소(실제 코드 분포 아님) | 첫 통합 후 재측정 |
| R-10 | NG-G7·G3의 정적 검사는 경로·이름 규약에 의존 — 규약 밖에 두면 검사 대상에서 빠진다 | 경로 규약을 STD-01로 동결하고, `blank-note/`·`pre-submit/` 디렉터리 존재 자체를 검사(미구현, 권고) |

## 8. 미검증 항목 (V-live pending)

- **Windows 10/11, macOS**: 경로 구분자(`\`) 정규화, CRLF, `graphify`·`biome` 바이너리 탐색, tsgo 네이티브 프로세스 기동은 이 컨테이너에서 실행하지 못했다.
- **pnpm 워크스페이스**: `node_modules/.pnpm` 심볼릭 링크와 `workspace:*` 해석에서 tsgo 모듈 심볼 이름이 여전히 절대 경로로 나오는지는 미검증(npm + `tsconfig paths`만 측정).
- **실제 코드베이스 오탐률**(R-1)과 **Jev SDK 실제 호출 형태**(`@typesafe-ai/sdk` 타입은 픽스처용 `.d.ts`로 대체).

## 9. 재현 방법

```bash
cd /home/user/study_develop_ai/spikes/sp7-static-gates
npm install                     # TS 7.0.2, Biome 2.5.14, es-module-lexer, tsx (정확 버전 pin)
npm run spike                   # 전체 측정 + JSON 요약 (약 72초, results/summary.json 갱신)
npm run spike:quick             # 규모 측정 생략
npm run demo:clean              # 4종 게이트, clean 픽스처 → PASS 4/4, exit 0
npm run demo:violations         # 4종 게이트, 위반 픽스처 → FAIL 4/4, exit 1
npm run typecheck               # tsc 7.0.2 -p fixture/clean
npm run check:boundaries -- --root fixture/violations   # 개별 게이트(--engine=tokens|lexer|regex|tsgo|both, --json)
npm run check:graphify -- --root fixture/violations     # graphify extract + 엣지 검사
npm run biome:violations        # Biome 통합 설정(플러그인 10개)
npm run compat:install && (cd compat/ts7 && node ../probe.mjs)   # 도구 호환성(선택; 5개 디렉터리)
```

파일 구성: `src/check-*.mjs`(게이트), `src/lib/{lex,common,tsgo,expect}.mjs`, `biome-plugins/*.grit`, `fixture/{clean,violations,evasions}`, `compat/*`, `results/summary.json`, `results/graphify/*/graphify-out/graph.json`.

## 감사(Audit) 결과

- 감사일: 2026-09-30. 감사자가 `npm run spike`를 직접 다시 실행했다(같은 Linux 컨테이너, Node v22.22.2, tsc 7.0.2, Biome 2.5.14, graphify 0.9.72). 재실행 결과는 23:45:16Z에 생성됐고 exit 0, `verdict.all_ok=true`였다. 재실행이 덮어쓴 `results/summary.json`은 이 보고서의 출처(23:33:35Z판)로 되돌려 두었다.
- 추가로 직접 실행한 것: `demo:clean`(PASS 4/4, exit 0), `demo:violations`(FAIL 4/4, 오류 13·20·11·41건, exit 1), 회피 픽스처에 각 엔진을 따로 돌린 출력, 음성 탐침 3종(존재하지 않는 root, 빈 root, tsconfig를 뺀 root).

### A.1 재현 판정: **재현됨**

- 정밀도·재현율·종료 코드·건수는 모두 그대로 나왔다. 경계 tokens 12/13(`@legacy/b`만 놓침), tsgo·both 13/13, lexer·regex는 clean에서 exit 1, Biome 10/13, graphify 파일 5/5에 초과 0. Jev는 tokens 21/21, Biome 18/21. SQL은 tokens 11/11. NG-G는 tokens 라인 40/40·규칙 41/41, Biome 34/40. Biome 통합 설정은 오류 76건. 회피 행렬은 23행이 3개 엔진 모두 같은 값으로 나왔다. `tsc` 진단 0, 음성 대조 TS2322, `createProgram === undefined`, 실험 API의 소스 수 32개, 호환성 행렬도 같다.
- 시간은 차이가 있다. 순서는 같지만 절대값이 흔들렸다. 규모 측정에서 boundaries tsgo는 726ms(보고 643ms), Biome은 1,381ms(보고 1,673ms)가 나왔다. 위반 픽스처에서 graphify는 586ms(보고 1,503ms)였다. 전체 벽시계는 39초로, 보고된 72초와 다르다. 이 시간 수치들은 참고값으로만 읽어야 한다.
- 채점의 독립성도 확인했다. 게이트 스크립트는 `EXPECT` 마커를 읽지 않는다. 마커를 읽는 곳은 `lib/common.mjs`의 `loadExpectations`와 채점기뿐이다. clean 픽스처에는 판정을 흔들 만한 사례도 들어 있다. `RegExp#exec`, 주석 속 `candidates[3]`, `"item2vec"`, Jev 코드 안의 비후보 배열 인덱스, 리터럴끼리 `+` 연결한 SQL이다. 이런 사례가 있으므로 "clean 오탐 0"은 의미 있는 음성 결과다. 사유 없는 `// sql-ok:`가 효력이 없다는 주장도 `store-bad.ts:36-37`에서 실제로 검증된다.
- 회피 행렬도 정직하다. `EVADES` 행은 해당 엔진이 **같은 줄에서 같은 계열 규칙을** 내지 않아야 silent로 기록된다. 감사자가 원시 출력으로 확인했는데, 근처 줄에서 잡은 것을 silent로 잘못 기록한 사례는 없었다.

### A.2 정정 사항 (과대 주장 또는 부정확한 표현)

1. **"엔진 자체 실패는 exit 2"(§3.2, §5-2)는 `check-boundaries.mjs`에만 해당한다.** 나머지 스크립트(`check-jev-index`·`check-sql-template`·`check-ng-g`·`check-sql-typed`·`check-graphify-edges`)는 예외가 나면 잡지 않은 예외로 끝나 exit 1을 낸다. 예를 들어 tsconfig를 뺀 root에서 `check-sql-typed`를 돌리면 exit 1이다. 실패가 통과로 바뀌지는 않으므로 fail-closed라는 성질은 유지된다. 하지만 "위반(1)과 엔진 고장(2)을 구분한다"는 것은 4종 전체에 대해서는 사실이 아니다.
2. **§6.1-2의 "조용히 tokens만으로 강등하지 않음"은 CI 진입점과 어긋난다.** `run-gates.mjs`(`check:all`, 권고안의 `check:gates`)는 `<root>/tsconfig.json`이 없으면 **경고 없이** `--engine=tokens`로 강등한다. 강등된 상태에서는 명명 규칙 밖 별칭(`@legacy/b`)을 놓친다. fail-closed 경로는 `check:boundaries --engine=both`를 직접 호출할 때만 성립한다.
3. **파일 0개일 때 거짓 통과(vacuous pass)가 난다.** 보고서는 dependency-cruiser가 "modules=0 violations=0"으로 거짓 통과한다는 이유로 도입 금지를 권고했다(§4.7, R-7). 그런데 이 스파이크의 게이트도 같은 결함을 가진다. 빈 디렉터리를 root로 주면 `check:boundaries`·`check:jev-index`·`check:sql`이 `files:0`, exit 0으로 PASS한다. `check:ng-g`만 `policy-file-missing` 양성 단언 덕분에 FAIL한다. root를 잘못 지정했거나 glob이 바뀌면 게이트가 조용히 무력화된다. 존재하지 않는 root는 ENOENT로 FAIL하므로 문제없다.
4. **§4.4의 tsgo 타입 기반 SQL "0.91/0.91"은 라인 기준 값이다.** 규칙 기준으로는 **0.82/0.82**다. 불일치는 1건이 아니라 2건이다. 23행 대신 24행에서 보고한 것 외에, 15행의 `+` 연결을 `sql/concat`이 아니라 `sql/dynamic-arg`로 분류한 것이 하나 더 있다. 결함 자체는 두 경우 모두 잡는다(exit 1, 11건).
5. **§5-4의 "SQL 0.82(삼항 오탐)"는 원인을 잘못 짚었다.** 위반 픽스처에서 Biome SQL 정밀도가 0.82로 나온 것은 대입 지점 대신 호출 지점(19·24행)에서 보고했기 때문이다. 삼항 오탐은 회피 픽스처의 `SAFE` 행에서만 관측되고, 정밀도 수치에는 들어가 있지 않다. 결론(1차 게이트로 부적합)은 바뀌지 않는다.
6. 사소한 것 두 가지. `lex.mjs`는 179줄이 아니라 189줄이다. `npm run spike`의 벽시계는 환경에 따라 39~72초다.

### A.3 판정 조정

- 합격 기준 "4종 검사 PoC 동작"은 **PASS로 유지**한다. 4종 모두 위반에서 비0, clean에서 0이 재현됐고, 결함 자체를 잡는 능력은 수치 그대로다.
- 다만 위 1~3은 **PoC를 게이트로 이식할 때 반드시 고쳐야 할 결함**이다. 이 결함이 남은 채로 "fail-closed 게이트"라고 부르는 것은 과대 주장이다. 이식할 때의 필수 조건은 다음과 같다.
  - (a) 모든 게이트가 엔진 예외를 잡아 exit 2로 끝낸다.
  - (b) 스캔 파일 수가 0이면 exit 2로 끝낸다. 가능하면 기대 디렉터리(`services/*`, `packages/contracts` 등)의 존재도 단언한다.
  - (c) `run-gates`는 tsconfig가 없을 때 강등하지 않고 exit 2로 끝낸다. 강등을 허용해야 한다면 명시 플래그가 있을 때만 허용한다.
  - (d) 게이트 단위 테스트에 빈 root와 tsgo 실패 음성 탐침을 포함한다.
