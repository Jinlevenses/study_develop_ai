# RTM-01. 요구사항추적표 (Requirements Traceability Matrix) — Fathom · 깊이

> **문서 ID**: RTM-01 · **버전**: v1.0(Architecture Freeze Baseline v1.0 입력, ADR-000) · **작성일**: 2026-10-01 · **작성 주체**: T1(상위 모델)
> **구속 입력**: REQ-01 v1.1(FR 236 · NFR 93) · ARC-01 · IF-01 · DB-01 · DCP-01 · AI-01 · SCR-01 · STD-01 · TST-01 · WBS-01/PGM-01 · `10-design-review-log.md`(CR-29·33·35~56 반영 후)
> **용도**: Planning §5.7 동결 조건 #6(RTM-01 + V-class 열)의 정본, `tools/si-docs`가 이 표의 열 구조로 RTM을 재생성하고 `check:rtm`(TST §18)이 고아 0을 판정한다. 하위 모델 에이전트는 Brief의 FR에서 이 행을 찾아 IF·테이블·화면·테스트 대역을 바로 얻는다.

---

## 0. 요약

1. **행 수**: FR 236(Must 203 · Should 33) + NFR 93 = 329. Must·Should FR은 **모든 열이 채워진 전체 행**이다(값이 없는 열은 사유를 적는다 — 예: "해당 없음(결정적)", "화면 없음").
2. **사슬**: UR → FR/NFR → 서비스(BC) → IF ID → 테이블 → SCR(화면·패널·전역) → 프롬프트/Jev 과업 ID → 테스트 ID(확정 ID 또는 TST §11.2·§18.1 대역) → WP(반복) → 첫 판정 INT. V-class = REQ §1.7(기본 V-build).
3. **도출 방법(재현 가능)**: IF 표의 FR 열·§14 · DB-01 `@table` 주석·부록 B(DR→테이블) · SCR §9·§7 · AI-01 행 · TST 케이스 표·§18.1 · WBS WP 행·PGM 행을 기계 대조했다. 같은 규칙을 `tools/si-docs/src/rtm.ts`가 구현하고, 구현 후에는 테스트 결과 JSON의 제목 ID로 "테스트" 열을 실측값으로 덮어쓴다.
4. **PG-2 정합으로 새로 닫힌 고리**: FR-QST-004(IF-CT-063·064 · WP-04-13b · UT-CT-209) · FR-PRG-028(WP-02-04 · UT-LR-311·312) · FR-CUR-024(IF-GW-052·053·195 · E2E-108) · FR-CUR-026(`PackKpi` · UT-PACKC-006) · FR-PRG-008/FR-CUR-007(`item_beta_after` · UT-LR-115·UT-CT-211) · NFR-AVL-010(WP-05-01·04-12 · UT-CT-210·311) · FR-CUR-010 = **v1 이월**(CR-50).

## 1. 열 정의

| 열 | 뜻 | 출처 |
|---|---|---|
| UR | 사용자 원 요구(project-brief) | REQ 출처 열 |
| ID·이름 | FR/NFR | REQ-01 |
| 우선·슬라이스 | Must/Should · R0~R3 | REQ-01 |
| V | 검증 등급(V-build 기본, `+V-ci/live/field` = 일부 V-build 밖) | REQ §1.7 예외 표 |
| 서비스 | PGM 단위(`services/<svc>/<bc>`·`apps/*`·`tools/*`), 없으면 BC 기본값 | PGM-01 |
| IF | 라우트·이벤트·원장·IPC·외부 IF ID | IF-01 표·§14 |
| 테이블 | 소유 DB 테이블(DDL `@table` 주석·DR 부록) | DB-01 |
| SCR | 화면·패널·전역 오버레이 | SCR-01 §9·§7 |
| AI | AI 과업(AI-J = Jev 판단, AI-G = LLM 생성)·프롬프트 ID | AI-01 · IF §11 |
| 테스트 | 확정 케이스 ID 또는 TST 대역 | TST-01 §11·§18.1 |
| WP | 작업 패키지(반복 = WP 두 자리) | WBS-01 |
| INT | 첫 판정 통합(슬라이스 기준) | WBS-01 §1.3 |

## 2. UR → FR 요약

| UR | 요지 | FR 수 | NFR 수 | 대표 FR |
|---|---|---|---|---|
| UR-01 | 전 분야·섹션별 학습 | 31 | 2 | FR-CUR-001·FR-CUR-003·FR-CUR-009·FR-CUR-010·FR-CUR-011 … |
| UR-02 | 탄탄한 기획·액터 | 14 | 0 | FR-CUR-005·FR-CUR-009·FR-CUR-010·FR-CUR-020·FR-CUR-021 … |
| UR-03 | 개발→검증→통합·회고 | 3 | 3 | FR-CUR-026·FR-DSH-009·FR-DSH-012 |
| UR-04 | 최신 디자인 | 18 | 15 | FR-DSH-001·FR-DSH-003·FR-DSH-004·FR-DSH-005·FR-DSH-011 … |
| UR-05 | 아키텍처 확정 후 개발 | 2 | 3 | FR-CUR-017·FR-SET-018 |
| UR-06 | 상위/하위 모델 분업 | 0 | 0 |  |
| UR-07 | SI 산출물 | 5 | 5 | FR-CUR-015·FR-LAB-015·FR-STD-023·FR-STD-026·FR-UX-002 |
| UR-08 | 서비스 분리 | 2 | 6 | FR-SET-001·FR-SET-002 |
| UR-09 | graphify | 0 | 2 |  |
| UR-10 | 이론→코드→핵심 | 13 | 0 | FR-CUR-005·FR-CUR-006·FR-CUR-007·FR-CUR-008·FR-CUR-026 … |
| UR-11 | 초급~전문가 깊이 | 38 | 1 | FR-CUR-001·FR-CUR-006·FR-CUR-009·FR-CUR-015·FR-CUR-016 … |
| UR-12 | 15년 사용 | 50 | 19 | FR-CUR-004·FR-CUR-013·FR-CUR-014·FR-CUR-016·FR-CUR-017 … |
| UR-13 | 문제 생성·개념 가져오기 | 49 | 7 | FR-AI-010·FR-AI-016·FR-AI-027·FR-CUR-002·FR-CUR-003 … |
| UR-14 | 6계열 학습 방식 | 77 | 4 | FR-AI-020·FR-CUR-007·FR-CUR-008·FR-CUR-024·FR-DSH-004 … |
| UR-15 | 로컬·API/CLI AI | 36 | 19 | FR-AI-001·FR-AI-002·FR-AI-003·FR-AI-004·FR-AI-006 … |
| UR-16 | Jev(판단 AI) | 26 | 5 | FR-AI-004·FR-AI-005·FR-AI-011·FR-AI-012·FR-AI-013 … |
| UR-17 | 기능·운영·UX | 71 | 42 | FR-AI-003·FR-AI-007·FR-AI-008·FR-AI-009·FR-AI-011 … |
| UR-18 | 한 번에 완성 | 2 | 1 | FR-SET-012·FR-STD-033 |

## 3. FR 추적표

### 3.1 FR-AI — AI 연결·판정 (27)

| ID | 이름 | 우선·슬 | UR | V | 서비스 | IF | 테이블 | SCR | AI(프롬프트/Jev) | 테스트 | WP | INT |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FR-AI-001 | 제공자 probe | Must·R0 | UR-15 | B+V-live | ai/control·gateway·web/ai-control | IF-AI-025·IF-AI-026·IF-AI-027·IF-AI-039·IF-EV-14·IF-EV-15 외 3 | ai_probe·ai_provider | GLB-WO·SCR-15 | — (모드 사다리 경유, AI-01 §7.5) | UT-AI·CT-AI(대역) | WP-04-08·WP-04-18·WP-04-24 | INT-1b |
| FR-AI-002 | 4단 성능 모드와 상태 칩 | Must·R0 | UR-15 | V-build | ai/control·contracts·gateway 외 1 | IF-AI-025·IF-AI-026·IF-AI-027·IF-AI-039·IF-EV-14·IF-EV-15 외 4 | ai_mode_state | GLB-WO·SCR-15 | 해당 없음(결정적) | CT-AI-514·UT-AI-002 | WP-00-07·WP-01-10·WP-01-17 외 3 | INT-1b |
| FR-AI-003 | 첫 기동 OFFLINE·동의 후 연결 | Must·R0 | UR-15·UR-17 | V-build | ai/control·gateway·tests 외 1 | IF-AI-025·IF-AI-026·IF-AI-027·IF-AI-039·IF-EV-14·IF-EV-15 외 4 | ai_consent | GLB-WO·SCR-01·SCR-15 | 해당 없음(결정적) | E2E-021·E2E-101·IT-026·UT-AI-001 외 1 | WP-01-10·WP-01-19·WP-04-08 외 2 | INT-1b |
| FR-AI-004 | 과업 레지스트리 라우팅 | Must·R2 | UR-15·UR-16 | V-build | ai·ai/generate·ai/judge 외 4 | IF-AI-001·IF-AI-002·IF-AI-010·IF-AI-011·IF-AI-012·IF-AI-013 외 40 | ac_entry·ai_call_log·ai_firewall_log·ai_gold_item 외 3 | GLB-WO·SCR-15 | 전 과업(AI-J01~J19·AI-G01~G13, `tasks.yaml`) | UT-AI-100·UT-AI-101 | WP-00-07·WP-00-33·WP-01-10 외 5 | INT-4~5 |
| FR-AI-005 | Jev 호출 규약 | Must·R1 | UR-16 | B+V-live | ai/jev·ai/judge·contracts 외 3 | IF-AI-001·IF-AI-002·IF-AI-010·IF-AI-011·IF-AI-012·IF-AI-013 외 38 | ac_entry·ai_call_log·ai_firewall_log·ai_gold_item 외 4 | GLB-WO·SCR-15 | AI-J01~J19(Jev 템플릿, `assets/jev/prompts/**`) | SEC-AI-106·UT-AI-200·UT-AI-201·UT-AI-202 외 2 | WP-00-07·WP-00-16·WP-04-02 외 2 | INT-2~3 |
| FR-AI-006 | LLM 구조화 출력 계약 | Must·R2 | UR-15 | B+V-live | ai/generate·contracts·gateway 외 1 | IF-AI-001·IF-AI-002·IF-AI-010·IF-AI-011·IF-AI-012·IF-AI-013 외 38 | ac_entry·ai_call_log·ai_firewall_log·ai_gold_item 외 3 | GLB-WO·SCR-15 | AI-G01~G13(PortableSchema) | UT-AI-301·UT-AI-304 | WP-00-07·WP-01-10·WP-04-05 외 3 | INT-4~5 |
| FR-AI-007 | 예산과 비용 추정 | Must·R2 | UR-15·UR-17 | V-build | ai/routing·contracts·gateway 외 1 | IF-AI-001·IF-AI-002·IF-AI-010·IF-AI-011·IF-AI-012·IF-AI-013 외 39 | ai_call_log·ai_usage_counter | GLB-WO·SCR-15 | 해당 없음(결정적) | UT-AI-102 | WP-00-07·WP-04-03·WP-04-07 외 2 | INT-4~5 |
| FR-AI-008 | 서킷 브레이커 강등 | Must·R2 | UR-15·UR-17 | V-build | ai/control·ai/routing·gateway 외 1 | IF-AI-001·IF-AI-025·IF-AI-026·IF-AI-027·IF-AI-039·IF-EV-14 외 4 | ac_entry·ai_call_log·ai_firewall_log·ai_gold_item 외 3 | GLB-WO·SCR-15 | 해당 없음(결정적) | UT-AI-105 | WP-01-10·WP-04-07·WP-04-18 외 1 | INT-4~5 |
| FR-AI-009 | 캐시와 중복 호출 억제 | Must·R2 | UR-15·UR-17 | V-build | ai·gateway·web/ai-control | IF-AI-001·IF-AI-002·IF-AI-010·IF-AI-011·IF-AI-012·IF-AI-013 외 38 | ac_entry | GLB-WO·SCR-15 | 전 과업(AI-J01~J19·AI-G01~G13, `tasks.yaml`) | UT-AI-107 | WP-04-03·WP-04-18·WP-04-24 | INT-4~5 |
| FR-AI-010 | AI 배치 작업 큐 | Must·R2 | UR-13·UR-15 | V-build | ai/routing·gateway·ops-api 외 1 | IF-AI-001·IF-AI-002·IF-AI-010·IF-AI-011·IF-AI-012·IF-AI-013 외 40 | ai_job | GLB-WO·SCR-15 | 전 과업(AI-J01~J19·AI-G01~G13, `tasks.yaml`) | UT-OP-350 | WP-00-30·WP-03-15·WP-04-07 외 2 | INT-4~5 |
| FR-AI-011 | 판정 카드 | Must·R2 | UR-16·UR-17 | V-build | content/grading·gateway·ui 외 2 | IF-AI-042·IF-AI-043·IF-AI-044·IF-AI-045·IF-AI-046·IF-AI-047 외 14 | ac_entry·ai_call_log·ai_firewall_log·ai_gold_item 외 3 | GLB-WO·SCR-02·SCR-05·SCR-14 외 1 | — (모드 사다리 경유, AI-01 §7.5) | UT-AI-200~299 + CT-AI-2nn + UT-WEB-2nn(판정 카드) | WP-04-12·WP-04-18·WP-04-20 외 1 | INT-4~5 |
| FR-AI-012 | 이의제기 | Must·R2 | UR-16·UR-17 | V-build | content/grading·gateway·web/ai-control 외 1 | IF-AI-042·IF-AI-043·IF-AI-044·IF-AI-045·IF-AI-046·IF-AI-047 외 14 | gr_appeal | GLB-WO·SCR-02·SCR-05·SCR-14 외 1 | AI-J19 | UT-AI-200~299 + CT-AI-2nn + UT-WEB-2nn(판정 카드) | WP-04-12·WP-04-18·WP-04-20 외 1 | INT-4~5 |
| FR-AI-013 | 개인 골드셋·판정 확인 카드 | Must·R2 | UR-16 | V-build | ai/judge·gateway·web/ai-control | IF-AI-042·IF-AI-043·IF-AI-044·IF-AI-045·IF-AI-046·IF-AI-047 외 13 | ai_gold_item | GLB-WO·SCR-15 | — (모드 사다리 경유, AI-01 §7.5) | UT-AI-200~299 + CT-AI-2nn + UT-WEB-2nn(판정 카드) | WP-04-09·WP-04-18·WP-04-24 | INT-4~5 |
| FR-AI-014 | 채점기 메타모픽 QA·Jev 한국어 캘리브레이션 | Must·R0 | UR-16 | B+V-live | ai/control·ai/judge·gateway 외 1 | IF-AI-010·IF-AI-042·IF-AI-043·IF-AI-044·IF-AI-045·IF-AI-046 외 14 | ai_calibration_run | GLB-WO·SCR-15 | AI-J01~J19 캘리브레이션(SP-1) | UT-AI-204 | WP-04-08·WP-04-09·WP-04-18 외 1 | INT-1b |
| FR-AI-015 | Provider canary·계약 테스트 | Must·R2 | UR-15·UR-17 | B+V-live | ai/control·ai/judge·gateway 외 1 | IF-AI-010·IF-AI-026·IF-AI-042·IF-AI-043·IF-AI-044·IF-AI-045 외 16 | ai_probe | GLB-WO·SCR-15 | — (모드 사다리 경유, AI-01 §7.5) | IT-026·UT-AI-004·UT-AI-203 | WP-04-08·WP-04-09·WP-04-18 외 1 | INT-4~5 |
| FR-AI-016 | 생성 회귀 평가 하네스 | Should·R2 | UR-13·UR-17 | V-build | ai/eval·gateway·testkit 외 1 | IF-AI-042·IF-AI-043·IF-AI-044·IF-AI-045·IF-AI-046·IF-AI-047 외 13 | ac_entry·ai_call_log·ai_firewall_log·ai_gold_item 외 3 | GLB-WO·SCR-15 | — (모드 사다리 경유, AI-01 §7.5) | UT-AI·CT-AI(대역) | WP-04-17·WP-04-18·WP-04-24 | INT-4~5 |
| FR-AI-017 | 기능별 강등 동작 준수 | Must·R2 | UR-15·UR-16 | V-build | ai/generate·content/grading·gateway 외 3 | IF-AI-001·IF-AI-002·IF-AI-003·IF-AI-025·IF-AI-026·IF-AI-027 외 11 | ac_entry·ai_call_log·ai_firewall_log·ai_gold_item 외 3 | GLB-WO·SCR-02·SCR-07·SCR-15 | AI-G07·AI-J17 | CT-AI-202·E2E-401~405·UT-CT-203·UT-CT-300 외 1 | WP-04-05·WP-04-11·WP-04-18 외 3 | INT-4~5 |
| FR-AI-018 | LLM-as-judge 사용 제한 | Must·R2 | UR-16 | V-build | ai/judge·ai/routing·content/grading 외 2 | IF-AI-001·IF-AI-042·IF-AI-043·IF-AI-044·IF-AI-045·IF-AI-046 외 14 | ac_entry·ai_call_log·ai_firewall_log·ai_gold_item 외 3 | GLB-WO·SCR-02·SCR-15 | 해당 없음(결정적) | UT-AI-109·UT-AI-205 | WP-04-07·WP-04-09·WP-04-11 외 2 | INT-4~5 |
| FR-AI-019 | Privacy Firewall (로컬 판정 전용) | Must·R2 | UR-15·UR-17 | V-build | ai/privacy·contracts·gateway 외 1 | IF-AI-002·IF-AI-050·IF-AI-051·IF-AI-052·IF-AI-053·IF-GW-105 외 7 | ai_firewall_log | GLB-WO·SCR-15 | 해당 없음(결정적) | SEC-AI-100·SEC-AI-101·UT-AI-400 | WP-00-07·WP-04-01·WP-04-18 외 1 | INT-4~5 |
| FR-AI-020 | 생성 호출 정책 (정답 대필 금지) | Must·R1 | UR-14 | V-build | ai/generate·ai/privacy·content/grading 외 5 | IF-AI-001·IF-AI-002·IF-GW-065·IF-GW-105·IF-GW-109·IF-GW-119 외 5 | ac_entry·ai_call_log·ai_firewall_log·ai_gold_item 외 3 | GLB-WO·SCR-06·SCR-15 | 해당 없음(결정적) | CT-AI-201·CT-SYS-004·UT-AI-302 | WP-00-07·WP-01-14·WP-03-05 외 5 | INT-2~3 |
| FR-AI-021 | AI 호출 로그·비용 열람 | Must·R2 | UR-15·UR-17 | V-build | gateway·web/ai-control | IF-AI-001·IF-AI-002·IF-AI-010·IF-AI-011·IF-AI-012·IF-AI-013 외 40 | ai_call_log | GLB-WO·SCR-15 | 전 과업(AI-J01~J19·AI-G01~G13, `tasks.yaml`) | UT-AI·CT-AI(대역) | WP-04-03·WP-04-18·WP-04-24 | INT-4~5 |
| FR-AI-022 | 과금 모드와 과금 전환 경고 | Must·R2 | UR-15 | V-build | ai/cli·gateway·web/ai-control | IF-AI-001·IF-AI-002·IF-AI-010·IF-AI-011·IF-AI-012·IF-AI-013 외 41 | ai_provider | GLB-WO·SCR-15 | 해당 없음(결정적) | UT-AI-552 | WP-04-04·WP-04-06·WP-04-08 외 2 | INT-4~5 |
| FR-AI-023 | 로컬 LLM 강제 라우팅 | Must·R2 | UR-15 | V-build | ai/privacy·ai/providers·gateway 외 1 | IF-AI-002·IF-AI-028·IF-AI-040·IF-AI-041·IF-AI-050·IF-EXT-05 외 8 | ac_entry·ai_call_log·ai_firewall_log·ai_gold_item 외 3 | GLB-WO·SCR-15 | — (모드 사다리 경유, AI-01 §7.5) | SEC-AI-104·UT-AI-400 | WP-04-01·WP-04-04·WP-04-18 외 1 | INT-4~5 |
| FR-AI-024 | 범용 CLI 제공자 어댑터 | Must·R2 | UR-15 | V-build | ai/cli·fake-cli·gateway 외 1 | IF-AI-002·IF-AI-029·IF-AI-034·IF-EXT-06·IF-EXT-09·IF-GW-105 외 8 | ai_provider | GLB-WO·SCR-15 | — (모드 사다리 경유, AI-01 §7.5) | IT-040·UT-AI-401·UT-AI-550 | WP-04-06·WP-04-18·WP-04-24 | INT-4~5 |
| FR-AI-025 | 구독 쿼터 예산·사용자 CLI 활동 양보 | Must·R2 | UR-15·UR-17 | V-build | ai/routing·gateway·ops-api 외 1 | IF-AI-001·IF-AI-002·IF-AI-010·IF-AI-011·IF-AI-012·IF-AI-013 외 41 | ai_quota_window | GLB-WO·SCR-15 | 해당 없음(결정적) | IT-021·UT-AI-103·UT-AI-108 | WP-03-15·WP-04-07·WP-04-18 외 1 | INT-4~5 |
| FR-AI-026 | 대량 AI 작업 미리보기·승인과 배치 창 | Must·R2 | UR-15·UR-17 | V-build | ai/routing·contracts·gateway 외 2 | IF-AI-001·IF-AI-002·IF-AI-010·IF-AI-011·IF-AI-012·IF-AI-013 외 40 | ai_work_order | GLB-WO·SCR-15 | 해당 없음(결정적) | IT-027·UT-AI-104 | WP-00-07·WP-04-07·WP-04-18 외 2 | INT-4~5 |
| FR-AI-027 | 골드셋 사용자 확정 | Must·R2 | UR-13·UR-16 | V-build | ai/judge·gateway·web/ai-control | IF-AI-042·IF-AI-043·IF-AI-044·IF-AI-045·IF-AI-046·IF-AI-047 외 13 | ai_gold_item | GLB-WO·SCR-15 | — (모드 사다리 경유, AI-01 §7.5) | UT-AI-204 | WP-04-09·WP-04-18·WP-04-24 | INT-4~5 |

### 3.2 FR-CUR — 커리큘럼·콘텐츠 (26)

| ID | 이름 | 우선·슬 | UR | V | 서비스 | IF | 테이블 | SCR | AI(프롬프트/Jev) | 테스트 | WP | INT |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FR-CUR-001 | 트랙·개념 지도 제공 | Must·R0 | UR-00·UR-01·UR-11 | V-build | content/catalog·gateway·learning/curriculum-ref 외 1 | IF-CT-001·IF-CT-002·IF-CT-003·IF-CT-004·IF-CT-005·IF-CT-006 외 8 | ct_concept·lr_curriculum_ref | SCR-03·SCR-04 | 해당 없음(결정적) | IT-016·UT-LR-450 | WP-01-01·WP-01-02·WP-01-08 외 1 | INT-1b |
| FR-CUR-002 | 콘텐츠 팩 로더 | Must·R0 | UR-00·UR-13·UR-17 | V-build | content/catalog·contracts·gateway 외 2 | IF-CT-001·IF-CT-002·IF-CT-003·IF-CT-004·IF-CT-005·IF-CT-006 외 9 | ct_pack | SCR-03 | 해당 없음(결정적) | IT-015·UT-CT-001·UT-PACKC-003 | WP-00-06·WP-00-16·WP-01-01 외 2 | INT-1b |
| FR-CUR-003 | 택소노미 lint | Must·R0 | UR-00·UR-01·UR-13 | V-build | gateway·packc | IF-CT-001·IF-CT-002·IF-CT-003·IF-CT-004·IF-CT-005·IF-CT-006 외 8 | content.db `ct_*` | SCR-03 | 해당 없음(결정적) | UT-CT-001~099 · UT-PACKC-0nn | WP-01-01·WP-01-17 | INT-1b |
| FR-CUR-004 | 안정 ID·별칭·폐기 | Must·R0 | UR-00·UR-12 | V-build | content/catalog·gateway | IF-CT-001·IF-CT-002·IF-CT-003·IF-CT-004·IF-CT-005·IF-CT-006 외 8 | ct_concept·ct_id_alias·lr_concept_id_alias | SCR-03 | 해당 없음(결정적) | CT-SYS-012·UT-PACKC-008 | WP-01-02·WP-01-17 | INT-1b |
| FR-CUR-005 | 3단 개념 페이지 불변식 (티어별 최소 사양) | Must·R0 | UR-00·UR-02·UR-10 | V-build | content/catalog·gateway·packc 외 1 | IF-CT-006·IF-CT-008·IF-CT-009·IF-CT-010·IF-CT-011·IF-CT-012 외 8 | content.db `ct_*` | DLG-BP-IMPORT·SCR-03·SCR-17 | 해당 없음(결정적) | UT-PACKC-001 | WP-01-01·WP-01-17·WP-02-12 외 1 | INT-1b |
| FR-CUR-006 | 레벨별 진입점·레벨 렌즈 | Must·R1 | UR-00·UR-10·UR-11 | V-build | content/catalog·gateway·web/curriculum | IF-CT-006·IF-CT-008·IF-CT-009·IF-CT-010·IF-CT-011·IF-CT-012 외 9 | content.db `ct_*` | DLG-BP-IMPORT·SCR-03·SCR-17 | 해당 없음(결정적) | UT-CT-001~099·UT-PACKC(대역) | WP-01-17·WP-02-12·WP-02-15 | INT-2~3 |
| FR-CUR-007 | 프리테스트 (M-02 먼저 풀어보기) | Must·R1 | UR-00·UR-10·UR-14 | V-build | content/catalog·gateway·web/curriculum | IF-CT-006·IF-CT-008·IF-CT-009·IF-CT-010·IF-CT-011·IF-CT-012 외 9 | ib_item_stat | DLG-BP-IMPORT·SCR-03·SCR-17 | 해당 없음(결정적) | UT-CT-211·UT-LR-115 | WP-01-17·WP-02-12·WP-02-15 | INT-2~3 |
| FR-CUR-008 | 임베디드 질문 | Must·R1 | UR-00·UR-10·UR-14 | V-build | content/catalog·gateway·web/curriculum | IF-CT-006·IF-CT-008·IF-CT-009·IF-CT-010·IF-CT-011·IF-CT-012 외 8 | content.db `ct_*` | DLG-BP-IMPORT·SCR-03·SCR-17 | 해당 없음(결정적) | UT-CT-001~099·UT-PACKC(대역) | WP-01-17·WP-02-12·WP-02-15 | INT-2~3 |
| FR-CUR-009 | 시드 콘텐츠 3티어 적재 (목표·하한 분리) | Must·R1 | UR-00·UR-01·UR-02·UR-11·UR-13 | V-build | content/catalog·gateway·packc | IF-CT-004·IF-GW-040 | ct_ku·ct_record_history | SCR-03·SCR-04 | 해당 없음(결정적) | UT-CT-001~099·UT-PACKC(대역) | WP-01-01·WP-01-02·WP-01-17 | INT-2~3 |
| FR-CUR-010 | Tier C 개념 즉시 승격 | Should·R2 | UR-01·UR-02·UR-13 | V-build | gateway | IF-GW-040 | content.db `ct_*` | SCR-03 | — (모드 사다리 경유, AI-01 §7.5) | UT-CT-001~099·UT-PACKC(대역) | WP-01-17 | INT-4~5 |
| FR-CUR-011 | 한국어 부분 일치 검색 | Must·R1 | UR-01·UR-13 | V-build | content/catalog·gateway | IF-CT-006·IF-CT-008·IF-CT-009·IF-CT-010·IF-CT-011·IF-CT-012 외 6 | ct_search_doc | SCR-03 | 해당 없음(결정적) | UT-CT-010·UT-CT-011·UT-CT-012·UT-CT-013 | WP-01-17·WP-02-13 | INT-2~3 |
| FR-CUR-012 | 출처 레지스트리·출처 서랍 | Must·R1 | UR-01·UR-13 | V-build | content/catalog·gateway·packc 외 1 | IF-CT-004·IF-CT-006·IF-CT-008·IF-CT-009·IF-CT-010·IF-CT-011 외 7 | content.db `ct_*` | DLG-BP-IMPORT·SCR-03·SCR-17 | 해당 없음(결정적) | UT-CT-001~099 · UT-PACKC-0nn | WP-01-17·WP-02-12·WP-02-14 외 1 | INT-2~3 |
| FR-CUR-013 | 신선도 메타데이터와 CL-X | Must(lite)·R3 | UR-01·UR-12·UR-17 | V-build | content/catalog | IF-CT-013·IF-CT-014·IF-CT-015·IF-CT-016·IF-CT-017·IF-CT-018 외 13 | content.db `ct_*` | DLG-BP-IMPORT·SCR-03·SCR-17 | 해당 없음(결정적) | UT-PACKC-008 | WP-07-03 | INT-6~7 |
| FR-CUR-014 | 수동 재검증·outdated 신고·복귀 변경 요약 | Must(lite)·R3 | UR-01·UR-12 | V-build | content/catalog | IF-CT-013·IF-CT-014·IF-CT-015·IF-CT-016·IF-CT-017·IF-CT-018 외 13 | content.db `ct_*` | DLG-BP-IMPORT·SCR-03·SCR-17 | — (모드 사다리 경유, AI-01 §7.5) | UT-CT-001~099·UT-PACKC(대역) | WP-07-03 | INT-6~7 |
| FR-CUR-015 | SI 실무 학습 콘텐츠 (`ctx:si`) | Must·R3 | UR-01·UR-07·UR-11 | V-build | content/grading | — (빌드 타임 packc·정적 게이트, API 없음) | content.db `ct_*` | SCR-02 | 해당 없음(결정적) | UT-CT-001~099·UT-PACKC(대역) | WP-06-06 | INT-6~7 |
| FR-CUR-016 | Case·Artifact·Rubric 콘텐츠 모델과 | Must·R0 | UR-01·UR-11·UR-12 | V-build | content/grading·contracts | IF-CT-024·IF-CT-040·IF-GW-070 | ct_case | SCR-08 | 해당 없음(결정적) | UT-CT-0nn Case 상태기계 + E2E-3nn(M-19) | WP-00-06·WP-06-02 | INT-1b |
| FR-CUR-017 | 정책·파라미터 버전 파일 | Must·R1 | UR-01·UR-05·UR-12 | V-build | contracts·packc·shared-kernel | IF-CT-001·IF-CT-002·IF-CT-003·IF-CT-004·IF-CT-005·IF-CT-006 외 10 | content.db `ct_*` | —(화면 없음) | 해당 없음(결정적) | IT-024·UT-LR-101·UT-SK-012 | WP-00-03·WP-00-21·WP-00-26 | INT-2~3 |
| FR-CUR-018 | 개념 관계 그래프 | Must·R1 | UR-01·UR-11 | V-build | content/catalog·gateway·web/curriculum | IF-CT-004·IF-CT-006·IF-CT-008·IF-CT-009·IF-CT-010·IF-CT-011 외 7 | ct_concept_edge | DLG-BP-IMPORT·SCR-03·SCR-17 | 해당 없음(결정적) | UT-CT-001~099 · UT-PACKC-0nn | WP-01-17·WP-02-12·WP-02-15 | INT-2~3 |
| FR-CUR-019 | 학습 경로(path) 선택 | Must·R1 | UR-01·UR-11 | V-build | content/catalog·gateway | IF-CT-004·IF-CT-006·IF-CT-008·IF-CT-009·IF-CT-010·IF-CT-011 외 7 | ct_path | DLG-BP-IMPORT·SCR-03·SCR-17 | 해당 없음(결정적) | UT-CT-001~099 · UT-PACKC-0nn | WP-01-17·WP-02-12 | INT-2~3 |
| FR-CUR-020 | 사용자 오버레이 (불변 시드 + 사용자 수정) | Must·R2 | UR-02·UR-12·UR-13·UR-17 | V-build | content/catalog·contracts·gateway 외 3 | IF-CT-013·IF-CT-014·IF-CT-015·IF-CT-016·IF-CT-017·IF-CT-018 외 16 | ct_overlay_event·ct_overlay_head | DLG-BP-IMPORT·SCR-03·SCR-14·SCR-17 | 해당 없음(결정적) | IT-015·UT-CT-002·UT-CT-003 | WP-00-06·WP-00-16·WP-01-17 외 3 | INT-4~5 |
| FR-CUR-021 | L4+ 1차 출처와 이견 표현 | Must·R2 | UR-02·UR-11·UR-12·UR-13 | V-build | packc | IF-CT-003·IF-CT-006·IF-CT-008·IF-CT-009·IF-CT-010·IF-CT-011 외 6 | content.db `ct_*` | DLG-BP-IMPORT·SCR-03·SCR-04·SCR-17 | 해당 없음(결정적) | UT-CT-001~099·UT-PACKC(대역) | WP-02-14·WP-05-12 | INT-4~5 |
| FR-CUR-022 | 개인 Case 파운드리 lite | Should·R3 | UR-02·UR-12·UR-13 | V-build | content/catalog | IF-CT-013·IF-CT-014·IF-CT-015·IF-CT-016·IF-CT-017·IF-CT-018 외 14 | content.db `ct_*` | —(화면 없음) | — (모드 사다리 경유, AI-01 §7.5) | UT-CT-001~099·UT-PACKC(대역) | WP-07-03 | INT-6~7 |
| FR-CUR-023 | 로컬 팩 갱신 `fathom pack refresh | Should·R3 | UR-01·UR-02·UR-12·UR-13 | V-build | cli·content/catalog | IF-CT-013·IF-CT-014·IF-CT-015·IF-CT-016·IF-CT-017·IF-CT-018 외 15 | content.db `ct_*` | —(화면 없음) | — (모드 사다리 경유, AI-01 §7.5) | UT-CT-001~099·UT-PACKC(대역) | WP-07-03·WP-07-17 | INT-6~7 |
| FR-CUR-024 | 자격증 블루프린트 | Must·R3 | UR-02·UR-11·UR-14 | V-build | content/catalog·gateway | IF-CT-013·IF-CT-014·IF-CT-015·IF-CT-016·IF-CT-017·IF-CT-018 외 20 | ct_blueprint·ct_blueprint_item·ct_blueprint_map | DLG-BP-IMPORT·SCR-03·SCR-04·SCR-10 외 1 | 해당 없음(결정적) | E2E-108 | WP-07-02·WP-07-03·WP-07-11 외 1 | INT-6~7 |
| FR-CUR-025 | 필수 개념·트랙 상한 메타 | Must·R1 | UR-01·UR-02·UR-11·UR-12 | V-build | contracts·learning/learner-model·packc 외 1 | IF-CT-001·IF-CT-002·IF-CT-003·IF-CT-004·IF-CT-005·IF-CT-006 외 12 | content.db `ct_*` | DLG-BP-IMPORT·SCR-03·SCR-04·SCR-17 | 해당 없음(결정적) | UT-CON-004·UT-PACKC-002 | WP-00-06·WP-01-01·WP-02-14 외 2 | INT-2~3 |
| FR-CUR-026 | 3단 커버리지 KPI | Must·R1 | UR-01·UR-02·UR-03·UR-10 | V-build | packc | IF-CT-001·IF-CT-002·IF-CT-003·IF-CT-004·IF-CT-005·IF-CT-006 외 8 | content.db `ct_*` | PNL-04-T·SCR-04 | 해당 없음(결정적) | UT-PACKC-006 | WP-02-14 | INT-2~3 |

### 3.3 FR-DSH — 대시보드·리뷰 (16)

| ID | 이름 | 우선·슬 | UR | V | 서비스 | IF | 테이블 | SCR | AI(프롬프트/Jev) | 테스트 | WP | INT |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FR-DSH-001 | Cockpit Home | Must·R0 | UR-04·UR-17 | V-build | gateway·learning/insight·web/insight | IF-GW-010·IF-GW-055·IF-GW-056·IF-GW-057·IF-GW-075·IF-GW-076 외 14 | insight.db `iv_*`(재구성) + learning 투영 | SCR-01 | 해당 없음(결정적) | UT-LR-400 | WP-01-12·WP-01-17·WP-03-11 외 1 | INT-1b |
| FR-DSH-002 | 레벨별 기본 화면 제안 | Should·R3 | UR-11·UR-17 | V-build | web/settings·shell | IF-GW-010·IF-GW-055·IF-GW-056·IF-GW-057·IF-GW-075·IF-GW-076 외 15 | insight.db `iv_*`(재구성) + learning 투영 | SCR-01·SCR-17 | 해당 없음(결정적) | UT-LR-400~449·UT-WEB-2nn·E2E-5nn(대역) | WP-06-15 | INT-6~7 |
| FR-DSH-003 | Depth Map | Must·R1 | UR-01·UR-04·UR-12 | V-build | gateway·learning/insight·web/curriculum | IF-CT-011·IF-GW-010·IF-GW-031·IF-GW-040·IF-GW-055·IF-GW-056 외 17 | iv_depth_cell | SCR-01·SCR-04 | 해당 없음(결정적) | UT-LR-400~449 + UT-WEB-200~499 + E2E-5nn | WP-03-11·WP-03-18·WP-03-26 | INT-2~3 |
| FR-DSH-004 | Depth Map 레이어 토글 | Must·R1 | UR-04·UR-14 | V-build | gateway·web/curriculum | IF-GW-010·IF-GW-031·IF-GW-040·IF-GW-055·IF-GW-056·IF-GW-057 외 16 | iv_depth_cell | SCR-04 | 해당 없음(결정적) | UT-LR-400~449 + UT-WEB-200~499 + E2E-5nn | WP-03-18·WP-03-26 | INT-2~3 |
| FR-DSH-005 | 과거 오버레이·연간 타임랩스 | Must·R1 | UR-04·UR-12 | V-build | gateway·web/curriculum | IF-GW-010·IF-GW-031·IF-GW-040·IF-GW-055·IF-GW-056·IF-GW-057 외 16 | insight.db `iv_*`(재구성) + learning 투영 | SCR-04 | 해당 없음(결정적) | UT-LR-400~449 + UT-WEB-200~499 + E2E-5nn | WP-03-18·WP-03-26·WP-07-11 | INT-2~3 |
| FR-DSH-006 | 셀 드릴다운과 행동 연결 | Must·R1 | UR-12·UR-17 | V-build | gateway·learning/learner-model·web/curriculum | IF-GW-010·IF-GW-031·IF-GW-040·IF-GW-043·IF-GW-055·IF-GW-056 외 18 | insight.db `iv_*`(재구성) + learning 투영 | SCR-04 | 해당 없음(결정적) | UT-LR-400~449 + UT-WEB-200~499 + E2E-5nn | WP-02-01·WP-03-18·WP-03-26 | INT-2~3 |
| FR-DSH-007 | 개념 증거 패널 ("왜 숙달인가") | Must·R1 | UR-12·UR-16 | V-build | gateway·learning/insight·learning/learner-model 외 1 | IF-GW-010·IF-GW-031·IF-GW-055·IF-GW-056·IF-GW-057·IF-GW-075 외 18 | insight.db `iv_*`(재구성) + learning 투영 | SCR-04·SCR-05·SCR-10 | 해당 없음(결정적) | UT-LR-209 | WP-02-01·WP-03-08·WP-03-11 외 2 | INT-2~3 |
| FR-DSH-008 | 세션 리포트 | Must·R0 | UR-14·UR-17 | V-build | learning/practice·web/practice | IF-EV-09·IF-GW-010·IF-GW-020·IF-GW-028·IF-GW-030·IF-GW-055 외 20 | insight.db `iv_*`(재구성) + learning 투영 | SCR-02·SCR-10 | — (모드 사다리 경유, AI-01 §7.5) | UT-LR-400~449 + UT-WEB-200~499 + E2E-5nn | WP-01-09·WP-01-13 | INT-1b |
| FR-DSH-009 | 주간 리뷰 의식 | Must·R1 | UR-03·UR-14 | V-build | gateway·learning/insight·web/insight | IF-GW-010·IF-GW-055·IF-GW-056·IF-GW-057·IF-GW-075·IF-GW-076 외 14 | iv_weekly_report·lr_review_note | SCR-10 | — (모드 사다리 경유, AI-01 §7.5) | UT-LR-400~449 + UT-WEB-200~499 + E2E-5nn | WP-03-11·WP-03-19·WP-03-26 외 2 | INT-2~3 |
| FR-DSH-010 | 보정 스튜디오 | Must·R1 | UR-14 | V-build | gateway·web/insight | IF-GW-010·IF-GW-055·IF-GW-056·IF-GW-057·IF-GW-075·IF-GW-076 외 14 | insight.db `iv_*`(재구성) + learning 투영 | SCR-10 | 해당 없음(결정적) | UT-LR-400~449 + UT-WEB-200~499 + E2E-5nn | WP-03-19·WP-03-26·WP-07-10 | INT-2~3 |
| FR-DSH-011 | LDI 노출 규칙 | Must·R1 | UR-04·UR-17 | V-build | learning/insight | IF-GW-010·IF-GW-055·IF-GW-056·IF-GW-057·IF-GW-075·IF-GW-076 외 14 | insight.db `iv_*`(재구성) + learning 투영 | SCR-01·SCR-04·SCR-10 | 해당 없음(결정적) | UT-LR-401 | WP-03-11·WP-07-10 | INT-2~3 |
| FR-DSH-012 | 시즌 플래너·프리모템·회고 | Should·R3 | UR-03·UR-12 | V-build | gateway·learning/insight·learning/practice 외 1 | IF-GW-010·IF-GW-055·IF-GW-056·IF-GW-057·IF-GW-075·IF-GW-076 외 18 | iv_season·lr_review_note | SCR-10·SCR-11 | 해당 없음(결정적) | UT-LR-400~449·UT-WEB-2nn·E2E-5nn(대역) | WP-07-04·WP-07-05·WP-07-10 외 1 | INT-6~7 |
| FR-DSH-013 | Retention Radar | Should·R3 | UR-12·UR-17 | B+V-field | gateway·learning/insight·web/insight | IF-GW-010·IF-GW-055·IF-GW-056·IF-GW-057·IF-GW-075·IF-GW-076 외 14 | iv_radar | SCR-10 | 해당 없음(결정적) | UT-LR-400~449·UT-WEB-2nn·E2E-5nn(대역) | WP-03-19·WP-07-04·WP-07-10 외 1 | INT-6~7 |
| FR-DSH-014 | 증거 포트폴리오 export | Should·R3 | UR-12 | V-build | gateway·learning/insight·web/insight | IF-GW-010·IF-GW-055·IF-GW-056·IF-GW-057·IF-GW-075·IF-GW-076 외 16 | op_id | SCR-10·SCR-11 | 해당 없음(결정적) | UT-LR-400~449·UT-WEB-2nn·E2E-5nn(대역) | WP-07-04·WP-07-10·WP-07-16 | INT-6~7 |
| FR-DSH-015 | 학습 ROI·모드 기여 | Should·R3 | UR-14·UR-17 | V-build | learning/insight | IF-GW-010·IF-GW-055·IF-GW-056·IF-GW-057·IF-GW-075·IF-GW-076 외 14 | insight.db `iv_*`(재구성) + learning 투영 | SCR-10 | 해당 없음(결정적) | UT-LR-400~449·UT-WEB-2nn·E2E-5nn(대역) | WP-07-04·WP-07-10 | INT-6~7 |
| FR-DSH-016 | 오개념 계열 리포트 | Should·R3 | UR-12·UR-14 | V-build | learning/insight·learning/learner-model | IF-GW-010·IF-GW-055·IF-GW-056·IF-GW-057·IF-GW-075·IF-GW-076 외 14 | insight.db `iv_*`(재구성) + learning 투영 | SCR-10 | 해당 없음(결정적) | UT-LR-400~449·UT-WEB-2nn·E2E-5nn(대역) | WP-06-09·WP-07-04·WP-07-10 | INT-6~7 |

### 3.4 FR-IMP — 개념 가져오기 (14)

| ID | 이름 | 우선·슬 | UR | V | 서비스 | IF | 테이블 | SCR | AI(프롬프트/Jev) | 테스트 | WP | INT |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FR-IMP-001 | 가져오기 입력 3종 | Must·R2 | UR-13 | V-build | content/acquisition·gateway·web/acquisition | IF-AI-010·IF-AI-020·IF-CT-030·IF-CT-031·IF-CT-032·IF-CT-033 외 19 | aq_import_job | SCR-12·SCR-13 | 해당 없음(결정적) | UT-CT-100~199·IT-200~299(대역) | WP-05-08·WP-05-14·WP-05-19 | INT-4~5 |
| FR-IMP-002 | URL 수집 가드 | Must·R2 | UR-13·UR-17 | V-build | content/acquisition·gateway·tests 외 1 | IF-AI-010·IF-AI-020·IF-CT-013·IF-CT-030·IF-CT-031·IF-CT-032 외 20 | content.db `aq_*` | SCR-12·SCR-13 | 해당 없음(결정적) | SEC-CT-251~270 | WP-05-09·WP-05-14·WP-05-19 외 1 | INT-4~5 |
| FR-IMP-003 | 파이프라인 I1~I9 진행 상태 | Must·R2 | UR-13·UR-17 | V-build | content/acquisition·gateway·web/acquisition | IF-AI-010·IF-AI-020·IF-CT-030·IF-CT-031·IF-CT-032·IF-CT-033 외 19 | aq_import_job | SCR-12·SCR-13 | 해당 없음(결정적) | UT-CT-105 | WP-05-08·WP-05-14·WP-05-19 | INT-4~5 |
| FR-IMP-004 | 규칙 기반 추출 (OFFLINE) | Must·R2 | UR-13·UR-15 | V-build | content/acquisition·gateway·web/acquisition | IF-AI-010·IF-AI-020·IF-CT-030·IF-CT-031·IF-CT-032·IF-CT-033 외 19 | content.db `aq_*` | SCR-12·SCR-13 | 해당 없음(결정적) | UT-CT-104 | WP-05-08·WP-05-14·WP-05-19 | INT-4~5 |
| FR-IMP-005 | AI 추출·근거 검증·분류·모순 탐지 | Must·R2 | UR-13·UR-16 | V-build | content/acquisition·gateway·web/acquisition | IF-AI-001·IF-AI-010·IF-AI-020·IF-CT-030·IF-CT-031·IF-CT-032 외 20 | content.db `aq_*` | SCR-12·SCR-13 | — (모드 사다리 경유, AI-01 §7.5) | UT-CT-100~199·IT-200~299(대역) | WP-05-08·WP-05-14·WP-05-19 | INT-4~5 |
| FR-IMP-006 | 프롬프트 주입 탐지·청크 격리 | Must·R2 | UR-13·UR-17 | B+V-live | content/acquisition·gateway·tests 외 1 | IF-AI-010·IF-AI-020·IF-AI-050·IF-CT-013·IF-CT-030·IF-CT-031 외 21 | content.db `aq_*` | SCR-12·SCR-13 | — (모드 사다리 경유, AI-01 §7.5) | UT-CT-103 | WP-05-08·WP-05-09·WP-05-14 외 2 | INT-4~5 |
| FR-IMP-007 | 라이선스 등급·copy-guard | Must·R2 | UR-13 | V-build | gateway·packc·web/acquisition | IF-AI-010·IF-AI-020·IF-CT-030·IF-CT-031·IF-CT-032·IF-CT-033 외 19 | ct_source | SCR-12·SCR-13 | 해당 없음(결정적) | UT-CT-102 | WP-02-14·WP-05-08·WP-05-14 외 1 | INT-4~5 |
| FR-IMP-008 | 중복·동형 병합 | Must·R2 | UR-13 | V-build | content/acquisition·gateway·web/acquisition | IF-AI-010·IF-AI-020·IF-CT-030·IF-CT-031·IF-CT-032·IF-CT-033 외 20 | content.db `aq_*` | SCR-12·SCR-13 | — (모드 사다리 경유, AI-01 §7.5) | UT-CT-100~199·IT-200~299(대역) | WP-05-08·WP-05-14·WP-05-19 | INT-4~5 |
| FR-IMP-009 | 스테이징 diff 승인과 신뢰 등급 | Must·R2 | UR-13·UR-17 | V-build | content/acquisition·gateway·web/acquisition | IF-AI-010·IF-AI-020·IF-CT-030·IF-CT-031·IF-CT-032·IF-CT-033 외 19 | aq_staging_item | SCR-12·SCR-13 | 해당 없음(결정적) | UT-CT-100~199·IT-200~299(대역) | WP-05-08·WP-05-14·WP-05-19 | INT-4~5 |
| FR-IMP-010 | 민감 자료 로컬 LLM 강제 | Must·R2 | UR-15 | V-build | content/acquisition·gateway·web/acquisition | IF-AI-010·IF-AI-020·IF-AI-050·IF-AI-053·IF-CT-030·IF-CT-031 외 22 | content.db `aq_*` | SCR-12·SCR-13 | — (모드 사다리 경유, AI-01 §7.5) | UT-CT-100~199·IT-200~299(대역) | WP-05-08·WP-05-09·WP-05-14 외 1 | INT-4~5 |
| FR-IMP-011 | 가져온 개념의 학습 편입 | Must·R2 | UR-00·UR-10·UR-13 | V-build | content/acquisition·gateway·web/acquisition | IF-AI-010·IF-AI-020·IF-CT-030·IF-CT-031·IF-CT-032·IF-CT-033 외 19 | content.db `aq_*` | SCR-12·SCR-13 | — (모드 사다리 경유, AI-01 §7.5) | UT-CT-100~199·IT-200~299(대역) | WP-05-08·WP-05-14·WP-05-19 | INT-4~5 |
| FR-IMP-012 | 가져오기 후보 큐 | Should·R2 | UR-13 | V-build | content/acquisition·gateway·web/acquisition | IF-AI-010·IF-AI-020·IF-CT-030·IF-CT-031·IF-CT-032·IF-CT-033 외 19 | aq_candidate | SCR-12 | 해당 없음(결정적) | UT-CT-100~199·IT-200~299(대역) | WP-05-10·WP-05-14·WP-05-19 | INT-4~5 |
| FR-IMP-013 | Encounter Inbox 캡처 | Should·R2 | UR-13·UR-15 | V-build | cli·content/acquisition·gateway 외 1 | IF-AI-010·IF-AI-020·IF-CT-030·IF-CT-031·IF-CT-032·IF-CT-033 외 19 | aq_inbox_item | SCR-12 | 해당 없음(결정적) | UT-CLI-003 | WP-05-10·WP-05-14·WP-05-19 외 1 | INT-4~5 |
| FR-IMP-014 | Inbox 매칭·프로브·트리아지 | Should·R2 | UR-13·UR-16 | V-build | content/acquisition·gateway·web/acquisition | IF-AI-010·IF-AI-020·IF-CT-030·IF-CT-031·IF-CT-032·IF-CT-033 외 19 | aq_inbox_item·ct_search_doc | SCR-12 | AI-J13 | UT-CT-100~199·IT-200~299(대역) | WP-05-10·WP-05-14·WP-05-19 | INT-4~5 |

### 3.5 FR-LAB — 실습·러너 (17)

| ID | 이름 | 우선·슬 | UR | V | 서비스 | IF | 테이블 | SCR | AI(프롬프트/Jev) | 테스트 | WP | INT |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FR-LAB-001 | JS/TS 코드 러너 (격리 설계 확정) | Must·R1 | UR-14·UR-17 | V-build | content/runner | IF-CT-040·IF-CT-050·IF-CT-051·IF-CT-056·IF-EXT-12·IF-GW-032 외 2 | content.db `ct_lab`·`rn_run` | —(화면 없음) | 해당 없음(결정적) | UT-CT-400·UT-CT-401·UT-CT-403·UT-CT-407 외 3 | WP-03-01 | INT-2~3 |
| FR-LAB-002 | SQL 러너 (토크나이저 allowlist) | Must·R1 | UR-01·UR-14 | V-build | content/runner | IF-CT-040·IF-CT-050·IF-CT-051·IF-CT-056·IF-EXT-12·IF-GW-032 외 2 | content.db `ct_lab`·`rn_run` | —(화면 없음) | 해당 없음(결정적) | UT-CT-402 | WP-03-01 | INT-2~3 |
| FR-LAB-003 | 코드 과제 형식 | Must·R1 | UR-10·UR-14 | V-build | content/grading·web/practice | IF-CT-040·IF-CT-050·IF-CT-051·IF-CT-056·IF-EXT-12·IF-GW-032 외 2 | content.db `ct_lab`·`rn_run` | SCR-02 | 해당 없음(결정적) | UT-CT-400~499 + E2E-301~321 | WP-03-03·WP-03-16 | INT-2~3 |
| FR-LAB-004 | 테스트 기반 채점·숨은 테스트 | Must·R1 | UR-14 | V-build | content/grading·web/practice | IF-CT-040·IF-CT-050·IF-CT-051·IF-CT-056·IF-EXT-12·IF-GW-020 외 4 | content.db `ct_lab`·`rn_run` | SCR-02 | AI-G06 | UT-CT-406 | WP-03-03·WP-03-16 | INT-2~3 |
| FR-LAB-005 | 힌트 사다리 | Must·R1 | UR-14 | V-build | content/grading·content/itembank·gateway 외 1 | IF-CT-040·IF-CT-050·IF-CT-051·IF-CT-056·IF-EXT-12·IF-GW-031 외 3 | ib_hint_open | SCR-02·SCR-04 | — (모드 사다리 경유, AI-01 §7.5) | UT-CT-400~499 + E2E-301~321 | WP-03-03·WP-03-04·WP-03-16 외 1 | INT-2~3 |
| FR-LAB-006 | 참조 모드 | Must·R1 | UR-14 | V-build | content/grading·web/practice | IF-CT-040·IF-CT-050·IF-CT-051·IF-CT-056·IF-EXT-12·IF-GW-032 외 2 | content.db `ct_lab`·`rn_run` | SCR-02 | 해당 없음(결정적) | UT-CT-400~499 + E2E-301~321 | WP-03-03·WP-03-16 | INT-2~3 |
| FR-LAB-007 | PRIMM 예측 → 실행 | Must·R1 | UR-10·UR-14 | V-build | content/grading·web/practice | IF-CT-040·IF-CT-050·IF-CT-051·IF-CT-056·IF-EXT-12·IF-GW-032 외 2 | content.db `ct_lab`·`rn_run` | SCR-02 | 해당 없음(결정적) | UT-CT-400~499 + E2E-301~321 | WP-03-03·WP-03-16 | INT-2~3 |
| FR-LAB-008 | Scaffold Fader | Should·R3 | UR-10·UR-11 | V-build | learning/practice | IF-CT-040·IF-CT-050·IF-CT-051·IF-CT-056·IF-EXT-12·IF-GW-032 외 2 | content.db `ct_lab`·`rn_run` | SCR-02 | 해당 없음(결정적) | UT-CT-400~499·SEC-CT(대역) | WP-06-10 | INT-6~7 |
| FR-LAB-009 | 코드 회상 카타 (M-11) | Should·R3 | UR-12·UR-14 | V-build | content/grading | IF-CT-040·IF-CT-050·IF-CT-051·IF-CT-056·IF-EXT-12·IF-GW-032 외 2 | content.db `ct_lab`·`rn_run` | SCR-02 | 해당 없음(결정적) | UT-CT-400~499·SEC-CT(대역) | WP-06-07·WP-06-13 | INT-6~7 |
| FR-LAB-010 | 인프라 실습 lite (M-12) | Must·R3 | UR-01·UR-14 | V-build | content/grading·web/practice | IF-CT-040·IF-CT-050·IF-CT-051·IF-CT-056·IF-EXT-12·IF-GW-020 외 3 | content.db `ct_lab`·`rn_run` | SCR-02 | 해당 없음(결정적) | UT-CT-400~499·SEC-CT(대역) | WP-06-07·WP-06-13 | INT-6~7 |
| FR-LAB-011 | Docker 선택 검증 | Must·R3 | UR-01 | B+V-live | content/runner | IF-CT-040·IF-CT-050·IF-CT-051·IF-CT-056·IF-EXT-12·IF-GW-032 외 2 | content.db `ct_lab`·`rn_run` | SCR-02 | 해당 없음(결정적) | UT-CT-400~499 + E2E-301~321 | WP-06-07 | INT-6~7 |
| FR-LAB-012 | 실습 불가 환경 대체 경로 | Must·R3 | UR-01·UR-15 | V-build | content/grading | IF-CT-040·IF-CT-050·IF-CT-051·IF-CT-055·IF-CT-056·IF-EXT-12 외 3 | content.db `ct_lab`·`rn_run` | SCR-02 | 해당 없음(결정적) | UT-CT-408 | WP-06-07 | INT-6~7 |
| FR-LAB-013 | 러너 결과 기록 | Must·R1 | UR-12·UR-17 | V-build | content/grading | IF-CT-040·IF-CT-050·IF-CT-051·IF-CT-056·IF-EXT-12·IF-GW-032 외 3 | gr_attempt·rn_run | SCR-02 | 해당 없음(결정적) | UT-CT-405 | WP-03-03 | INT-2~3 |
| FR-LAB-014 | 알고리즘 구현 문제 은행 | Must·R2 | UR-01·UR-11·UR-14 | V-build | content/runner·packc | IF-CT-040·IF-CT-050·IF-CT-051·IF-CT-056·IF-EXT-12·IF-GW-032 외 2 | content.db `ct_lab`·`rn_run` | SCR-02 | AI-G06 | UT-CT-310 | WP-05-11·WP-05-12 | INT-4~5 |
| FR-LAB-015 | 보안 패치 과제 (Patch-the-Vuln) | Must·R3 | UR-01·UR-07·UR-14 | V-build | content/runner·packc | IF-CT-040·IF-CT-050·IF-CT-051·IF-CT-056·IF-EXT-12·IF-GW-032 외 2 | content.db `ct_lab`·`rn_run` | SCR-02 | AI-G06 | UT-CT-400~499·SEC-CT(대역) | WP-05-12·WP-06-07 | INT-6~7 |
| FR-LAB-016 | 코드 출처별 실행 허용 정책 | Must·R1 | UR-14·UR-17 | V-build | content/itembank·content/runner | IF-CT-040·IF-CT-050·IF-CT-051·IF-CT-056·IF-EXT-12·IF-GW-032 외 2 | content.db `ct_lab`·`rn_run` | SCR-02 | AI-G06 | CT-CT-202·UT-CT-409 | WP-03-01·WP-03-04 | INT-2~3 |
| FR-LAB-017 | ml/llm 코드 단 (예측형 · 빌드타임 오라클) | Must·R2 | UR-01·UR-10 | V-build | packc | IF-CT-040·IF-CT-050·IF-CT-051·IF-CT-056·IF-EXT-12·IF-GW-032 외 2 | content.db `ct_lab`·`rn_run` | —(화면 없음) | 해당 없음(결정적) | UT-PACKC-005 | WP-05-12 | INT-4~5 |

### 3.6 FR-PRG — 진척·숙달·원장 (33)

| ID | 이름 | 우선·슬 | UR | V | 서비스 | IF | 테이블 | SCR | AI(프롬프트/Jev) | 테스트 | WP | INT |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FR-PRG-001 | Learning Event 계약 | Must·R0 | UR-12·UR-17 | V-build | contracts·learning/ledger | IF-EXT-16·IF-GW-020·IF-GW-057·IF-LG-01·IF-LG-02·IF-LG-03 외 24 | lr_event | —(화면 없음) | 해당 없음(결정적) | UT-LR-010·UT-LR-012 | WP-00-03·WP-01-05 | INT-1b |
| FR-PRG-002 | 증거 가중 고정 저장 | Must·R0 | UR-12 | V-build | contracts·learning/ledger | IF-EXT-16·IF-GW-020·IF-LG-01·IF-LG-02·IF-LG-03·IF-LG-04 외 22 | lr_event | —(화면 없음) | 해당 없음(결정적) | UT-CT-304 | WP-00-03·WP-01-05 | INT-1b |
| FR-PRG-003 | 해시 체인 (기기별 체인 + 병합 체크포인트) | Must·R0 | UR-12 | V-build | contracts·learning/ledger | IF-EXT-16·IF-LG-01·IF-LG-02·IF-LG-03·IF-LG-04·IF-LG-05 외 22 | lr_checkpoint·op_id | SCR-16 | 해당 없음(결정적) | IT-011·UT-LR-002·UT-LR-004·UT-LR-006 외 1 | WP-00-03·WP-01-05·WP-03-12 | INT-1b |
| FR-PRG-004 | 카드 적립 (개념 × facet × 응답 모드) | Must·R0 | UR-10·UR-14 | V-build | learning/learner-model·learning/practice | IF-EXT-16·IF-LG-01·IF-LG-02·IF-LG-03·IF-LG-04·IF-LG-05 외 22 | lr_card_state | SCR-02 | 해당 없음(결정적) | UT-LR-103 | WP-01-06·WP-01-09·WP-02-01 | INT-1b |
| FR-PRG-005 | FSRS-6 스케줄링과 보존율 계층 | Must·R0 | UR-12·UR-14 | V-build | learning/learner-model | IF-EXT-16·IF-LG-01·IF-LG-02·IF-LG-03·IF-LG-04·IF-LG-05 외 21 | learning.db `lr_event` + 투영 | —(화면 없음) | 해당 없음(결정적) | UT-LR-100 | WP-01-06·WP-02-01 | INT-1b |
| FR-PRG-006 | 오늘 큐와 Keystone 우선순위 | Must·R1 | UR-11·UR-14 | V-build | learning/learner-model·learning/practice | IF-GW-043·IF-GW-051·IF-GW-055·IF-GW-056·IF-GW-057·IF-GW-075 외 25 | lr_queue_overflow | SCR-01 | 해당 없음(결정적) | UT-LR-300 | WP-02-01·WP-02-02 | INT-2~3 |
| FR-PRG-007 | FSRS grade 반영 규칙 | Must·R1 | UR-14·UR-16 | V-build | learning/learner-model | IF-GW-043·IF-GW-051·IF-GW-055·IF-GW-056·IF-GW-057·IF-GW-075 외 25 | learning.db `lr_event` + 투영 | —(화면 없음) | 해당 없음(결정적) | UT-LR-102 | WP-01-06·WP-02-01 | INT-2~3 |
| FR-PRG-008 | Elo 학습자·문항 모델 | Must·R0 | UR-11 | V-build | learning/learner-model | IF-EV-08·IF-GW-043·IF-GW-051·IF-GW-055·IF-GW-056·IF-GW-057 외 26 | ib_item_stat | SCR-05 | 해당 없음(결정적) | UT-CT-211·UT-LR-104·UT-LR-105·UT-LR-106 외 3 | WP-01-06·WP-05-01 | INT-1b |
| FR-PRG-009 | 숙달 판정 (Mastered, 2조건 증거) | Must·R1 | UR-11·UR-12 | V-build | learning/learner-model·web/insight | IF-GW-043·IF-GW-051·IF-GW-055·IF-GW-056·IF-GW-057·IF-GW-075 외 25 | lr_concept_state·lr_lifecycle·lr_mc_state·lr_track_level | SCR-05 | 해당 없음(결정적) | UT-LR-003·UT-LR-106·UT-LR-108·UT-LR-109 | WP-03-08·WP-03-19 | INT-2~3 |
| FR-PRG-010 | 4중 역량 분리 표시 | Must·R1 | UR-11·UR-12 | V-build | learning/learner-model·web/insight | IF-GW-043·IF-GW-051·IF-GW-055·IF-GW-056·IF-GW-057·IF-GW-064 외 26 | lr_concept_state·lr_lifecycle·lr_mc_state·lr_track_level | SCR-05 | 해당 없음(결정적) | UT-LR-100~299 + UT-LR-500~599(속성) | WP-03-08·WP-03-19 | INT-2~3 |
| FR-PRG-011 | Concept Lifecycle 상태기계 | Must·R1 | UR-11·UR-12 | V-build | learning/learner-model·web/insight | IF-GW-043·IF-GW-051·IF-GW-055·IF-GW-056·IF-GW-057·IF-GW-075 외 25 | lr_lifecycle | SCR-05 | 해당 없음(결정적) | UT-LR-110 | WP-03-08·WP-03-19 | INT-2~3 |
| FR-PRG-012 | ◆ 검증 받기 (숙달 평가) | Must·R1 | UR-11 | V-build | learning/learner-model·web/insight | IF-GW-015·IF-GW-043·IF-GW-051·IF-GW-055·IF-GW-056·IF-GW-057 외 26 | lr_concept_state·lr_lifecycle·lr_mc_state·lr_track_level | SCR-05 | — (모드 사다리 경유, AI-01 §7.5) | UT-LR-208 | WP-03-08·WP-03-19 | INT-2~3 |
| FR-PRG-013 | 승급 평가와 자동 전환 (L1→L4) | Must·R3 | UR-02·UR-11 | V-build | contracts·gateway·learning/learner-model 외 2 | IF-CT-007·IF-EV-08·IF-GW-015·IF-GW-040·IF-GW-051·IF-GW-084 외 18 | lr_curriculum_inventory | SCR-02·SCR-04 | — (모드 사다리 경유, AI-01 §7.5) | UT-LR-200·UT-LR-201·UT-LR-202·UT-LR-203 외 3 | WP-00-05·WP-01-07·WP-06-08 외 3 | INT-6~7 |
| FR-PRG-014 | 적응형 배치 진단 (CAT) | Must·R1 | UR-11·UR-12 | V-build | learning/practice | IF-GW-015·IF-GW-051·IF-GW-165·IF-GW-166·IF-GW-167·IF-GW-168 외 11 | learning.db `lr_event` + 투영 | SCR-01 | 해당 없음(결정적) | UT-LR-100~299 + UT-LR-500~599(속성) | WP-03-10 | INT-2~3 |
| FR-PRG-015 | 모름 진단 (선수 이분 탐색·프런티어 탐침) | Should·R2 | UR-11·UR-13 | V-build | learning/practice | IF-EV-08·IF-LR-001·IF-LR-004·IF-LR-005 | learning.db `lr_event` + 투영 | SCR-02 | — (모드 사다리 경유, AI-01 §7.5) | UT-LR-100~299(대역) | WP-05-07 | INT-4~5 |
| FR-PRG-016 | 오개념 소거 원장 | Should·R3 | UR-12·UR-14 | V-build | learning/learner-model | IF-EV-08·IF-LR-001·IF-LR-004·IF-LR-005 | lr_mc_state | SCR-10 | — (모드 사다리 경유, AI-01 §7.5) | UT-LR-100~299(대역) | WP-06-09 | INT-6~7 |
| FR-PRG-017 | LDI 엔진 | Must·R1 | UR-12·UR-17 | V-build | learning/learner-model | IF-GW-043·IF-GW-051·IF-GW-055·IF-GW-056·IF-GW-057·IF-GW-075 외 24 | iv_weekly_report·op_telemetry_daily | SCR-10 | 해당 없음(결정적) | UT-LR-107·UT-LR-250·UT-LR-251 | WP-03-09 | INT-2~3 |
| FR-PRG-018 | 부하 거버너 | Must·R1 | UR-12·UR-17 | B+V-field | gateway·learning/learner-model | IF-EV-10·IF-GW-010·IF-GW-011·IF-LR-046 | lr_forecast_log | SCR-01·SCR-10 | 해당 없음(결정적) | UT-LR-252·UT-LR-253 | WP-01-17·WP-02-06·WP-07-01 | INT-2~3 |
| FR-PRG-019 | D-day 프로파일 | Must·R3 | UR-02·UR-14 | V-build | gateway·learning/practice·web/settings | IF-CT-020·IF-GW-051·IF-GW-052·IF-GW-076·IF-GW-160·IF-GW-165 외 15 | lr_profile_mode | SCR-10·SCR-17 | 해당 없음(결정적) | UT-LR-100~299(대역) | WP-02-18·WP-07-02·WP-07-14 외 1 | INT-6~7 |
| FR-PRG-020 | 복귀 프로파일 | Must·R1 | UR-12 | V-build | learning/practice·tests | IF-GW-051·IF-GW-165·IF-GW-166·IF-GW-167·IF-GW-168·IF-GW-169 외 12 | lr_profile_mode | SCR-01·SCR-17 | 해당 없음(결정적) | UT-LR-309 | WP-02-05·WP-02-22·WP-07-02 | INT-2~3 |
| FR-PRG-021 | 일시정지·크런치 모드 | Must·R1 | UR-14·UR-17 | V-build | gateway·learning/practice·tests 외 1 | IF-GW-051·IF-GW-160·IF-GW-165·IF-GW-166·IF-GW-167·IF-GW-168 외 15 | lr_profile_mode | SCR-01·SCR-17 | 해당 없음(결정적) | UT-LR-100~299 + UT-LR-500~599(속성) | WP-02-05·WP-02-18·WP-02-21 외 2 | INT-2~3 |
| FR-PRG-022 | 주간 목표 스트릭·휴식 토큰·MVD | Must·R1 | UR-14 | V-build | gateway·learning/practice·tests 외 1 | IF-GW-051·IF-GW-160·IF-GW-161·IF-GW-165·IF-GW-166·IF-GW-167 외 15 | learning.db `lr_event` + 투영 | SCR-01·SCR-17 | 해당 없음(결정적) | UT-LR-308 | WP-02-05·WP-02-18·WP-02-21 외 1 | INT-2~3 |
| FR-PRG-023 | 보정 지표 (CBM·Brier·ECE·과신) | Must·R1 | UR-14 | V-build | learning/learner-model·web/insight | IF-GW-043·IF-GW-051·IF-GW-055·IF-GW-056·IF-GW-057·IF-GW-075 외 24 | iv_calibration | SCR-10 | 해당 없음(결정적) | UT-LR-254 | WP-03-07·WP-03-19 | INT-2~3 |
| FR-PRG-024 | 착각 지도 계산 | Must·R1 | UR-14 | V-build | learning/learner-model·web/insight | IF-GW-043·IF-GW-051·IF-GW-055·IF-GW-056·IF-GW-057·IF-GW-075 외 24 | iv_calibration | SCR-10 | 해당 없음(결정적) | UT-LR-100~299 + UT-LR-500~599(속성) | WP-03-07·WP-03-19 | INT-2~3 |
| FR-PRG-025 | 선언 vs 증명 | Must·R1 | UR-11·UR-14 | V-build | learning/learner-model·web/insight | IF-GW-043·IF-GW-051·IF-GW-055·IF-GW-056·IF-GW-057·IF-GW-075 외 28 | learning.db `lr_event` + 투영 | SCR-10 | 해당 없음(결정적) | UT-LR-100~299 + UT-LR-500~599(속성) | WP-03-07·WP-03-19 | INT-2~3 |
| FR-PRG-026 | JOL (세션 전 예측 → 마무리 대조) | Must·R1 | UR-14 | V-build | learning/learner-model | IF-GW-025·IF-GW-028·IF-GW-043·IF-GW-051·IF-GW-055·IF-GW-056 외 28 | learning.db `lr_event` + 투영 | SCR-02·SCR-10 | 해당 없음(결정적) | UT-LR-100~299 + UT-LR-500~599(속성) | WP-03-07 | INT-2~3 |
| FR-PRG-027 | 일 경계·시계 보정 | Must·R0 | UR-14·UR-17 | V-build | contracts·shared-kernel | IF-EXT-16·IF-GW-160·IF-GW-161·IF-LG-01·IF-LG-02·IF-LG-03 외 25 | learning.db `lr_event` + 투영 | SCR-17 | 해당 없음(결정적) | UT-LR-001·UT-LR-003·UT-LR-503 | WP-00-03·WP-00-14·WP-01-05 | INT-1b |
| FR-PRG-028 | 개인 정책 오버라이드 | Must·R1 | UR-11·UR-14 | V-build | learning/practice | IF-GW-043·IF-GW-051·IF-GW-055·IF-GW-056·IF-GW-057·IF-GW-075 외 24 | learning.db `lr_event` + 투영 | SCR-17 | 해당 없음(결정적) | UT-LR-311·UT-LR-312 | WP-02-04 | INT-2~3 |
| FR-PRG-029 | FSRS 파라미터 개인화 | Should·R3 | UR-12 | V-build | learning/learner-model | IF-GW-051·IF-GW-163·IF-GW-165·IF-GW-166·IF-GW-167·IF-GW-168 외 11 | learning.db `lr_event` + 투영 | SCR-17 | 해당 없음(결정적) | UT-LR-100~299(대역) | WP-07-01 | INT-6~7 |
| FR-PRG-030 | leech 탐지 | Must·R3 | UR-12·UR-14 | V-build | learning/learner-model | IF-GW-051·IF-GW-165·IF-GW-166·IF-GW-167·IF-GW-168·IF-GW-169 외 11 | learning.db `lr_event` + 투영 | SCR-05·SCR-10 | 해당 없음(결정적) | UT-LR-113 | WP-07-01 | INT-6~7 |
| FR-PRG-031 | 일시중지(suspend)·은퇴(retire) | Must·R3 | UR-12 | V-build | gateway·learning/learner-model | IF-GW-051·IF-GW-076·IF-GW-165·IF-GW-166·IF-GW-167·IF-GW-168 외 14 | learning.db `lr_event` + 투영 | SCR-05·SCR-10 | 해당 없음(결정적) | UT-LR-114 | WP-07-01·WP-07-16 | INT-6~7 |
| FR-PRG-032 | L4→L5 승급 기준 | Must·R3 | UR-11·UR-12 | V-build | content/grading·gateway·learning/learner-model 외 2 | IF-CT-040·IF-GW-051·IF-GW-103·IF-GW-165·IF-GW-166·IF-GW-167 외 14 | lr_curriculum_inventory | SCR-04·SCR-09 | — (모드 사다리 경유, AI-01 §7.5) | UT-LR-201·UT-LR-204 | WP-01-07·WP-06-05·WP-06-08 외 3 | INT-6~7 |
| FR-PRG-033 | AI 모드별 숙달 규칙 프로파일·잠정 판정 | Must·R3 | UR-11·UR-15 | V-build | learning/learner-model·tests·web/curriculum·insight | IF-EV-12·IF-GW-051·IF-GW-165·IF-GW-166·IF-GW-167·IF-GW-168 외 11 | learning.db `lr_event` + 투영 | SCR-04·SCR-09 | — (모드 사다리 경유, AI-01 §7.5) | UT-LR-205·UT-LR-206 | WP-01-07·WP-06-05·WP-06-08 외 2 | INT-6~7 |

### 3.7 FR-QST — 문제·출제·채점 (26)

| ID | 이름 | 우선·슬 | UR | V | 서비스 | IF | 테이블 | SCR | AI(프롬프트/Jev) | 테스트 | WP | INT |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FR-QST-001 | T1 절차 생성기 12종 | Must·R0 | UR-01·UR-13 | V-build | content/itembank·packc | IF-AI-010·IF-AI-020·IF-CT-030·IF-CT-034·IF-CT-050·IF-CT-055 외 23 | content.db `ib_item`·`gr_verdict` | —(화면 없음) | 해당 없음(결정적) | UT-CT-200 | WP-01-03·WP-02-10·WP-03-04 외 1 | INT-1b |
| FR-QST-002 | T2 ItemModel 선언적 전개 | Must·R0 | UR-13 | V-build | content/itembank | IF-AI-010·IF-AI-020·IF-CT-030·IF-CT-034·IF-CT-055·IF-CT-056 외 22 | ib_item_model | —(화면 없음) | 해당 없음(결정적) | UT-CT-201 | WP-01-03·WP-02-08 | INT-1b |
| FR-QST-003 | T3 근거 기반 LLM 문항 생성 | Must·R2 | UR-13 | V-build | content/itembank | IF-AI-010·IF-AI-020·IF-CT-030·IF-CT-034·IF-CT-055·IF-CT-056 외 22 | content.db `ib_item`·`gr_verdict` | —(화면 없음) | — (모드 사다리 경유, AI-01 §7.5) | UT-CT-200~399·CT-CT-2nn(대역) | WP-04-13 | INT-4~5 |
| FR-QST-004 | T4 시나리오·루브릭 생성 | Must·R2 | UR-11·UR-13 | V-build | content/itembank | IF-AI-010·IF-AI-020·IF-CT-030·IF-CT-034·IF-CT-055·IF-CT-056 외 22 | ib_item | PNL-14-S·SCR-14 | AI-G02·AI-J04 | UT-CT-209 | WP-04-13b | INT-4~5 |
| FR-QST-005 | ItemModel 저작 루프 (LLM = 템플릿 작 | Must·R2 | UR-13·UR-16 | V-build | content/itembank | IF-AI-010·IF-AI-020·IF-CT-030·IF-CT-034·IF-CT-055·IF-CT-056 외 22 | ib_item_model | —(화면 없음) | — (모드 사다리 경유, AI-01 §7.5) | UT-CT-200~399 + CT-CT-2nn | WP-04-13 | INT-4~5 |
| FR-QST-006 | Variant·문형 로테이션 | Must·R1 | UR-13·UR-14 | V-build | content/itembank | IF-AI-010·IF-AI-020·IF-CT-030·IF-CT-034·IF-CT-055·IF-CT-056 외 22 | ib_stem_rotation | —(화면 없음) | 해당 없음(결정적) | UT-CT-204 | WP-02-08 | INT-2~3 |
| FR-QST-007 | 문항 메타데이터·오답지 매핑 | Must·R0 | UR-13 | V-build | content/itembank·packc | IF-AI-010·IF-AI-020·IF-CT-030·IF-CT-034·IF-CT-055·IF-CT-056 외 22 | ib_item | SCR-02 | 해당 없음(결정적) | UT-PACKC-007 | WP-01-01·WP-01-03·WP-02-08 | INT-1b |
| FR-QST-008 | 품질 게이트 G0~G13 | Must·R1 | UR-13·UR-16 | V-build | content/itembank | IF-AI-001·IF-AI-010·IF-AI-020·IF-CT-030·IF-CT-034·IF-CT-055 외 23 | ib_gate_result | —(화면 없음) | — (모드 사다리 경유, AI-01 §7.5) | UT-CT-200~399·CT-CT-2nn(대역) | WP-04-14 | INT-2~3 |
| FR-QST-009 | 위험 비례 게이트 스택 | Must·R2 | UR-13 | V-build | content/itembank | IF-AI-001·IF-AI-010·IF-AI-020·IF-CT-030·IF-CT-034·IF-CT-055 외 23 | content.db `ib_item`·`gr_verdict` | —(화면 없음) | — (모드 사다리 경유, AI-01 §7.5) | IT-036 | WP-04-14 | INT-4~5 |
| FR-QST-010 | 메타모픽 검증 | Must·R2 | UR-13 | V-build | content/itembank | IF-AI-001·IF-AI-010·IF-AI-020·IF-CT-030·IF-CT-034·IF-CT-055 외 23 | content.db `ib_item`·`gr_verdict` | —(화면 없음) | 해당 없음(결정적) | UT-CT-200~399 + CT-CT-2nn | WP-04-14 | INT-4~5 |
| FR-QST-011 | 게이트 상태기계(`gate_status`)와 보류  | Must·R1 | UR-13·UR-16 | V-build | content/itembank·contracts | IF-AI-010·IF-AI-020·IF-CT-030·IF-CT-034·IF-CT-055·IF-CT-056 외 23 | ib_correction·ib_item_gate·ib_staging_item | SCR-14 | — (모드 사다리 경유, AI-01 §7.5) | CT-CT-201·IT-017·UT-CT-202·UT-CT-203 | WP-00-06·WP-04-14 | INT-2~3 |
| FR-QST-012 | 독립 풀이 (G4) | Must·R2 | UR-13 | B+V-live | content/itembank | IF-AI-001·IF-AI-010·IF-AI-020·IF-CT-030·IF-CT-034·IF-CT-055 외 23 | content.db `ib_item`·`gr_verdict` | SCR-14 | — (모드 사다리 경유, AI-01 §7.5) | UT-CT-200~399 + CT-CT-2nn | WP-04-14 | INT-4~5 |
| FR-QST-013 | 수요 예측 워밍 풀 | Must·R1 | UR-13·UR-17 | V-build | content/itembank·contracts·gateway 외 1 | IF-AI-010·IF-AI-020·IF-CT-030·IF-CT-034·IF-CT-055·IF-CT-056 외 27 | ib_warming_demand | SCR-05·SCR-14 | — (모드 사다리 경유, AI-01 §7.5) | UT-CT-206 | WP-00-05·WP-02-09·WP-04-20 외 2 | INT-2~3 |
| FR-QST-014 | 문항 건강 모니터링 | Must·R2 | UR-13·UR-17 | V-build | content/itembank·contracts·gateway 외 1 | IF-AI-010·IF-AI-020·IF-CT-030·IF-CT-034·IF-CT-055·IF-CT-056 외 25 | ib_family·ib_item_health | SCR-05·SCR-14 | — (모드 사다리 경유, AI-01 §7.5) | UT-CT-207 | WP-00-05·WP-04-20·WP-04-24 외 2 | INT-4~5 |
| FR-QST-015 | 계보 그래프와 패밀리 격리 | Must·R2 | UR-12·UR-13 | V-build | content/itembank·contracts·gateway 외 2 | IF-AI-010·IF-AI-020·IF-CT-030·IF-CT-034·IF-CT-055·IF-CT-056 외 26 | ib_correction·ib_family·ib_lineage_edge | SCR-02·SCR-05·SCR-14 | 해당 없음(결정적) | CT-CT-507·IT-017 | WP-00-06·WP-04-15·WP-04-20 외 3 | INT-4~5 |
| FR-QST-016 | 문항 신고와 처리 결과 표시 | Must·R1 | UR-02·UR-13·UR-17 | V-build | content/itembank·gateway·tests 외 1 | IF-AI-010·IF-AI-020·IF-CT-014·IF-CT-030·IF-CT-034·IF-CT-055 외 28 | ib_report | SCR-02·SCR-04·SCR-05·SCR-07 외 1 | — (모드 사다리 경유, AI-01 §7.5) | IT-037·UT-CT-208 | WP-03-26·WP-04-20·WP-04-24 외 3 | INT-2~3 |
| FR-QST-017 | 채점 사다리 | Must·R0 | UR-15·UR-16 | V-build | content/grading·learning/practice | IF-AI-001·IF-CT-040·IF-CT-041·IF-CT-045·IF-CT-047·IF-CT-048 외 14 | content.db `ib_item`·`gr_verdict` | SCR-02 | AI-G06 | UT-CT-300 | WP-01-04·WP-01-09·WP-04-11 | INT-1b |
| FR-QST-018 | 단답·빈칸 결정적 정규화 | Must·R1 | UR-16 | V-build | content/grading | IF-AI-001·IF-CT-040·IF-CT-041·IF-CT-045·IF-CT-047·IF-CT-048 외 14 | content.db `ib_item`·`gr_verdict` | —(화면 없음) | AI-G06 | UT-CT-303 | WP-01-04·WP-02-11 | INT-2~3 |
| FR-QST-019 | 낙관적 채점 (3s 데드라인) | Must·R2 | UR-16·UR-17 | V-build | content/grading | IF-AI-001·IF-CT-040·IF-CT-041·IF-CT-045·IF-CT-047·IF-CT-048 외 15 | content.db `ib_item`·`gr_verdict` | SCR-02 | AI-G06 | IT-018·UT-CT-301·UT-CT-302 | WP-04-11 | INT-4~5 |
| FR-QST-020 | 보류 재채점과 소급 반영 | Must·R2 | UR-15·UR-16 | V-build | content/grading·gateway·learning/ledger 외 2 | IF-AI-001·IF-CT-040·IF-CT-041·IF-CT-045·IF-CT-047·IF-CT-048 외 16 | gr_pending | SCR-02·SCR-05·SCR-14 | AI-G06 | UT-CT-305 | WP-04-11·WP-04-15·WP-04-20 외 2 | INT-4~5 |
| FR-QST-021 | 자기채점과 편향 리포트 | Must·R1 | UR-15·UR-16 | V-build | content/grading·gateway·learning/practice | IF-AI-001·IF-CT-040·IF-CT-041·IF-CT-045·IF-CT-047·IF-CT-048 외 18 | content.db `ib_item`·`gr_verdict` | SCR-02·SCR-06 | AI-G06 | UT-CT-200~399 + CT-CT-2nn | WP-01-04·WP-01-09·WP-01-17 외 1 | INT-2~3 |
| FR-QST-022 | 서버측 채점·정답 비공개 | Must·R0 | UR-17 | V-build | content/grading·content/itembank·contracts 외 1 | IF-AI-001·IF-AI-002·IF-CT-040·IF-CT-041·IF-CT-045·IF-CT-047 외 17 | ct_lab·ct_manifest·gr_attempt | SCR-02 | AI-G06 | CT-CT-201·UT-CON-003·UT-CT-205·UT-CT-306 | WP-00-05·WP-01-03·WP-01-04 외 1 | INT-1b |
| FR-QST-023 | 오답 피드백 (오개념 근거) | Must·R0 | UR-13·UR-14 | V-build | content/grading | IF-AI-001·IF-AI-003·IF-CT-040·IF-CT-041·IF-CT-045·IF-CT-047 외 15 | content.db `ib_item`·`gr_verdict` | SCR-02 | AI-G06 | UT-CT-200~399·CT-CT-2nn(대역) | WP-02-11 | INT-1b |
| FR-QST-024 | CBM 점수 규칙 | Must·R0 | UR-14 | V-build | content/grading | IF-AI-001·IF-CT-040·IF-CT-041·IF-CT-045·IF-CT-047·IF-CT-048 외 14 | content.db `ib_item`·`gr_verdict` | SCR-02 | AI-G06 | UT-LR-112 | WP-01-04 | INT-1b |
| FR-QST-025 | 게이밍 계수 (빠른 응답 대칭 처리) | Must·R1 | UR-14 | V-build | content(itembank·grading) | IF-AI-001·IF-CT-040·IF-CT-041·IF-CT-045·IF-CT-047·IF-CT-048 외 14 | ib_hint_open | —(화면 없음) | AI-G06 | UT-LR-102·UT-LR-111·UT-LR-504 | IT-02~03→INT-2~3 | INT-2~3 |
| FR-QST-026 | 해설 공개 시점 | Must·R1 | UR-14 | V-build | contracts | IF-AI-001·IF-CT-040·IF-CT-041·IF-CT-045·IF-CT-047·IF-CT-048 외 17 | content.db `ib_item`·`gr_verdict` | —(화면 없음) | AI-G06 | UT-CT-200~399 + CT-CT-2nn | WP-00-05 | INT-2~3 |

### 3.8 FR-SET — 설정·운영 (26)

| ID | 이름 | 우선·슬 | UR | V | 서비스 | IF | 테이블 | SCR | AI(프롬프트/Jev) | 테스트 | WP | INT |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FR-SET-001 | 단일 슈퍼바이저 `fathom up` | Must·R0 | UR-08·UR-17 | V-build | cli·contracts·ops-api 외 2 | IF-COM-001·IF-COM-002·IF-COM-003·IF-COM-004·IF-COM-005·IF-COM-006 외 108 | op_id | DLG-MERGE·SCR-16 | 해당 없음(결정적) | E2E-106·IT-031·UT-CLI-002·UT-OP-100 외 1 | WP-00-07·WP-00-08·WP-00-29 외 4 | INT-1b |
| FR-SET-002 | 부분 장애 격하 | Must·R1 | UR-08·UR-17 | V-build | contracts·ops-api·shared-kernel 외 2 | IF-COM-001·IF-COM-002·IF-COM-003·IF-COM-004·IF-COM-005·IF-COM-006 외 109 | op_backup·op_epoch_manifest·op_health_sample | DLG-MERGE·SCR-16 | 해당 없음(결정적) | IT-023·UT-SUP-002 | WP-00-08·WP-00-21·WP-00-29 외 2 | INT-2~3 |
| FR-SET-003 | `fathom doctor [--fix]`와 Saf | Must·R3 | UR-17 | V-build | cli·contracts·gateway 외 2 | IF-COM-001·IF-COM-002·IF-COM-003·IF-COM-004·IF-COM-005·IF-COM-006 외 111 | op_doctor_run·op_id | DLG-MERGE·SCR-16 | 해당 없음(결정적) | UT-OP-0nn~3nn + IT-500~599 + E2E-1nn | WP-00-08·WP-03-21·WP-07-07 외 3 | INT-6~7 |
| FR-SET-004 | 백업 (증분 + 스냅샷 + 2차 대상) | Must·R1 | UR-12·UR-17 | V-build | cli·contracts·gateway 외 2 | IF-AI-044·IF-COM-001·IF-COM-002·IF-COM-003·IF-COM-004·IF-COM-005 외 112 | op_backup·op_epoch_manifest·op_id | DLG-MERGE·SCR-10·SCR-16 | 해당 없음(결정적) | IT-006·SEC-OP-001·UT-OP-001·UT-OP-004 외 1 | WP-00-07·WP-00-08·WP-03-13 외 3 | INT-2~3 |
| FR-SET-005 | 복원과 분기 복원 리허설 | Must·R1 | UR-12·UR-17 | V-build | cli·contracts·gateway 외 2 | IF-COM-001·IF-COM-002·IF-COM-003·IF-COM-004·IF-COM-005·IF-COM-006 외 108 | op_backup·op_epoch_manifest·op_id | DLG-MERGE·SCR-10·SCR-16 | 해당 없음(결정적) | IT-007·UT-OP-003 | WP-00-08·WP-03-14·WP-03-21 외 3 | INT-2~3 |
| FR-SET-006 | 전량 export ↔ import 왕복 | Must·R1 | UR-12 | V-build | cli·contracts·gateway 외 4 | IF-AI-044·IF-AI-045·IF-COM-001·IF-COM-002·IF-COM-003·IF-COM-004 외 113 | op_id | DLG-MERGE·SCR-10·SCR-16 | 해당 없음(결정적) | UT-OP-0nn~3nn + IT-500~599 + E2E-1nn | WP-00-08·WP-03-12·WP-03-14 외 4 | INT-2~3 |
| FR-SET-007 | 스키마 마이그레이션 드라이런·롤백 | Must·R3 | UR-12·UR-17 | V-build | cli·contracts·ops-api 외 4 | IF-COM-001·IF-COM-002·IF-COM-003·IF-COM-004·IF-COM-005·IF-COM-006 외 107 | op_id | DLG-MERGE·SCR-16 | 해당 없음(결정적) | IT-014·UT-OP-300·UT-OP-301·UT-SK-005 | WP-00-08·WP-00-20·WP-00-29 외 4 | INT-6~7 |
| FR-SET-008 | AI 연결 설정 화면 | Must·R2 | UR-15·UR-17 | V-build | gateway·tests·web/ai-control | IF-AI-030·IF-GW-105·IF-GW-107·IF-GW-108·IF-GW-111·IF-GW-112 외 24 | ai_provider | GLB-WO·SCR-15 | 해당 없음(결정적) | UT-OP·IT-500~599·E2E-1nn(대역) | WP-04-18·WP-04-24·WP-04-25 | INT-4~5 |
| FR-SET-009 | 스케줄 파라미터 설정 | Must·R1 | UR-12·UR-17 | V-build | gateway·learning/practice·web/settings | IF-GW-107·IF-GW-108·IF-GW-111·IF-GW-112·IF-GW-113·IF-GW-114 외 24 | ai_firewall_pattern·ai_setting·lr_setting | DLG-ONB·SCR-17 | 해당 없음(결정적) | UT-OP-0nn~3nn + IT-500~599 + E2E-1nn | WP-02-05·WP-02-18·WP-02-21 외 1 | INT-2~3 |
| FR-SET-010 | 모자 분리·파괴 작업 확인 | Must·R1 | UR-17 | V-build | web/settings·web/shell | IF-GW-005·IF-GW-107·IF-GW-108·IF-GW-111·IF-GW-112·IF-GW-113 외 24 | ops.db `op_*` | DLG-ONB·SCR-03·SCR-15·SCR-17 | 해당 없음(결정적) | UT-OP-0nn~3nn + IT-500~599 + E2E-1nn | WP-00-24·WP-03-22 | INT-2~3 |
| FR-SET-011 | 콘텐츠 큐레이션 콘솔 | Must·R2 | UR-13·UR-17 | V-build | web/assessment-ui | IF-CT-058·IF-GW-035·IF-GW-095·IF-GW-101·IF-GW-107·IF-GW-108 외 26 | ops.db `op_*` | SCR-14 | 해당 없음(결정적) | UT-OP·IT-500~599·E2E-1nn(대역) | WP-04-20·WP-05-02·WP-05-16 | INT-4~5 |
| FR-SET-012 | 3분 설치와 점진적 설정 | Must·R3 | UR-15·UR-18 | V-build | deploy·tests | IF-COM-001·IF-COM-002·IF-COM-003·IF-COM-004·IF-COM-005·IF-COM-006 외 107 | ops.db `op_*` | SCR-01 | 해당 없음(결정적) | E2E-102 | WP-07-08·WP-07-18 | INT-6~7 |
| FR-SET-013 | 포터블 오프라인 번들 | Must·R3 | UR-15 | V-build | deploy | IF-COM-001·IF-COM-002·IF-COM-003·IF-COM-004·IF-COM-005·IF-COM-006 외 107 | ops.db `op_*` | —(화면 없음) | 해당 없음(결정적) | UT-OP·IT-500~599·E2E-1nn(대역) | WP-07-08 | INT-6~7 |
| FR-SET-014 | 팩 설치·업그레이드 `fathom seed` | Must·R1 | UR-01·UR-13·UR-17 | V-build | cli·content/catalog·gateway | IF-CT-001·IF-CT-002·IF-CT-003·IF-GW-105·IF-GW-107·IF-GW-108 외 29 | ops.db `op_*` | SCR-15 | 해당 없음(결정적) | UT-CT-001 | WP-01-02·WP-01-17·WP-01-18 | INT-2~3 |
| FR-SET-015 | CLI 표면 | Must·R0 | UR-02·UR-15·UR-17 | V-build | cli·contracts·gateway | IF-COM-001·IF-COM-002·IF-COM-003·IF-COM-004·IF-COM-005·IF-COM-006 외 107 | op_id | SCR-16 | 해당 없음(결정적) | UT-CLI-001·UT-GW-101 | WP-00-04·WP-00-30·WP-00-35 외 4 | INT-1b |
| FR-SET-016 | 통합 로그 열람 | Must·R1 | UR-17 | V-build | contracts·gateway·ops-api 외 1 | IF-COM-001·IF-COM-002·IF-COM-003·IF-COM-004·IF-COM-005·IF-COM-006 외 107 | ops.db `op_*` | DLG-MERGE·SCR-16 | 해당 없음(결정적) | IT-039 | WP-00-08·WP-03-21·WP-07-07 외 2 | INT-2~3 |
| FR-SET-017 | 운영 배너 | Must·R3 | UR-17 | V-build | contracts·ops-api | IF-EV-21·IF-GW-010·IF-GW-107·IF-GW-108·IF-GW-111·IF-GW-112 외 26 | op_banner | DLG-MERGE·SCR-16 | 해당 없음(결정적) | UT-OP-102 | WP-00-08·WP-01-11·WP-07-07 | INT-6~7 |
| FR-SET-018 | 정책·파라미터 버전 교체와 리플레이 비교 | Must·R1 | UR-05·UR-12 | V-build | gateway·learning/practice·web/settings | IF-GW-107·IF-GW-108·IF-GW-111·IF-GW-112·IF-GW-113·IF-GW-114 외 26 | ops.db `op_*` | DLG-ONB·SCR-17 | 해당 없음(결정적) | UT-OP-0nn~3nn + IT-500~599 + E2E-1nn | WP-02-05·WP-02-21·WP-03-22 | INT-2~3 |
| FR-SET-019 | 온보딩 | Must·R1 | UR-11·UR-15 | V-build | gateway·learning/practice·web/settings | IF-GW-075·IF-GW-107·IF-GW-108·IF-GW-111·IF-GW-112·IF-GW-113 외 25 | ops.db `op_*` | DLG-ONB·SCR-01·SCR-10·SCR-17 | 해당 없음(결정적) | UT-OP-0nn~3nn + IT-500~599 + E2E-1nn | WP-03-10·WP-03-22·WP-03-26 | INT-2~3 |
| FR-SET-020 | 알림 설정 | Should·R3 | UR-17 | V-build | web/settings | IF-GW-107·IF-GW-108·IF-GW-111·IF-GW-112·IF-GW-113·IF-GW-114 외 23 | ops.db `op_*` | DLG-ONB·SCR-17 | 해당 없음(결정적) | UT-OP·IT-500~599·E2E-1nn(대역) | WP-02-18·WP-07-07·WP-07-14 | INT-6~7 |
| FR-SET-021 | Tripwire 조치 강도 설정 | Should·R3 | UR-17 | V-build | gateway·ops-api·web/ops-console | IF-GW-107·IF-GW-108·IF-GW-111·IF-GW-112·IF-GW-113·IF-GW-114 외 25 | ops.db `op_*` | DLG-MERGE·SCR-16 | 해당 없음(결정적) | UT-OP·IT-500~599·E2E-1nn(대역) | WP-03-21·WP-07-07·WP-07-12 외 1 | INT-6~7 |
| FR-SET-022 | 다기기 `export --since` / `impo | Must·R1 | UR-12·UR-15·UR-17 | V-build | cli·content/catalog·learning/ledger 외 2 | IF-AI-045·IF-COM-001·IF-COM-002·IF-COM-003·IF-COM-004·IF-COM-005 외 118 | lr_setting·op_id | DLG-MERGE·SCR-14·SCR-16 | 해당 없음(결정적) | CT-LR-203·UT-LR-007 | WP-03-12·WP-03-14·WP-03-21 외 2 | INT-2~3 |
| FR-SET-023 | 매일 진입 마찰 제거 | Must·R1 | UR-15·UR-17 | V-build | cli·gateway·tests 외 2 | IF-COM-001·IF-COM-002·IF-COM-003·IF-COM-004·IF-COM-005·IF-COM-006 외 108 | ops.db `op_*` | SCR-01 | 해당 없음(결정적) | E2E-103·E2E-105·UT-GW-001·UT-GW-006 | WP-00-25·WP-00-30·WP-00-35 외 3 | INT-2~3 |
| FR-SET-024 | OS 로그인 자동 기동 | Should·R3 | UR-15·UR-17 | B+V-ci/V-live | cli·contracts·gateway 외 3 | IF-EXT-14·IF-GW-107·IF-GW-108·IF-GW-111·IF-GW-112·IF-GW-113 외 28 | op_autostart | DLG-MERGE·SCR-16·SCR-17 | 해당 없음(결정적) | UT-OP-351 | WP-00-08·WP-02-18·WP-03-21 외 5 | INT-6~7 |
| FR-SET-025 | 동기화 폴더 데이터 디렉터리 경고 | Must·R1 | UR-12·UR-17 | V-build | ops-api | IF-COM-001·IF-COM-002·IF-COM-003·IF-COM-004·IF-COM-005·IF-COM-006 외 108 | ops.db `op_*` | DLG-MERGE·SCR-16·SCR-17 | 해당 없음(결정적) | UT-OP-200 | WP-03-15 | INT-2~3 |
| FR-SET-026 | E3 반입 승인 체크리스트·런타임 동봉 | Should·R3 | UR-15·UR-17 | V-build | deploy | IF-GW-107·IF-GW-108·IF-GW-111·IF-GW-112·IF-GW-113·IF-GW-114 외 22 | ops.db `op_*` | —(화면 없음) | 해당 없음(결정적) | UT-OP·IT-500~599·E2E-1nn(대역) | WP-07-08 | INT-6~7 |

### 3.9 FR-STD — 학습 모드·세션 (35)

| ID | 이름 | 우선·슬 | UR | V | 서비스 | IF | 테이블 | SCR | AI(프롬프트/Jev) | 테스트 | WP | INT |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FR-STD-001 | 세션 시작 (시간·에너지 선택) | Must·R0 | UR-14·UR-17 | V-build | gateway·learning/practice·web/insight 외 1 | IF-CT-055·IF-GW-010·IF-GW-015·IF-GW-016·IF-GW-017·IF-GW-018 외 16 | lr_session | SCR-01·SCR-02·SCR-06 | 해당 없음(결정적) | UT-LR-306 | WP-01-09·WP-01-12·WP-01-17 외 1 | INT-1b |
| FR-STD-002 | 슬롯 문법과 하드 제약 | Must·R1 | UR-14 | V-build | gateway·learning/practice·learning/sim 외 1 | IF-CT-055·IF-GW-015·IF-GW-016·IF-GW-017·IF-GW-018·IF-GW-019 외 15 | lr_attempt·lr_block·lr_session | SCR-01·SCR-02·SCR-06 | 해당 없음(결정적) | UT-LR-301 | WP-01-17·WP-02-02·WP-02-03 외 2 | INT-2~3 |
| FR-STD-003 | 형태학적 거리·변주 예산·Wildcard | Must·R1 | UR-14 | V-build | gateway·learning/practice | IF-CT-055·IF-GW-015·IF-GW-016·IF-GW-017·IF-GW-018·IF-GW-019 외 15 | lr_attempt·lr_block·lr_session | SCR-02·SCR-06 | 해당 없음(결정적) | UT-LR-300~399(composer·router 속성) + E2E-301~321 | WP-01-17·WP-02-03 | INT-2~3 |
| FR-STD-004 | 난이도 파도·보스·성공 마무리 | Must·R1 | UR-14 | V-build | gateway·learning/practice | IF-CT-055·IF-GW-015·IF-GW-016·IF-GW-017·IF-GW-018·IF-GW-019 외 16 | lr_attempt·lr_block·lr_session | SCR-02·SCR-06 | 해당 없음(결정적) | UT-LR-300~399(composer·router 속성) + E2E-301~321 | WP-01-17·WP-02-03 | INT-2~3 |
| FR-STD-005 | 세션 중 적응 제어 | Must·R1 | UR-14 | V-build | gateway·learning/practice | IF-CT-055·IF-GW-015·IF-GW-016·IF-GW-017·IF-GW-018·IF-GW-019 외 16 | lr_attempt·lr_block·lr_session | SCR-02·SCR-06 | 해당 없음(결정적) | UT-LR-300~399(composer·router 속성) + E2E-301~321 | WP-01-17·WP-02-03 | INT-2~3 |
| FR-STD-006 | "왜 지금?" 설명·교체·잠금·건너뛰기 | Must·R1 | UR-14·UR-17 | V-build | gateway·learning/practice·web/practice | IF-CT-055·IF-GW-015·IF-GW-016·IF-GW-017·IF-GW-018·IF-GW-019 외 15 | lr_attempt·lr_block·lr_session | SCR-01·SCR-02·SCR-06 | 해당 없음(결정적) | UT-LR-300~399(composer·router 속성) + E2E-301~321 | WP-01-17·WP-02-03·WP-02-17 | INT-2~3 |
| FR-STD-007 | Method Router 정책 | Must·R1 | UR-01·UR-11·UR-14 | V-build | learning/practice | IF-CT-055·IF-GW-015·IF-GW-016·IF-GW-017·IF-GW-018·IF-GW-019 외 16 | learning.db `lr_session`·`lr_block`·`lr_attempt` | SCR-02·SCR-06·SCR-17 | 해당 없음(결정적) | UT-LR-300~399(composer·router 속성) + E2E-301~321 | WP-02-04 | INT-2~3 |
| FR-STD-008 | 레벨별 모드 믹스 기본값 | Must·R1 | UR-00·UR-10·UR-11·UR-14 | V-build | learning/practice | IF-CT-055·IF-GW-015·IF-GW-016·IF-GW-017·IF-GW-018·IF-GW-019 외 16 | learning.db `lr_session`·`lr_block`·`lr_attempt` | SCR-02·SCR-06·SCR-17 | 해당 없음(결정적) | UT-LR-300~399·E2E-301~321(대역) | WP-02-04 | INT-2~3 |
| FR-STD-009 | 주간 쿼터·모드 엔트로피 가드 (블록 수 스케일링) | Must·R1 | UR-14 | V-build | learning/practice·learning/sim | IF-CT-055·IF-GW-015·IF-GW-016·IF-GW-017·IF-GW-018·IF-GW-019 외 16 | learning.db `lr_session`·`lr_block`·`lr_attempt` | SCR-02·SCR-06 | 해당 없음(결정적) | UT-LR-302 | WP-02-03·WP-02-07 | INT-2~3 |
| FR-STD-010 | 3단 레슨 모드 (M-01) | Must·R0 | UR-10·UR-14 | V-build | learning/practice·web/practice | IF-GW-018·IF-GW-020·IF-GW-021·IF-GW-025·IF-GW-065·IF-GW-066 외 6 | learning.db `lr_session`·`lr_block`·`lr_attempt` | SCR-02·SCR-06 | 해당 없음(결정적) | UT-LR-300~399(composer·router 속성) + E2E-301~321 | WP-01-09·WP-01-13 | INT-1b |
| FR-STD-011 | OX 스프린트 (M-03) | Must·R0 | UR-14 | V-build | web/practice | IF-GW-018·IF-GW-020·IF-GW-021·IF-GW-025·IF-GW-065·IF-GW-066 외 6 | learning.db `lr_session`·`lr_block`·`lr_attempt` | SCR-02·SCR-06 | — (모드 사다리 경유, AI-01 §7.5) | UT-LR-300~399·E2E-301~321(대역) | WP-01-13 | INT-1b |
| FR-STD-012 | 문제 믹스 (M-04) | Must·R0 | UR-13·UR-14 | V-build | web/practice | IF-GW-018·IF-GW-020·IF-GW-021·IF-GW-025·IF-GW-065·IF-GW-066 외 6 | learning.db `lr_session`·`lr_block`·`lr_attempt` | SCR-02·SCR-06 | — (모드 사다리 경유, AI-01 §7.5) | UT-LR-300~399(composer·router 속성) + E2E-301~321 | WP-02-16 | INT-1b |
| FR-STD-013 | 코드 읽기·출력 예측 (M-05) | Must·R0 | UR-01·UR-14 | V-build | content/grading·content/itembank·web/practice | IF-GW-018·IF-GW-020·IF-GW-021·IF-GW-025·IF-GW-065·IF-GW-066 외 6 | learning.db `lr_session`·`lr_block`·`lr_attempt` | SCR-02·SCR-06 | 해당 없음(결정적) | UT-LR-300~399(composer·router 속성) + E2E-301~321 | WP-02-10·WP-02-11·WP-02-16 | INT-1b |
| FR-STD-014 | 오류 찾기 (M-06) | Must·R1 | UR-01·UR-14 | V-build | content/grading·content/itembank·web/practice | IF-GW-018·IF-GW-020·IF-GW-021·IF-GW-025·IF-GW-065·IF-GW-066 외 6 | learning.db `lr_session`·`lr_block`·`lr_attempt` | SCR-02·SCR-06 | — (모드 사다리 경유, AI-01 §7.5) | UT-LR-300~399(composer·router 속성) + E2E-301~321 | WP-02-10·WP-02-11·WP-02-16 | INT-2~3 |
| FR-STD-015 | 헷갈림 쌍 대조 드릴 (M-07) | Should·R1 | UR-14 | V-build | content/grading·learning/practice | IF-GW-018·IF-GW-020·IF-GW-021·IF-GW-025·IF-GW-065·IF-GW-066 외 6 | iv_confusion | SCR-02·SCR-06 | — (모드 사다리 경유, AI-01 §7.5) | UT-LR-300~399·E2E-301~321(대역) | WP-05-05·WP-05-06 | INT-2~3 |
| FR-STD-016 | 페르미 추정 드릴 (M-08) | Should·R3 | UR-11·UR-14 | V-build | content/grading·web/practice | IF-GW-018·IF-GW-020·IF-GW-021·IF-GW-025·IF-GW-065·IF-GW-066 외 6 | learning.db `lr_session`·`lr_block`·`lr_attempt` | SCR-02·SCR-06 | — (모드 사다리 경유, AI-01 §7.5) | UT-LR-300~399·E2E-301~321(대역) | WP-06-06·WP-06-13 | INT-6~7 |
| FR-STD-017 | 조건 반전 쌍 (M-09) | Must·R3 | UR-11·UR-14 | V-build | content/grading·web/practice | IF-GW-018·IF-GW-020·IF-GW-021·IF-GW-025·IF-GW-065·IF-GW-066 외 6 | learning.db `lr_session`·`lr_block`·`lr_attempt` | SCR-02·SCR-06 | — (모드 사다리 경유, AI-01 §7.5) | UT-LR-300~399(composer·router 속성) + E2E-301~321 | WP-06-06·WP-06-13 | INT-6~7 |
| FR-STD-018 | 백지노트 사다리 작성 (M-13) | Must·R0 | UR-14 | V-build | ai/privacy·learning/practice·web/practice | IF-AI-002·IF-GW-018·IF-GW-020·IF-GW-021·IF-GW-025·IF-GW-065 외 7 | learning.db `lr_session`·`lr_block`·`lr_attempt` | SCR-02·SCR-06 | 해당 없음(결정적) | CT-SYS-004·UT-AI-302·UT-LR-310 | WP-01-14·WP-03-06·WP-03-17 외 1 | INT-1b |
| FR-STD-019 | 백지노트 채점·3색 diff·후속 | Must·R1 | UR-14·UR-16 | V-build | content/grading·web/practice | IF-AI-001·IF-CT-040·IF-CT-045·IF-CT-047·IF-GW-018·IF-GW-020 외 11 | learning.db `lr_session`·`lr_block`·`lr_attempt` | SCR-02·SCR-06 | AI-G06 | UT-LR-300~399·E2E-301~321(대역) | WP-01-14·WP-03-05·WP-03-17 | INT-2~3 |
| FR-STD-020 | 개념 디깅 엔진 (M-14) | Must·R2 | UR-14·UR-16 | V-build | ai/generate·content/grading·gateway 외 3 | IF-AI-002·IF-AI-003·IF-CT-042·IF-CT-046·IF-GW-060·IF-GW-061 외 18 | gr_turn_judgment·lr_artifact_version·lr_dialog_state·lr_dialog_turn 외 1 | SCR-02·SCR-06·SCR-07 | AI-G07·AI-J17 | UT-CT-307·UT-CT-308 | WP-04-05·WP-05-03·WP-05-04 외 3 | INT-4~5 |
| FR-STD-021 | Feynman 가르치기 (M-15) | Should·R2 | UR-12·UR-14·UR-16 | V-build | content/grading·gateway·learning/practice 외 1 | IF-AI-002·IF-AI-003·IF-CT-042·IF-CT-046·IF-GW-060·IF-GW-061 외 18 | learning.db `lr_session`·`lr_block`·`lr_attempt` | SCR-02·SCR-06·SCR-07 | AI-G07·AI-J17 | UT-LR-300~399·E2E-301~321(대역) | WP-05-03·WP-05-04·WP-05-13 외 1 | INT-4~5 |
| FR-STD-022 | AI 답안 감사 (M-16) | Should·R2 | UR-14·UR-16 | V-build | content/grading·web/practice | IF-AI-002·IF-AI-003·IF-CT-042·IF-CT-046·IF-GW-020·IF-GW-060 외 19 | learning.db `lr_session`·`lr_block`·`lr_attempt` | SCR-02·SCR-06 | AI-G07·AI-J17 | UT-LR-300~399·E2E-301~321(대역) | WP-05-05·WP-05-13 | INT-4~5 |
| FR-STD-023 | PR 리뷰 도장 (M-17) | Must·R3 | UR-01·UR-07 | V-build | content/grading·web/practice | IF-CT-024·IF-CT-040·IF-GW-020·IF-GW-068·IF-GW-069·IF-GW-070 외 6 | learning.db `lr_session`·`lr_block`·`lr_attempt` | SCR-02·SCR-06 | — (모드 사다리 경유, AI-01 §7.5) | UT-LR-300~399·E2E-301~321(대역) | WP-06-06·WP-06-13 | INT-6~7 |
| FR-STD-024 | 역출제 (M-18) | Should·R2 | UR-13·UR-14 | V-build | content/grading·web/practice | IF-CT-024·IF-CT-040·IF-GW-020·IF-GW-068·IF-GW-069·IF-GW-070 외 6 | learning.db `lr_session`·`lr_block`·`lr_attempt` | SCR-02·SCR-06 | — (모드 사다리 경유, AI-01 §7.5) | UT-LR-300~399·E2E-301~321(대역) | WP-05-05·WP-05-13 | INT-4~5 |
| FR-STD-025 | Case 엔진 (M-19) | Must·R3 | UR-11·UR-12·UR-14 | V-build | content/catalog·content/grading·gateway 외 3 | IF-CT-024·IF-CT-040·IF-GW-051·IF-GW-068·IF-GW-069·IF-GW-070 외 6 | lr_long_task | SCR-02·SCR-04·SCR-06·SCR-08 | AI-G06 | UT-LR-300~399·E2E-301~321(대역) | WP-06-01·WP-06-02·WP-06-03 외 3 | INT-6~7 |
| FR-STD-026 | 산출물 과제 + 반박 (M-20) — **L5 증거 | Must·R3 | UR-07·UR-11·UR-12·UR-14 | V-build | content/grading·gateway·learning/practice 외 2 | IF-AI-002·IF-AI-003·IF-CT-040·IF-CT-042·IF-CT-046·IF-GW-051 외 20 | ct_artifact_task | SCR-02·SCR-04·SCR-06·SCR-09 | AI-G07·AI-J17 | UT-LR-300~399·E2E-301~321(대역) | WP-06-04·WP-06-05·WP-06-12 외 2 | INT-6~7 |
| FR-STD-027 | 과거의 나 (M-21) | Should·R3 | UR-12·UR-14 | V-build | learning/practice | IF-AI-002·IF-AI-003·IF-CT-042·IF-CT-046·IF-GW-060·IF-GW-061 외 20 | learning.db `lr_session`·`lr_block`·`lr_attempt` | SCR-02·SCR-06·SCR-11 | — (모드 사다리 경유, AI-01 §7.5) | UT-LR-300~399·E2E-301~321(대역) | WP-07-05 | INT-6~7 |
| FR-STD-028 | ◆ 깊이 당김 | Should·R2 | UR-14 | V-build | learning/practice | IF-EV-08·IF-LR-001·IF-LR-004·IF-LR-005 | learning.db `lr_session`·`lr_block`·`lr_attempt` | SCR-02·SCR-06 | — (모드 사다리 경유, AI-01 §7.5) | UT-LR-300~399·E2E-301~321(대역) | WP-05-06 | INT-4~5 |
| FR-STD-029 | ◆ 갭 → 문항 즉시 루프 | Should·R2 | UR-13·UR-14 | V-build | learning/practice | IF-EV-08·IF-LR-001·IF-LR-004·IF-LR-005 | learning.db `lr_session`·`lr_block`·`lr_attempt` | SCR-02·SCR-06 | 해당 없음(결정적) | UT-LR-300~399·E2E-301~321(대역) | WP-05-06 | INT-4~5 |
| FR-STD-030 | ◆ 약점 드릴 | Should·R3 | UR-14 | V-build | learning/practice | — (교차 품질 속성, 전 라우트) | learning.db `lr_session`·`lr_block`·`lr_attempt` | SCR-02·SCR-06 | — (모드 사다리 경유, AI-01 §7.5) | UT-LR-300~399·E2E-301~321(대역) | WP-06-10 | INT-6~7 |
| FR-STD-031 | 세션·장기 과제 저장과 재개 | Must·R1 | UR-17 | V-build | gateway·learning/practice·web/practice | IF-GW-015·IF-GW-016·IF-GW-017·IF-GW-018·IF-GW-020·IF-GW-021 외 28 | gr_utterance·lr_artifact_version·lr_attempt·lr_long_task 외 2 | SCR-02·SCR-06·SCR-08 | 해당 없음(결정적) | IT-028·UT-LR-307 | WP-01-13·WP-01-17·WP-03-06 외 1 | INT-2~3 |
| FR-STD-032 | 세션 범위 (전체·경로·트랙·개념 집합) | Must·R1 | UR-01·UR-14 | V-build | learning/practice·web/practice | IF-CT-055·IF-GW-015·IF-GW-016·IF-GW-017·IF-GW-018·IF-GW-019 외 16 | lr_session | SCR-01·SCR-02·SCR-04·SCR-06 | 해당 없음(결정적) | UT-LR-303 | WP-02-03·WP-02-05·WP-02-17 | INT-2~3 |
| FR-STD-033 | 모드 릴리스 매니페스트 | Must·R0 | UR-14·UR-18 | V-build | contracts·packc·tools/gates 외 1 | IF-CT-055·IF-GW-015·IF-GW-016·IF-GW-017·IF-GW-018·IF-GW-019 외 15 | learning.db `lr_session`·`lr_block`·`lr_attempt` | SCR-02·SCR-06 | 해당 없음(결정적) | CT-SYS-008·E2E-301~321·UT-CON-006·UT-LR-304 외 1 | WP-00-03·WP-00-17·WP-00-24 외 1 | INT-1b |
| FR-STD-034 | Case 변형 재도전 | Must·R3 | UR-11·UR-12·UR-14 | V-build | content/grading·gateway·learning/practice 외 2 | IF-CT-024·IF-CT-040·IF-GW-051·IF-GW-068·IF-GW-069·IF-GW-070 외 6 | lr_long_task | SCR-02·SCR-04·SCR-06·SCR-08 | 해당 없음(결정적) | UT-LR-300~399·E2E-301~321(대역) | WP-06-01·WP-06-02·WP-06-11 외 2 | INT-6~7 |
| FR-STD-035 | 마이크로 판단 포맷 | Should·R3 | UR-11·UR-14 | V-build | content/grading·web/practice | IF-CT-024·IF-CT-040·IF-GW-020·IF-GW-068·IF-GW-069·IF-GW-070 외 6 | learning.db `lr_session`·`lr_block`·`lr_attempt` | SCR-02·SCR-06 | 해당 없음(결정적) | UT-LR-300~399·E2E-301~321(대역) | WP-06-06·WP-06-13 | INT-6~7 |

### 3.10 FR-UX — UI·UX (16)

| ID | 이름 | 우선·슬 | UR | V | 서비스 | IF | 테이블 | SCR | AI(프롬프트/Jev) | 테스트 | WP | INT |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FR-UX-001 | D3 Bathymetry 디자인 토큰 | Must·R0 | UR-04 | V-build | design-tokens | — (교차 품질 속성, 전 라우트) | web IndexedDB `fathom-attempts`·localStorage(DB 없음) | SCR-18 | 해당 없음(결정적) | UT-WEB-001~499 + E2E-501~505 | WP-00-13 | INT-1b |
| FR-UX-002 | 살아있는 스타일가이드 `/_design` | Must·R1 | UR-04·UR-07 | V-build | web/shell | — (교차 품질 속성, 전 라우트) | web IndexedDB `fathom-attempts`·localStorage(DB 없음) | SCR-18 | 해당 없음(결정적) | UT-WEB-001~499 + E2E-501~505 | WP-00-24·WP-03-20 | INT-2~3 |
| FR-UX-003 | 키보드 우선 조작 | Must·R1 | UR-04·UR-17 | V-build | ui·web/lib·web/shell | — (교차 품질 속성, 전 라우트) | web IndexedDB `fathom-attempts`·localStorage(DB 없음) | SCR-02 | 해당 없음(결정적) | E2E-503 | WP-00-18·WP-00-25·WP-03-20 | INT-2~3 |
| FR-UX-004 | IME 안전 입력 | Must·R0 | UR-04·UR-17 | B+V-ci | ui·web/lib | — (교차 품질 속성, 전 라우트) | web IndexedDB `fathom-attempts`·localStorage(DB 없음) | —(화면 없음) | 해당 없음(결정적) | UT-WEB-006 | WP-00-18·WP-00-25 | INT-1b |
| FR-UX-005 | 초성 명령 팔레트 | Must·R1 | UR-04·UR-17 | V-build | ui·web/lib·web/shell | IF-CT-012·IF-GW-050 | web IndexedDB `fathom-attempts`·localStorage(DB 없음) | GLB-PAL | 해당 없음(결정적) | UT-CT-014·UT-WEB-007 | WP-00-19·WP-00-25·WP-03-20 | INT-2~3 |
| FR-UX-006 | 적응형 UI 밀도 | Should·R3 | UR-04·UR-11 | V-build | web/lib·web/settings·web/settings·shell | IF-GW-161·IF-GW-162 | web IndexedDB `fathom-attempts`·localStorage(DB 없음) | SCR-17 | 해당 없음(결정적) | UT-WEB·E2E-501~505(대역) | WP-00-25·WP-03-22·WP-06-15 | INT-6~7 |
| FR-UX-007 | 판정 배지 7종 | Must·R2 | UR-16·UR-17 | V-build | ui | IF-CT-045·IF-GW-035 | web IndexedDB `fathom-attempts`·localStorage(DB 없음) | PNL-02-J·SCR-02 | 해당 없음(결정적) | UT-WEB-200 | WP-00-19·WP-04-20 | INT-4~5 |
| FR-UX-008 | 보상 설계 금지 규칙 | Must·R0 | UR-04·UR-14 | V-build | tools/gates | — (교차 품질 속성, 전 라우트) | web IndexedDB `fathom-attempts`·localStorage(DB 없음) | —(화면 없음) | 해당 없음(결정적) | UT-WEB-001~499 + E2E-501~505 | WP-00-17 | INT-1b |
| FR-UX-009 | 모션 규칙 | Must·R1 | UR-04 | V-build | design-tokens·ui | — (교차 품질 속성, 전 라우트) | web IndexedDB `fathom-attempts`·localStorage(DB 없음) | SCR-02·SCR-18 | 해당 없음(결정적) | UT-WEB-203 | WP-00-13·WP-00-19 | INT-2~3 |
| FR-UX-010 | 전역 셸 | Must·R0 | UR-04·UR-17 | V-build | ui·web/shell | IF-GW-005 | web IndexedDB `fathom-attempts`·localStorage(DB 없음) | GLB-SHELL | 해당 없음(결정적) | UT-WEB-001~499 + E2E-501~505 | WP-00-19·WP-00-24 | INT-1b |
| FR-UX-011 | 빈·로딩·오류 상태와 카피 | Must·R1 | UR-17 | V-build | ui | — (교차 품질 속성, 전 라우트) | web IndexedDB `fathom-attempts`·localStorage(DB 없음) | SCR-18 | 해당 없음(결정적) | UT-WEB-201 | WP-00-19·WP-03-20 | INT-2~3 |
| FR-UX-012 | 화면 인벤토리 | Must·R0 | UR-04·UR-17 | V-build | web/shell | — (교차 품질 속성, 전 라우트) | web IndexedDB `fathom-attempts`·localStorage(DB 없음) | —(화면 없음) | 해당 없음(결정적) | E2E-501(18 라우트) | WP-00-24·WP-03-20 | INT-1b |
| FR-UX-013 | 한국어 UI·폰트 self-host | Must·R0 | UR-04·UR-15 | V-build | design-tokens | — (교차 품질 속성, 전 라우트) | web IndexedDB `fathom-attempts`·localStorage(DB 없음) | SCR-18 | 해당 없음(결정적) | E2E-505 | WP-00-13 | INT-1b |
| FR-UX-014 | 안전한 리치 콘텐츠 렌더 | Must·R1 | UR-04·UR-17 | V-build | web/lib | — (교차 품질 속성, 전 라우트) | web IndexedDB `fathom-attempts`·localStorage(DB 없음) | SCR-02·SCR-03 | 해당 없음(결정적) | SEC-GW-008·UT-WEB-202 | WP-00-25 | INT-2~3 |
| FR-UX-015 | Soft gate (강제 잠금 금지) | Must·R1 | UR-11 | V-build | learning/practice | IF-LR-065 | web IndexedDB `fathom-attempts`·localStorage(DB 없음) | SCR-03·SCR-17 | 해당 없음(결정적) | UT-LR-305 | WP-02-04 | INT-2~3 |
| FR-UX-016 | 세션 플레이어 블록 믹스테이프 | Must·R1 | UR-04·UR-14 | V-build | web/practice·web/shell | IF-GW-017·IF-GW-018·IF-LR-004 | web IndexedDB `fathom-attempts`·localStorage(DB 없음) | SCR-02 | 해당 없음(결정적) | PRF-019 | WP-00-24·WP-01-13 | INT-2~3 |

## 4. NFR 추적표

| ID | 이름 | 우선·슬 | UR | V | 서비스 | IF | 테이블 | 테스트 | WP | INT |
|---|---|---|---|---|---|---|---|---|---|---|
| NFR-AVL-001 | Zero-AI Floor | Must·R1 | UR-14·UR-15 | B+V-ci | tests | IF-GW-015 | 모든 DB `_infra`(outbox·inbox) | E2E-100·E2E-101·UT-TK-010·UT-TK-011 | WP-01-19·WP-02-22 | INT-2~3 |
| NFR-AVL-002 | 부분 장애 내성 | Must·R1 | UR-08·UR-17 | V-build | learning/curriculum-ref·shared-kernel·testkit 외 2 | IF-CT-007·IF-CT-040·IF-EV-01·IF-GW-005·IF-IPC-010 | 모든 DB `_infra`(outbox·inbox) | CHA-001·CHA-003·CT-LR-202·IT-020 외 2 | WP-00-21·WP-00-25·WP-00-36 외 3 | INT-2~3 |
| NFR-AVL-003 | 자동 재시작 | Must·R0 | UR-17 | V-build | supervisor·tests | IF-IPC-010 | 모든 DB `_infra`(outbox·inbox) | CHA-001·CHA-006·CHA-007·UT-SUP-001 | WP-00-29·WP-07-18 | INT-1b |
| NFR-AVL-004 | 백업 RPO·복원 RTO | Must·R1 | UR-12·UR-17 | V-build | shared-kernel | IF-IPC-018 | 모든 DB `_infra`(outbox·inbox) | PRF-018·UT-OP-006 | WP-00-21 | INT-2~3 |
| NFR-AVL-005 | 조용한 실패 금지 | Must·R2 | UR-17 | V-build | gateway·ops-api·tests 외 2 | IF-AI-002·IF-GW-005·IF-GW-121·IF-GW-135·IF-OP-001 | op_banner | CT-OP-521·CT-SYS-001·IT-002·UT-GW-050 외 3 | WP-00-19·WP-00-30·WP-01-11 외 2 | INT-4~5 |
| NFR-AVL-006 | 헬스·준비 엔드포인트 | Must·R0 | UR-08·UR-17 | V-build | ops-api·shared-kernel | IF-COM-003·IF-OP-001 | 모든 DB `_infra`(outbox·inbox) | CT-*-601~610(IF-COM, 제목에 NFR-AVL-006 추가) | WP-00-14·WP-01-11 | INT-1b |
| NFR-AVL-007 | 구조화 로그·보존 | Must·R1 | UR-17 | V-build | shared-kernel·supervisor | IF-COM-003·IF-OP-041 | 모든 DB `_infra`(outbox·inbox) | IT-038·UT-SK-010·UT-SUP-007 | WP-00-14·WP-00-29 | INT-2~3 |
| NFR-AVL-008 | 로컬 텔레메트리 | Must·R3 | UR-15·UR-17 | V-build | ops-api | IF-GW-152·IF-LR-090·IF-OP-045 | 모든 DB `_infra`(outbox·inbox) | PRF-013·UT-OP-101 | WP-07-07 | INT-6~7 |
| NFR-AVL-009 | Safe Mode 부팅 | Must·R3 | UR-17 | V-build | ops-api | IF-OP-026 | 모든 DB `_infra`(outbox·inbox) | IT-033 | WP-07-07 | INT-6~7 |
| NFR-AVL-010 | Content Health SLO | Must·R2 | UR-13·UR-17 | V-build | 전 서비스 | — (교차 품질 속성, 전 라우트) | 모든 DB `_infra`(outbox·inbox) | UT-CT-210·UT-CT-311 | WP-04-12·WP-05-01 | INT-4~5 |
| NFR-AVL-011 | 멱등성과 재시도 | Must·R1 | UR-12·UR-17 | V-build | shared-kernel | IF-COM-004 | 모든 DB `_infra`(outbox·inbox) | CT-LR-201·IT-003·UT-SK-004·UT-SK-006 외 3 | WP-00-27 | INT-2~3 |
| NFR-AVL-012 | 시계·수면 복원력 | Must·R1 | UR-17 | V-build | 전 서비스 | — (교차 품질 속성, 전 라우트) | 모든 DB `_infra`(outbox·inbox) | UT-LR-001 | IT-02~03→INT-2~3 | INT-2~3 |
| NFR-DATA-001 | append-only 강제 | Must·R0 | UR-12 | V-build | contracts·learning/ledger | IF-LG-01 | lr_artifact_version·lr_attempt·lr_block·lr_checkpoint 외 11 | SEC-LR-001·UT-LR-011 | WP-00-03·WP-01-05 | INT-1b |
| NFR-DATA-002 | 리플레이 일치 | Must·R0 | UR-12 | V-build | learning/learner-model·learning/ledger·learning/sim 외 2 | IF-LR-086 | learning.db·ops.db | IT-030·UT-LR-101·UT-LR-500·UT-LR-601 외 1 | WP-00-14·WP-01-05·WP-01-06 외 3 | INT-1b |
| NFR-DATA-003 | 15년 호환 | Must·R3 | UR-12 | V-build | learning/learner-model·ops-api·shared-kernel 외 1 | IF-IPC-018·IF-OP-020·IF-OP-031 | learning.db·ops.db | IT-014·UT-LR-008·UT-LR-600 | WP-00-20·WP-01-06·WP-07-06 외 1 | INT-6~7 |
| NFR-DATA-004 | export 왕복 무손실 | Must·R3 | UR-12 | V-build | learning·ops-api | — (교차 품질 속성, 전 라우트) | learning.db·ops.db | IT-012 | IT-06~07→INT-6~7 | INT-6~7 |
| NFR-DATA-005 | 판정 원자료 보존 | Must·R2 | UR-12·UR-16 | V-build | learning·ops-api | — (교차 품질 속성, 전 라우트) | ai_budget_alert·ai_calibration_run·ai_call_log·ai_consent 외 5 | IT-001~099 + UT-LR-001~099 | IT-04~05→INT-4~5 | INT-4~5 |
| NFR-DATA-006 | 시간 표현 | Must·R0 | UR-12 | V-build | learning·ops-api | — (교차 품질 속성, 전 라우트) | learning.db·ops.db | UT-SK-003 | IT-01→INT-1b | INT-1b |
| NFR-DATA-007 | 보존 정책 | Must·R3 | UR-12·UR-17 | V-build | learning·ops-api | — (교차 품질 속성, 전 라우트) | gr_appeal·gr_attempt·gr_turn_judgment·gr_utterance 외 17 | IT-001~099 + UT-LR-001~099 | IT-06~07→INT-6~7 | INT-6~7 |
| NFR-DATA-008 | 무결성 점검 | Must·R3 | UR-17 | V-build | learning·ops-api | — (교차 품질 속성, 전 라우트) | learning.db·ops.db | IT-025 | IT-06~07→INT-6~7 | INT-6~7 |
| NFR-DATA-009 | 콘텐츠 품질 기준 | Must·R1 | UR-13 | V-build | learning·ops-api | — (교차 품질 속성, 전 라우트) | learning.db·ops.db | IT-001~099 + UT-LR-001~099 | IT-02~03→INT-2~3 | INT-2~3 |
| NFR-DATA-010 | 개인정보 최소화 | Must·R2 | UR-15 | V-build | content/acquisition·shared-kernel | IF-AI-050 | learning.db·ops.db | SEC-AI-102·SEC-CT-271·UT-CT-100 | WP-00-14·WP-05-09 | INT-4~5 |
| NFR-DATA-011 | 다기기 병합 결정성 | Must·R1 | UR-12 | V-build | learning/ledger·tests | IF-COM-004·IF-COM-005·IF-COM-006·IF-COM-007·IF-EV-13·IF-LR-080 외 9 | learning.db·ops.db | CHA-009·IT-009·IT-010·UT-LR-005 외 2 | WP-03-12·WP-03-28 | INT-2~3 |
| NFR-DATA-012 | 서비스 간 일관 백업 (epoch) | Must·R1 | UR-12·UR-17 | V-build | content·contracts·learning 외 3 | IF-COM-004·IF-COM-005·IF-COM-006·IF-COM-007·IF-IPC-001·IF-LR-080 외 9 | op_id | CHA-008·IT-005·IT-008·PRF-017 외 2 | WP-00-03·WP-00-27·WP-00-31 외 3 | INT-2~3 |
| NFR-DATA-013 | 원장 자급성 (단일 writer · outbox) | Must·R0 | UR-05·UR-12 | V-build | content·content/grading·contracts 외 5 | IF-COM-004·IF-COM-005·IF-COM-006·IF-COM-007·IF-CT-040·IF-CT-045 외 13 | lr_event | CT-CT-203·CT-CT-505·IT-001·UT-LR-010 외 2 | WP-00-03·WP-00-16·WP-00-27 외 5 | INT-1b |
| NFR-MAINT-001 | 서비스 경계 준수 | Must·R0 | UR-08·UR-09 | V-build | ai·biome-plugins·content 외 3 | IF-COM-001·IF-EXT-13 | — (저장소·게이트) | UT-GATE-001·UT-GATE-002·UT-GATE-003·UT-GATE-004 | WP-00-01·WP-00-10·WP-00-15 외 5 | INT-1b |
| NFR-MAINT-002 | 데이터 소유권 | Must·R0 | UR-08 | V-build | shared-kernel·tools/gates | — (빌드 타임 packc·정적 게이트, API 없음) | — (저장소·게이트) | UT-GATE-nnn(node:test) + CT-SYS-0nn | WP-00-10·WP-00-14·WP-00-16 | INT-1b |
| NFR-MAINT-003 | 계약 우선 | Must·R0 | UR-05·UR-08 | V-build | contracts·tools/gates | — (빌드 타임 packc·정적 게이트, API 없음) | — (저장소·게이트) | CT-SYS-002·UT-CON-001 | WP-00-04·WP-00-09·WP-00-10 외 1 | INT-1b |
| NFR-MAINT-004 | 테스트 커버리지 | Must·R0 | UR-03·UR-17 | V-build | tools/gates · 전 단위 | — (빌드 타임 packc·정적 게이트, API 없음) | — (저장소·게이트) | UT-GATE·CT-SYS(대역) | IT-01→INT-1b | INT-1b |
| NFR-MAINT-005 | 정적 품질 | Must·R0 | UR-07 | V-build | repo | — (빌드 타임 packc·정적 게이트, API 없음) | — (저장소·게이트) | UT-PACKC-004 | WP-00-01 | INT-1b |
| NFR-MAINT-006 | 동결과 변경 통제 (2단 동결) | Must·R0 | UR-05 | V-build | contracts·tools/gates | — (빌드 타임 packc·정적 게이트, API 없음) | — (저장소·게이트) | CT-SYS-006·IT-022·UT-SUP-004 | WP-00-09·WP-00-17 | INT-1b |
| NFR-MAINT-007 | 정책·파라미터 외부화 | Must·R1 | UR-01·UR-12·UR-17 | V-build | shared-kernel | — (빌드 타임 packc·정적 게이트, API 없음) | — (저장소·게이트) | UT-GATE-nnn(node:test) + CT-SYS-0nn | WP-00-21 | INT-2~3 |
| NFR-MAINT-008 | 어댑터 포트 | Must·R0 | UR-09·UR-15·UR-16 | V-build | ai/generate | — (빌드 타임 packc·정적 게이트, API 없음) | — (저장소·게이트) | UT-GATE-nnn(node:test) + CT-SYS-0nn | WP-01-10 | INT-1b |
| NFR-MAINT-009 | 결정적 CI | Must·R0 | UR-03·UR-15 | V-build | testkit | — (빌드 타임 packc·정적 게이트, API 없음) | — (저장소·게이트) | UT-GATE·CT-SYS(대역) | WP-00-22 | INT-1b |
| NFR-MAINT-010 | 개발표준 준수 | Must·R0 | UR-07 | V-build | tools/gates · 전 단위 | — (빌드 타임 packc·정적 게이트, API 없음) | — (저장소·게이트) | UT-GATE-nnn(node:test) + CT-SYS-0nn | IT-01→INT-1b | INT-1b |
| NFR-MAINT-011 | 추적 가능 테스트 ID | Must·R0 | UR-07 | V-build | testkit·tools/gates | — (빌드 타임 packc·정적 게이트, API 없음) | — (저장소·게이트) | UT-SID-001·UT-SID-002 | WP-00-17·WP-00-22·WP-00-36 | INT-1b |
| NFR-MAINT-012 | 합성 학습자 시뮬레이터·합성 로그 생성기 | Must·R0 | UR-03·UR-17 | V-build | learning/sim | — (빌드 타임 packc·정적 게이트, API 없음) | — (저장소·게이트) | UT-LR-650·UT-LR-651 | WP-01-07·WP-02-07 | INT-1b |
| NFR-MAINT-013 | 콘텐츠 표본 감사 KPI | Must·R1 | UR-13 | V-build | tools/gates · 전 단위 | — (빌드 타임 packc·정적 게이트, API 없음) | — (저장소·게이트) | UT-GATE-nnn(node:test) + CT-SYS-0nn | IT-02~03→INT-2~3 | INT-2~3 |
| NFR-PERF-001 | 세션 첫 문항 지연 | Must·R0 | UR-17 | V-build | content/itembank·learning/practice·tests | IF-CT-055·IF-LR-001 | — (측정) | PRF-001·UT-LR-306 | WP-01-03·WP-01-09·WP-01-19 외 1 | INT-1b |
| NFR-PERF-002 | 비AI 로컬 API 응답 | Must·R1 | UR-17 | V-build | 전 서비스 | — (교차 품질 속성, 전 라우트) | — (측정) | PRF-002 | IT-02~03→INT-2~3 | INT-2~3 |
| NFR-PERF-003 | 결정적 채점 응답 | Must·R0 | UR-17 | V-build | tests | — (교차 품질 속성, 전 라우트) | — (측정) | CT-LR-201·PRF-003 | WP-02-22 | INT-1b |
| NFR-PERF-004 | AI interactive 데드라인 | Must·R2 | UR-16·UR-17 | V-build | 전 서비스 | — (교차 품질 속성, 전 라우트) | — (측정) | IT-018·PRF-004·UT-CT-301 | IT-04~05→INT-4~5 | INT-4~5 |
| NFR-PERF-005 | LDI·숙달 증분 계산 | Must·R1 | UR-12 | V-build | 전 서비스 | — (교차 품질 속성, 전 라우트) | — (측정) | PRF-005·PRF-006 | IT-02~03→INT-2~3 | INT-2~3 |
| NFR-PERF-006 | 검색 응답 | Must·R1 | UR-04·UR-17 | V-build | content/catalog·tests | IF-CT-012 | — (측정) | PRF-007·UT-CT-013 | WP-02-13·WP-02-22 | INT-2~3 |
| NFR-PERF-007 | 코드 러너 실행 | Must·R1 | UR-14 | V-build | tests | — (교차 품질 속성, 전 라우트) | — (측정) | PRF-008·UT-CT-410 | WP-02-22 | INT-2~3 |
| NFR-PERF-008 | 기동 시간 | Must·R0 | UR-17 | V-build | supervisor·tests | IF-GW-002·IF-IPC-001 | — (측정) | E2E-107·IT-034·PRF-009 | WP-00-29·WP-00-36 | INT-1b |
| NFR-PERF-009 | 프런트엔드 렌더 | Must·R1 | UR-04 | V-build | content/catalog·packc·web/curriculum | IF-CT-011·IF-GW-040 | — (측정) | PRF-010 | WP-02-12·WP-02-14·WP-03-18 | INT-2~3 |
| NFR-PERF-010 | 부하 예측 정확도 | Must·R3 | UR-12 | B+V-field | 전 서비스 | — (교차 품질 속성, 전 라우트) | — (측정) | PRF-nnn(대역) | IT-06~07→INT-6~7 | INT-6~7 |
| NFR-PERF-011 | 장기 데이터 규모 성능 | Must·R3 | UR-12 | V-build | 전 서비스 | — (교차 품질 속성, 전 라우트) | — (측정) | PRF-011 | IT-06~07→INT-6~7 | INT-6~7 |
| NFR-PERF-012 | AI 호출 처리량 제한 준수 | Must·R2 | UR-15 | V-build | 전 서비스 | — (교차 품질 속성, 전 라우트) | — (측정) | PRF-012·UT-AI-106 | IT-04~05→INT-4~5 | INT-4~5 |
| NFR-PORT-001 | OS 지원 | Must·R1 | UR-15 | B+V-ci | repo | IF-CT-051·IF-GW-039 | — (실행 환경) | E2E-104(제목에 NFR-PORT-001 추가) | WP-00-12 | INT-2~3 |
| NFR-PORT-002 | 런타임 | Must·R0 | UR-15 | V-build | repo | — (교차 품질 속성, 전 라우트) | — (실행 환경) | E2E-104·UT-SUP-005 | WP-00-01 | INT-1b |
| NFR-PORT-003 | 네이티브 빌드 금지 | Must·R0 | UR-15 | V-build | repo | — (교차 품질 속성, 전 라우트) | — (실행 환경) | E2E-1nn·V-ci(대역) | WP-00-01 | INT-1b |
| NFR-PORT-004 | Windows CLI 호환 | Must·R2 | UR-15 | B+V-ci | shared-kernel | — (교차 품질 속성, 전 라우트) | — (실행 환경) | UT-AI-551 | WP-00-21 | INT-4~5 |
| NFR-PORT-005 | 데이터 디렉터리 | Must·R0 | UR-15 | V-build | shared-kernel | — (교차 품질 속성, 전 라우트) | — (실행 환경) | UT-OP-200 | WP-00-14 | INT-1b |
| NFR-PORT-006 | 자산 self-host | Must·R0 | UR-15 | V-build | gateway | — (교차 품질 속성, 전 라우트) | — (실행 환경) | E2E-505 | WP-00-30 | INT-1b |
| NFR-PORT-007 | 선택 도구 부재 허용 | Must·R1 | UR-01·UR-15 | V-build | cli·ops | IF-OP-025 | — (실행 환경) | E2E-1nn·V-ci(대역) | IT-02~03→INT-2~3 | INT-2~3 |
| NFR-PORT-008 | 브라우저 지원 | Must·R1 | UR-04 | B+V-ci | cli·ops | — (교차 품질 속성, 전 라우트) | — (실행 환경) | E2E-1nn·V-ci(대역) | IT-02~03→INT-2~3 | INT-2~3 |
| NFR-PORT-009 | 런타임 수명 정책 | Must·R3 | UR-12·UR-15 | B+V-ci | shared-kernel | — (교차 품질 속성, 전 라우트) | — (실행 환경) | UT-OP-201·UT-SK-001 | WP-00-20 | INT-6~7 |
| NFR-SEC-001 | 로컬 바인딩 | Must·R0 | UR-15 | V-build | gateway·shared-kernel | IF-COM-001·IF-GW-001·IF-GW-002·IF-GW-003·IF-GW-004·IF-GW-005 외 2 | — (경계·설정) | SEC-GW-005·UT-SK-007 | WP-00-28·WP-00-30 | INT-1b |
| NFR-SEC-002 | Host 검증·CSRF 방어 | Must·R0 | UR-17 | V-build | gateway·web/lib | IF-GW-001·IF-GW-002·IF-GW-003·IF-GW-004·IF-GW-005·IF-GW-006 외 1 | — (경계·설정) | CT-GW-201·SEC-GW-001·SEC-GW-002·UT-GW-004 외 2 | WP-00-25·WP-00-30 | INT-1b |
| NFR-SEC-003 | 내부 서비스 인증 | Must·R0 | UR-08 | V-build | contracts·shared-kernel·supervisor 외 1 | IF-COM-001·IF-COM-005·IF-GW-001·IF-GW-002·IF-GW-003·IF-GW-004 외 3 | — (경계·설정) | CT-SYS-003·CT-SYS-009·SEC-GW-006·SEC-GW-007 외 2 | WP-00-03·WP-00-21·WP-00-28 외 2 | INT-1b |
| NFR-SEC-004 | API 키 보관 | Must·R2 | UR-15·UR-17 | V-build | ai·shared-kernel | IF-AI-030·IF-AI-031·IF-AI-032·IF-AI-033·IF-AI-050·IF-AI-051 외 7 | — (경계·설정) | CT-AI-203·IT-038·SEC-AI-107·UT-AI-500 외 4 | WP-00-14·WP-00-33·WP-04-08 | INT-4~5 |
| NFR-SEC-005 | CLI 안전 호출 4원칙 | Must·R2 | UR-15 | B+V-ci | ai/cli·fake-cli·shared-kernel | IF-AI-030·IF-AI-031·IF-AI-032·IF-AI-033·IF-AI-050·IF-AI-051 외 3 | — (경계·설정) | UT-SK-016 | WP-00-21·WP-04-06 | INT-4~5 |
| NFR-SEC-006 | 코드 실행 샌드박스 | Must·R1 | UR-14·UR-17 | V-build | content/runner | IF-CT-050·IF-EXT-11·IF-OP-015·IF-OP-016·IF-OP-020·IF-OP-021 | — (경계·설정) | UT-CT-400 | WP-03-01·WP-03-02 | INT-2~3 |
| NFR-SEC-007 | SSRF 방어 | Must·R2 | UR-13 | V-build | content/acquisition | IF-CT-050·IF-EXT-11·IF-OP-015·IF-OP-016·IF-OP-020·IF-OP-021 | — (경계·설정) | SEC-CT-251~270 | WP-05-09 | INT-4~5 |
| NFR-SEC-008 | 프롬프트 인젝션 격리 | Must·R2 | UR-13·UR-16 | B+V-live | ai/generate | IF-AI-030·IF-AI-031·IF-AI-032·IF-AI-033·IF-AI-050·IF-AI-051 외 2 | — (경계·설정) | SEC-AI-105·UT-AI-300·UT-CT-101 | WP-04-05 | INT-4~5 |
| NFR-SEC-009 | LLM 출력 안전 처리 | Must·R2 | UR-13 | V-build | ai/control | IF-AI-027·IF-AI-030·IF-AI-031·IF-AI-032·IF-AI-033·IF-AI-050 외 3 | — (경계·설정) | SEC-GW-008·UT-AI-301·UT-AI-303·UT-WEB-202 | WP-04-08 | INT-4~5 |
| NFR-SEC-010 | SQL 파라미터 바인딩 | Must·R0 | UR-17 | V-build | tools/gates | — (교차 품질 속성, 전 라우트) | — (경계·설정) | UT-CT-012·UT-GATE-005 | WP-00-15 | INT-1b |
| NFR-SEC-011 | 금지 API 스캔 | Must·R0 | UR-07·UR-17 | V-build | tools/gates | — (교차 품질 속성, 전 라우트) | — (경계·설정) | SEC-*(대역) | WP-00-15 | INT-1b |
| NFR-SEC-012 | 오류 정보 비노출 | Must·R1 | UR-17 | V-build | contracts | IF-GW-001·IF-GW-002·IF-GW-003·IF-GW-004·IF-GW-005·IF-GW-006 외 1 | — (경계·설정) | CT-SYS-005·SEC-GW-004·UT-CT-404·UT-SK-009 | WP-00-03 | INT-2~3 |
| NFR-SEC-013 | 외부 전송 통제 | Must·R2 | UR-15 | V-build | ai/privacy·shared-kernel | IF-AI-030·IF-AI-031·IF-AI-032·IF-AI-033·IF-AI-050·IF-AI-051 외 2 | — (경계·설정) | SEC-AI-100·UT-AI-402 | WP-00-14·WP-04-01 | INT-4~5 |
| NFR-SEC-014 | 파일 입출력 검증 | Must·R1 | UR-12·UR-13·UR-17 | V-build | 전 서비스 | IF-CT-050·IF-EXT-11·IF-OP-015·IF-OP-016·IF-OP-020·IF-OP-021 | — (경계·설정) | PRF-016·SEC-OP-002·UT-SK-017 | IT-02~03→INT-2~3 | INT-2~3 |
| NFR-SEC-015 | 행안부 보안약점 적용표 준수 | Must·R1 | UR-07·UR-17 | V-build | ops-api | IF-OP-014 | — (경계·설정) | SEC-*(대역) | WP-03-13 | INT-2~3 |
| NFR-SEC-016 | 의존성 감사 | Must·R0 | UR-17 | V-build | tools/gates | — (교차 품질 속성, 전 라우트) | — (경계·설정) | SEC-*(대역) | WP-00-16 | INT-1b |
| NFR-SEC-017 | 로컬 API rate limit | Should·R1 | UR-17 | V-build | gateway | IF-GW-001·IF-GW-002·IF-GW-003·IF-GW-004·IF-GW-005·IF-GW-006 외 1 | — (경계·설정) | UT-GW-100 | WP-00-30 | INT-2~3 |
| NFR-SEC-018 | export 무결성 | Must·R3 | UR-12 | V-build | 전 서비스 | IF-CT-050·IF-EXT-11·IF-GW-144·IF-OP-015·IF-OP-016·IF-OP-020 외 1 | — (경계·설정) | SEC-LR-002 | IT-06~07→INT-6~7 | INT-6~7 |
| NFR-SEC-019 | 세션 통제 (부트스트랩 + 쿠키) | Must·R0 | UR-17 | V-build | gateway·web/lib | IF-GW-001·IF-GW-002·IF-GW-003·IF-GW-004·IF-GW-005·IF-GW-006 외 2 | — (경계·설정) | CT-GW-202·E2E-103·IT-031·SEC-GW-001 외 6 | WP-00-25·WP-00-30 | INT-1b |
| NFR-SEC-020 | LLM CLI 사용자 설정 격리 | Must·R2 | UR-15·UR-17 | B+V-live | ai/cli | IF-AI-030·IF-AI-031·IF-AI-032·IF-AI-033·IF-AI-050·IF-AI-051 외 2 | — (경계·설정) | UT-AI-401·UT-AI-552 | WP-04-06 | INT-4~5 |
| NFR-UX-001 | 색 대비 (WCAG 2.2 AA) | Must·R0 | UR-04 | V-build | design-tokens | — (교차 품질 속성, 전 라우트) | web IndexedDB `fathom-attempts`·localStorage(DB 없음) | E2E-501·UT-TOK-001 | WP-00-13 | INT-1b |
| NFR-UX-002 | 키보드 접근성 | Must·R1 | UR-04·UR-17 | V-build | web/shell | — (교차 품질 속성, 전 라우트) | web IndexedDB `fathom-attempts`·localStorage(DB 없음) | E2E-501·E2E-503 | WP-03-20 | INT-2~3 |
| NFR-UX-003 | 스크린리더·대체 표현 | Must·R1 | UR-04 | V-build | web | — (교차 품질 속성, 전 라우트) | web IndexedDB `fathom-attempts`·localStorage(DB 없음) | E2E-501 | IT-02~03→INT-2~3 | INT-2~3 |
| NFR-UX-004 | 색 단독 정보 전달 금지 | Must·R1 | UR-04 | V-build | web | — (교차 품질 속성, 전 라우트) | web IndexedDB `fathom-attempts`·localStorage(DB 없음) | E2E-501~505 + UT-WEB-2nn | IT-02~03→INT-2~3 | INT-2~3 |
| NFR-UX-005 | 인지 부하 예산 | Must·R1 | UR-04·UR-17 | B+V-field | web | — (교차 품질 속성, 전 라우트) | web IndexedDB `fathom-attempts`·localStorage(DB 없음) | E2E-501~505 + UT-WEB-2nn | IT-02~03→INT-2~3 | INT-2~3 |
| NFR-UX-006 | 한국어 IME 품질 | Must·R0 | UR-04 | B+V-ci | web | — (교차 품질 속성, 전 라우트) | web IndexedDB `fathom-attempts`·localStorage(DB 없음) | E2E-501~505 + UT-WEB-2nn | IT-01→INT-1b | INT-1b |
| NFR-UX-007 | 첫 사용 경험 | Must·R3 | UR-17·UR-18 | V-build | web | — (교차 품질 속성, 전 라우트) | web IndexedDB `fathom-attempts`·localStorage(DB 없음) | E2E-501~505 + UT-WEB-2nn | IT-06~07→INT-6~7 | INT-6~7 |
| NFR-UX-008 | 역품질 가드레일 자동 검사 | Must·R0 | UR-04·UR-14 | V-build | tools/gates | — (교차 품질 속성, 전 라우트) | web IndexedDB `fathom-attempts`·localStorage(DB 없음) | UT-CON-003·UT-LR-305 | WP-00-17 | INT-1b |
| NFR-UX-009 | 한국어 타이포그래피·정보 밀도 | Must·R0 | UR-04·UR-11 | V-build | design-tokens·tools/gates | — (교차 품질 속성, 전 라우트) | web IndexedDB `fathom-attempts`·localStorage(DB 없음) | E2E-501~505 + UT-WEB-2nn | WP-00-13·WP-00-17 | INT-1b |
| NFR-UX-010 | 반응형 범위 | Should·R1 | UR-04 | V-build | web | — (교차 품질 속성, 전 라우트) | web IndexedDB `fathom-attempts`·localStorage(DB 없음) | E2E-504 | IT-02~03→INT-2~3 | INT-2~3 |
| NFR-UX-011 | 판정 신뢰 UX | Must·R2 | UR-16·UR-17 | V-build | web | — (교차 품질 속성, 전 라우트) | web IndexedDB `fathom-attempts`·localStorage(DB 없음) | E2E-501~505 + UT-WEB-2nn | IT-04~05→INT-4~5 | INT-4~5 |
| NFR-UX-012 | 디자인 품질 리뷰 (INT마다) | · | UR-04·UR-17 | V-build | web/shell | — (교차 품질 속성, 전 라우트) | web IndexedDB `fathom-attempts`·localStorage(DB 없음) | E2E-502 | WP-00-24 |  |
| NFR-UX-013 | 과업 기반 사용성 검사 | Must·R1 | UR-04·UR-17 | V-build | tests | IF-GW-002 | web IndexedDB `fathom-attempts`·localStorage(DB 없음) | E2E-201~205 | WP-03-28 | INT-2~3 |
| NFR-UX-014 | 시간 제한 조정·단일 키 단축키·도식 대체 | Must·R1 | UR-00·UR-04·UR-17 | V-build | web | — (교차 품질 속성, 전 라우트) | web IndexedDB `fathom-attempts`·localStorage(DB 없음) | UT-WEB-006·UT-WEB-204 | IT-02~03→INT-2~3 | INT-2~3 |

## 4A. PR(프로세스 요구) 추적 — UR-02·03·05·06·07·09·18

| PR | 이름 | UR | 실현(문서·WP·게이트) | 판정 |
|---|---|---|---|---|
| PR-001·002 | 복수 기획 방법론 · 가상 액터 | UR-02 | `docs/01-planning/01~03` | PG-1(완료) |
| PR-003 | 설계 문서 선행 | UR-05·07 | ARC·IF·DB·DCP·SCR·STD·TST + 이 RTM | PG-2(ADR-000 §5) |
| PR-004 | 동결·순서 불변 | UR-05 | ADR-000, `frozen.lock`, `check:frozen`, WP-00-00 | PG-2 |
| PR-005 | 개발 → 검증/보완 → 통합 | UR-03 | STD §14 G1~G3, WBS §2.1·§2.6, TST §9 | 매 INT |
| PR-006 | 모델 티어 배분 | UR-06 | WBS §2.3(T1·T2s·T2h·T0), STD §17 | 매 Brief |
| PR-007 | SI 산출물 | UR-07 | `docs/02-design/**`, `tools/si-docs`(UTR·ITR·PRF·SEC·RTM) | 매 INT |
| PR-008 | graphify 탐색 | UR-09 | STD §18, CLAUDE.md, WBS §2.5, `pnpm audit:graph`(비차단) | 매 반복 |
| PR-009·015 | 회고 주기·제품 내 동형 | UR-03 | WBS §14 RETRO-01~03, FR-DSH-009·012 | INT-2·4·6 뒤 |
| PR-010·011 | 즉시 착수·한 번에 완성 | UR-18 | WBS §0·§4(IT-00 즉시), §13 cut line | PG-3·INT-7 |
| PR-012·016 | 디자인 참조 | UR-04 | DS-01, SCR-01 §3 | 매 INT 디자인 리뷰 |
| PR-013 | 요구 추적 | UR-07 | **이 문서**, `check:rtm` | INT-3부터 차단 |
| PR-014 | 동결 전 스파이크 | UR-05 | `spikes/SP-2·3·4·6·7` + 감사, ARC 부록 B | PG-2 |
| PR-017 | 용량 모델 | UR-18 | WBS §3, VC-1 | VC-1·RETRO |
| PR-018 | FR ↔ 반복 매핑 | UR-03 | `tools/si-docs/data/fr-iteration.json`(TST §18.1 시드) | PG-3 |

## 5. 커버리지 점검 (2026-10-01)

| 점검 | 결과 | 조치 |
|---|---|---|
| Must·Should FR 중 IF·WP·INT 열이 빈 행 | 0 | — |
| 테스트 열이 확정 ID 없이 **대역**인 Must·Should FR | 114 | TST §18.1 대역에서 T1이 Brief별 번호 배정, INT별 `check:rtm`이 고아 0 확인(INT-3부터 차단) |
| 화면 없는 FR(백엔드·빌드 타임·정책) | 26 | 정상(예: 원장 계약·packc lint·AI 라우팅) — UI 증거는 해당 FR의 [T]/[I] 수용 기준 |
| 이월 FR | FR-CUR-010(Should R2) | CR-50, WBS §13.1 #24 — 매핑 0이 정상, `check:rtm`은 `deferred` 표기 요구를 제외 |

## 6. `modes.manifest.json` 초안 (Planning §5.7 #6, JSON 방출 = WP-00-03 `packages/contracts/manifests/`)

| mode_id | 이름 | ur14_family | offline_path(OFFLINE 결정적 경로) | 렌더러·화면 | e2e_ids | status |
|---|---|---|---|---|---|---|
| M-01 | 3단 레슨 | 개념이해 | 임베디드 질문 D | RND-LESSON · SCR-03 | E2E-301 · SCN-01 | included |
| M-02 | 먼저 풀어보기 | 개념이해 | 결정적(증거 0, β만) | RND-OX/MCQ | E2E-302 | included |
| M-03 | OX 스프린트 | OX | O/X D + 교정 H→S | RND-OX | E2E-303 · SCN-01 | included |
| M-04 | 문제 믹스 | 문제 | 결정적 + 정규화 | RND-MCQ·CLOZE·SHORT·MATCH·ORDER | E2E-304 | included |
| M-05 | 코드 읽기(출력 예측) | 문제 | 실행 결정적(T1) | RND-PREDICT | E2E-305 | included |
| M-06 | 오류 찾기·설정 리뷰·로그 | 문제 | 위치 D + 설명 H→S | RND-BUGLINE·RND-MCQ(log_read) | E2E-306 | included |
| M-07 | 헷갈림 쌍 | 문제 | 결정적 | RND-MCQ(쌍) | E2E-307 | included(컷 #20 시 deferred) |
| M-08 | 페르미 | 문제 | 로그 허용오차 D | RND-FERMI | E2E-308 | included(컷 #16 시 deferred) |
| M-09 | 조건 반전 쌍 | 문제 | 셀·쌍 D + pivot S | RND-CONDPAIR | E2E-309 | included |
| M-10 | 코드 과제(Parsons 포함) | 실습 | 숨은 테스트 D(부모 판정) | RND-LAB·RND-PARSONS | E2E-310 | included |
| M-11 | 코드 회상 카타 | 실습 | 숨은 테스트 D | RND-LAB | E2E-311 | included(컷 #21 시 deferred) |
| M-12 | 인프라 lite | 실습 | 정적 규칙 D | RND-INFRA | E2E-312 | included |
| M-13 | 백지노트 | 백지노트 | trigram H + KP 자기채점 + 보류 | SCR-06 | E2E-313 · SCN-03 | included |
| M-14 | 개념 디깅 | 개념 디깅 | 질문 은행 × KU + S, D4~D5 MCQ D | SCR-07 | E2E-314 | included |
| M-15 | Feynman | 개념 디깅 | 스크립트 학생 + 체크리스트 S | SCR-07 | E2E-315 | included(컷 #23 시 deferred) |
| M-16 | AI 답안 감사 | 문제 | 주입 위치 D + 설명 S | RND-BUGLINE | E2E-316 | included(컷 #17 시 deferred) |
| M-17 | PR 리뷰 | 실습 | 라인 범위 D + 자기매칭 S | RND-PRREVIEW | E2E-317 | included |
| M-18 | 역출제 | 문제 | 형식 D + 체크리스트 S + 보류 | RND-AUTHOR | E2E-318 | included(컷 #18 시 deferred) |
| M-19 | Case | 실습(판단) | 결정점 D ≥ 60% + 루브릭 S(잠정) | SCR-08 | E2E-319 | included |
| M-20 | 산출물 + 반박 | 실습(판단) | 루브릭 S(잠정) + 반론 은행 | SCR-09 | E2E-320 | included |
| M-21 | 과거의 나 | 백지노트 | diff + S | RND-TIMECAPSULE | E2E-321 | included(컷 #12 시 deferred) |

- 규칙: UR-14 6계열(개념이해·실습·문제·개념 디깅·OX·백지노트)마다 `included` ≥ 1(`check:manifest`), 렌더러 레지스트리 키 ∩ 형식 후보 ≠ ∅(SCR DN-09). JSON 필드 = `{mode_id, ur14_family, offline_path, e2e_ids[], status}`(ARC §10.5).

## 7. `verification-class.json` 초안

```json
{ "default": "V-build",
  "exceptions": {
    "FR-AI-001": {"build": true, "beyond": ["V-live"]},
    "FR-AI-005": {"build": true, "beyond": ["V-live"]},
    "FR-AI-006": {"build": true, "beyond": ["V-live"]},
    "FR-AI-014": {"build": true, "beyond": ["V-live"]},
    "FR-AI-015": {"build": true, "beyond": ["V-live"]},
    "FR-DSH-013": {"build": true, "beyond": ["V-field"]},
    "FR-IMP-006": {"build": true, "beyond": ["V-live"]},
    "FR-LAB-011": {"build": true, "beyond": ["V-live"]},
    "FR-PRG-018": {"build": true, "beyond": ["V-field"]},
    "FR-QST-012": {"build": true, "beyond": ["V-live"]},
    "FR-SET-024": {"build": true, "beyond": ["V-ci", "V-live"]},
    "FR-UX-004": {"build": true, "beyond": ["V-ci"]},
    "NFR-AVL-001": {"build": true, "beyond": ["V-ci"]},
    "NFR-PERF-010": {"build": true, "beyond": ["V-field"]},
    "NFR-PORT-001": {"build": true, "beyond": ["V-ci"]},
    "NFR-PORT-004": {"build": true, "beyond": ["V-ci"]},
    "NFR-PORT-008": {"build": true, "beyond": ["V-ci"]},
    "NFR-PORT-009": {"build": true, "beyond": ["V-ci"]},
    "NFR-SEC-005": {"build": true, "beyond": ["V-ci"]},
    "NFR-SEC-008": {"build": true, "beyond": ["V-live"]},
    "NFR-SEC-020": {"build": true, "beyond": ["V-live"]},
    "NFR-UX-005": {"build": true, "beyond": ["V-field"]},
    "NFR-UX-006": {"build": true, "beyond": ["V-ci"]}
  } }
```

- 생성 원천 = REQ §1.7 예외 표. RTM의 V 열과 같은 값이며 `check:rtm` ④가 V-build 요구의 ci-build 결과 존재를 판정한다.

## 8. 갱신 규칙

1. 이 문서는 동결 기준선의 **설계 시점 추적**이다. 구현 중 실측 열(테스트 결과)은 `docs/40-impl/reports/RTM-<INT>.md`(si-docs 생성)에 쌓고 이 문서는 CR로만 바꾼다.
2. 새 IF·테이블·화면·테스트가 생기면 해당 문서(IF-01 FR 열, DB-01 `@table` 주석, SCR §9, TST 제목)에 FR ID를 넣는다 — 그래야 si-docs가 사슬을 다시 잇는다.
3. `check:rtm` 차단: INT-3부터 Must FR/NFR 고아 0, PG-3에서 Must·Should 전부 + V-class 일치.

*끝. RTM-01 v1.0 — ADR-000 동결 기준선의 일부.*
