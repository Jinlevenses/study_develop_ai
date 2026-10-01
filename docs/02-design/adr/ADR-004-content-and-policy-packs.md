# ADR-004. 콘텐츠·정책 팩 — content-as-code, packc·`.fpack`, 단일 수입 포트, 불변 시드 + 오버레이, 정책 소유

- **상태**: Accepted · **일자**: 2026-10-01 · **결정자**: T1(아키텍처)
- **Trace**: UR-05·10·12·13, FR-CUR-002·004·005·009·011·014·016·017·020·023·024·025·026, FR-PRG-013·017·018·032, FR-QST-009·011, FR-LAB-017, DR-006·022·026·027·028, DEC-CNV-35, PLN-REV-01 AQ-11·AQ-13, SP-4 R-6 + 감사(검색·alias), SP-6 §6.2·R-9 + 감사(R-POOL·미결 4건), SP-3 감사(파라미터 세트·`ldi_params` 미확정)
- **관련**: ARC-01 §10, ADR-001·002·005·011

## 맥락 (Context)

- 시드 커리큘럼(469 개념, Tier A/B/C, Case 30, 문항 1,464 목표)은 사람이 diff로 리뷰해야 하는 글이며 UR-07 산출물 문화와 맞아야 한다. 팩은 불변이고 사용자 수정은 오버레이로 남긴다(DEC-CNV-35).
- "게이트 없이 출제되는 AI 문항 0"(D-6)과 "승인 전 출제 0"(FR-IMP-009, FR-CUR-023)을 쿼리 조건이 아니라 **구조로** 보장하고 싶다(심사 graft C → A).
- SP-4: 검색 재현율 손실의 대부분은 어휘 격차(별칭 부재)다 → 한글 개념의 영문 alias를 lint로 강제해야 한다. SP-6: 레벨별 평가 문항 풀이 없으면 승급이 구조적으로 막힌다 → cap 계산·lint에 평가 풀을 넣어야 한다. 감사는 풀을 **AI 모드별로 허용된 엔진의 형식**으로 세고, 그 판정 함수(`structuralFeasibility`)를 승급 화면·팩 리포트·CI 게이트가 공유하라고 구속했다.
- SP-3 감사: 리플레이는 이벤트가 참조하는 **불변 파라미터 세트**만 써야 한다 → 과거 정책 파일을 영구 보관하고 이벤트에 정책 세트 주소를 기록해야 한다. `ldi_params@v1`은 민감도 분석이 없어 미확정이다.
- 정책(Router 25칸, Composer, mastery_rules, LDI, gaming, CBM, FSRS, 게이트 임계)은 코드 상수가 아니라 버전 파일이어야 하고(NFR-MAINT-007), 해시가 바뀌었는데 버전이 같으면 기동을 거부해야 한다(FR-CUR-017). AQ-11은 저장 위치·소유·초기값을 묻는다.

## 결정 (Decision)

1. **원천 = 저장소 `content/`**(ARC-01 §10.1): `packs/<track>/`(pack.yaml, `concepts/*.md` = frontmatter + "## 이론 / ## 코드 / ## 핵심", `kus/`·`misconceptions/`·`item-models/`·`items/`·`cases/`·`artifacts/`·`rubrics/`·`labs/<id>/`), `blueprints/`, `sources/registry.yaml`, `review/V7/`, `oracles/<track>/*.py`(빌드 전용). ID 규칙: 시드 `<track>.<slug>`, 사용자 팩 `u.<ns>.<slug>`, ID 불변·alias·`deprecated_by`.
2. **팩 컴파일러 `tools/packc`**(`@fathom/tool-packc`): parse → V1 zod(`@fathom/contracts/pack/*`) → V2 lint(R-ID·R-DAG·R-LVL·R-REF·R-SRC·**R-3STAGE**(469 전부)·**R-REQ**(`required_for_level`은 Tier A/B만)·**R-ALIAS**(한글 개념마다 영문 alias 또는 동의어 ≥ 1)·**R-POOL**(레벨별 × AI 모드별 승급 평가 풀 = 그 모드에서 허용된 엔진의 형식만 세어 ≥ 12문항·형식 ≥ 4 — 판정은 `@fathom/contracts/pack/feasibility`의 `structuralFeasibility()`, learning PromotionEngine과 같은 함수)·R-NS) → V3 copy-guard → V4 실행 검증(T1·랩·알고리즘·보안 패치는 러너와 같은 샌드박스, ml·llm은 빌드타임 uv 오라클) → V5 G1·G8 → V6 출처·L4+ 1차 출처 span → V9 난이도 prior → Depth Map 레이아웃(d3-force 고정 시드) → 3단 KPI·cap 오라클(SP-6 `structuralFeasibility()` blocker 코드) → 출력. 규칙마다 음성 fixture `tools/packc/fixtures/<rule>/`.
3. **`.fpack` 형식**(무압축 tar): `manifest.json`(pack_id, version, channel `seed|local|user`, schema_v, packc_version, files[{path, sha256, bytes}], **merkle_root**, counts, required_for_level 요약, offline_cap_level) · `bundle.jsonl`(정준 JSON 레코드 한 줄 1건) · `report.json`(V1~V10, gate_status 근거, KPI, cap blocker) · `layout.json`. **content는 컴파일본만 설치**한다(원천 파싱 코드 0).
4. **단일 수입 포트**: 서빙 테이블(`ct_*` 카탈로그·`ib_item` 등)을 바꾸는 경로는 ① `.fpack` 설치 ② **PackDelta**(op: `upsert_concept`·`upsert_ku`·`alias`·`deprecate`·`upsert_misconception`·`upsert_item_model`·`publish_items`·`set_gate_status`·`quarantine_family`·`upsert_case`·`upsert_blueprint`·`attach_source`, op마다 `base_version`, `delta_id` 멱등) ③ 오버레이 패치뿐이다. 코드 위치는 `services/content/src/application/{catalog,itembank}/ingest/`이고, `check:content-ingest`가 서빙 테이블 INSERT/UPDATE SQL 문자열의 위치를 이 디렉터리로 제한한다. 가져오기·생성 파이프라인은 `aq_staging_*`·`ib_staging_item`에만 쓴다. 출제 쿼리는 `gate_status IN ('seed_reviewed','jev_verified','gated_pass')`로 이중 방어한다.
5. **설치·활성화(blue/green)**: sha256·merkle 검증 → content의 **단명 자식 job `pack-load`**(ADR-002 §3)가 비활성 버전 행에 500행 배치 적재(`BEGIN IMMEDIATE`) → 오버레이 재적용(`base_version` 같으면 자동, 다르면 `aq_staging_diff` 충돌 + `catalog.overlay.conflicted`) → 활성 포인터 전환 1 tx → `catalog.pack.activated` + `catalog.concept.changed`. 실패 시 비활성 행 폐기. FR-CUR-002의 원자성은 포인터 전환으로 보장한다(CR-12). 사용자 데이터(원장·카드)는 불변이고 변경 KU 요약을 만든다(FR-SET-014).
6. **오버레이**: `ct_overlay_event`(append-only: id, target_kind, target_id, field, base_version, new_value, reason, device_id, ts, revert_of). 조회 = 팩 ⊕ 오버레이 합성. 되돌리기 = 역패치. export·병합 대상. 정답 키 오버레이는 itembank 보정(`itembank.item.corrected`, basis `overlay`)을 함께 일으킨다(같은 tx).
7. **사용자 팩·pack refresh**: `fathom pack add <dir>`·`fathom pack refresh <track>`은 content가 `tools/packc` 빌드본을 **자식 프로세스**로 실행(서비스 간 import 금지를 프로세스 경계로 준수)하고 Python 오라클 단계는 비활성(사전 계산 정답 없는 항목은 `deferred`)이다. 결과는 스테이징 diff 승인 후 PackDelta(channel `user|local`). refresh는 작업 주문(비용·쿼터 미리보기)을 거친다(FR-AI-026).
8. **블루프린트(AQ-13)**: CNCF CKA는 GitHub `cncf/curriculum` 파일 + 커밋 SHA·sha256을 `ct_blueprint.source_edition`에, Q-Net 정보처리기사는 사용자 제공 파일(`fathom import --blueprint <file>`) 또는 수동 입력, 판본 연도 필수, 기출 복제 금지(copy-guard).
9. **정책 팩(AQ-11)**: 저장소 `policy/<name>@v<k>.yaml` + `policy/policy.lock.json`(`{"<name>@v<k>": {"sha256", "owner"}}`) → 설치 시 `FATHOM_HOME/policy/`(읽기 전용, 과거 버전 영구 보관). 각 정책은 **소유 서비스 1개**(버전 결정)와 하나 이상의 소비 서비스를 가진다. 로더 `@fathom/shared-kernel/policy/policy`가 zod(`@fathom/contracts/policy/<name>`) + 해시를 검증하고, **해시 변경 + 버전 불변 → exit 78**. 이벤트·원장에는 정책 세트 콘텐츠 주소 `policy_version = "ps_" + sha256(canonical(활성 정책 맵)).slice(0,16)`을 기록하고, **리플레이는 이 주소가 가리키는 불변 파라미터 세트로만 해석**한다(현재 활성 정책으로 대체 금지, SP-3 감사). `FATHOM_HOME/policy/sets/<policy_version>.json`(정책 이름 → 버전·sha256 맵)을 함께 영구 보관한다.

   | 정책 | 소유 | 소비 | 초기값 |
   |---|---|---|---|
   | `method_policy@v1` · `composer_policy@v1` · `gaming_params@v1` · `cbm_params@v1` | learning | learning | REQ 부록 A·PED(CBM 점수표 +1/+2/+3 · 0/−2/−6) |
   | `ldi_params@v1` | learning | learning | REQ 부록 A 초기값 — **미확정**(SP-3 감사). SIM-LDI 민감도 분석 후 `@v2` 교체 가능(CR-28) |
   | `mastery_rules@v1` | learning | learning(+ packc가 `structuralFeasibility` 입력으로 읽음) | FR-PRG-009/013/032/033 + SP-6 **F0** `elo.guess_correction: true`, **F1** `promotion.empty_level: skip`, **F3** `d4.floor_mode: min_with_possible`, **F4** `elo.unqualified_ceiling: 0`, θ 수축 `{theta_prior: -0.5, theta_shrink_n0: 10, theta_display_min_events: 30}`(CR-22), `promotion.required_mastered: n ≤ 3 ? n : min(n−1, ceil(0.85n))`(CR-20), `assessment{items: 12, formats_min: 4, selection: round_robin_by_format, engines: [deterministic, calibrated_jev_if_sp1_pass], accuracy_min_correct: {1: 10, 2: 10, 3: 10, 4: 11}, cbm_denominator: chosen_confidence_max, cbm_min: {1: 0.70, 2: 0.70, 3: 0.70, 4: 0.75}, retry_days: 14}`(CR-19, 키 = 출발 레벨), `sparse.depth_scope: track`·`d4.possible_scope: level_le_k`(CR-21), AI 모드 프로파일(`ai_profiles.JUDGE_ONLY.rubric_engine: {sp1_pass: J, sp1_fail: S_provisional}`, CR-18), `geq ε = 1e-9` — SIM-PROMO 재검증 후 확정 |
   | `fsrs_params@v1` | learning | learning | SP-3: ts-fsrs 5.4.2 `default_w`, `enable_fuzz: false`, `enable_short_term: true`, `request_retention: 0.90`(tier별 재정의), 예측 = 30일 총량 범위만·띠는 사용자 과거 예측 오차 분위수(창 < 8개면 ±15%)·거버너는 하한 비교(CR-05) |
   | `gate_thresholds@v1` · `search_params@v1` | content | content | G0~G13 임계·재게이트 보정 / SP-4 V2 가중·질의 토큰 구두점·따옴표 제거·짧은 토큰 3자 미만 `instr`·**V3 전환 20,000**(CR-24) |
   | `ai_policy@v1` · `firewall_rules@v1` | ai-gateway | ai-gateway(+ content: firewall_rules) | 예산·쿼터·대량 임계·배치 창·레이트 / 비밀 정규식·등급 규칙 |
   | `ops_policy@v1` | ops-api | ops-api | 백업 주기·보존·quiesce·로그 상한·Tripwire |

10. **릴리스 매니페스트**: `packages/contracts/manifests/modes.manifest.json`(FR-STD-033)과 `verification-class.json`(REQ §1.7)은 contracts 패키지 export로 둔다(learning·web·E2E·si-docs가 경계 안에서 import). `check:manifest`가 UR-14 6계열 included ≥ 1, E2E 대상 = included 집합을 검사한다.
11. **콘텐츠 Brief(SP-6)**: docker·cicd·cloud·ml·eng L4와 lead L2·L3에 Tier B `required_for_level` 각 1개 이상(권장 2개씩, 합계 권장 약 14개)을 DCP-01 제작 항목에 넣는다. 들어오기 전까지 제품 지도는 선언 cap이 아니라 **오라클 cap**(docker·cicd·cloud·ml·eng = L4)을 표시하고(SP-6 감사 구속), 실제 `required_for_level` 데이터로 가정된 Tier B 배분을 바꾼 뒤 feasibility 게이트를 다시 돌린다(D-11).
12. **검색 평가셋(SP-4 감사)**: DCP-01의 120질의(`evals/sets/search-120`)에 문자 그대로 일치하는 문서가 10건을 넘는 짧은(1~2음절) 질의를 넣고, 정답은 문자 일치 집합의 **진부분집합**으로 만든다. 재현율@10과 P@10을 함께 측정한다(SP-4의 2음절 재현율 0.991은 순환이라 근거로 쓰지 않음, CR-24).

## 대안 (Alternatives)

| 대안 | 장점 | 단점 | 판정 |
|---|---|---|---|
| YAML만 + 단순 tar(A 원안) | 단순 | 본문 diff 리뷰 불편, merkle·레이아웃·KPI 사전 계산 없음 | 기각(packc로 대체) |
| content가 런타임에 YAML·MD 파싱 | 빌드 단계 없음 | 공격 표면·중복 로직, 설치 원자성·해시 보장 약화 | 기각 |
| 정책을 콘텐츠 팩 안에(B `content/policy/`) | 파일 한 곳 | 팩 업그레이드와 정책 변경 결합(FR-CUR-017 위반 소지) | 기각 |
| 정책 무소유 배포(C) | 단순 | 해시 불일치 시 기동 거부 책임 분산 | 기각 |
| 사용자 팩은 git 필수(C) | 학습 효과 | 진입 장벽 | 선택 사항으로 완화(`pack init`은 git 권장만) |
| 3-way 병합(v1.0) | 사용자 수정 자동 보존 | 복잡·오류 | Deprecated(DEC-CNV-35, 오버레이로 대체) |

## 결과 (Consequences)

- **긍정**: 승인 전 출제 0이 쓰기 경로 자체로 보장된다. 팩·정책은 해시 고정이라 epoch 매니페스트·리플레이가 정확한 버전을 재현한다. lint 규칙이 SP-4·SP-6의 실패 원인(별칭·평가 풀)을 빌드 시점에 잡는다.
- **부정**: packc 빌드 단계와 `.fpack` 계약이 늘어난다. 런타임 packc 자식은 Python 없이 일부 항목을 `deferred`로 남긴다. 과거 정책 파일을 영구 보관해야 한다.
- **후속**: DCP-01이 제작 묶음·하한·Brief를 확정. IF-01이 `contracts/pack/*`·`contracts/policy/*`를 코드로 작성. `check:content-ingest`·`check:manifest`(ADR-010).

## 동결 영향

`.fpack` 매니페스트 스키마, PackDelta op 목록, 오버레이 레코드, 정책 이름·소유 표, `policy_version` 규칙, 매니페스트 위치는 상세 동결이다. 개별 정책 값은 정책 버전 증가(`policy.switched` + 리플레이 비교)로 바꾼다.
