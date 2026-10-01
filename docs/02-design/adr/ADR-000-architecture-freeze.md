# ADR-000. Architecture Freeze Baseline v1.0 — 구조 동결 선언, 변경 통제, 설계 문서 기준선

- **상태**: Accepted · **일자**: 2026-10-01 · **결정자**: T1(아키텍처) · **승인 근거**: Planning Baseline v1.0 §5.7 동결 조건 6개 충족(§5), PG-2 교차 문서 정합 개정 완료(`10-design-review-log.md`)
- **Trace**: UR-05(아키텍처 확정 후 개발·순서 불변) · UR-07 · UR-18 · PR-003·004·013·014 · NFR-MAINT-006(2단 동결)
- **관련**: ARC-01 §22·§24·부록 B, ADR-001~016, RTM-01(`09-rtm.md`), WBS-01 WP-00-00

## 맥락 (Context)

- 기획 기준선(Planning Baseline v1.0)은 2026-09-30에 동결됐고, 그 뒤 ARC-01·ADR-001~016과 상세 설계 문서 9종(IF·DB·DCP·AI·SCR·DS·WBS·STD·TST)이 작성됐다.
- 스파이크 5건(SP-2·3·4·6·7)은 독립 Opus 감사를 거쳤다(SP-2·SP-7 PASS, SP-3·4·6 PARTIAL). 감사의 구속 결정은 ARC-01 부록 B에 모두 반영됐고 상세 문서와 대조를 마쳤다(`10-design-review-log.md` §1).
- 교차 문서 비평 3건(api-db-screen-ai · reqs-coverage · standards-wbs-build, 60개 지적: blocker 8 · major 35 · minor 17)을 PG-2 정합 개정으로 해소했다. 코드는 하위 모델 에이전트가 병렬로 쓰므로, 계약이 문서 사이에서 한 글자라도 다르면 병렬 WP가 서로 다른 코드를 만든다. 동결 시점은 "모든 문서가 같은 값을 말하는 첫 시점"이어야 한다.

## 결정 (Decision)

### 1. 동결 대상 (상세 동결 = 변경 시 ADR)

| # | 대상 | 정본 | 동결 내용 |
|---|---|---|---|
| F-1 | 서비스 카탈로그 | ARC-01 §5.1·ADR-001 | 상주 프로세스 6개 + web: gateway · content · learning · ai-gateway · ops(supervisor + ops-api), web은 gateway가 정적 제공. 7번째 서비스 슬롯은 포트 4765만 예약 |
| F-2 | 포트 | ARC-01 §5.1·§12·ADR-012 | 127.0.0.1 전용. gateway **4747**(폴백 4748~4756) · ops-api **4761** · content **4762** · learning **4763** · ai-gateway **4764** · 예약 4765. dev 프로파일 +100(4847·4861~4864), Vite 127.0.0.1:5173(strictPort, gateway 프록시). supervisor = 포트 없음(IPC) |
| F-3 | DB 소유 | ADR-002·DB-01 §2 | 서비스 1개 = DB 파일 소유(타 서비스 파일 접근·ATTACH 0): content `content.db` · learning `learning.db`(synchronous=FULL, 증거 단일 writer) + `insight.db`(재구성 가능, 백업 제외) · ai-gateway `ai.db` + `ai-cache.db`(백업 제외) · ops-api `ops.db` · gateway·supervisor·web = DB 없음(web은 IndexedDB 미전송 큐만) |
| F-4 | 계약 | IF-01(코드 블록 = zod 4.6.5 그대로) · ADR-003·008·011 | `packages/contracts/src/{common,admin,ledger,events/envelope.ts,events/consumer-manifest.ts,manifests}/**`·`db-hooks.ts`·`pack/records.ts`·`policy/{lock,mastery_rules,method_policy,ai_policy}.ts` 상세 동결. R0/R1 라우트(`freeze: 'D'`) 상세, R2/R3 라우트(`'O'`) 개요 동결(가산 CR 가능). 파일 목록 정본 = IF-01 `// file:` 머리(CR-54) |
| F-5 | 이벤트 | ADR-003·IF-01 §9 | 통합 이벤트 **23종**(push relay, feed long-poll 기각) — catalog.pack.activated · catalog.concept.changed · catalog.overlay.conflicted · acquisition.import.staged · grading.verdict.issued · grading.verdict.revised · itembank.item.corrected · learning.{evidence.recorded, session.completed, demand.forecasted, mastery.changed, level.promoted, ledger.merged} · ai.{mode.changed, provider.status_changed, job.completed, work_order.approval_requested, work_order.decided, budget.threshold_reached, judge.drift_detected} · ops.{health.changed, backup.completed, host_state.changed}. 원장 내부 이벤트 **17종**(IF-LG-01~17). envelope = ULID·`device_id`·`device_seq`·`client_ts`·`producer_seq` |
| F-6 | 원장 규칙 | ADR-011 | learning 단일 writer, `INSERT OR IGNORE`만, `recursive_triggers=ON`, 기기별 체인 헤드 원장 밖 앵커, payload에 리플레이 입력·`study_day`·`policy_version` 내장, 리플레이 = `ORDER BY client_ts, device_id, device_seq` |
| F-7 | AI 경계 | ADR-005·016 | ai-gateway = 키·CLI·Jev·LLM의 유일 접점, Privacy Firewall, 예산·작업 주문. 모드 사다리 FULL/JUDGE_ONLY/LLM_ONLY/OFFLINE, 첫 기동 OFFLINE. Jev 항목 참조 = 객체 키만. 제출 전 생성 = 403 `AI-POLICY-001` |
| F-8 | 러너 | ADR-007 | 요청당 전용 자식(SP-2 플래그·가드), RSS 감시 25~50ms 전 OS, 부모 판정, 차단 스위트 미통과 OS = 코드 실행 형식 비활성 + Docker 권고 |
| F-9 | 백업 | ADR-013 | epoch 일관 백업(quiesce → VACUUM INTO 사본 → 매니페스트), 복원 시 delivery 커서 되감기 |
| F-10 | 디렉터리 트리 | ARC-01 §16·§16.1·STD-01 §2 | `apps/{web,cli}` · `services/{gateway,content,learning,ai-gateway,ops}` · `packages/{contracts,shared-kernel,design-tokens,ui,testkit}` · `tools/{gates,biome-plugins,packc,graph,fake-cli,si-docs}` · `content` · `policy` · `evals` · `tests` · `deploy` · `.github/workflows`. 서비스 내부 `http → application → domain ← infra` + `jobs/`·`workers/`. 코드 배치 규약(Jev·SQL·pre/post-submit·blank-note·routing·design-tokens 경로, STD-01 §2.4) |
| F-11 | 스택 버전 | ARC-01 §18(exact pin) | Node 22.22.2(엔진 ≥ 22.15) · pnpm 10.33.0 · turbo 2.11 · **typescript 7.0.2**(병행 pin 0) · zod 4.6.5 · fastify 5.12.5 · pino · ulidx · ts-fsrs 5.4.2 · `@typesafe-ai/sdk` 0.6.0 · `@anthropic-ai/sdk` 0.129.0 · openai 7.25.0 · `@google/genai` 2.25.0 · React 19.3.0 · Vite 8.3.1 · TanStack Router 1.170.41 · Query 5.104.0 · Tailwind 4.3.3 · radix-ui 1.6.7 · CodeMirror 6 · mermaid 12.0.0 · vitest 5.0.2 · **@playwright/test 1.56.1**(CR-47) · Biome 2.5.14 · graphify 0.9.72(비차단 감사) |
| F-12 | 정적 게이트 | ADR-010·STD-01 §14 | 의존성 0 `tools/gates/check-*.mjs` + 공용 `lib/lex.mjs`, 종료 코드 0/1/2(0파일 스캔 = 2), `check:boundaries --engine=both` 기본, Biome GritQL = 에디터 전용, graphify = 감사 전용 |

**동결이 아닌 것(값·정책)**: 정책 파일 값(`policy/*@v1.yaml`), 특히 `mastery_rules@v1`의 CR-18~22 값(SIM-PROMO 통과 후 확정)과 `ldi_params@v1`(SIM-LDI, V-field로 이월 가능)은 첫 번들 릴리스 전까지 같은 버전 안에서 고칠 수 있다(DCP DN-31). 콘텐츠(`content/**`)·프롬프트 본문·디자인 토큰 값은 CR 없이 각 파이프라인 규칙을 따른다.

### 2. 변경 통제 규칙

1. **파괴 변경**(F-1~F-12의 삭제·의미 변경·이름 변경·순서 역전)은 **새 ADR(ADR-017~) + 회고 승인**으로만 한다. 회고 = 직후 RETRO(통합 2회마다, WBS §14) 또는 T1′(작성자와 다른 컨텍스트) 임시 회고. ADR이 Accepted가 되면 `frozen.lock`을 재생성하고 영향 문서·계약 스냅샷·테스트를 같은 변경에서 갱신한다.
2. **가산 변경**(새 필드 `.optional()`·새 라우트(`'O'`)·새 테이블·새 enum 값 중 소비자 영향이 없는 것)은 **CR**로 한다: ARC-01 §22 CR 대장에 번호(CR-57~), 영향 문서 목록, 계약 스냅샷 diff. `check:frozen`이 CR 트레일러(`CR: CR-nn`)가 없는 동결 파일 변경을 거부한다.
3. **긴급 수정**(보안·데이터 손실): T1이 ADR 초안 + 수정 병합 후 다음 회고에서 사후 승인. 미승인 시 되돌린다.
4. 에이전트(T2)는 동결 파일을 바꾸지 않는다. 필요하면 작업을 멈추고 `contract_change` 에스컬레이션(STD-AGT-12).
5. 문서 사이 충돌 시 우선순위: ADR-000 > ADR-001~016 > ARC-01 > IF-01·DB-01(계약·DDL) > DCP·AI·SCR·DS > WBS·STD·TST. 단, 값의 문자열 모양(ID·enum)은 IF-01 코드 블록이 정본이다.

### 3. 설계 문서 기준선 (Design Baseline v1.0)

| 문서 | ID | 버전 | 동결 범위 |
|---|---|---|---|
| `docs/02-design/01-architecture.md` | ARC-01 | v1.0 | §5·§8·§9·§12.2~12.3·§12.6·§14.1~14.2·§16·§17·§18 상세 |
| `docs/02-design/adr/ADR-001~016` | ADR | Accepted | 각 ADR "동결 영향" 절 |
| `docs/02-design/02-interface-spec.md` | IF-01 | v1.0 + PG-2 정합(D-34) | 코드 블록 전부(D 상세·O 개요) |
| `docs/02-design/03-database-design.md` | DB-01 | v1.0 + PG-2 정합(D-38, §17.1a 재검증 71/71) | DDL 전부 |
| `docs/02-design/04-data-collection-plan.md` | DCP-01 | v1.0 + CR-35·36·52 | §5.2 ID 문법 · §6 스키마 형태 · §7 검증 규칙 |
| `docs/02-design/05-ai-design.md` | AI-01 | v1.0 | 과업 레지스트리·Jev 템플릿 키·`ai_policy@v1` 키 |
| `docs/02-design/06-screen-design.md` | SCR-01 | v1.0 | 라우트 18(17 화면 + `/_design`)·렌더러 키 |
| `docs/02-design/07-design-system.md` | DS-01 | v1.0 | 토큰 이름(값은 비동결) |
| `docs/02-design/08-wbs-iteration-plan.md` | WBS-01·PGM-01 | v1.0 + PG-2 정합 | WP 소유 경로·반복 순서 |
| `docs/02-design/09-rtm.md` | RTM-01 | v1.0 | 열 구조·Must/Should 행 |
| `docs/02-design/10-design-review-log.md` | DRL-01 | v1.0 | 기록 |
| `docs/02-design/11-agent-build-brief.md` | BRIEF-01 | v1.0 | 요약(정본 아님) |
| `docs/03-standards/01-dev-standards.md` | STD-01 | v1.0 | `[M]` 조항 |
| `docs/04-test/01-test-plan.md` | TST-01 | v1.0 | §11.2 번호 대역·게이트 |
| `CLAUDE.md` | — | v1.0 | 에이전트 주입 지침(요약) |

`frozen.lock` = 위 파일 + 동결 계약 파일의 sha256 목록이다. WP-00-00이 IT-00 시작 직전에 생성하고 `check:frozen`이 대조한다. 이 ADR 작성 시점의 문서 해시는 §6에 있다.

### 4. CR 대장 (동결 시점)

| 범위 | CR | 상태 |
|---|---|---|
| 기획 기준선 대비(ARC-01 §22) | CR-01 ~ CR-28 | 반영 완료 |
| 상세 문서 제안 | CR-29·30(DB-01), CR-31~34(DCP-01) | CR-29·33 = **의무화·반영 완료**(CR-42 묶음), CR-30·31·32·34 = 반영(문구·가산) |
| PG-2 교차 문서 정합 | CR-35 ~ CR-56 | 반영 완료(`10-design-review-log.md` §2, ARC-01 §22 표) |
| AI-01 ★ 메모 | D-AI-10·14·15·16·17·26 | IF-01·DB-01에 반영 완료 |
| 미결(값) | SIM-PROMO(CR-18~22 값), SIM-LDI(`ldi_params@v1`) | INT-2 진입 조건(VC-1) — 구조 동결과 독립 |
| 다음 번호 | CR-57 · ADR-017 | — |

### 5. 동결 조건 점검표 (Planning Baseline §5.7)

| # | 조건 | 상태 | 증거 |
|---|---|---|---|
| 1 | 스파이크 SP-2·3·4·6·7 통과 또는 사전 확정 대응 | **충족** — SP-2 PASS · SP-7 PASS · SP-3/4/6 PARTIAL + 구속 결정 반영, SP-1·SP-8 = V-live 사전 확정 대응, ADR-010 Accepted | `spikes/00-audit-summary.md`, ARC-01 부록 B, DRL-01 §1 |
| 2 | `lint:hooks`: DR-020 이름 훅 + `ext` 열 | **충족(문서)** — DB-01 DR-020 훅 열이 모든 해당 DDL에 존재(§3.5·부록 B), 개정 DDL 재실행 무결성 0 오류. 기계 재검증 = E0-5 `check-hooks`(INT-1a) | DB-01 §17.1a |
| 3 | ARC 동결 조건(단일 writer · outbox + Idempotency-Key · 리플레이 입력 내장 · epoch 백업 · envelope) | **충족** | ADR-003·011·013, IF-01 §9.1·§10 |
| 4 | 2단 동결(R0/R1 상세 · R2/R3 개요) | **충족** — IF-01 모든 라우트에 `슬라이스·동결` D/O 열 | IF-01 §1.1·§4~§8 |
| 5 | AQ-01~06·08·09·10·11·12·15 결정 | **충족** | ARC-01 §20 AQ 표 |
| 6 | `verification-class.json`·`modes.manifest.json` 초안 + RTM-01 등급 열 | **충족** — 초안 = RTM-01 §6·§7, RTM-01 V 열. JSON 방출 = WP-00-03 | `09-rtm.md` |

**남은 위험(동결을 막지 않음)**: Windows·macOS 지원 미확립(V-ci 후속 게이트, 러너 형식은 Linux에서만 활성) · SP-1(Jev 한국어)·SP-8(CLI canary) V-live · SIM-PROMO·SIM-LDI 결과에 따른 정책 값 조정 · 정적 게이트의 실코드 오탐률(INT-1a warn-only 후 차단).

### 6. 작성 시점 문서 해시 (sha256 앞 16자, 2026-10-01)

| 파일 | sha256(앞 16) | 바이트 |
|---|---|---|
| `docs/02-design/01-architecture.md` | `42a14bd9445bd2f0` | 240,103 |
| `docs/02-design/adr/ADR-001-service-decomposition.md` | `b144b9197b1fa77d` | 7,849 |
| `docs/02-design/adr/ADR-002-database-per-service-node-sqlite.md` | `03ac8008004fdbd7` | 13,699 |
| `docs/02-design/adr/ADR-003-communication-outbox-events.md` | `8359c55fe8a9e19a` | 10,099 |
| `docs/02-design/adr/ADR-004-content-and-policy-packs.md` | `8f0e0ebd843cec9c` | 12,802 |
| `docs/02-design/adr/ADR-005-ai-provider-jev-routing.md` | `b301da0fc500d245` | 14,284 |
| `docs/02-design/adr/ADR-006-frontend-stack.md` | `d731afe2e385f40a` | 10,015 |
| `docs/02-design/adr/ADR-007-runner-isolation.md` | `68f90e2abb0d73b8` | 15,905 |
| `docs/02-design/adr/ADR-008-monorepo-contracts-as-code.md` | `e6a7cda40300f24e` | 11,253 |
| `docs/02-design/adr/ADR-009-session-and-secrets.md` | `c713ee3a7a50f563` | 10,200 |
| `docs/02-design/adr/ADR-010-static-gates-ts7.md` | `3be680dfc3c5811d` | 16,383 |
| `docs/02-design/adr/ADR-011-evidence-ledger-replay.md` | `a4a6bb9a1224aa64` | 26,715 |
| `docs/02-design/adr/ADR-012-supervisor-process-lifecycle.md` | `684f8c10040e7b0c` | 10,481 |
| `docs/02-design/adr/ADR-013-backup-upgrade-rollback.md` | `46b84a215fa9c173` | 11,722 |
| `docs/02-design/adr/ADR-014-deployment-views.md` | `79af379e6294cc92` | 7,088 |
| `docs/02-design/adr/ADR-015-observability.md` | `7da336b009c10830` | 7,331 |
| `docs/02-design/adr/ADR-016-privacy-firewall-data-classes.md` | `8a078671d9a3ebe9` | 7,284 |
| `docs/02-design/02-interface-spec.md` | `45a08199efb3da41` | 396,672 |
| `docs/02-design/03-database-design.md` | `a654ebf0ce8018a1` | 465,109 |
| `docs/02-design/04-data-collection-plan.md` | `da7a7f562e66a005` | 263,437 |
| `docs/02-design/05-ai-design.md` | `05b8c56736adf511` | 203,401 |
| `docs/02-design/06-screen-design.md` | `a3e4491a9799343e` | 167,171 |
| `docs/02-design/07-design-system.md` | `4cb47692803457ab` | 81,838 |
| `docs/02-design/08-wbs-iteration-plan.md` | `18c5daca30e27fb3` | 258,271 |
| `docs/02-design/09-rtm.md` | `752e7b5357a9d192` | 113,303 |
| `docs/02-design/10-design-review-log.md` | `88212d7d7f63ac9d` | 22,274 |
| `docs/02-design/11-agent-build-brief.md` | `c4600dab5a334b06` | 19,233 |
| `docs/03-standards/01-dev-standards.md` | `c81f92d39dc166d4` | 171,864 |
| `docs/04-test/01-test-plan.md` | `06cf856f1a9215e1` | 173,215 |
| `CLAUDE.md` | `6efd00418be1899d` | 9,778 |
| `docs/00-brief/tech-stack-facts.md` | `a42a8ebf3c52ee13` | 3,122 |

- 이 표는 기록이다. 판정용 전체 해시 목록은 WP-00-00이 생성하는 `docs/02-design/frozen.lock`(sha256 64자 + 동결 계약 파일)이다. 이 ADR 자신은 표에서 제외(자기 참조).

## 결과 (Consequences)

- 좋음: IT-00 전사 WP(contracts·DDL)가 한 값만 보게 된다. 병렬 WP 간 계약 불일치(ID 문법·enum·형식 어휘)가 구조적으로 사라진다.
- 비용: 이후 구조 변경은 ADR + 회고 승인을 거쳐야 하므로 느리다(의도된 마찰, UR-05).
- 후속: WP-00-00이 `frozen.lock`을 생성하고 이 ADR의 §5를 PG-2 판정 기록으로 인용한다. IT-00 Brief는 RTM-01 행을 Brief의 Trace로 쓴다.
