# ADR-010. TS 7 시대의 정적 게이트 — 의존성 0 토큰 스크립트 1차, `both` 경계 엔진, 코드 배치 규약(STD-01), GritQL·graphify 보조, TS 병행 pin 없음

- **상태**: Accepted · **일자**: 2026-10-01 · **결정자**: T1(아키텍처)
- **Trace**: UR-05·07·08·09, NFR-MAINT-001·002·005·006, NFR-SEC-010·011, NFR-UX-001·008·009, NFR-PORT-007, FR-AI-005·020, FR-STD-018, FR-QST-022, DR-020, PR-004·005·008, PLN-REV-01 FE-14·AQ-14, **SP-7 보고서(`docs/02-design/spikes/SP-7.md`) + 감사(2026-09-30, PASS, 구속 결정 11항)**
- **관련**: ARC-01 §2(AP-15)·§5.4·§9.3·§16·§17·부록 B.5, ADR-002·003·006·008

## 맥락 (Context)

- 앱 컴파일러는 TypeScript 7.0.2(Go 네이티브)다. SP-7 실측(감사 재현):
  - `require('typescript')`가 `version`·`versionMajorMinor`만 export하고 **`createProgram`이 없다**. typescript-eslint는 "TS 7.0 미지원". dependency-cruiser는 TS 7 단독에서 **오류 없이 `modules=0 violations=0`**(거짓 통과). madge 실패. TS 7은 불안정 API `typescript/unstable/sync`·`typescript/unstable/ast`를 제공하며 이것으로 모듈 해석(별칭·exports·심볼릭 링크)이 된다.
  - 엔진별 정확도(위반 fixture): 경계 — tokens(자체 어휘 분석기) P 1.00 / R 0.92(규칙 밖 별칭 `@legacy/b` 누락), tsgo P 1.00 / R 1.00, **both(tokens ∪ tsgo) P 1.00 / R 1.00**, es-module-lexer·단순 정규식은 clean에서 exit 1(게이트 불가), Biome GritQL R 0.77, graphify 파일 단위 5/5·초과 0. Jev 인덱스 tokens 21/21(Biome 18/21: `.md`·"SDK를 import한 파일" 표현 불가). SQL tokens 11/11, tsgo 타입 기반 **규칙 기준 0.82/0.82**(라인 기준 0.91 — 감사 정정), Biome 0.82. NG-G tokens 규칙 41/41(Biome 34/40: JSON·양성 단언·다중 노드 문맥 불가).
  - 822파일·102서비스 합성 규모 중앙값: tokens 경계 129ms · Jev 134ms · SQL 123ms · NG-G 219ms · tsgo 643~726ms · `tsc` 357ms · Biome 1.4~1.7s · graphify extract 3.4s. 벽시계는 환경에 따라 39~72s(참고값).
  - 회피(evasion) 19건: 비리터럴 동적 import(tokens 경고만), `createRequire`, `new URL("../../b/…", import.meta.url)`, Jev 위치 구조분해·`shift()`, SQL `db['prepare']`·`.bind`·`.call`(tsgo 타입 기반만 탐지) 등. → 게이트는 **우연·나태한 위반을 잡는 안전망이지 보안 경계가 아니다**.
- **감사가 찾은 PoC 결함**(이식 시 반드시 고칠 것): ① exit 2(엔진 고장)는 `check-boundaries`만 지키고 나머지는 잡지 않은 예외로 exit 1 ② 빈 root에서 `check:boundaries`·`check:jev-index`·`check:sql`이 `files:0`, exit 0으로 **vacuous pass** ③ `run-gates.mjs`가 `tsconfig.json`이 없으면 **경고 없이** tokens로 강등해 규칙 밖 별칭을 놓침.
- 코드는 하위 모델 에이전트가 병렬로 쓴다. 게이트가 경로·이름으로 범위를 잡으므로, 규약 밖에 둔 코드는 검사에서 빠진다(SP-7 R-10). 따라서 코드 배치 규약을 함께 동결해야 한다.

## 결정 (Decision)

1. **계층형 게이트**:
   - **1차(병합 차단) = 의존성 0 Node 스크립트** `tools/gates/check-*.mjs`(SP-7 `src/check-*.mjs` 이식, 빌드 없이 `node`로 실행). 공용 어휘 분석기 `tools/gates/lib/lex.mjs`(구문 분석기가 아닌 어휘 분석기: 주석·문자열·템플릿·정규식 리터럴·TSX 텍스트 처리)와 `lib/{common,tsgo,walk,report}.mjs`, 단위 테스트 `tools/gates/test/*.test.mjs`(node:test). 공통 플래그 `--root`·`--json`·`--quiet`.
   - **경계 엔진**: `check:boundaries`는 CI 기본 **`--engine=both`**(tokens ∪ tsgo `typescript/unstable/sync`). tsgo 실패는 exit 2(fail-closed). `--engine=tokens`는 명시 플래그로만 허용(로컬 빠른 실행용).
   - **SQL**: tokens `check:sql`이 1차, tsgo 타입 기반 `check:sql-typed`(수신자가 `SqlitePort`·`DatabaseSync`인지 타입으로 판정 → 대괄호·`bind`·`call` 회피 탐지, `RegExp#exec` 오탐 구조적 배제)가 2차 엔진(병합 차단, 432ms 수준).
   - **보조**: Biome 2.5.14 = 린트·포맷 + `noRestrictedImports` + GritQL 플러그인(같은 정책의 **에디터 즉시 피드백**, `tools/biome-plugins/*.grit`). `biome ci` 경고 0(NFR-MAINT-005)에 플러그인 진단이 포함되지만 정책의 정본 판정은 1차 스크립트다.
   - **감사 경로(비차단)**: graphify — `graphify extract . --code-only --no-cluster --force --out "$TMP"` → `node tools/gates/check-graphify-edges.mjs --root . --graph "$TMP/graphify-out/graph.json"`. 교차 서비스 파일 엣지 0을 INT 종료 시점에 확인하고(NFR-MAINT-001 `[A]`), 파일 쌍 보고를 리뷰 입력으로 쓴다. 도구가 없으면 건너뛴다(NFR-PORT-007).
2. **종료 코드 계약(모든 게이트, 감사 이식 필수 조건)**: `0` 통과 · `1` 위반 · `2` 엔진 고장. 다음은 전부 exit 2다 — 엔진 예외(최상위 `try/catch`), **스캔 파일 0개**, 기대 단위 디렉터리(`services/*` 1개 이상, `packages/contracts`) 부재, tsgo 엔진 초기화 실패, 설정 파일(`tools/gates/config/*.json`) 부재·스키마 위반. `run-gates.mjs`(`pnpm check:gates`)는 `tsconfig.json`이 없을 때 **강등하지 않고 exit 2**이며, 강등은 `--allow-tokens-only` 명시 플래그가 있을 때만. 게이트 단위 테스트에 빈 root·존재하지 않는 root·tsconfig 없는 root·tsgo 실패 음성 탐침을 포함한다.
3. **자기 검증**: 모든 게이트는 `tools/gates/fixtures/<check>/{clean,violations,evasions}`를 갖고 `check:gate-selftest`가 violations에서 exit 1, clean에서 exit 0, 빈 root에서 exit 2를 단언한다(fail-open 구조적 배제, AP-15). 탐지 못 하는 회피는 `evasions/`에 `EVADES[...]`로 기록해 한계를 문서화한다.
4. **게이트 목록**(`package.json` 스크립트, `pnpm check:gates`가 일괄 실행):

   | 스크립트 | 파일 | 엔진 | 검사 | 단계 |
   |---|---|---|---|---|
   | `typecheck` | `tsc -p tsconfig.json`(루트 프로젝트, `noEmit`, 7.0.2) | 컴파일러 | 타입 | G1 |
   | `lint` | `biome ci` | Biome + GritQL | 포맷·린트·에디터 정책 피드백 | G1 |
   | `check:boundaries` | `check-boundaries.mjs --engine=both` | tokens ∪ tsgo | 단위 간 import(`config/boundaries.json`), `bc-cross`, `grading-no-catalog`, domain 순수성(`node:*`·`fastify`·`node:sqlite` 금지), `sqlite-direct`(`new DatabaseSync` 직접 호출 금지), 비리터럴 동적 import·`createRequire`·`require`(`// boundary-ok:` 없으면 **오류**), 타 서비스 DB 경로 | G1 |
   | `check:deps` | `check-deps.mjs` | JSON | `package.json` 의존 ⊆ `config/deps.json` 허용표(SDK 위치, 도입 금지 목록) | G1 |
   | `check:tsconfig-paths` | `check-tsconfig-paths.mjs` | JSON | `compilerOptions.paths` 금지, 워크스페이스 이름 = `@fathom/svc-*`·`@fathom/app-*`·`@fathom/<pkg>` 형식만 | G1 |
   | `check:security` | `check-security-scan.mjs` | tokens | `eval`·`new Function`·`child_process.exec`·`shell:true`·`dangerouslySetInnerHTML`·`NODE_TLS_REJECT_UNAUTHORIZED`·`rejectUnauthorized:false`·`Buffer.allocUnsafe` | G1 |
   | `check:gate-selftest` | `check-gate-selftest.mjs` | 전 게이트 × fixture | §3 | G1 |
   | `check:sql` · `check:sql-typed` | `check-sql-template.mjs` · `check-sql-typed.mjs` | tokens · tsgo | §6 SQL 규약 | G2 |
   | `check:db-paths` | `check-db-paths.mjs` | tokens | 타 서비스 DB 파일명·`ATTACH` | G2 |
   | `check:ledger-writer` | `check-ledger-writer.mjs` | tokens | `lr_event` 쓰기 SQL 위치 = `infra/ledger/ledger-writer.ts`, 형태 = `INSERT OR IGNORE`만(REPLACE·`ON CONFLICT … DO UPDATE`·`DROP TRIGGER` 금지) | G2 |
   | `check:content-ingest` | `check-content-ingest.mjs` | tokens | 서빙 테이블 쓰기 위치 = `application/{catalog,itembank}/ingest/` | G2 |
   | `check:jev-index` | `check-jev-index.mjs` | tokens | 범위 `src/jev/**`·`*.jev.ts`·`@typesafe-ai/sdk` import 파일·`**/jev/prompts/**/*.md`, 규칙 `jev/index-{literal,var,string,interp,field}` | G2 |
   | `check:ng-g` | `check-ng-g.mjs` | tokens + CSS·JSON·정책 파일 스캐너 | NG-G1·G2(어휘)·G3(`pre-submit/` 금지 필드·post-submit 파생)·G4(`routing/` 잠금 어휘·선수 리디렉트)·G5(연체 빨강·푸시 API·손실 문구)·G6(영상)·G7(`blank-note/` 비 post-submit의 AI import + `ai-gateway-policy.ts` **양성 단언**)·`design/raw-color`(`packages/design-tokens/` 밖 원색) | G2 |
   | `check:typo-ko` | `check-typo-ko.mjs` | tokens(CSS·TSX) | keep-all·한글 이탤릭 금지·tabular-nums·토큰 외 px | G2 |
   | `lint:hooks` | `check-hooks.mjs` | SQL 어휘 + `contracts/db-hooks.ts` | DR-020 이름 훅·`ext`·`ext_v` | G2·PG-2·IT-01 |
   | `check:frozen` | `check-frozen.mjs` | contracts 스냅샷 diff + 커밋 트레일러 | 2단 동결(ADR-008) | G2 |
   | `check:consumers` | `check-consumers.mjs` | 매니페스트 × 생산자 스키마 | `reads` 보존, 생성물 최신 | G2 |
   | `check:manifest` · `check:rtm` | `check-manifest.mjs` · `check-rtm.mjs` | JSON · si-docs | 매니페스트 ↔ E2E, FR·NFR ↔ 테스트 | G3·PG-3 |
   | `audit:graph` | `check-graphify-edges.mjs` | graphify | 교차 서비스 파일 엣지 0(INT 스냅샷) | 감사(비차단) |

5. **규칙 ID·진단 형식 단일화**: 토큰 스크립트와 GritQL이 같은 `<family>/<rule>` ID(`boundary/cross-service-import`, `jev/index-literal`, `sql/template-interp`, `ng-g5/push-api`, `design/raw-color` …)를 낸다. GritQL 진단 메시지는 **규칙 ID로 시작**한다(`register_diagnostic(span = $x, message = "<rule-id>: …", severity = "error")`; Biome가 플러그인 진단 카테고리를 하나로 합치기 때문). 제외 조건은 `not or { … }`가 오동작하므로 **조건마다 개별 `not` 절**. CSS 플러그인은 `engine biome(1.0)` + `language css;` 헤더. 진단 JSON = `{file, line, rule, message, severity}`.
6. **STD-01 코드 배치 규약(게이트 전제, 이 ADR과 함께 동결)**:

   | 규약 | 게이트 |
   |---|---|
   | 워크스페이스·import 별칭은 `@fathom/svc-<name>`·`@fathom/app-<name>`·`@fathom/<pkg>`만, `tsconfig` `paths` 금지 | `check:tsconfig-paths`, `check:boundaries` |
   | 비리터럴 동적 `import(x)`·`createRequire`·`require` 금지, 필요하면 `// boundary-ok: <사유>`(CI에서 경고 → 오류 승격) | `check:boundaries` |
   | Jev 코드는 `services/*/src/jev/` 또는 `*.jev.ts`, Jev 프롬프트는 `**/jev/prompts/**/*.md`, 항목 참조는 객체 키만(`candidates.k137`) | `check:jev-index` |
   | SQL = 리터럴 + `?`/`:name` 바인딩, 동적 형태는 `ident()`·`placeholders(n)`·`sqlInt(n)` 보간과 `*.sql.ts`의 `UPPER_SNAKE` 상수(정의도 같은 규칙 검사)뿐, 예외 `// sql-ok: <사유>`(사유 없으면 무효) | `check:sql`·`check:sql-typed` |
   | 제출 전 스키마 = `pre-submit/` 또는 `*PreSubmit*`, 제출 후 = `post-submit/`, **별개 zod 객체**(스프레드·`.extend`·`.merge` 파생 금지) | `check:ng-g`(G3) |
   | 백지노트 코드 = `blank-note/`, 제출 후 공개 코드 = `blank-note/post-submit/`. AI는 ai-gateway 클라이언트로만, `packages/contracts/src/ai/ai-gateway-policy.ts`에 `deny_before_submit: ["blank_note.*"]` 유지 | `check:ng-g`(G7 양성 단언) |
   | 원색 리터럴(hex·`rgb()`·`hsl()`·`oklch()`·`oklab()`·`hwb()`)은 `packages/design-tokens/`에서만 | `check:ng-g`(`design/raw-color`) |
   | 라우팅 코드 = `routing/` 또는 `*.route.ts`(web TanStack `routesDirectory = ./src/routing`, learning `domain/practice/routing/`) | `check:ng-g`(G4) |
   | 탈출구는 전부 사유 필수: `// sql-ok:`·`// boundary-ok:`·`// jev-ok:`·`// biome-ignore lint/plugin: <사유>` | 전 게이트 |

7. **TypeScript 버전 정책**: `typescript`는 **7.0.2 정확 pin**(`^` 금지 — `unstable/sync`는 불안정 API). TS 업그레이드 PR은 `pnpm check:gates` 통과가 조건이며, `check:boundaries` 자체가 호환성 테스트다. **TS 5.9/6.x 병행 pin은 하지 않는다**(SP-7 §5-7: 4종 게이트와 tsgo 엔진은 TS 7만으로 동작). typescript-eslint·dependency-cruiser(TS 경로)·madge는 **도입 금지**(`config/deps.json` 금지 목록 — dependency-cruiser는 TS 7 단독에서 거짓 통과). 그런 도구가 꼭 필요해지면 별도 SP를 거쳐 `tools/` 워크스페이스에만 `typescript: npm:@typescript/typescript6` + `typescript7: npm:typescript@7.0.2` 별칭 쌍을 두고, 앱 패키지는 TS 7을 유지하며 `tsc` 호출은 `typescript7` 경로를 명시한다.
8. **Biome 버전 정책**: 2.5.14 정확 pin. 업그레이드 시 `tools/biome-plugins/__snapshots__/` 플러그인 스냅샷 테스트를 돌린다.
9. **게이트의 위상**: 정적 게이트는 **실수 방지망이지 보안 경계가 아니다**. 본체 강제는 계약 테스트(FR-QST-022 제출 전 정답 403), 런타임 거부(ai-gateway `deny_before_submit` 403 — FR-STD-018·FR-AI-020), 읽기 전용 DB 연결, `--permission`, 브랜드 타입(`FirewalledPayload`)·zod 런타임 검증(`JudgeState` 배열 거부)이다. NFR-UX-008 검증 분류: G1·G4·G5·G6 = 정적 게이트로 완결, G3·G7 = 정적은 보조(본체는 계약 테스트·런타임 거부), G2 "스키마에 타 사용자 개념 없음" = 리뷰 체크리스트 [CR-23].
10. **도입 단계**: 첫 R0 통합(INT-1a)에서는 `check:gates --warn-only`로 돌려 실제 코드 오탐을 수집하고, 오탐은 `fixtures/<check>/clean`에 회귀 케이스로 추가한 뒤 오류로 승격한다(INT-1b부터 병합 차단). V-live pending: Windows·macOS 경로 구분자·CRLF, pnpm `node_modules/.pnpm` 심볼릭 링크에서 tsgo 모듈 심볼 해석, 실코드 오탐률.
11. **성능 예산**: G1 합계 ≤ 10s(822파일 기준 tokens 게이트 각 ≤ 250ms, both ≤ 1s, Biome ≤ 2s), G2 ≤ 15s. graphify 감사는 예산 밖.

## 대안 (Alternatives)

| 대안 | 장점 | 단점 | 판정 |
|---|---|---|---|
| TS 5.9 또는 6.x 병행 pin + typescript-eslint·dependency-cruiser | 성숙한 생태계 | 컴파일러 이중화 상시화, SP-7상 불필요, dependency-cruiser는 TS 7 단독 거짓 통과 이력 | 기각(감사 구속) |
| 단순 정규식 스캐너 | 의존 0 | clean 오탐(P 0.71) → 게이트 불가 | 기각 |
| es-module-lexer | 빠름 | TSX 파싱 실패로 clean exit 1 | 기각 |
| Biome GritQL을 1차 게이트로 | 에디터 통합 | R 0.77~0.86, JSON·MD·양성 단언·다중 파일 문맥 불가 | 보조(에디터) |
| tokens 단독 경계 | 빠름(129ms) | 규칙 밖 별칭 누락(R 0.92) | 기각 → `both` 기본 |
| tsgo 단독 경계 | R 1.0 | 불안정 API 단일 의존 | 기각 → `both`(tokens 독립 동작 유지) |
| graphify 블로킹 게이트 | 해석 정확 | 줄 단위 보고 불가, 선택 도구(부재 가능), 3.4s | 감사 경로 |
| `SqlText` 태그 브랜드(ARC 초안) | 타입 수준 강제 | STD-01 SQL 규약·SP-7 스캐너와 불일치(태그 호출을 동적 인자로 판정) | 기각 → 규약 + 2엔진 게이트 |

## 결과 (Consequences)

- **긍정**: 게이트가 컴파일러 세대와 외부 도구 생태계에 묶이지 않고, 1차 게이트 전체가 수 초 안에 끝난다. 종료 코드 계약과 vacuous-pass 금지로 "조용히 꺼진 게이트"가 구조적으로 불가능하다. 하위 모델 에이전트가 경계·SQL·Jev·NG-G 규약을 어기면 병합 전에 실패한다.
- **부정**: 자체 토큰 스크립트(≈ 1.2k LoC)와 어휘 분석기를 유지보수한다 → 공용 `lex.mjs` + 단위 테스트 + 회귀 fixture. 이름·경로 휴리스틱은 정상 코드를 오탐할 수 있다 → 경고 모드 도입, 사유 필수 탈출구. 악의적 우회는 막지 못한다(범위 밖, STD-01 명기).
- **후속**: INT-1a에 게이트 이식(감사 필수 조건 4건 포함) + selftest + 경고 모드, INT-1b 오류 승격, INT 종료마다 graphify 감사 스냅샷. STD-01이 §6 규약과 도입 금지 목록을 조항으로 옮긴다.

## 동결 영향

게이트 목록·엔진 선택(`both` 기본)·종료 코드 계약·규칙 ID 체계·selftest 원칙·STD-01 코드 배치 규약·TS/Biome 버전 정책은 상세 동결이다. 규칙 추가 = CR, 게이트 제거·완화·엔진 변경 = ADR.
