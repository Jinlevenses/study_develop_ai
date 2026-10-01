# BRIEF-01. 에이전트 빌드 브리프 — Fathom · 깊이 (코딩 에이전트가 가장 먼저 읽는 문서)

> v1.0 · 2026-10-01 · 동결 기준선 = [ADR-000](adr/ADR-000-architecture-freeze.md). 이 문서는 **요약**이다. 충돌하면 ADR-000 > ADR-001~016 > ARC-01 > IF-01·DB-01(계약·DDL 코드 블록) > 나머지. 값의 문자열 모양(ID·enum·필드명)은 **IF-01 코드 블록이 정본**이다.

## 1. 제품 한 줄 · 하드 제약

로컬 우선 1인용 개발 학습 서비스(Windows·macOS·Linux, **127.0.0.1만**). 6계열 학습(개념이해·실습·문제·디깅·OX·백지노트) + FSRS·Elo 숙달 + 증거 원장. AI는 선택(첫 기동 OFFLINE).

- 서비스는 bounded context별 분리(≤ 7), **서비스 간 코드 import 0**(계약 패키지만 공유, 호출은 HTTP·이벤트·IPC).
- **learning = 증거의 유일 writer**. 상태 변경 = transactional outbox + `Idempotency-Key`(ULID). 이벤트 payload는 리플레이 입력을 내장한다.
- AI 사다리 FULL / JUDGE_ONLY / LLM_ONLY / OFFLINE, 모든 기능은 OFFLINE 경로가 있다. Jev 항목 참조 = **객체 키만**(배열 인덱스 금지).
- 러너 = 요청당 전용 자식 프로세스(SP-2 플래그·가드), 숨은 테스트는 부모가 판정. v1 런타임 Python 0.

## 2. 서비스 카탈로그 (ARC §5, ADR-001·002·012)

| 단위 | 패키지 | 포트(prod / dev) | DB 파일(`FATHOM_HOME/data/`) | 책임 |
|---|---|---|---|---|
| web | `@fathom/app-web` | gateway가 정적 제공 / Vite 127.0.0.1:5173(프록시) | 없음(IndexedDB `fathom-attempts` 미전송 큐) | React SPA, 17 화면 + `/_design` = 18 라우트 |
| gateway | `@fathom/svc-gateway` | **4747**(폴백 4748~4756) / 4847 | 없음(무상태) | BFF, 부트스트랩 토큰 → 쿠키 `fathom_sid` + CSRF, SSE 허브 `/api/v1/stream`, CLI API `/api/v1/cli/*`, 정적 파일 |
| content | `@fathom/svc-content` | **4762** / 4862 | `content.db` | BC: catalog · acquisition · itembank · grading · runner |
| learning | `@fathom/svc-learning` | **4763** / 4863 | `learning.db`(synchronous=FULL) + `insight.db`(재구성, 백업 제외) | BC: ledger(단일 writer) · learner-model · practice · insight · curriculum-ref |
| ai-gateway | `@fathom/svc-ai-gateway` | **4764** / 4864 | `ai.db` + `ai-cache.db`(백업 제외) | AI 유일 접점(키·CLI·Jev·LLM), Privacy Firewall, 예산·작업 주문, 모드 산정 |
| ops | `@fathom/svc-ops` | supervisor = 포트 없음(IPC) · ops-api **4761** / 4861 | `ops.db`(ops-api만) | supervisor(fork·재시작·포트·토큰) + ops-api(헬스·백업/복원·doctor·업그레이드·자동 기동) |
| cli | `@fathom/app-cli` | — | — | `fathom up/down/status/doctor/backup/restore/export/import/pack/blueprint/upgrade` |
| (예약) | — | 4765 | — | 7번째 서비스 슬롯 |

- 내부 API = `http://127.0.0.1:<port>/internal/v1/*`(Bearer 64 hex 호출자 토큰, `allowedCallers`), 공개 API = gateway `/api/v1/*`만. 실제 포트·토큰은 IPC **부트스트랩 봉투**(`@fathom/contracts/admin/ipc` `BootstrapEnvelope`)로 받는다.
- `FATHOM_HOME`: macOS·Linux `~/.fathom`, Windows `%LOCALAPPDATA%\Fathom`, `pnpm dev` = `<repo>/.fathom-dev`.

## 3. 모노레포 트리 (ARC §16 정본, contracts 파일 목록 = IF-01 `// file:` 머리)

```
study_develop_ai/
├─ package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc .node-version turbo.json biome.json tsconfig.base.json tsconfig.json
├─ apps/{web,cli}/
├─ services/<gateway|content|learning|ai-gateway|ops>/
│  ├─ src/{main.ts, app.ts, config.ts}            # main: --mode=serve|migrate|restore|verify|job
│  ├─ src/http/<bc>/<group>.ts                     # Fastify 플러그인(라우트 정의는 contracts import)
│  ├─ src/application/<bc>/{register,ports,errors}.ts + <use-case>.ts + inbox/<event-type>.ts
│  ├─ src/domain/<bc>/<sub>/                       # 순수(node:*·fastify·sqlite import 금지)
│  ├─ src/infra/{db/<agg>.repo.ts, db/<agg>.sql.ts, clients/, events/, <adapter>/}
│  ├─ src/jobs/<name>.ts  src/workers/<name>.ts     # 단명 자식 job / worker_threads(DB 핸들 금지)
│  ├─ assets/  migrations/<module>/NNNN_<desc>.sql  test/{unit,property,golden,contract,integration,security}/
├─ packages/{contracts,shared-kernel,design-tokens,ui,testkit}/
├─ tools/{gates,biome-plugins,packc,graph,fake-cli,si-docs}/
├─ content/  policy/  evals/  tests/{contract,integration,e2e,chaos,perf,security,support}/
├─ deploy/  .github/workflows/  docs/  spikes/(읽기 전용 PoC — import 금지)  graphify-out/
```

서비스 내부 의존: `http → application → domain ← infra`. 새 최상위 폴더(`utils/`·`common/`·`helpers/`·`lib/`(web 제외)·`services/`·`models/`) 금지(STD-DIR-01).

## 4. 공유 패키지 · 공개 API (ARC §17)

**import 규칙**: barrel(`index.ts`) 금지, 파일 단위 subpath만. `@fathom/contracts/<path-without-.ts>`, `@fathom/shared-kernel/<module>/<module>`.

| 패키지 | 의존 허용 | 공개 표면 |
|---|---|---|
| `@fathom/contracts` | `zod`만 | `common/{schema,ids,time,domain,practice,pagination,degraded,problem,route,ndjson}` · `http/<svc>/v1/<group>`(+ `pre-submit/`·`post-submit/`) · `events/{envelope,consumer-manifest,inbox,catalog/<context>}` · `ledger/{envelope,types,payloads/<type>}` · `ai/{tasks,judge,judge-keys,generate,portable-schema,data-class,work-order,stream,errors,ai-gateway-policy}` · `pack/{manifest,records,delta,feasibility}` · `policy/<name>`·`policy/lock` · `admin/{ipc,admin-routes,epoch-manifest,jobs}` · `manifests/*` · `db-hooks` |
| `@fathom/shared-kernel` | contracts, fastify, pino, ulidx, `node:*` | `service`: `createService(def)` · `sqlite`: `openDb(path,{readOnly?,synchronous,recursiveTriggers?})` → `SqlitePort{prepare, exec, tx, fn, close}` + `ident()`·`placeholders()`·`sqlInt()` · `jobs`: `jobs.run(name,args,{timeoutMs})`·`defineJob` · `eventing`: `appendEvent(tx,…)`·`startRelay`·`inboxPlugin`·`rewindCursors` · `http-client`: `PeerClient.call(route,input,{idempotencyKey,deadlineMs})` · `idempotency` · `auth` · `log`: `createLogger(svc)` · `metrics` · `ids`: `ulid()` · `time`: `Clock`·`monotonicClientTs` · `canonical`: `canonicalJson`·`sha256Hex` · `redact` · `errors`: `Result`·`ok`·`err`·`AppError`·`assertNever`(순수 — domain이 import 가능한 유일 모듈) · `config`: `resolveFathomHome`·`readAllowedEnv` · `policy`: `loadPolicy(name,ver)` · `proc`: `safeSpawn`·`treeKill` |
| `@fathom/design-tokens` | 없음 | `tokens.css`·`typography.css`·`tokens.ts` — **원색 리터럴이 허용되는 유일한 곳** |
| `@fathom/ui` | design-tokens, react, radix-ui, cva, tailwind-merge, clsx, motion, lucide-react, cmdk, sonner | 컴포넌트·배지 7종·Command(`filter` prop)·Toast |
| `@fathom/testkit` | 위 전부 + undici(MockAgent) — devDependency 전용 | `vitest-preset`·`setup/no-network`·`clock`·`prng`·`contract`(`describeRouteContracts`)·`spawn-stack`·`chaos`·`fakes/`·`cassettes/`·`golden-ledgers/`·`preload/egress-recorder.mjs` |

서드파티 위치 제한(`tools/gates/config/deps.json`): `@typesafe-ai/sdk` → ai-gateway `src/jev/**`만 · `@anthropic-ai/sdk`·`openai`·`@google/genai` → ai-gateway `src/infra/providers/**`만 · `ts-fsrs` → learning만 · `es-hangul` → content·web · `d3-force` → packc만.

## 5. 계약 · 이벤트 명명 (IF-01, ADR-003·008·011)

- **라우트**: `defineRoute({id: '<svc>.<group>.<action>', method, path, allowedCallers, idempotent, request, response, deadlineMs?, freeze: 'D'|'O'})`. IF ID(`IF-GW/LR/CT/AI/OP-nnn`)를 계약 테스트 제목에 넣는다. 콜론 동사 경로(`items:select`)는 Fastify에서 `::`로 이스케이프.
- **스키마**: zod 4 `.strict()`(문서는 `S({…})` 헬퍼), 와이어·DB 필드 = `snake_case` 그대로. 제출 전 스키마(`*PreSubmit`, `pre-submit/`)에는 정답 계열 필드 0, 제출 후(`*PostSubmit`)와 파생(`.extend`·spread) 금지.
- **통합 이벤트 23종** `<context>.<entity>.<past_tense>`(catalog.pack.activated … ops.host_state.changed), envelope = `event_id(ULID)·type·schema_version·producer·producer_seq·occurred_at·correlation_id·causation_id·traceparent·payload`. 생산 = 상태 변경과 **같은 tx**에 `appendEvent`. 소비 = `POST /internal/v1/inbox`(event_id 멱등), 매니페스트 `events/__consumers__/<svc>.json`(`reads` 필드 목록).
- **원장 17종**(IF-LG-01~17, learning 내부): `INSERT OR IGNORE`만, `recursive_triggers=ON`, 멱등 키 `verdict:<id>`·`corr:<item>:<basis>:<gate_result_id>`·`att:<id>`·`card:<card_id>`·`policy:<ps>`…, payload에 `study_day`·`policy_version`, 리플레이 `ORDER BY client_ts, device_id, device_seq`.
- **콘텐츠 ID**(CR-35): concept `k8s.probes` · user `u.<ns>.<slug>` · KU `k8s.probes.k03` · 오개념 `.m01` · 문항 `.i05` / T2 `<model_id>.x<12hex>` / 랩 기반 = `<track>.lab.<slug>` / 런타임 ULID · case·art·lab `<track>.(case|art|lab).<slug>` · blueprint `cert-cka@2026` · pack `k8s`·`x.blueprints`·`u.local` · card `k8s.probes:definition:p`.
- **FormatId 33종**(CR-36) — 저작·Verdict·렌더러·`method_policy@v1.formats` 키가 모두 같은 집합.

## 6. 핵심 규약 (STD-01)

| 영역 | 규칙 |
|---|---|
| 오류 | 경계 = RFC 9457 `application/problem+json` + `code: <SVC>-<CAT>-<NNN>`(SVC ∈ GW·CT·LR·AI·OP·CLI, CAT ∈ VAL·AUTH·ACL·NOTFOUND·CONFLICT·DEP·LIMIT·POLICY·INTERNAL) + `error_id`·`request_id`. 예상 실패 = `Result<T, DomainError>`, 경계 변환 = `AppError`, 결함 = throw. 공통 = `9xx`. 코드 레지스트리 = IF-01 §2.6 |
| 로그 | stdout pino JSON 한 줄, 필수 `ts, level, svc, req_id, msg`. 비밀·학습자 원문·프롬프트·LLM 출력 로그 0, `console.*` 0 |
| ID | 런타임 = ULID 대문자 26자(`ulid()` 단조), 해시 = sha256 hex, 정책 세트 `ps_<16hex>`. ULID 시간 성분으로 정렬하지 않는다 |
| 시간 | epoch ms 정수, 학습일 `YYYY-MM-DD`(일 경계 기본 04:00, 이벤트 생성 시 고정), `Clock` 포트 주입(도메인에서 `Date.now()` 금지), `client_ts = max(now, last+1)` |
| SQL | `openDb()`만, 쓰기 `BEGIN IMMEDIATE`(`tx()` 안 `await` 0), **정적 SQL 리터럴만**(`?`/`:name` 바인딩, 조각은 `ident()`·`placeholders()`·`sqlInt()`·UPPER_SNAKE 상수, 예외 `// sql-ok: <사유>`), `Date`·`boolean` 바인딩 금지(epoch ms·0/1), STRICT 테이블, 타 서비스 DB·ATTACH 0, 대량 작업 = 단명 자식 job, LIKE 대신 `instr()` |
| env | `process.env`는 `shared-kernel/config` `readAllowedEnv()`만(STD §8.3 표 밖 이름 금지). 서비스 설정 = 부트스트랩 봉투, 도메인 임계 = 정책 파일. `.env` 파일 없음. 모든 node 실행에 `--disable-warning=ExperimentalWarning`(supervisor가 NODE_OPTIONS 병합) |
| TS | `typescript` 7.0.2 정확 pin, `strict`·`erasableSyntaxOnly`(enum·namespace 금지)·`noUncheckedIndexedAccess`, `any`·`!` 0, 동적 `import(변수)`·`require`·`createRequire` 금지(`// boundary-ok: <사유>`) |
| 배치 | Jev 코드 `services/*/src/jev/` 또는 `*.jev.ts`, Jev 프롬프트 `**/jev/prompts/**/*.md` · 라우팅 `routing/`·`*.route.ts` · 제출 전 `pre-submit/` · 백지노트 `blank-note/`(제출 후 `blank-note/post-submit/`) · 원색 `packages/design-tokens/`만 · 유스케이스 파일 1개 = 공개 함수 1개 |
| 보안 | `resolveInside()`, `safeSpawn(shell:false)` + 비밀은 stdin, `react-markdown skipHtml + rehype-sanitize`, Host·Origin·CSRF, SafeFetch(SSRF) |
| Git | Conventional Commits, 트레일러 `Refs:`·`Task:` 필수, 동결 파일 변경 = `CR:`/`ADR:` 트레일러, 브랜치 `it<nn>/<task-id>-<slug>`, Task당 squash 1개 |

## 7. 실행 · 테스트

| 목적 | 명령 |
|---|---|
| 설치 | `pnpm i --frozen-lockfile` |
| 전체 기동(dev 프로파일, 운영과 같은 supervisor 경로) | `pnpm dev`(= `tsx apps/cli/src/main.ts up --profile=dev --foreground`) → 브라우저 `http://127.0.0.1:4847` |
| CLI | `pnpm fathom <cmd>`(`up`·`status`·`down`·`doctor`·`backup`·`restore`·`export`·`import`·`pack list`·`blueprint import`·`upgrade`) |
| 서비스 단독(디버그) | supervisor가 넘기는 봉투가 필요하므로 단독 `node` 실행 대신 `pnpm dev` 사용. 마이그레이션만 = `--mode=migrate`, job = `--mode=job --job=<name>` |
| 타입·린트 | `pnpm typecheck`(`tsc -p tsconfig.json`) · `pnpm lint`(`biome ci`) |
| 단위(패키지) | `pnpm --filter @fathom/svc-learning test`(vitest `--project unit`) · `test:integration` · `test:security` |
| 교차 | `pnpm test:contract` · `pnpm test:integration` · `pnpm test:security` · `pnpm test:chaos` · `pnpm test:perf` |
| E2E | `pnpm test:e2e`(Playwright **1.56.1**, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, `playwright install` 금지) · `pnpm test:offline` |
| 게이트 자체 | `pnpm --filter @fathom/tool-gates test`(= `node --test "test/*.test.mjs"`) |
| 계약 생성물 | `pnpm contracts:gen`(registry·routing·스냅샷, 원천과 같은 커밋) |
| 콘텐츠 | `pnpm content:check` · `pnpm packs:build`(`--release`는 INT-7) |
| 시뮬레이터 | `pnpm sim promo` · `pnpm sim ldi` |
| 그래프 | `graphify query "…"`(읽기만) · `pnpm graph:update`(= `graphify update .`, T0/반복 시작만) |

테스트 ID = `<LV>-<UNIT>-nnn`(UT·CT·IT·E2E·SEC·CHA·PRF), 번호 대역 정본 = TST-01 §11.2(Brief가 하위 범위 배정, CT 001~199 = IF 번호 거울). 제목에 요구 ID 포함(`[IF-LR-010] … FR-PRG-001`). 단위 테스트는 무네트워크(127.0.0.1만), 외부 AI 호출 0(cassette·fake-cli).

## 8. 정적 게이트 (ADR-010, STD §14)

`pnpm check:gates`(= `node tools/gates/run-gates.mjs --stage=g1|g2|g3`). 의존성 0 Node 스크립트 + `lib/lex.mjs`, **exit 0 통과 · 1 위반 · 2 엔진 고장(스캔 0파일 포함)**. INT-1a = `--warn-only`(exit 2는 실패), INT-1b부터 병합 차단.

| 단계 | 게이트 |
|---|---|
| G1 | `typecheck` · `lint` · `check:boundaries --engine=both` · `check:deps` · `check:tsconfig-paths` · `check:security` · `check:gate-selftest` · `check:scope --task <T>` |
| G2 | `check:sql`(+`check:sql-typed`) · `check:db-paths` · `check:ledger-writer` · `check:content-ingest` · `check:jev-index` · `check:ng-g` · `check:typo-ko` · `lint:hooks` · `check:frozen` · `check:consumers` |
| G3·PG-3 | `check:manifest` · `check:rtm` · `audit:graph`(graphify, **비차단**) |

Biome GritQL = 에디터 피드백 전용. 게이트는 안전망이지 보안 경계가 아니다(본체 = 계약 테스트·런타임 거부).

## 9. 단계별 완료 정의 (STD §14.3, WBS §2.6)

| 단계 | 누가 | 통과 조건(전부 exit 0) |
|---|---|---|
| **G1 개발 DoD**(Task) | T2 + T0 | `pnpm --filter <pkg> typecheck` · `pnpm --filter <pkg> test` · `pnpm lint` · `run-gates --stage=g1` · `check-scope --task <T>`; 변경 파일 ⊆ Brief `allowed_paths`; 테스트 제목에 IF/FR ID |
| **G2 검증 DoD**(리뷰 전, 보완 ≤ 2회) | T0 → T1 | `pnpm typecheck` · `pnpm test` · `pnpm test:contract` · `run-gates --stage=g2` · domain 커버리지(STD-TST-09) |
| **G3 통합 DoD**(INT) | T0 → T1 판정 | `pnpm build` · `test:integration` · `test:security` · `test:e2e` · `run-gates --stage=g3` · `audit:graph` · `graph:snapshot --int <id>` · `pnpm audit --prod --audit-level high` + INT 체크리스트(WBS §2.7) |
| **PG-3 Product DoD** | T1 | D-1~D-14(Planning §5.8, TST §17): OFFLINE 6계열 E2E 외부 호출 0 · 설치→첫 세션 ≤ 3분 · 첫 문항 p95 ≤ 2s · 리플레이 = 라이브 · … |

## 10. 반복 · 작업 패키지 (WBS-01)

| 반복 → 통합 | 범위 | 대표 WP |
|---|---|---|
| IT-00 → INT-1a | 기반: 스캐폴드·pin(00-01), contracts 전사(00-03 코어 → S2a 00-06·07·08 → S2b 00-05 → S2c 00-04 → 00-09 gen), 게이트(00-10·15~17), testkit preset(00-11), shared-kernel 17모듈(00-14·20·21·27·28), supervisor(00-29), 서비스 골격 + DDL 전량(00-30~34), web 셸(00-24), tests(00-36) | WP-00-00~36 |
| IT-01 → INT-1b | R0 관통 루프: 인출→채점→원장→FSRS/Elo→리포트, 리플레이 = 라이브, 시뮬레이터 → **VC-1**(SIM-PROMO·SIM-LDI) | WP-01-xx |
| IT-02 → INT-2 | R1-a 오프라인 코어·습관·검색·3단 개념 페이지, Router + 개인 조정(WP-02-04) | WP-02-xx · RETRO-01 |
| IT-03 → INT-3 | R1-b 숙달·보정·LDI·Depth Map·러너(WP-03-01 + RSK-RUN)·백지노트·백업·다기기 | WP-03-xx · `check:rtm` 차단 시작 |
| IT-04 → INT-4 | R2-a AI 제어면·Firewall·Jev·작업 주문·채점 사다리·생성·T4 S2 승인(WP-04-13b) | WP-04-xx · RETRO-02 |
| IT-05 → INT-5 | R2-b 디깅·Feynman·감사·역출제·가져오기·Inbox·오버레이·문항 건강(WP-05-01) | WP-05-xx |
| IT-06 → INT-6 | R3-a Case·산출물·PR 리뷰·승급 L1→L5 | WP-06-xx · RETRO-03 |
| IT-07 → INT-7 | R3-b D-day·시즌·블루프린트(WP-07-00·03)·doctor·업그레이드·번들 → **PG-3** | WP-07-xx · RETRO-04 |

병렬 규칙: 한 반복에서 한 파일은 WP 1개만 쓴다. 핫스팟(`app.ts`의 `register<Bc>()` 목록, 라우트 파일 19개, 렌더러 레지스트리, 소비자 매니페스트)은 IT-00에서 최종 모양으로 만들고 이후 목록을 바꾸지 않는다.

## 11. 에이전트 행동 규칙 (STD §17·§18)

1. Brief의 `allowed_paths` 밖 파일이 필요하면 **멈추고 에스컬레이션**(`scope`). 동결 파일(ADR-000 §1)은 바꾸지 않는다(`contract_change`).
2. 코드 수정 전 graphify 3단 질의: `graphify query "<기능>" --budget 1500` → `graphify explain "<심볼>"` → `graphify affected "<심볼>" --depth 2`. T2는 `graphify update`를 돌리지 않는다.
3. 스파이크 코드는 import하지 않고 복사 이식 + 첫 줄 `// ported-from: spikes/<sp>/<path> (audit-fixed: <요지>)`.
4. 계약을 재정의하지 않는다 — gateway가 하위 스키마를 쓰면 import(`Object.is` 계약 테스트).
5. 완료 보고에 `graphify[]`·`rtmUpdates[]`(FR·PGM·테스트 ID)를 남긴다.

## 12. 정본 문서 색인

| 알고 싶은 것 | 문서 · 절 |
|---|---|
| 서비스·BC·통신·보안·트리·스택 | `01-architecture.md` §5·§8·§12·§16·§17·§18, ADR-001~016 |
| 라우트·스키마·이벤트·원장·AI 계약·팩 레코드·정책 zod | `02-interface-spec.md` §2~§13 |
| DDL·테이블정의서·백업·마이그레이션 | `03-database-design.md` §3·§5~§12 |
| 콘텐츠 팩 형식·ID 문법·lint | `04-data-collection-plan.md` §5·§6·§7 |
| AI 과업·Jev 템플릿·프롬프트·Firewall·`ai_policy` | `05-ai-design.md` §6~§12 |
| 화면·렌더러·상태 | `06-screen-design.md` §2·§5·§7 · `07-design-system.md` |
| WP·소유 경로·반복·PGM | `08-wbs-iteration-plan.md` §2·§4~§11·§17 |
| 요구 → 설계 → 테스트 | `09-rtm.md` |
| 리뷰 결정(CR-35~56) | `10-design-review-log.md` |
| 코딩·Git·게이트·graphify 표준 | `../03-standards/01-dev-standards.md` |
| 테스트 수준·번호 대역·CI·DoD | `../04-test/01-test-plan.md` §3·§4·§9·§11·§17·§18 |
