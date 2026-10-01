# ADR-008. 모노레포와 contracts-as-code — pnpm + turbo, 패키지 규칙, 라우트·이벤트 계약, 2단 동결, 파일 소유 레인

- **상태**: Accepted · **일자**: 2026-10-01 · **결정자**: T1(아키텍처)
- **Trace**: UR-05·06·07·08·09·18, CON-004·006·010·011, NFR-MAINT-001·003·005·006·010·011, PR-004·005·006·007·008·013·018, IR-015, SP-7 감사(별칭 규칙·코드 배치 규약·게이트 위치)
- **관련**: ARC-01 §16·§17, ADR-001·003·010

## 맥락 (Context)

- 코드는 하위 모델 AI 코딩 에이전트가 **병렬로** 쓴다(UR-06). 각 에이전트는 Task Brief(허용 경로·금지 경로·컨텍스트 팩·수용기준)로만 움직인다(R6 §8). 계약이 코드로 정확해야 하고, 같은 파일을 두 에이전트가 동시에 고치는 핫스팟이 없어야 한다.
- 동결 후 아키텍처를 뒤집지 않는다(UR-05). 동결은 2단(아키텍처·R0/R1 상세, R2/R3 개요)이며, 가산 변경 = CR, 파괴 변경 = ADR(NFR-MAINT-006).
- TS 7 세대에서는 컴파일러 API가 없다(SP-7) → 계약 검사·경계 검사가 컴파일러에 의존하면 안 된다(ADR-010).

## 결정 (Decision)

1. **워크스페이스**: 저장소 루트 = 모노레포 루트. `pnpm-workspace.yaml` packages `apps/*`, `services/*`, `packages/*`, `tools/*` + `onlyBuiltDependencies: []`. 루트 `package.json`: `"private": true`, `"packageManager": "pnpm@10.33.0"`, `"engines": {"node": ">=22.15.0"}`, `"type": "module"`. `.npmrc`: `engine-strict=true`, `strict-peer-dependencies=true`, `auto-install-peers=false`, `save-exact=true`(isolated `node_modules` 기본 유지). `.node-version` = `22.22.2`.
2. **패키지 이름**(STD-01 별칭 규칙, SP-7 감사 구속): `@fathom/app-<web|cli>` · `@fathom/svc-<gateway|content|learning|ai-gateway|ops>` · `@fathom/<contracts|shared-kernel|design-tokens|ui|testkit>` · tools `@fathom/tool-<gates|packc|graph|fake-cli|si-docs>`(형식상 `@fathom/<pkg>`, 어떤 런타임 단위도 import 불가로 `tools/gates/config/boundaries.json`에 등록). 경계 게이트의 tokens 엔진이 별칭을 **이름으로** 단위에 대응시키므로 이 형식 밖의 별칭과 `tsconfig` `compilerOptions.paths`는 금지(`check:tsconfig-paths`). 내부 의존은 `workspace:*`.
3. **TypeScript**: `tsconfig.base.json` = `strict`, `module`/`moduleResolution` `nodenext`, `target es2023`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `isolatedModules`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `customConditions: ["source"]`, `types: []`(패키지별 지정). 루트 `tsconfig.json`은 `noEmit` 프로젝트로 `apps/*/src`·`services/*/src`·`packages/*/src`를 포함한다(에디터 + `check:boundaries --engine=both`·`check:sql-typed`의 tsgo 엔진 입력 — 없으면 게이트 exit 2). 타입 검사 = TS 7.0.2 `tsc -p tsconfig.json`, 빌드 = 패키지별 `tsc -p`(서비스·패키지) / `vite build`(web). `typescript`는 루트 devDependency 정확 pin 7.0.2 하나뿐이다(ADR-010).
4. **패키지 export 규칙(barrel 금지)**: 내부 패키지는 와일드카드 subpath만 export한다.
   ```json
   "exports": { "./*": { "source": "./src/*.ts", "types": "./dist/*.d.ts", "default": "./dist/*.js" } }
   ```
   import는 파일 단위(`@fathom/contracts/events/envelope`). 손으로 유지하는 `index.ts` 재수출 금지. dev(`--conditions=source` + tsx)·typecheck(`customConditions`)·vitest(`resolve.conditions`)는 빌드 없이 원천을 읽는다.
5. **`@fathom/contracts` 구조(정본)** — 파일 단위 목록의 정본은 IF-01의 `// file:` 머리다(CR-54, ARC §16): `common/`(schema·ids·time·domain·practice·pagination·degraded·problem·route·ndjson) · `http/<svc>/v1/<group>.ts`(라우트 정의; 제출 전 응답 스키마는 `http/<svc>/v1/pre-submit/*.ts`, 제출 후 공개 스키마는 `post-submit/*.ts` — 별개 `z.object`, 파생 금지) · `events/{envelope.ts, consumer-manifest.ts, inbox.ts, catalog/<context>.ts, __consumers__/<svc>.json, registry.gen.ts, routing.gen.ts}` · `ledger/{envelope.ts, types.ts, payloads/<type>.ts, versions.ts}` · `ai/*`(tasks·judge·judge-keys·generate·portable-schema·data-class·work-order·stream·errors + `ai-gateway-policy.ts`: `deny_before_submit: ["blank_note.*"]`) · `pack/{manifest,records,delta,feasibility}.ts`(`records.ts` = BundleRecord 18종, `feasibility.ts`: `structuralFeasibility()` 순수 함수) · `policy/<name>.ts` · `admin/{ipc,admin-routes,epoch-manifest,jobs}.ts`(BootstrapEnvelope = `admin/ipc.ts`) · `manifests/*` + `manifests/{modes.manifest.json, verification-class.json}` · `db-hooks.ts`. 의존은 `zod`만(순수 함수는 I/O·시계·난수 없이).
6. **라우트 정의 = 계약 + ACL + 동결 수준**:
   ```ts
   export const createSession = defineRoute({
     id: 'learning.practice.sessions.create',
     method: 'POST', path: '/internal/v1/practice/sessions',
     allowedCallers: ['gateway'], idempotent: true,
     request: { body: CreateSessionBody }, response: { 201: SessionStarted, 409: Problem },
     deadlineMs: 2000, freeze: 'D',
   });
   ```
   서버(`createService`)는 이 정의로 요청·응답을 검증하고 ACL을 집행한다. 클라이언트(`PeerClient`, web `api-client`)는 같은 정의로 타입 안전 호출을 한다. 계약 테스트는 **모든 라우트**를 Fastify `inject()`로 검사한다(IR-015 100%).
7. **생성물**: `pnpm contracts:gen`이 `events/registry.gen.ts`·`events/routing.gen.ts`·`packages/contracts/.snapshots/*.json`(zod 4 `z.toJSONSchema` 스냅샷)을 만든다. 생성물은 커밋하고 CI가 최신 여부를 검사한다(수기 편집 금지).
8. **2단 동결**: 라우트·이벤트·원장 payload에 `freeze: 'D'|'O'` 표시. PG-2에서 `docs/02-design/frozen.lock`(동결 파일 목록 + sha256)을 만든다. `check:frozen`은 ① 동결 파일 변경 시 커밋 트레일러 `CR: CR-nnn` 또는 `ADR: ADR-nnn`을 요구하고 ② 계약 스냅샷 diff를 분류한다 — 선택 필드·엔드포인트·이벤트·enum 값 **추가** = 가산(CR로 통과), 필드 삭제·개명·타입 축소·필수화·enum 값 삭제 = 파괴(ADR 필요, 새 `schema_version`/v2 경로).
9. **turbo 파이프라인**(`turbo.json`): `build`(`dependsOn: ["^build"]`, outputs `dist/**`) · `typecheck` · `lint`(biome ci) · `test`(vitest). 정적 게이트는 빌드가 필요 없는 의존성 0 스크립트라 turbo 밖에서 `pnpm check:gates`로 한 번에 돈다(ADR-010). 실행 오케스트레이션(dev 서버)은 turbo가 아니라 supervisor(ADR-012).
10. **루트 스크립트**: `dev`(`tsx apps/cli/src/main.ts up --profile=dev --foreground`) · `build` · `typecheck`(`tsc -p tsconfig.json`) · `lint` · `test` · `test:contract` · `test:integration` · `test:e2e` · `test:chaos` · `test:security` · `check:gates`(`node tools/gates/run-gates.mjs`, 첫 R0 통합은 `--warn-only`) · 개별 `check:boundaries`(`node tools/gates/check-boundaries.mjs --engine=both`) · `check:jev-index` · `check:sql` · `check:sql-typed` · `check:ng-g` · `check:deps` · `check:tsconfig-paths` · `check:frozen` · `check:consumers` · `lint:hooks` … · `audit:graph`(graphify 감사, 비차단) · `contracts:gen` · `packs:build` · `ai:eval:gates` · `sim`(learning 시뮬레이터: `sim promo`·`sim ldi`) · `graph:update`(`graphify update .`) · `bundle` · `fathom`(`tsx apps/cli/src/main.ts`).
11. **파일 소유 레인**(ARC-01 §16.1): Task Brief의 허용 경로는 레인 경로의 부분집합이어야 한다. 공급 서비스 레인이 `contracts/http/<svc>/**`·`events/catalog/<context>.ts`를, 소비 서비스 레인이 `events/__consumers__/<svc>.json`을 소유한다. `common/`·`admin/`·`ledger/`·`events/envelope.ts`·`manifests/`·`db-hooks.ts`는 L-CONTRACTS(동결, T1 승인). 서비스 composition root(`app.ts`)는 BC별 `register.ts`를 나열만 하며 INT-1a 후 동결.
12. **테스트 ID·추적**: `UT-<SVC>-nnn`(단위) · `CT-<SVC>-nnn`(계약) · `IT-nnn`(통합) · `E2E-nnn`. 테스트 제목에 요구 ID(`[FR-PRG-001]`)를 넣고 `tools/si-docs`가 RTM·UTR·`verification-class.json` 대조표를 생성한다(NFR-MAINT-011, PR-013·018).
13. **graphify 프로세스**(UR-09, PR-008): 반복 시작 시 `graphify update .`, Task 착수 전 `query → explain → affected` 3단 질의, affected가 Brief 범위를 넘으면 에스컬레이션, INT마다 `docs/40-impl/graph/INT-nn/`에 GRAPH_REPORT·`god-nodes` 상위 10 스냅샷 + `audit:graph`(교차 서비스 파일 엣지 0 확인). graphify는 **감사 경로이며 병합 차단 게이트가 아니다**(NFR-MAINT-001 `[A]`, 도구 부재 허용 — ADR-010).
14. **코드 배치 규약(STD-01 동결 — 게이트가 경로·이름으로 범위를 잡는다)**: Jev 코드 `services/*/src/jev/` 또는 `*.jev.ts`, Jev 프롬프트 `**/jev/prompts/**/*.md` · 라우팅 `routing/` 또는 `*.route.ts` · 제출 전 스키마 `pre-submit/`·`*PreSubmit*` · 백지노트 `blank-note/`(제출 후 `blank-note/post-submit/`) · 정적 SQL `*.sql.ts`의 `UPPER_SNAKE` · 원색 리터럴 `packages/design-tokens/`만 · 단명 자식 job `src/jobs/<name>.ts` · worker_threads `src/workers/<name>.ts`(DB 핸들 금지) · 비리터럴 동적 import·`createRequire`·`require`는 `// boundary-ok: <사유>` 없이 금지.
15. **커밋 규약**: Conventional Commits + 트레일러 `Refs: <요구 ID>` · `Task: T-nn-nn` · (동결 파일 변경 시) `CR:`/`ADR:`.

## 대안 (Alternatives)

| 대안 | 장점 | 단점 | 판정 |
|---|---|---|---|
| Nx | 그래프·생성기 풍부 | 학습 비용·설정 표면, TS 7 플러그인 호환 불확실 | 기각 |
| npm·Yarn workspaces | 익숙함 | 엄격한 미선언 의존 차단이 pnpm만큼 강하지 않음(경계 1겹 상실) | 기각 |
| 폴리레포 | 물리 경계 | 계약 동기화·원샷 빌드(UR-18) 불리 | 기각 |
| OpenAPI 우선 코드 생성 | 표준 문서 | 생성기·스키마 이중 진실, 이벤트·원장 계약 표현 약함 | 기각(zod가 정본, 필요 시 문서용 OpenAPI 생성) |
| tRPC | 타입 공유 | 서비스 간 HTTP 계약·ACL·이벤트와 맞지 않음, 런타임 결합 | 기각 |
| barrel `index.ts` 허용 | import 짧음 | 병렬 머지 핫스팟, 순환 import 위험 | 기각 |

## 결과 (Consequences)

- **긍정**: 에이전트는 계약 파일 하나를 import해 서버·클라이언트·테스트를 같은 정의로 쓴다. 소유 레인과 생성물 규칙으로 병렬 머지 충돌이 구조적으로 줄어든다. 동결 위반이 커밋 시점에 기계적으로 막힌다.
- **부정**: subpath import가 길다. 생성물(`*.gen.ts`, 스냅샷)을 커밋·검사하는 절차가 필요하다. `source` 조건이 도구마다 설정을 요구한다(tsx·vitest·tsconfig).
- **후속**: INT-1a에서 스캐폴드·`defineRoute`·`contracts:gen`·`check:frozen`을 먼저 구현(ST-X-01·06·09). IF-01이 R0/R1 라우트를 `freeze: 'D'`로 작성.

## 동결 영향

워크스페이스 구조, 패키지 이름 규칙(별칭 3형식), export 규칙, contracts 디렉터리 구조, `defineRoute` 형태, 2단 동결 규칙, 레인 표, 코드 배치 규약(§14)은 상세 동결이다.
