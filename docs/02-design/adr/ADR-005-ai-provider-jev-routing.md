# ADR-005. AI 제공자·Jev 라우팅 — ai-gateway 단일 접점, 모드 사다리, 과업·프롬프트 레지스트리, 작업 주문, CLI 격리

- **상태**: Accepted · **일자**: 2026-10-01 · **결정자**: T1(아키텍처)
- **Trace**: UR-13·15·16, CON-002·003·009, FR-AI-001~027, FR-QST-011·017·019·020, FR-STD-018, IR-001~008·010·018, NFR-PERF-004·012, NFR-SEC-004·005·008·009·013·020, NFR-DATA-005, NFR-UX-008(NG-G7), Baseline §5.6, PLN-REV-01 AQ-05, R5 §7~§13, SP-6(SP-1 결과 무관성) + 감사(미결 (a)), SP-7 감사(STD-01 Jev·백지노트 규약)
- **관련**: ARC-01 §11·§12.5, ADR-001·009·016

## 맥락 (Context)

- 제품은 AI 없이 완결돼야 하고(CON-002), AI를 연결하면 품질이 오른다. 판단은 Jev(텍스트 생성 없음), 생성은 LLM(API·Claude/Codex/Gemini CLI·범용 CLI·Ollama)이다(UR-16, CON-003).
- 위험 축: 키 유출, CLI가 사용자 hooks·MCP·CLAUDE.md를 로드(FE-09), 구독 쿼터 잠식(PX-09), 비용 폭주, 프롬프트 인젝션, Jev 배열 인덱스 오답(브리프 함정), 기밀을 판정하려고 외부로 보내는 유출(FE-08), CLI 주간 릴리스·`jev-latest` 교체 같은 드리프트(15년).
- SP-6: 승급 도달 가능성은 SP-1(Jev 보정 통과/실패)과 무관하다. SP-1은 배지·재채점 부담에만 영향을 준다. 빌드 환경에는 키가 없다(V-live).

## 결정 (Decision)

1. **ai-gateway가 키·CLI·Jev·LLM의 유일한 접점**이다. LLM SDK(`@anthropic-ai/sdk`·`openai`·`@google/genai`) import와 CLI spawn 코드는 `services/ai-gateway/src/infra/providers/**`·`infra/cli-kit/**`에만, **Jev SDK(`@typesafe-ai/sdk`)와 Jev 요청 조립 코드는 `services/ai-gateway/src/jev/**`에만** 존재한다(`check:deps` + `check:jev-index` 범위, STD-01). 다른 서비스에서 judge 과업 입력(후보·기준 객체 키 맵)을 만드는 코드는 `*.jev.ts` 파일에 둔다(예: content `application/grading/judge-input.jev.ts`). 호출자: content(judge·generate·streams·jobs·work-orders), gateway(설정·동의·비용·승인·secrets), ops-api(`doctor --live`). **learning은 v1에서 호출하지 않는다.**
2. **모드 산정**(`domain/control`): probe(CLI 설치·버전·로그인·필수 플래그, API 키 존재, Ollama `/v1/models`, Jev `models.list`; 전체 ≤ 10s, 개별 3s) × 동의(`ai_consent`) × 서킷 → `FULL | JUDGE_ONLY | LLM_ONLY | OFFLINE`. **첫 기동 = 동의 0건 = OFFLINE**, 동의 전에는 감지된 CLI도 배경 생성에 쓰지 않는다. 바뀌면 `ai.mode.changed`. 매일 첫 기동 canary(버전 문자열 변화 → 플래그 재검사, 실패 → 라우트 비활성 + 칩 경보, 학습 흐름 비차단).
3. **채점 사다리의 위치**: 사다리 정책과 D(결정적)·H(휴리스틱)·S(자기) 엔진은 **content.grading 로컬 코드**다. ai-gateway는 J(Jev)·LJ(LLM-judge)·L(생성) 엔진만 제공한다. ai-gateway가 죽어도 사다리 하단은 산다(호출자 연결 300ms 서킷 → OFFLINE 간주).
4. **과업 레지스트리**(`services/ai-gateway/assets/tasks.yaml`, 과업 ID = R5의 AI-J01~J19·AI-G01~G13, `@fathom/contracts/ai/tasks`의 enum):
   ```yaml
   AI-J03:                      # 백지노트 KP 커버리지 + 오개념 + SOLO
     kind: judge                # judge | generate
     lane: interactive          # interactive | conversational | background
     chain: [jev, llm-judge]
     question_types: [noul, score]
     max_questions_per_request: 15
     data_class_max: C1
     family_constraint: none    # none | different_from_generator
     deadline_ms: 3000
     requires_work_order: false
   AI-G01:                      # T3 근거 문항 배치 생성
     kind: generate
     lane: background
     tier: mid
     schema: ai/ItemBatch@1     # contracts의 PortableSchema
     prompt: { id: AI-G01, channel: active }
     prefer: [claude-cli, anthropic-api, openai-api, gemini-api, ollama]
     deny: { ollama: ["stakes:S2"] }
     data_class_max: C1
     requires_work_order: true
   ```
   "정답 대필" 과업은 enum에 존재할 수 없다. **제출 전 생성 금지**(FR-AI-020·FR-STD-018, NG-G7): 정본 정책 `packages/contracts/src/ai/ai-gateway-policy.ts`의 `AI_GATEWAY_POLICY = { deny_before_submit: ['blank_note.*'] }`를 ai-gateway privacy 계층이 집행한다 — `generate/*` 요청의 `context_ref = {kind, phase: 'pre_submit' | 'post_submit', id}`가 `kind = 'blank_note'`·`phase = 'pre_submit'`이면 과업과 무관하게 403 `AI-POLICY-001`(CR-44)(계약 테스트 `tests/contract/presubmit-403.spec.ts`). 정적 게이트 `ng-g7/*`는 이 파일의 존재·내용을 양성 단언하는 보조 장치다(ADR-010).
5. **라우팅 순서**(`domain/routing`): 과업 조회(lock 검증된 프롬프트) → 후보 = `prefer` ∩ {동의 ∧ probe 가용 ∧ 서킷 닫힘 ∧ 역량(스키마·스트림) ∧ 데이터 등급 ≤ 어댑터 신뢰(범용 CLI `trust: unverified` → C0만) ∧ Firewall 판정(C3 → ollama만 또는 차단) ∧ 계열 제약 ∧ 로컬 강제 옵션(FR-AI-023) ∧ 예산·쿼터 ∧ (background) 배치 창·작업 주문 ∧ 사용자 대화형 CLI 양보} → 점수(선호 순서, 이후 품질 점수 `w_q` 훅) → 어댑터 호출(`FirewalledPayload`만, ADR-016) → zod `.strict()` + repair 1회(AI-G10) → `ai_call_log`(route_trace·prompt_version·firewall_action·cost_basis·cache_hit) → 캐시(`ai-cache.db`, 키 = sha256(task, prompt_version, provider, model, 정준 입력, schema_hash), 판단 30일·생성 7일).
6. **레인**: interactive(메모리, 데드라인 3s, 항상 먼저 — 대기 ≤ 1작업) · conversational(발화 스트림 `GET /internal/v1/streams/{ref}`) · background(`ai_job` 영속, 재시도 3회 지수 백오프, 앱 재시작 후 재개, 멱등 키). 동시성: Jev ≤ 20·15 rps(버스트 30)·`retryAfterMs` 존중, CLI 자식 ≤ 2.
7. **Jev 규칙**: `src/jev/`(`client.ts`·`adapter.ts`·`state-builder.ts`·`questions.ts`·`keys.ts`)만 SDK 사용(apiKey는 SecretStore에서 생성자로 주입, `logLevel ≤ warn`), 항목 참조는 객체 키만(`candidates.k137` — 배열 위치·서수 문자열·`index` 필드 금지, `check:jev-index`), 모델 `jev-latest`의 응답 `model_version` 기록, interactive 3s·batch 10s. `JudgeState`는 배열 금지 zod(`z.record`), 키 `^[a-z][a-z0-9_]{1,31}$`, `JevStateBuilder.fromList(prefix, items)`만 배열 → 키 맵 변환, instructions는 레지스트리 고정 문자열 + `{{key}}` 치환만(없는 키 = 버그 예외, 폴백 금지), 요청당 질문 ≤ 15(대량은 항목별 분할). Jev는 전송 로그에 **외부 처리자**로 표시하고 설정 화면에 "Jev 서버 7일 동일요청 캐시"를 고지한다.
8. **판정 결과 계약**(`@fathom/contracts/ai/judge`): `JudgeResult = {status: 'ok'|'unavailable'|'deferred', engine: 'J'|'LJ', calibrated, confidence, probabilities(객체 키), model_version, judge_log_id}`. `unavailable`·`deferred`는 정상 결과이며 호출자는 사다리를 내려간다. 원자료는 `ai_judge_log`(append-only: task_id, engine, model_version, input_hash, questions, probabilities, confidence, calibrated, latency, cost, prompt_version; NFR-DATA-005).
9. **캘리브레이션·골드셋**: `evals/gold/<taskId>/*.jsonl`을 `model_labeled_draft`로 출하 → 앱 판정 확인 카드(하루 ≤ 3)로 사용자 확정 → 과업별 확정 ≥ 20(또는 확정 10 + 타 계열 리뷰)이고 SP-1 지표(idea unit 정확도 ≥ 0.85, conf ≥ 0.6 정밀도 ≥ 0.90, 루브릭 κ ≥ 0.6, 패러프레이즈 ≥ 0.9, 장황함 편향 < 0.3)를 통과하면 그 과업만 `calibrated`(w 0.9). `model_version` 변화 → `ai.judge.drift_detected` → 배지 "보정 전"(w 0.7) + calibrate 작업 제안.
10. **프롬프트 레지스트리**: LLM 과업(AI-G·LLM-judge) `assets/prompts/<taskId>/<semver>/{prompt.md, meta.yaml}`, **Jev 과업(AI-J) `assets/jev/prompts/<taskId>/<semver>/{prompt.md, meta.yaml}`**(경로의 `jev/prompts/`로 `check:jev-index`가 `.md`까지 검사)(meta: status `active|candidate|retired`, schema, tier, temperature, eval_baseline) + 두 트리를 함께 덮는 `assets/prompts.lock.json`(sha256). 기동 시 lock 불일치 과업만 비활성 + doctor. 조립 순서 고정(시스템 → 규칙 → 스키마 → 신뢰 데이터 → `<source-<nonce>>` 비신뢰 데이터 → 지시 재확인). `prompt_version`은 호출 로그·캐시 키·문항 계보(`ib_item.lineage`)에 들어가 **프롬프트 버전 단위 패밀리 일괄 격리**(PackDelta `quarantine_family`)를 가능하게 한다. 승격(candidate → active)은 `pnpm ai:eval --task <id> --candidate <ver>`(cassette 재생, 스키마 적합·게이트 통과율 −5%p 이내·골드 일치 비열화) 통과 시만(Should; v1 lite = lock 검증 + 단일 active).
11. **E1 게이트 뮤턴트(V-build)**: `pnpm ai:eval:gates`가 `evals/mutants/`의 결정적 변이(키 교체·제2 정답 삽입·줄기 정답 누설·근거 KU 제거·선택지 중복·실행 결과 변조)를 시드 문항에 적용해 content의 결정적 게이트(G0·G1·G8·G12·copy-guard·메타모픽)가 유형별 100% 잡는지 측정한다. 키 없는 환경에서도 참인 품질 증거다.
12. **작업 주문 = 단일 PEP**: background 호출은 `work_order_id` 필수. 추정(호출·₩·창 쿼터%)이 임계(호출 > 50 ∨ ₩1,000 ∨ 창 쿼터 20%)를 넘으면 `ai.work_order.approval_requested` → 사용자 승인(gateway 전역 다이얼로그) → `ai.work_order.decided`. v1 lite = 승인 플래그 + 추정. 예약·원자 차감(`ai_reservation`)은 Should(스키마 훅 보유).
13. **예산·쿼터**: 월 ₩30,000(기본), 20일차 80% → 생성 라우팅을 CLI·T2로 강등, 100% → 유료 API 차단(FR-AI-007). 구독 CLI는 5시간 창·주간 상한(보수 기본값, `ai_policy@v1`). 배치 창 = `ops.host_state.changed`의 `idle_window_open ∧ power != battery`. `interactive_cli`에 해당 CLI가 있으면 그 제공자 background 레인 일시정지(FR-AI-025). 비용 화면은 과금분·구독분 분리.
14. **CLI 격리**(AQ-05, ARC-01 §12.5): `shell:false` + argv 배열 + stdin 프롬프트, 빈 0700 cwd, env allowlist, 타임아웃 트리 kill, Windows shim 해석. claude `-p --output-format json --json-schema <과업 스키마> --model <m> --tools "" --safe-mode --strict-mcp-config --mcp-config <assets/empty-mcp.json> --setting-sources <최소> --disable-slash-commands --no-session-persistence`(`--bare` 제외), codex `exec --json --sandbox read-only --ephemeral --output-schema <file> -` + **격리 `CODEX_HOME=$FATHOM_HOME/cli-homes/codex`**, gemini `-p "<고정 지시>" -o json --approval-mode plan`, 범용 CLI는 설정 파일만(인자 템플릿에 프롬프트 치환 슬롯 = 설정 검증 오류). 최종 플래그는 IF-01 모의 CLI 계약 테스트(`tools/fake-cli`, V-build) + canary hook(V-live, SP-8)로 고정, canary 실패 CLI는 구독 배치 비활성(API 경로만).
15. **첫 AI 연결 자동 작업(D-14)**: 첫 동의 시 SP-1 캘리브레이션·SP-8 CLI canary·CLI 구조화 출력 스모크를 `ai_job`으로 만들고 승인 대기로 둔다(대량이면 작업 주문).
16. **강등 행렬**(ARC-01 §11.3)과 공통 규칙(Baseline §5.6)을 따른다: 결정적 과업은 어떤 모드에서도 AI 0, 판단 게이트는 휴리스틱으로 통과시키지 않음(`deferred` 출제 0), 비보정 판정은 FSRS에 확인 후·숙달·LDI에 w 감쇠.
17. **SP-1 실패 폴백과 승급 증거**(SP-6 감사 미결 (a) 결정, CR-18): SP-1(Jev 한국어 보정)이 실패하면 Jev는 게이트·분류 전용이고 BPS·루브릭 1차 엔진은 LLM-judge다(CNV 사전 합의). JUDGE_ONLY에는 LLM이 없으므로 서술형 루브릭(Case·Teaching·Artifact) 채점은 자기채점(S) + 미보정 Jev 참고 점수로 하고 그 증거는 **잠정**이다. 확정은 SP-1 통과 Jev 또는 FULL·LLM_ONLY의 LJ가 재채점해 통과할 때만. 승급 평가 12문항은 **결정적 형식 + (SP-1 통과 시) 보정 Jev 형식만** 쓰며 LJ·S 형식은 넣지 않는다(ADR-011 §6).

## 대안 (Alternatives)

| 대안 | 장점 | 단점 | 판정 |
|---|---|---|---|
| 서비스마다 SDK 직접 사용 | 홉 감소 | 키·예산·쿼터·Firewall이 흩어짐, NFR-SEC-004·013 위반 | 기각 |
| LangChain·에이전트 프레임워크 | 생산성 | 추상화 누수, 도구 호출 = 주입 표면, 의존 증가 | 기각 |
| 동적 JS 플러그인으로 제공자 확장 | 확장성 | 키 프로세스에 임의 코드, 공급망 위험 | 기각(범용 CLI 설정으로 대체) |
| H·S 엔진도 ai-gateway에(R5 스케치) | 판단 코드 한 곳 | ai-gateway 다운 시 사다리 하단까지 정지(D-9 약화) | 기각 |
| Jev로 기밀 판정 | 정확도 | 판정하려고 보내는 것 자체가 유출(FE-08) | Deprecated |
| learning이 요약 문장 생성 호출(A) | 주간 리뷰 품질 | 원장 코어에 AI 경로 추가 | v1 기각(템플릿 폴백 허용, 가산 CR로 추가 가능) |

## 결과 (Consequences)

- **긍정**: 새 CLI는 설정만으로 붙는다(코드 변경 0, FR-AI-024). 비용·쿼터·동의·Firewall 집행이 한 프로세스에 모여 정책 위반 경로가 없다. 프롬프트 계보로 회귀 시 패밀리 단위 격리가 가능하다. ai-gateway 장애·OFFLINE에서도 채점과 학습이 계속된다.
- **부정**: ai-gateway가 어댑터 9종·레지스트리·작업 주문으로 커진다(레인 L-AI 하나가 소유, 하위 모듈 5개로 분할). 모델 행동 품질은 빌드에서 증명할 수 없다(E1·cassette는 형상만, V-live로 정직하게 분리).
- **후속**: IF-01이 `contracts/ai/*`(과업 enum, Judge 대수, PortableSchema, WorkOrder)와 어댑터 계약을 코드로 고정. TST-01이 기능 × AI 모드 4 매트릭스와 synthetic cassette 표기를 정의. V-live `fathom doctor --live` 목록(AQ-15).

## 동결 영향

ai-gateway 단일 접점 규칙, 모드 4종과 산정 입력, 과업 ID enum, Judge 결과 계약, 작업 주문 이벤트, CLI 격리 원칙은 상세 동결이다. 플래그 조합·임계·모델 매핑은 설정·정책(`ai_policy@v1`, `tasks.yaml`, `cli-providers/*.yaml`)으로 바꾼다.
