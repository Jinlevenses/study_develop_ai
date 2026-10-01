# DRL-01. 설계 리뷰 기록 (Design Review Log) — PG-2 교차 문서 정합

> **문서 ID**: DRL-01 · **버전**: v1.0 · **작성일**: 2026-10-01 · **작성 주체**: T1(상위 모델, 아키텍처)
> **입력**: 스파이크 감사 5건(`spikes/SP-2·3·4·6·7.md`의 "감사(Audit) 결과", `spikes/00-audit-summary.md`) · 교차 문서 비평 3건(api-db-screen-ai 17 · reqs-coverage 19 · standards-wbs-build 24 = 60개 지적)
> **산출**: 상세 문서 개정(IF-01·DB-01·DCP-01·AI-01·SCR-01·DS-01·WBS-01·STD-01·TST-01·ARC-01·ADR-005·006·008·012·016·tech-stack-facts) + RTM-01 + ADR-000 + 에이전트 빌드 브리프 + `CLAUDE.md`
> **판정**: blocker 8/8 · major 35/35 · minor 17/17 **해소**. 남은 미결 = 값(SIM-PROMO·SIM-LDI)과 V-ci/V-live 항목뿐(ADR-000 §5).

---

## 0. 요약

1. **스파이크 감사 대조**: 감사의 구속 결정 약 60건(SP-2 10 · SP-3 14 · SP-4 15 · SP-6 9 · SP-7 12)을 상세 문서 9종에서 찾아 대조했다. 아키텍처 반영(ARC 부록 B)은 이미 완료돼 있었고, 상세 문서에서 어긋난 곳은 **1건**(DCP §6.17.1 골드셋 초기 상태 `'draft'` → `'model_labeled_draft'`, CR-39와 함께 정정)이었다(§1).
2. **가장 큰 결정 — 콘텐츠 ID 문법(CR-35)**: 비평 3건 중 2건이 "packc R-ID(DCP·DB가 이미 쓰는 형식)를 정본으로" 권했고, IF-01 쪽 형식은 `common/ids.ts` 한 블록과 예시 몇 곳에만 있었다. DDL·DCP 견본·packc 스키마를 살리고 **IF-01 정규식을 R-ID 문법으로 재작성**했다. 카드 ID만 IF 형식 `<concept_id>:<facet>:r|p`를 유지(비평 2건 권고, DB는 주석 2곳만 수정). 새 정규식은 DCP 견본 ID 50종에 대해 양성·음성 검증을 통과했다(§3.2).
3. **형식 어휘(CR-36)**: IF `FormatId`를 단일 어휘(33종)로 하고 DCP 저작 이름을 그 이름으로 **개명**했다. 병합은 하지 않았다(비평 standards-wbs-build: 병합은 형식 수 집계·R-POOL·`formats_min`을 깨뜨린다) — 그래서 `mcq_multi`·`order`·`parsons`·`log_read`·`config_review` 5종을 IF에 가산했다(비평 api-db-screen-ai의 `config_review → error_find` 병합 제안은 채택하지 않음).
4. **DDL 정합**: 화면·계약이 보는 값이 정본이라는 원칙(IF enum = DB CHECK)으로 content·learning·ai·ops DDL을 고쳤고, 신규 테이블 8개를 추가했다. 개정 DDL을 `node:sqlite`로 다시 적용해 **71/71 검사 통과**, 개정 테이블정의서는 실행 결과에서 재생성했다(DB-01 §17.1a).
5. **빌드 가능성**: Playwright 1.63 → **1.56.1**(컨테이너 Chromium 1194 실측 짝), `node --test test/` 실패 → glob, L-js 오프라인 탐침 재정의, testkit preset을 WA 웨이브로 앞당김, contracts S2 웨이브 순환 제거, 테스트 번호 정본을 TST §11.2로 일원화.
6. **Mermaid**: 개정 후 설계·표준·테스트 문서의 다이어그램 66개 전부 mermaid 12.0.0 `parse` 통과(정규식이 잡은 비다이어그램 인라인 2건 제외).

---

## 1. 스파이크 감사 대조 (a)

| SP | 감사 정정(구속 결정) | 아키텍처 | 상세 문서 반영 위치 | 판정 |
|---|---|---|---|---|
| SP-2 | 요청당 전용 자식, prewarm 1회용 예비는 차단 스위트 통과 후만 | ADR-007, ARC §12.6 | WBS WP-03-01, TST §14.2 | 일치 |
| SP-2 | RSS 감시 25~50ms 전 OS(100ms = ~400MB 초과), RLIMIT_NPROC 금지, 출력 캡 `>=` | ADR-007, CR-02 | WBS WP-03-01, TST windows 매트릭스(`win-rss-helper` ≤ 50ms) | 일치 |
| SP-2 | 결과 위조(RES-14) → 숨은 테스트는 부모 판정 | ADR-007 | IF-CT-040 ③, TST SEC-CT-211~213 | 일치 |
| SP-2 | 대조군 = 호스트 부수효과 **또는** 자기보고 표식, SQL 16행 전부 무토크나이저 대조군 | ARC 부록 B.1 | TST §14.2(대조군 100%, 16행) | 일치 |
| SP-2 | Windows·macOS 미검증 → 형식 비활성 + Docker 권고 | ADR-007, RK | WBS `runner_verified_platforms`, DB `rn_run.exit_reason='platform_disabled'` | 일치 |
| SP-3 | `INSERT OR IGNORE`만, `recursive_triggers=ON`, REPLACE 거부 | ADR-011 | DB §17.1 #36·#39, STD-SQL | 일치 |
| SP-3 | 체인 헤드 원장 밖 앵커 | ADR-011, CR-27 | DB `lr_checkpoint`, TST `chain-anchor.spec.ts` | 일치 |
| SP-3 | payload에 리플레이 입력·`study_day`·`policy_version`, 파라미터는 이벤트 버전에서 | ADR-011, CR-26 | IF §10.2(모든 payload `study_day`), DB §6.3 | 일치 |
| SP-3 | LDI 표시 시 전체 재계산(캐시 금지) | CR-25 | IF §5.4 주석, DB §7(스냅샷 표 없음) | 일치 |
| SP-3 | 예측 = 범위만, 띠 = 사용자 오차 보정, 거버너 = 하한 | CR-05 | DB `lr_forecast_log`, IF `ForecastView`, TST UT-LR-252 | 일치 |
| SP-3 | `ldi_params@v1` 미확정(SP-3 주장 철회) | CR-28 | IF `params_provisional`, DCP DN-31, SCR-10 ⓘ | 일치 |
| SP-3 | 정정 경로 결정성 테스트(INT-1 게이트), WAL + `synchronous=FULL` | CR-04 | TST `merge-corrections`, WBS INT-1b | 일치 |
| SP-4 | 서비스 1개 = DB 1개, ATTACH 0, `SqlitePort` + `BEGIN IMMEDIATE`, busy 5000 | ADR-002 | DB §3.1, STD-SQL | 일치 |
| SP-4 | 백업 = `VACUUM INTO` 사본(기본 `backup()` 완료 시간 무한) | ADR-013 | DB B-06·§12, ADR-013 기각표 | 일치 |
| SP-4 | 검색 V2(instr, LIKE 금지), 구두점·따옴표 제거, 20,000 문서에서 V3 | CR-24 | DB 0002 FTS 3종, IF `SearchResultView.engine`, `search_params.strip_chars` | 일치 |
| SP-4 | 2음절 재현율 미검증 → 평가셋 진부분집합 + P@10 | CR-24 | DCP §6.17.2 `search-120` | 일치 |
| SP-4 | `--disable-warning=ExperimentalWarning`(NODE_OPTIONS 병합), E2E stderr 검사 | ARC §9.3 | STD §8.3, TST E2E-104 | 일치 |
| SP-4 | Windows 기본 `%LOCALAPPDATA%\Fathom`, 동기화·WSL 경고, 양 OS 미확립 | CR-01 | DB B-13, STD-CFG-10, AI-01 §4.5, SCR-17 | 일치 |
| SP-6 | F0 추측 보정(`n_options`)·F4 θ_q·형식 산입 2조건·ε geq | CR-11 | IF `Verdict.item_n_options`, `MasteryRulesV1.elo` | 일치 |
| SP-6 | θ는 채점 30건 전 비노출 + 수축 | CR-22 | `MasteryRulesV1.theta_shrink`, DB `lr_concept_state.n_graded` | 일치 |
| SP-6 | `structuralFeasibility()` 순수 함수(promotion 화면·packc R-POOL·CI 공용) | CR-10 | IF §13.3, DCP R-POOL, WBS WP-00-06 | 일치 |
| SP-6 | 미결 4건 → ARC §7.3 결정 + SIM-PROMO 재실행 | CR-18~21 | WBS §5.5 VC-1, IF `PolicyView.provisional` | 일치(값 미확정) |
| SP-7 | 게이트 = 의존성 0 스크립트 + `lib/lex.mjs`, 엔진 예외·0파일 = exit 2, tokens 강등은 `--allow-tokens-only`만 | ADR-010 | STD-GATE-02, WBS WP-00-10(감사 이식 4건) | 일치 |
| SP-7 | `check:boundaries --engine=both`, TS 7.0.2 정확 pin, 병행 pin 금지 | ADR-010 | STD-TS-01·GATE-06 | 일치 |
| SP-7 | 코드 배치 규약 STD-01 동결(Jev·SQL·pre/post-submit·blank-note·routing·design-tokens) | ADR-010 | STD §2.4 | 일치 |
| SP-7 | NFR-UX-008 검증 재분류(정적 G1·G4·G5·G6, 계약·런타임 G3·G7) | CR-23 | TST §15·§17 | 일치 |
| (부수) | 골드셋 초기 상태 문자열 | — | DCP §6.17.1 `status='draft'` → **`'model_labeled_draft'`**(DB CR-39와 같은 값) | **정정** |

## 2. 결정 대장 — 이번 정합에서 발행한 CR

| CR | 결정 | 주 반영 문서 |
|---|---|---|
| CR-29(의무화)·CR-33·CR-42 | `learning.evidence.recorded{item_beta_after, phase}` 필수(pretest도 발행), `basis: 'pack_upgrade'`를 이벤트·원장 payload·멱등 키·`ib_correction` CHECK에 한 묶음 적용 | IF §9.4·§9.5·§10.2·IF-LR-010, DB §5.3.4·D-37·`ib_correction` |
| CR-35 | 콘텐츠 ID 문법 = packc R-ID, Card만 IF 형식, Volatility `evolving`, Tag `[a-z0-9_.-]`, `GoldId`, `PackId`(트랙 \| `x.<slug>` \| `u.<ns>`), `ItemModelId`·`RubricId` 신설 | IF §2.4·D-11, DB §3.3·`lr_card_state`, DCP §5.2, STD-NAM-103·D-STD-25, SCR 와이어프레임 |
| CR-36 | `FormatId` 33종 단일 어휘, DCP 저작명 개명, `w_format` = `method_policy@v1.formats.<FormatId>`만, packc R-FMT | IF §2.4·§13.4·D-10, DCP §6.5·DN-10·§7.3, SCR §7.2.3·DN-01, DB `ib_item.format`, WBS WP-01-00·PGM-PACKC-012 |
| CR-37 | practice DDL ↔ R0/R1 계약(세션 template·ai_mode_at_start·paused, BlockState·BlockKind 열, awaiting_self_grade, DialogKind, `turn_id` 3표) | DB practice/0001·grading/0001 |
| CR-38 | content.db enum = IF enum(gr_attempt·gr_pending·gr_appeal·ib_report·aq_import_job·aq_inbox_item·ct_artifact_task), `ImportStage`에 `COPY_GUARD`, `'I1.5'`↔`'I1_5'` 매핑 1곳 | DB §5.5, IF §6.2·§6.3, DCP §6.8 |
| CR-39 | ai.db enum·열 = IF·AI-01(work_order·job·consent·gold·call_log·billing·`gcli-*`·calibration `prompt_version`), `CallLogEntry`에서 `blocked` 제거·`SystemTaskId`, `WorkOrderView.tasks` | DB §8.2, IF §7·§11, AI-01 §19 |
| CR-40 | 신규 표 `lr_note_draft`·`lr_review_note`(백업 대상)·`ib_hint_open` | DB, IF D-19·D-32·IF-LR-033·058 |
| CR-41 | `lr_curriculum_ref` title·tags·`catalog_version`/`pack_version`, `lr_curriculum_{sync,inventory,case,path}`, 증분 export = 정수 catalog 버전 | DB curriculum-ref/0001·§6.6, IF D-13 |
| CR-43 | breaker open 60s(×2 ≤ 600s) + 오류율 규칙, IF `AiPolicyV1` = AI-01 §12.5 키 1:1, 나머지 정책 상세 zod = T1 R3 저작 | IF §12.1·§13.4, WBS WP-00-05~08 |
| CR-44 | `AIG-POLICY-001` → `AI-POLICY-001` | ARC §11.1, ADR-005, ADR-016, STD-NAM-91, TST D-TST-15 |
| CR-45 | 블루프린트 공개 라우트 IF-GW-052(목록)·053(가져오기)·CLI 195 | IF §4.4·§4.9·§4.11, SCR-04·17, WBS WP-07-00·03, TST E2E-108 |
| CR-46 | `pack/records.ts` BundleRecord 18종 code-exact | IF §13.1, WBS WP-00-06, TST CT-SYS-013 |
| CR-47 | Playwright 1.56.1 고정 | ARC §18, TST §3.1, WBS WP-00-01, tech-stack-facts |
| CR-48 | `op_tripwire_state` = TripwireView/Settings | DB telemetry/0001 |
| CR-49 | FR-QST-004 T4 S2 3요건 승인 경로 | IF IF-CT-063·064·IF-GW-104·133·`S2Approval`, SCR-14 `tab=staging`, WBS WP-04-13b, TST UT-CT-209 |
| CR-50 | FR-CUR-010 v1 이월 | WBS §13.1 #24, SCR-03, IF D-36 |
| CR-51 | `PackKpi` = report.json `kpi` = `TrackCatalog.tracks[].kpi` | IF §6.1, DCP §7.6, SCR-04, TST UT-PACKC-006 |
| CR-52 | 경로 = 카탈로그 콘텐츠(`x.paths`, `ct_path`, export `path` 줄), `composer_policy.path_weights` | DCP DN-22·§6.18, DB `ct_path`·`ct_search_doc.kind`, IF §6.1 |
| CR-53 | shared-kernel import = `@fathom/shared-kernel/<module>/<module>` | ARC §16·§17.3, STD-DIR-31, 전 문서 치환(38곳) |
| CR-54 | contracts 파일 목록 정본 = IF `// file:` 머리, Provider*·Volatility·Tag → `common/domain.ts`, practice 어휘 4종 `common/practice.ts` 머리 정정, BootstrapEnvelope = `admin/ipc.ts` | IF, ARC §16, ADR-008 §5, ADR-012 §3, STD §2.1·§8.1 |
| CR-55 | `@fathom/ui` 허용 의존에 `cmdk`·`sonner`(Command는 `filter` prop) | ARC §17.1·§18, DS-01 §9.2 |
| CR-56 | 테스트 번호 정본 = TST §11.2 대역, WBS 반복 블록 폐기, boot-shell = E2E-107, walking-skeleton = E2E-021 | WBS §2.4·D-WBS-11·E0-1·E1-1, STD-NAM-96, TST §11.6 |

## 3. 지적별 처리 기록

### 3.1 api-db-screen-ai (17건)

| # | 심각도 | 쟁점 | 처리 | CR | 상태 |
|---|---|---|---|---|---|
| A-01 | blocker | FormatId 어휘 분기(IF 28 vs DCP 25 이름) | IF 33종 단일 어휘, DCP 개명(병합 없음 — `config_review`는 별도 FormatId), DB 주석·SCR 레지스트리·`method_policy.formats` 키·packc R-FMT | CR-36 | 해소 |
| A-02 | blocker | 콘텐츠 ID 문법 충돌 | **R-ID 문법을 정본으로**(비평 권고 IF 쪽의 역방향 — 다른 비평 2건·편집 최소), Card = IF 형식, `GoldId` 신설, PackId = DB/DCP 형식, Tag 정규식 정렬 | CR-35 | 해소 |
| A-03 | blocker | practice DDL이 R0/R1 계약 저장 불가 | `lr_session`·`lr_block`·`lr_attempt`·`lr_dialog_state`·`turn_id` 3표 — 비평 제시안 그대로 | CR-37 | 해소 |
| A-04 | major | content.db CHECK ↔ IF enum | 제시안 채택, `PendingGradeView.reason`에 `low_confidence`·`appeal` 가산, `ImportJobView.source_kind` 확장, `ImportStage` `COPY_GUARD` | CR-38 | 해소 |
| A-05 | major | ai.db enum·열 | 제시안 채택(`caller_svc` 분리, `tasks_json`·`cap_json`·`decided_by`, `blocked` 제거, billing 매핑 없음, `gcli-*` CHECK) | CR-39 | 해소 |
| A-06 | major | 노트 초안·힌트 열람·주간/시즌 서술 저장소 없음 | `lr_note_draft`·`ib_hint_open`·`lr_review_note`, IF D-32 이름 정정, `iv_season.season_id` 정의 | CR-40 | 해소 |
| A-07 | major | 학습 경로 소유·저장 없음 | 경로 = 카탈로그(`x.paths`, `ct_path`), export `path` 줄, `SearchQuery.kinds`에 `misconception` 가산 | CR-52 | 해소 |
| A-08 | major | curriculum-ref ↔ ConceptRef·export | 열 가산, `catalog_version` 정수 + `pack_version`, inventory·case·sync 표, §6.6 재작성 | CR-41 | 해소 |
| A-09 | major | breaker 120s vs 60s, ai_policy 키 누락 | IF §12.1 문구, `AiPolicyV1` zod 전 키 | CR-43 | 해소 |
| A-10 | major | AI-01 ★ 미반영(pa/pb, 템플릿, SystemTaskId, calibration, judge_bands, judge-keys) | 전부 IF·DB 반영, DB는 0001에 직접 | CR-39·43 | 해소 |
| A-11 | major | CR-29·33 부분 적용 | 묶음 적용 + CR-29 의무화(pretest 포함) | CR-42 | 해소 |
| A-12 | major | `AIG-POLICY-001` 잔존 | ARC·ADR-005·ADR-016 정정, IF·STD·TST 메모 종결 | CR-44 | 해소 |
| A-13 | major | 블루프린트 공개 라우트 없음, `bp` 매핑 | IF-GW-052(+053·195), SCR `bp` ↔ `blueprint_id` 문서화, DN-12 종결 | CR-45 | 해소 |
| A-14 | minor | `CT-DEP-001` 미정의 코드 | SCR §2.2·§6A.1 → `GW-DEP-001`(+`dependency`), 미준비 = `CT-DEP-901` | — | 해소 |
| A-15 | minor | 대량 승인 임계 경계 `≥` vs `>` | AI-01 §12.4 엄격 초과로 통일, IF·DB 주석 동일 | — | 해소 |
| A-16 | minor | tripwire enum | DB 정정(`action_strength`·`muted`) | CR-48 | 해소 |
| A-17 | minor | `prompt_version` 타입 불일치 | `Verdict`·`VerdictCarried` = `SemVer.nullable()` | — | 해소 |

### 3.2 reqs-coverage (19건)

| # | 심각도 | 쟁점 | 처리 | CR | 상태 |
|---|---|---|---|---|---|
| R-01 | blocker | FR-CUR-004 ID 문법 3종 | A-02와 동일 결정(이 비평의 권고 방향). CT-SYS-012 골든 픽스처(DCP 견본 ID → IF zod) | CR-35 | 해소 |
| R-02 | blocker | Volatility `slow` vs `evolving` | `evolving`으로 통일(`common/domain.ts`), UT-PACKC-008 | CR-35 | 해소 |
| R-03 | major | DB 저장소 공백 6건 | A-06·A-08·A-10 + billing `'free'` | CR-39~41 | 해소 |
| R-04 | major | FR-PRG-008/CUR-007 β 갱신이 선택 CR에 의존 | CR-29 의무화, UT-LR-115·UT-CT-211 | CR-29 | 해소 |
| R-05 | major | FR-AI-008 60s ↔ IF 120s, ai_policy 키 | A-09 | CR-43 | 해소 |
| R-06 | major | FR-QST-004 실현 경로 없음 | `S2Approval`·IF-CT-063·064·IF-GW-104·133·SCR-14 `tab=staging`·WP-04-13b·UT-CT-209(이월 대신 실현 선택 — Must) | CR-49 | 해소 |
| R-07 | major | FR-PRG-028 WP·테스트 없음 | WP-02-04 `overrides.ts`(+0.2u)·PGM-LR-012·UT-LR-311·312 | — | 해소 |
| R-08 | major | FR-CUR-024 가져오기 경로 없음 | IF-GW-053·195, SCR `DLG-BP-IMPORT`, WP-07-00·03, E2E-108 | CR-45 | 해소 |
| R-09 | major | §5.7 동결 조건 실현 증거 없음 | WP-00-00 PG-2 점검표, ADR-000 §5, RTM-01(§6 모드 매니페스트 초안·§7 V-class 초안), WBS §4.1 CR 원천 목록 | — | 해소 |
| R-10 | major | `check:rtm` 고아 Must 74건 | TST §18.1 "Must 요구 → 수준·대역·INT" 표(74행) + 기존 케이스 제목에 요구 ID 추가 규칙, `fr-iteration.json` 시드 | — | 해소 |
| R-11 | major | DCP → IF FormatId 매핑 불완전 | A-01(매핑 대신 개명, UT-PACKC-007) | CR-36 | 해소 |
| R-12 | major | FR-CUR-026 KPI 모양 | `PackKpi`, TrackCatalog `kpi`, SCR-04 PNL-04-T·범례, UT-PACKC-006, PGM-PACKC-008 | CR-51 | 해소 |
| R-13 | major | FR-CUR-010 실현 경로 없음 + 죽은 버튼 | **v1 이월** 선택(Should R2, AI 과업·라우트 신설 비용 > 가치), WBS §13.1 #24, SCR-03 버튼 제거, IF D-36 | CR-50 | 해소 |
| R-14 | minor | `AIG-POLICY-001` 원문 | A-12 | CR-44 | 해소 |
| R-15 | minor | IF §14 추적 누락 | FR-CUR-009·010·015·016·024·026, FR-STD-028·029, FR-PRG-015·016, β 행 추가, D-35(`policy_changed` = `policy.switched`) | — | 해소 |
| R-16 | minor | NFR-AVL-010 소유 없음 | WP-05-01(자동 동결)·WP-04-12(인용률), UT-CT-210·311 | — | 해소 |
| R-17 | minor | RSK-RUN 문서 경로 소유 없음 | `docs/40-impl/reports/RSK-RUN.md` → WP-03-01, TST §17 D-12 | — | 해소 |
| R-18 | minor | ADR-006 "18 + /_design" | "17 + `/_design` = 18"(3곳) | — | 해소 |
| R-19 | minor | SCR §9 추적 누락 | FR-PRG-026·021·022·027·028·FR-CUR-026·FR-QST-004 행 | — | 해소 |

### 3.3 standards-wbs-build (24건)

| # | 심각도 | 쟁점 | 처리 | CR | 상태 |
|---|---|---|---|---|---|
| S-01 | blocker | ID 형식 불일치(+ConceptId가 KU ID 통과) | CR-35 정규식은 시드 개념 = 점 1개로 고정해 `db.mvcc.k03`이 ConceptId를 통과하지 않음(음성 검증), FeasibilityBlocker 문자 집합 `[a-z0-9.-]` | CR-35 | 해소 |
| S-02 | blocker | `pack/records.ts` 미정의 | IF §13.1 code-exact BundleRecord 18종 + 번역 규칙 ①~④ | CR-46 | 해소 |
| S-03 | blocker | Playwright 1.63 ↔ 컨테이너 Chromium 1194 | 1.56.1 고정(실측: `/opt/pw-browsers/chromium-1194`, 전역 playwright 1.56.1) | CR-47 | 해소 |
| S-04 | major | WBS·TST 테스트 번호 체계 충돌 | TST §11.2 정본, WBS 블록 폐기, E2E-107·021 | CR-56 | 해소 |
| S-05 | major | 계약 파일 머리·S2 웨이브 순환 | practice 어휘 `common/practice.ts` 머리, Provider* → `common/domain.ts`, `mastery_rules.ts` → WP-00-03, WP-00-03 원천 목록 재작성, S2a(06·07·08) → S2b(05) → S2c(04) | CR-54 | 해소 |
| S-06 | major | 정책 zod 비정밀·w_format 위치 | `AiPolicyV1`·`FormatPolicy` 상세 zod, 나머지 = T1 R3 저작으로 재분류, w_format = method_policy | CR-36·43 | 해소 |
| S-07 | major | FormatId 병합·WP-01-00 파일 | A-01, WP-01-00은 흡수(0.1u, 가산 CR 있을 때만) | CR-36 | 해소 |
| S-08 | major | D-13 미반영 | A-08(`pack_version` + `catalog_version`) | CR-41 | 해소 |
| S-09 | major | shared-kernel import 해석 불가 | `<module>/<module>` 진입 파일 규칙, 전 문서 치환 | CR-53 | 해소 |
| S-10 | major | ARC contracts 트리 ↔ IF 머리 | STD §2.1 예외 선언, ARC §16·ADR-008 §5 재생성, `services.ts`·`overlay.ts` 삭제, Bootstrap = `admin/ipc` | CR-54 | 해소 |
| S-11 | major | `node --test test/` 실패 | glob(`"test/*.test.mjs"`) — STD §13.2, WBS C-04·E0-6 | — | 해소 |
| S-12 | major | 오프라인 탐침이 컨테이너에서 항상 exit 2 | L-js = preload 차단 자식 탐침 + 기록 행 단언, `egress.json.isolation`·`host_reachable` | — | 해소 |
| S-13 | major | 교차 테스트 하네스 소유·실행 불가 | `tests/vitest.config.ts` security 프로젝트, 루트 `test:security`, 루트 devDependencies, `tests` 단위(D-TST-04), testkit 파일 → WP-00-11·22, `tests/support/**` → WP-00-36 | — | 해소 |
| S-14 | major | 선행 부재 실행(preset·perf·bundle·packs) | WP-00-11(WA) 신설, `tests/perf/*` → WP-01-19, `bundle` = INT-7부터(스텁), packs = INT-7부터 `--release`·floor | — | 해소 |
| S-15 | major | `@fathom/ui` 의존 허용표 위반 | cmdk·sonner 허용 + `filter` prop | CR-55 | 해소 |
| S-16 | major | 계약 테스트 파일 소유 없음 | `test/contract/http/**`(하네스+fixtures), events/common/ipc 소유 규칙(TST §6.3·WBS PR-3) | CR-56 | 해소 |
| S-17 | major | gateway `NoteView` 재정의 | 정의 삭제, learning `notes`에서 직접 import | — | 해소 |
| S-18 | minor | golden-ledgers 위치 | testkit 경로로 통일(WP-01-05에 위임) | — | 해소 |
| S-19 | minor | 라우트 수 표기 | "17 화면 + `/_design` = 18 라우트", 라우트 파일 19 | — | 해소 |
| S-20 | minor | `AIG-POLICY-001` | A-12 | CR-44 | 해소 |
| S-21 | minor | 레인 표 누락·소유 충돌 | ARC §16.1에 L-PACKC·L-AI 하위 레인·features/shell·si-docs(L-PLAT)·`.A` 소유·deploy 추가, TST D-TST-12 정정, WBS PR-8 정정 | — | 해소 |
| S-22 | minor | PG-2 fold-in 목록 불완전 | WBS §4.1 진입 조건에 전 CR 원천 + "IF/DB 병합·`frozen.lock` 재생성 후 전사 시작" | — | 해소 |
| S-23 | minor | alg 랩이 Tier A/B보다 먼저 | alg.A·.B를 IT-03으로 당김 | — | 해소 |
| S-24 | minor | graphify 기준 그래프 시점 | STD §18.2 "IT-00 W2 직후(T0)" + §18.5 유일 예외 | — | 해소 |

## 4. 검증 증거

| 검증 | 방법 | 결과 |
|---|---|---|
| DDL 재실행 | DB-01의 모든 `sql` 블록을 6개 메모리 DB에 적용(Node 22.22.2 `node:sqlite`, `foreign_keys=ON`, `recursive_triggers=ON`) + 정적 SQL 25문 prepare + 개정분 동작 28건 | 71/71 ok(DB-01 §17.1a) |
| 테이블정의서 | 개정·신규 37개 표를 `PRAGMA table_xinfo`·`foreign_key_list`·`index_list`에서 재생성 | 기존 형식과 diff = 개정 열만 |
| ID 정규식 | IF `common/ids.ts` 새 정규식을 DCP 견본·DB 예시 ID 양성 22·음성 8 + DCP 본문 ID 토큰 50개에 적용 | 실패 0(파일명 `miss.case.yaml` 오검출 1 제외) |
| Mermaid | mermaid 12.0.0 `parse`(jsdom) — 설계·표준·테스트·ADR 전체 | 66/66 통과 |
| 컨테이너 사실 | `/opt/pw-browsers` = `chromium-1194`·`chromium_headless_shell-1194`, 전역 playwright 1.56.1, `node --version` 22.22.2 | CR-47 근거 |

## 5. 남은 항목 (동결 비차단)

| 항목 | 담당 | 시점 |
|---|---|---|
| SIM-PROMO(`mastery_rules@v1` CR-18~22 값), SIM-LDI(`ldi_params@v1`) | T1 · learning `sim/` | VC-1(INT-1b 직후), INT-2 진입 조건 |
| `frozen.lock` 생성·`check:frozen` 가동 | WP-00-00 → WP-00-15 | IT-00 시작 전 |
| 정책 9종 상세 zod 저작(키 동결) | WP-00-05~08(T1 R3) | IT-00 |
| Windows·macOS(V-ci), SP-1·SP-8(V-live) | L-PLAT · 사용자 기기 | INT-3·4·7 / 첫 AI 연결 |
| 정적 게이트 실코드 오탐률 | T0 | INT-1a warn-only → INT-1b 차단 |

*끝. DRL-01 v1.0.*
