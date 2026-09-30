# PLN-REV-01. 기획 적대적 리뷰 결과 · Planning Baseline v1.0

> **Trace**: UR-01 ~ UR-18 (`00-brief/project-brief.md`) · PLN-ACT-01(`01-actors-personas.md`) · 아이디에이션 7종(`02-ideation/`) · PLN-CNV-01(`03-convergence.md` v1.1) · REQ-01(`04-requirements-spec.md` v1.1) · UC-01(`05-use-cases.md` v1.1) · USM-01(`06-user-story-map.md` v1.1)
> **버전**: v1.0 (Frozen) · **작성 주체**: T1(상위 모델, 기획·리뷰) · **작성일**: 2026-09-30
> **리뷰 방식**: 세 렌즈(brief-compliance · persona-pedagogy-ux · feasibility-readiness)의 독립 적대적 리뷰 결과 51건을 받아, 모든 blocker·major와 minor 전부를 기획 문서에 반영했다. ID는 바꾸지 않았다. 개정 행에는 **[v1.1]**, 폐기 규칙에는 **Deprecated**를 표기했고, 신규 요구에는 새 ID를 붙였다.
> **근거 수준**: 웹 호출 0회. 2026-09-30 빌드 컨테이너 실측(`graphify --help`, `claude --help`/`--version`, `node:sqlite` 옵션, `node --permission` 동작, 브라우저·키 존재 여부)과 리뷰가 보고한 실측(`net.connect` 미차단, 힙 밖 `Buffer` 2,560MB, `ATTACH` 파일 생성)을 사용했다. 그 밖의 값은 `[추정]` 또는 `[지식]`으로 표시했다.
> **ID 접두어**: BC = brief-compliance, PX = persona·pedagogy·UX, FE = feasibility·readiness. (요구 ID의 `FR-`·제품 원칙 `PP-`와 겹치지 않게 골랐다.)

---

## 0. 요약 (TL;DR)

1. **리뷰 51건 전부 해소**: blocker 7 · major 26 · minor 18. 해소 방식은 ① 요구 추가·개정(신규 FR 29 · NFR 10 · DR 4 · IR 1 · CON 1 · PR 3, 개정 행 [v1.1] 표기) ② 결정 기록(DEC-CNV-19~36, 18건) ③ 판정 정직화(과대 "완전" 5건 → 부분·조건부) ④ 아키텍처 단계 이관(§4 AQ-01~17)이며, 한 건이 여러 방식에 걸친다.
2. **가장 큰 변화 다섯 가지**
   - **전문가 깊이(UR-11/12)**: Tier A를 L4 12·L5 6으로 재배분하고, Case를 30개(하한 12) 파라미터화 템플릿으로 바꿨다. L4→L5 승급 기준을 정의하고 L5 증거 모드인 F06 산출물을 Must로 올렸다. 필수 개념(Tier A/B), 희소 레벨 규칙, 트랙별 OFFLINE 상한(cap L5 13트랙 · L4 6트랙)을 공개했다.
   - **숙달 규칙의 도달 가능성**: 형식 산입을 `w_format ≥ 0.7 ∧ w_grader ≥ 0.6`의 2조건으로 명문화했다. OFFLINE 대체 증거(D4 MCQ·Case 결정점·T2 매칭)와 잠정 승급을 두고, 빠른 응답은 정오와 관계없이 증거 0으로 처리한다. SP-6 시뮬레이션으로 검증한다.
   - **15년 데이터**: 다기기 병합(device_id·ULID·기기별 체인), 원장 자급성(단일 writer·outbox·리플레이 입력 내장), 일 증분 + epoch 스냅샷 + 2차 대상 백업을 R0/R1에 넣었다.
   - **보안·운영 실현성**: 러너 격리를 실측 기반으로 다시 설계했고, Privacy Firewall은 로컬 판정만 쓴다. CLI 설정 격리, 키 저장 절차, 매일 진입(고정 포트·부트스트랩·쿠키)을 정했다.
   - **한 번에 완성(UR-18)**: 코드 **169u** + 콘텐츠 **34cu**로 다시 계상했다. **보장 코어 ≈ 103u**, Must별 lite 사양, 콘텐츠 하한, 검증 등급(V-build 게이트)을 사전 정의했다. 속도가 계획의 61%여도 보장 코어는 완성된다.
3. **최종 UR 판정**: 18/18 대응 — **완전 13 · 부분 3(UR-01·10·12) · 조건부 2(UR-11·18)**. 부분·조건부는 모두 수치와 해소 경로를 갖는다(§3).
4. **Planning Baseline v1.0 동결**(§5): 제품명·모드·트랙·레벨·v1 범위·AI 강등 사다리·콘텐츠·용량·동결 조건·Product DoD를 한 곳에 고정했다. 이후 변경은 CR(가산) / ADR(파괴)로만 한다.

---

## 1. 리뷰 로그

> "변경 ID"는 v1.1에서 신설·개정한 요구·결정·절이다. 문서 약어: CNV = `03-convergence.md`, REQ = `04-requirements-spec.md`, UC = `05-use-cases.md`, USM = `06-user-story-map.md`.

### 1.1 brief-compliance (BC, 16건)

| ID | 렌즈 | 심각도 | 이슈 (요지) | 해결 | 변경 ID |
|---|---|---|---|---|---|
| BC-01 | brief-compliance | **blocker** | L4+ 콘텐츠·기준 부재: Tier A L4 3·L5 1, 트랙 대부분 L4+ 자산 0, "필수 개념" 미정의, Tier C는 OFFLINE에서 Mastered 불가, L4→L5 기준 없음, SCN-07이 Should(FR-CUR-010)+AI에 의존, L5 증거 모드가 전부 Should인데도 UR-11/12 "완전" | ① 필수 개념 = `required_for_level`(Tier A/B만, lint R-REQ) + 필수 < 3이면 희소 레벨 규칙 ② Tier A 재배분 L1 18·L2 18·L3 18·**L4 12·L5 6**, Case 30(L4 14·L5 8)/하한 12, 트랙별 깊이 자산 표와 cap(L5 13·L4 6) 공개 ③ L4→L5 기준(Case 2개 ≥ 3.0 + Taught **또는** 산출물 + CBM ≥ 75%), **F06 산출물 Should → Must** ④ SCN-07 = FULL 확정 / OFFLINE 잠정 ⑤ FR-CUR-010은 승급 경로에서 분리 | FR-CUR-009·016·025, FR-PRG-013·032·033, FR-STD-026, DEC-CNV-20~22, CNV §9.3~9.5, SP-6 |
| BC-02 | brief-compliance | major | UR-10 3단 불변식을 Tier A 72개(15%)만 검사, Tier B 코드 단 없음, USM "완전" | 티어별 최소 사양(Tier B = 요약 + 스니펫/사례 + KU, Tier C = 3단 골격), R-3STAGE로 **469개 전부** 검사, 트랙별 3단 커버리지 KPI, 판정 "부분"(전체 본문 15.4% · lite 25.6% · 골격 59.1%) | FR-CUR-005·026, CNV §6.3·§9.2, UC-03 A5/E1, USM §6 |
| BC-03 | brief-compliance | major | "섹션별 공부"(트랙 한정 세션) FR·UC 없음, FR-CUR-001 UC 미연결 | 세션 범위(전체·경로·트랙·개념 집합), 블록 100% 범위 트랙, 제약 완화 사유 표시, 범위 밖 due 손실 0. UC-33 상세 명세(지도 → 트랙 세션) | FR-STD-032, UC-33, BR-22, ST-A2-16 |
| BC-04 | brief-compliance | major | 실습 희석 무기록: kind 티켓 랩 → 정적 lint, Python 러너 없음(ml/llm 코드 단 불가), 알고리즘 구현·보안 실습 없음, FR-LAB-011이 RC-17 인용 | DEC-CNV-23: RC-17 라이브 kind 랩 v1 제외(DEF-12), SCN-02 v1 범위 한정, FR-LAB-011 trace 정정. DEC-CNV-24: 런타임 JS/TS·SQL만, ml/llm = 예측형 + **빌드타임 Python 오라클**, 런타임 Python DEF-31. DEC-CNV-25: **알고리즘 구현 은행**(목표 40/하한 24, 복잡도 테스트) + **보안 패치 과제**(8/6, 익스플로잇 테스트) Must | FR-LAB-011·014·015·017, DEF-12·14·31, CNV §7.9 SCN-02, USM §5 P1 |
| BC-05 | brief-compliance | major | Product DoD·NFR이 "21종 완료"를 요구하나 Should 모드는 cut 가능 | "UR-14 6개 명명 계열(항상) + 모드 매니페스트 included 모드"로 전부 재작성. `modes.manifest.json`이 E2E 대상을 정한다 | FR-STD-033, DR-028, D-1, NFR-AVL-001, FR-UX-003, NFR-UX-002, NFR-PORT-007, FR-PRG-001 |
| BC-06 | brief-compliance | major | "기타 LLM CLI" 요구 누락(claude·codex·gemini만) | 설정 기반 범용 CLI 어댑터: 인자 배열 템플릿(사용자 텍스트 치환 금지)·stdin·JSON 포인터 추출·zod + repair 1회·안전 호출 4원칙·설정 격리. 수용기준 "모의 임의 CLI를 설정만으로 등록 → probe + 구조화 과업 성공, 코드 변경 0" | FR-AI-024, IR-018, ST-A10-26 |
| BC-07 | brief-compliance | major | 디자인·UX 품질을 토큰·대비 lint로만 검증, 디자인 스킬 참조 미포착, UR-04가 UC에 없음 | 참조 세트(서비스 8 + 디자인 스킬 지침 체크리스트) → SCR-01. INT마다 스크린샷 6차원 루브릭(평균 ≥ 4.0, 차원 < 3 없음). 과업 기반 사용성 5종(입력 상한·막다른 길 0). UR → UC 표에 UR-04 | PR-012·016, NFR-UX-012·013, D-13, UC §7.4 |
| BC-08 | brief-compliance | major | Must 179 FR + 콘텐츠 대량인데 용량 근거 없음, "Must → lite CR" 미정의, 콘텐츠가 cut line 밖 | 코드 169u + 콘텐츠 34cu 재계상. **보장 코어 ≈ 103u**. Must 30개 기능별 lite 사양 표(CNV §7.3, 기반·보안 기능은 lite 없음). 콘텐츠 목표/하한(CNV §9.4). VC-1(INT-1 뒤) 속도 재투영 | PR-011·017, CON-013, CNV §7.2~7.3, USM §4 |
| BC-09 | brief-compliance | major | DR·CON에 수용기준 없음, DR-020 훅이 어떤 게이트에도 없음, FR-CUR-016 스키마가 IT-06에만 | DR-001~028·CON-001~015 수용기준 표 신설. `lint:hooks`를 **PG-2 동결 게이트와 IT-01 DoD**에 추가. FR-CUR-016(스키마)을 IT-01에 명시 | REQ §7.1·§9.1, DR-020, USM §3.4 #9, §4.2 IT-01 |
| BC-10 | brief-compliance | minor | UC 커버리지가 영역 단위 주장, FR 25개 UC 미연결 | FR 단위 커버리지 표 신설, v1.0 미연결 FR + v1.1 신규 FR 29개 전부 연결(스크립트 확인 FR 236/236) | UC §7.3 |
| BC-11 | brief-compliance | minor | FR-SET-008이 IT-04 목록에 없음 | IT-04에 명시. FR·NFR ↔ IT 매핑 검사 스크립트를 PG-3 게이트로(스크립트 확인 FR 236/236 · NFR 93/93) | USM §4.2, PR-018 |
| BC-12 | brief-compliance | minor | graphify `affected`·`god-nodes` 미검증 | 2026-09-30 설치본 `graphify --help`로 `affected`(역방향 탐색)·`god-nodes`·`extract` 존재 확인. 사라질 경우 `path`/`query` + graph.json 역의존 스크립트로 대체 | IR-013, PR-008, PR-014 |
| BC-13 | brief-compliance | minor | 모호 수용기준(척도 없는 0.5, 승급 평가 구성 없음, 주관 [D], 빌드 시 불가능한 텔레메트리) | FR-AI-005 "0~4 척도 기대 점수 ≤ 0.5 + unit 판정 변경 0", FR-PRG-013 "12문항·형식 ≥ 4·보정 엔진만", FR-STD-010 분량 프록시 lint, NFR-UX-005 스크립트 과업 타이머(V-build) + 텔레메트리(V-field) | FR-AI-005, FR-PRG-013, FR-STD-010, NFR-UX-005 |
| BC-14 | brief-compliance | minor | T2 의미 결함 감사 없음, 골드셋이 상위 모델 라벨(순환) | 빌드 시 T2·T3/T4 5% 독립 감사(결함 ≤ 5%). 골드셋은 `model_labeled_draft` → 앱에서 사용자 확정 ≥ 20/과업(또는 확정 10 + 타 계열 리뷰)이어야 `calibrated` | NFR-MAINT-013, FR-AI-014·027, CNV §9.6 V7b |
| BC-15 | brief-compliance | minor | USM §6 과대 "완전" 판정이 RETRO 기준선을 왜곡 | 판정 재작성: 완전 13 · 부분 3 · 조건부 2, 수치와 해소 경로 명시. RETRO-01~03 기준선으로 지정 | USM §6, CNV §7.8~7.9, 본 문서 §3 |
| BC-16 | brief-compliance | minor | 모델 티어 준수를 자기 보고 `tier`로만 확인 | 오케스트레이터·세션 메타데이터의 실제 모델 ID를 INT 보고서에 기록해 교차 검증 | PR-006, CON-011 |

### 1.2 persona-pedagogy-ux (PX, 18건)

| ID | 렌즈 | 심각도 | 이슈 (요지) | 해결 | 변경 ID |
|---|---|---|---|---|---|
| PX-01 | persona-pedagogy-ux | **blocker** | 다기기(회사 Windows + 개인 MacBook)인데 단일 선형 해시 체인·device_id 부재 → 병합 시 체인 깨짐, 동결 후 변경 불가 | 이벤트 envelope에 event_id(ULID)·device_id·device_seq·client_ts·idempotency_key(R0 상세 동결). **기기별 체인 + 병합 체크포인트**. `export --since`/`import --merge`: event_id 합집합(멱등) → (ts, device_id, seq) 리플레이, 순서 무관(교환). 라이브 DB 동기화 폴더 경고 | FR-PRG-001·003, FR-SET-022·025, NFR-DATA-003·011, DR-020·025, DEC-CNV-26, UC-34, BR-24 |
| PX-02 | persona-pedagogy-ux | **blocker** | 승급 도달 불가: 필수 개념 대부분 Tier C, OFFLINE L2→L3 구조적 불가, "w ≥ 0.7"이 곱 w면 Jev 미보정 서술 증거가 영원히 불산입 | 형식 산입 = **w_format ≥ 0.7 ∧ w_grader ≥ 0.6**(DEC-CNV-19) → SP-1 실패해도 Jev 0.7 유효. 필수 = Tier A/B lint. Tier B에 T2 매칭 추가로 OFFLINE 3형식. 경로 트랙 L3 Tier B 24개. SP-6(트랙 × 전이 × AI 모드 × SP-1 결과). SCN-07·P3 판정 "조건부" | FR-PRG-009·013·033, FR-CUR-025, SP-6, CNV §8.3·§9.2 |
| PX-03 | persona-pedagogy-ux | **blocker** | L4/L5 자산이 몇 주 분량, Case 재도전 시 회상화, 런타임 S2 승인자 미정의, 시니어 원형 부재 | Case 파라미터화(`variant_params`·`root_cause_pool`·`best_if`·`contested`) + 미노출 변형 재도전(소진 시 회상 모드 ×0.5). L4+ Tier A 18(lead·arch·sre·sec 12). **시니어 원형 Case 12개 추가**(무중단 스키마 마이그레이션, FinOps 비용 회귀, 키 유출 대응, Build vs Buy, Conway·팀 토폴로지, 개인정보보호법·ISMS-P, 전자금융 망분리 CI, LLM 에이전트 평가 회귀, O(n²) 핫패스, FE 상태 아키텍처, cgroup OOM, 학습-서빙 skew). L4+ 1차 출처 span 필수·이견은 best 복수 + 조건. **런타임 S2** = 타 계열 high tier 교차 판정 + 출처 검증 + 사용자 승인. 개인 Case 파운드리 lite를 v1으로 | FR-CUR-016·021·022, FR-STD-034, FR-QST-004, CNV §9.3·§9.5, DEF-11 |
| PX-04 | persona-pedagogy-ux | major | 빠른 추측을 오답일 때만 w 0 → 찍기 기대값이 항상 이득 | 형식별 t_min(글자 수 비례, 200응답 후 개인화)보다 빠르면 **정오 무관 w 0**, FSRS 추천 Hard 이하, GR-04를 rapid 비율로. 무작위 찍기 에이전트 θ 상승 ≤ 0.02 | FR-QST-025, BR-17, GR-04, DEC-CNV-33 |
| PX-05 | persona-pedagogy-ux | major | 재인·생산 형식 혼합 카드로 FSRS S·D 오염, 파라미터 개인화·leech·retire 없음 | 카드 키 = (개념, facet, **response_mode**). 추천 grade 형식 정규화(recognition ≤ Good). leech(lapse ≥ 8) → 진단 제안. suspend/retire(이벤트, 원장 불변, 경로 밖 트랙 은퇴 제안). FSRS 개인화(Should, WASM 또는 선택적 Python, 리플레이 비교 후 승인) | FR-PRG-004·007·029~031, DEC-CNV-34 |
| PX-06 | persona-pedagogy-ux | major | 습관 루프(주간 목표·일시정지·복귀·백업)가 INT-7 — RETRO-01이 없는 기능으로 습관 검증 | FR-PRG-020(최소)·021·022, 일일 상한 스로틀, 주간 리뷰 lite, 백업을 **R1(INT-2~3)**로. RETRO-01 확인 항목 조정 | FR-PRG-018·020~022, FR-DSH-009, FR-SET-004, DEC-CNV-36, USM §4.3 |
| PX-07 | persona-pedagogy-ux | major | 매일 터미널·자동 포트·기동마다 재인증 → 이탈 1순위 | 선호 고정 포트 + 폴백 안내, `fathom open`(1회용 부트스트랩 URL), **HttpOnly·SameSite=Strict 세션 쿠키**(재기동·다중 탭 유지, Host·Origin·CSRF 헤더 검증, ADR), PWA, OS 로그인 자동 기동(Should). 수용기준 "앱 기동 상태에서 재기동 후 북마크 → 입력 0" | FR-SET-001·023·024, NFR-SEC-019, DEC-CNV-29, UC-36 |
| PX-08 | persona-pedagogy-ux | major | 페르소나 시간 예산 30~50%가 폰 채널인데 제품은 127.0.0.1 전용, SCN-01 "지하철 MacBook" 비현실 | **(a) 채택**: v1은 노트북·데스크톱 전용임을 명시하고 SCN-01 v1 범위를 재정의. 오프라인 응답 재수입 계약(client_ts·device_id·idempotency_key)은 R0 동결. LAN 페어링(QR 토큰 + 자체서명 TLS + 응답 전용 API)은 v1.x DEF-32(NG-09 재검토 ADR). 01-actors의 SCN-01 서술은 CNV §7.9 판정이 우선한다 | DEC-CNV-27, NFR-DATA-003, DEF-32, CNV §4.9 NG-09·§7.9 |
| PX-09 | persona-pedagogy-ux | major | "야간 배치"가 노트북에 없음, 구독 CLI 배치가 업무 한도 잠식, 대량 작업 승인 없음 | 배치 창 = 앱 실행 + 입력 유휴 ≥ 10분 + AC 전원. 구독 쿼터 예산(5시간 창·주간), 사용자 CLI 대화형 사용 감지 시 일시정지. 대량 작업(호출 > 50·₩1,000·쿼터 20%) 미리보기·승인. 비용 화면에 과금/구독 분리. Tier C 보강은 제안 | FR-AI-007·010·025·026, FR-CUR-010, BR-25 |
| PX-10 | persona-pedagogy-ux | major | 주 1회·같은 디스크 백업, RPO 8일, R3, import 2MB 제한과 충돌 | 일 증분 JSONL + 주 epoch 스냅샷, **사용자 지정 2차 대상**·선택 암호화(AES-256-GCM + scrypt), 미설정 배너, **R1**. RPO ≤ 26시간. NFR-SEC-014 범위 분리(2MB는 개념 가져오기만, import·restore는 스트리밍 + 해시 검증) | FR-SET-004~006, NFR-AVL-004, NFR-SEC-014, NFR-DATA-012 |
| PX-11 | persona-pedagogy-ux | major | 상류 팩 주체 없음, 사용자 수정 v1.x → 신고 루프·SCN-12 성립 불가 | **불변 시드 + 사용자 오버레이**(패치 이벤트, 팩 업그레이드 시 재적용·충돌 diff) v1 Must. `fathom pack refresh <track>`(사용자 CLI 구독으로 로컬 파이프라인, Should). 신고 → 오버레이 수정 → 재게이트. 3-way 병합 Deprecated | FR-CUR-020·023, FR-QST-016, DEC-CNV-35, DR-026, UC-17·18 |
| PX-12 | persona-pedagogy-ux | major | 정보처리기사·CKA 목표에 블루프린트 자산 없음 | 공식 출제기준만 쓰는 블루프린트(하한: 정보처리기사 필기·CKA, 목표: + 실기) → concept 매핑·가중치, `cert:` 태그, D-day 가중 커버리지 %, 기출 복제 금지 | FR-CUR-024, FR-PRG-019, DR-027, UC-20, ST-A9-22 |
| PX-13 | persona-pedagogy-ux | minor | 한국어 타이포 규칙이 REQ에 없음, NFR-UX-009 Should·R3 | NFR-UX-009 **Must·R0**: keep-all·측정폭 토큰·text-wrap·행간·자간·한글 이탤릭 금지·tabular-nums lint | NFR-UX-009, ST-X-12 |
| PX-14 | persona-pedagogy-ux | minor | 타이머·지연 grade·도식 대체·단일 키 단축키 접근성 | 타이머 끄기·연장(WCAG 2.2.1), 지연 기반 grade off, 도식 텍스트 대체 lint, 입력 포커스 중 단일 키 비활성·재매핑(WCAG 2.1.4) | NFR-UX-014, FR-STD-018, FR-PRG-007, FR-UX-003, FR-CUR-005 |
| PX-15 | persona-pedagogy-ux | minor | 엔트로피 2.3·쿼터·Wildcard 강제가 10~15분 시니어에게 과도 | H_min = min(2.3, 0.8·log2(min(k, B))), L4+·사용자 설정 시 쿼터·Wildcard는 제안, 마이크로 판단 포맷(조건 반전 1쌍·결정점 1개) | FR-STD-003·009·035, GR-03, CNV §5.3·§5.4 |
| PX-16 | persona-pedagogy-ux | minor | 12문항 Brier 표시는 잡음·지표 피로 | 이동 창 응답 ≥ 30일 때만 수치, 세션 리포트는 "고확신 오답 N건" | FR-PRG-023, FR-DSH-008 |
| PX-17 | persona-pedagogy-ux | minor | E3가 규정 위반을 유도, Node 22 EOL·`node:sqlite` experimental | E3 = "승인된 반입 또는 개인 오프라인 기기", 반입 승인 체크리스트, 런타임 동봉 번들 옵션, LTS 매트릭스(V-ci)·SqlitePort·doctor EOL 경고 | FR-SET-013·026, NFR-PORT-009, CNV §7.9 E3 |
| PX-18 | persona-pedagogy-ux | minor | T2 문형 반복 → 패턴 암기 | `stem_family`(이름 훅), 개념당 문형 ≥ 3계열, 문형 단위 30일 로테이션, 문형 암기 신호 | FR-QST-006·014, DR-020 |

### 1.3 feasibility-readiness (FE, 17건)

| ID | 렌즈 | 심각도 | 이슈 (요지) | 해결 | 변경 ID |
|---|---|---|---|---|---|
| FE-01 | feasibility-readiness | **blocker** | 360개 요구·148u에 용량 모델 없음, 콘텐츠 26건 = 8u, 시뮬레이터·SI 문서 미계상, INT-1 과적 | BC-08 해결 + **INT-1을 1a(스캐폴드·계약·게이트·툴체인 7u) / 1b(관통 루프 9u)로 분할**, 시뮬레이터 3u·SI 문서 자동 생성 1u 계상, SI 문서는 테스트 ID에서 RTM 추출 등 자동화 | CNV §7.2·§7.3, USM §3.2·§4.1, PR-017, DEC-CNV-32 |
| FE-02 | feasibility-readiness | **blocker** | 3 OS·3 엔진·실제 AI를 게이트로 요구하나 컨테이너는 Linux + Chromium, 키 없음, `claude`만 | **검증 등급** V-build(게이트)·V-ci·V-live·V-field와 예외 표, Product DoD D-1~D-14를 V-build로 재작성, synthetic cassette는 형상 적합성만 주장, 빌드 환경 제약 CON-015 | REQ §1.7, CON-015, CNV §7.7, DEC-CNV-31, DR-028 |
| FE-03 | feasibility-readiness | **blocker** | 명세대로 격리 불가(net 미차단·힙 밖 메모리·`ATTACH` 우회), 코드 출처 위협 모델 없음 | 코드 출처 정책(학습자·저작 시드·T1만 실행, 가져온·LLM 코드 금지). 러너 = 전용 자식 + `--permission` + preload 모듈 차단(net·dgram·dns·http(s)·http2·tls·inspector·child_process·worker_threads) + RSS 감시 256MB 트리 kill(+ `prlimit` 보조). SQL = 토크나이저 allowlist + 러너 자식 `:memory:` + `allowExtension:false`(authorizer 부재 실측). SP-2 기준 = 차단 목록 ≥ 20종 실패 + RSK-RUN. Docker `--network none` 선택 | FR-LAB-001·002·016, NFR-SEC-006, SP-2, BR-20 |
| FE-04 | feasibility-readiness | major | 시드 분량 과다, copy-guard 원문 부재, 교차 모델 리뷰 불가, 콘텐츠가 코드 INT 차단 | 목표/하한 분리(하한 20cu), R1 최소(Tier C + A ≥ 24 + B ≥ 40), V3 범위(가져온 콘텐츠 + 캐시 원문), V7 = 다른 컨텍스트·프롬프트·상위 티어 독립 리뷰, 골드셋 draft, **콘텐츠 미달은 INT 경보(차단은 D-11 하한만)** | FR-CUR-009, CNV §9.4·§9.6, FR-AI-027 |
| FE-05 | feasibility-readiness | major | S2 게이트 vs V7 시드 출제 규칙 모순 → OFFLINE 문항 0 또는 게이트 무력화 | `gate_status` 상태기계(`seed_reviewed` = 모든 모드 출제, `deferred` = 출제 안 함), 저작 시드는 V7 레코드를 S2 승인으로 인정, 재게이트 탈락 = 보정 이벤트(G3 → 증거 무효, G5 → ×0.5) | FR-QST-009·011, BR-19, CNV §9.6 V8 |
| FE-06 | feasibility-readiness | major | OFFLINE에서 D4(L3 승급)·Deepened 불가, Tier B는 형식 3개 불가 | D4·D5 결정적 MCQ 변형, Case 결정점 D 점수 가중 ≥ 60%, T2 매칭, `mastery_rules@v1` AI 모드 프로파일 + 잠정 판정, SP-6 도달 가능성 매트릭스 | FR-STD-020·025, FR-PRG-013·033, SP-6 |
| FE-07 | feasibility-readiness | major | 서비스별 SQLite로 원자적 쓰기 불가, 리플레이가 assessment 입력 필요, 백업 시점 불일치 | ARC 동결 조건: 단일 writer = learning, transactional outbox + Idempotency-Key, 리플레이 입력 내장(원장 자급), 슈퍼바이저 조율 epoch 백업, content + assessment 병합 검토 | NFR-DATA-012·013, FR-PRG-001, FR-SET-004, CNV §12.1, §4 AQ-01·02 |
| FE-08 | feasibility-readiness | major | 기밀 판정을 외부 Jev에 보냄(7일 캐시) = 그 자체가 유출 | Firewall **로컬 판정 전용**(정규식·사용자 패턴·선택적 Ollama), Jev 포함 외부 호출은 통과 페이로드만, Jev를 외부 처리자로 로그 표시·캐시 고지. v1.0 Jev 기밀 판정 Deprecated | FR-AI-019, BR-21, CNV §8.1·§8.2, DEC-CNV-28 |
| FE-09 | feasibility-readiness | major | `claude -p`가 사용자 hooks·MCP·플러그인·CLAUDE.md를 로드 | Claude Code 2.1.285 `--help` 실측 후보: `--safe-mode`, `--strict-mcp-config` + 빈 `--mcp-config`, `--setting-sources` 최소화, `--disable-slash-commands`, `--tools ""`, `--no-session-persistence`. `--bare`는 키체인 읽기를 건너뛰어 구독 인증과 충돌 → 제외. canary hook 계약 테스트, env allowlist, codex `CODEX_HOME` ADR | NFR-SEC-005·020, IR-005·006, SP-8 |
| FE-10 | feasibility-readiness | major | stdin 전달 요구와 `security -w` argv 충돌, KEK 출처 없음, env 우선 | 키체인 > 암호 파일 > env(경고). macOS `security -i`(명령을 stdin), Linux `secret-tool store`(stdin), Windows DPAPI(stdin). KEK = passphrase(scrypt) 또는 OS 바인딩 무작위 KEK, 위협 모델 ADR, "ps 출력 비밀 0" 테스트 | NFR-SEC-004, IR-010, AQ-06 |
| FE-11 | feasibility-readiness | major | R2/R3 계약·추측성 훅 13종 상세 동결 → 늦은 결함·ADR 폭증 | **2단 동결**(아키텍처·R0/R1 상세, R2/R3 개요), 이름 훅(식별·불변성·v1 사용분)과 `ext` JSON 분리, 가산 변경 = CR 로그 / 파괴 변경 = ADR | NFR-MAINT-006, DR-020, CNV §7.4, DEC-CNV-30 |
| FE-12 | feasibility-readiness | major | [A] 기준에 필요한 시뮬레이터·합성 로그·평가셋·LDI 초기값 없음, REF-ENV 관계 미정 | 시뮬레이터 + 합성 로그 생성기 R0 도구(3u), 평가셋(검색 120·정규화 200·SSRF 20·주입 30·비밀 50·비식별화 30)을 DCP-01 제작 항목으로, 컨테이너 기준 측정·REF-ENV는 참고, `ldi_params@v1` 초기값 부록 | NFR-MAINT-012, REQ §1.7·§12.5, CNV §9.4 |
| FE-13 | feasibility-readiness | minor | trigram은 3자 미만 질의 불가(캐시·해시·락·큐) | 3자 미만 → `LIKE` 스캔, 초성 인덱스, 순위 병합 규칙, 2음절 평가 20질의 | FR-CUR-011 |
| FE-14 | feasibility-readiness | minor | TS 7에서 컴파일러 API 기반 도구 불확실 | SP-7: Biome(GritQL)·정규식·graphify 엣지 PoC, 실패 시 도구 전용 TS 5.9/6.x pin | SP-7, PR-014, AQ-14 |
| FE-15 | feasibility-readiness | minor | SPA 토큰 획득 방식 미정의(CSRF가 Host·CORS에만 의존) | Jupyter식 1회용 부트스트랩 URL → POST 교환 → 쿠키, 교차 출처 획득 불가 테스트 | NFR-SEC-019, FR-SET-023 |
| FE-16 | feasibility-readiness | minor | Windows npm shim spawn(EINVAL) | shim 해석 규칙(npm 9·10·11 fixture), 실패 시 라우트 비활성 + doctor, Windows = V-ci | NFR-PORT-004 |
| FE-17 | feasibility-readiness | minor | OFFLINE 학습 가능 개념 172/469, lead Tier A 1 | 트랙별 OFFLINE 학습 가능 ≥ 4(하한)·≥ 5(목표), Tier C 골격 시각 구분, cap 표·팩 증분 로드맵, lead Tier A 4 | FR-CUR-009·025·026, CNV §9.3 |

---

## 2. 결정 요약 (PLN-CNV-01 §10 DEC-CNV-19~36)

| DEC | 결정 | 리뷰 |
|---|---|---|
| DEC-CNV-19 | 숙달 형식 산입 = w_format ≥ 0.7 ∧ w_grader ≥ 0.6 | PX-02, FE-06 |
| DEC-CNV-20 | 필수 개념 = Tier A/B, 희소 레벨 규칙, 트랙 cap 공개 | BC-01, PX-02 |
| DEC-CNV-21 | L4→L5 기준 정의, F06 산출물 Must 승격 | BC-01 |
| DEC-CNV-22 | Tier A 재배분(L4 12·L5 6), Case 30/12 파라미터화, 산출물 12, 목표/하한 | BC-01, PX-03, FE-04 |
| DEC-CNV-23 | RC-17 라이브 kind 랩 v1 제외, SCN-02 범위 한정 | BC-04 |
| DEC-CNV-24 | 런타임 러너 JS/TS·SQL, ml/llm 빌드타임 Python 오라클, 런타임 Python v1.x | BC-04, FE-03 |
| DEC-CNV-25 | 알고리즘 구현 은행·보안 패치 과제 v1 Must | BC-04 |
| DEC-CNV-26 | 다기기: ULID·device_id·기기별 체인·병합 import | PX-01 |
| DEC-CNV-27 | v1은 노트북·데스크톱 전용 명시, 재수입 계약 R0 동결, LAN 페어링 v1.x | PX-08 |
| DEC-CNV-28 | Privacy Firewall 로컬 판정 전용 | FE-08 |
| DEC-CNV-29 | 선호 고정 포트 + 1회용 부트스트랩 + HttpOnly 쿠키 + PWA | PX-07, FE-15 |
| DEC-CNV-30 | 2단 동결 + 이름 훅/`ext` + 가산 CR·파괴 ADR | FE-11 |
| DEC-CNV-31 | 검증 등급, Product DoD = V-build | FE-02 |
| DEC-CNV-32 | 코드 169u + 콘텐츠 34cu, 보장 코어 103u, Must lite, INT-1a/1b, VC-1 | BC-08, FE-01 |
| DEC-CNV-33 | 빠른 응답 정오 무관 w 0 | PX-04 |
| DEC-CNV-34 | 카드 키에 response_mode, grade 정규화, leech·retire, FSRS 개인화 | PX-05 |
| DEC-CNV-35 | 불변 시드 + 사용자 오버레이, pack refresh, 3-way 병합 Deprecated | PX-11 |
| DEC-CNV-36 | 습관 루프·백업 R1 앞당김 | PX-06, PX-10 |

---

## 3. 최종 UR 커버리지 매트릭스 (UR-01 ~ UR-18)

> **판정 기준**: 완전 = v1 범위에서 요구 전부 충족 · 부분 = 핵심 충족, 수치로 표시한 갭 잔존 · 조건부 = 명시한 검증(스파이크·속도)에 달림. 이 표는 RETRO-01~03의 기준선이다(USM §6과 동일, 요약형).

| UR | 요구 (요지) | 대응 FR / NFR / PR (대표) | 상태 | 잔여 갭 · 해소 경로 |
|---|---|---|---|---|
| UR-01 | 전 분야 섹션별 공부 | FR-CUR-001·009·011·018·019·025·026, FR-STD-032, FR-STD-014·023, FR-LAB-001·002·010~017, FR-DSH-003, NFR-PORT-007 | **부분** | 지도 469·트랙 한정 세션 완전. OFFLINE 학습 가능 개념 목표 192/469(41%), 하한 트랙당 ≥ 4 → 팩 증분. 라이브 kind 랩 DEF-12, 런타임 Python DEF-31 |
| UR-02 | 복수 방법론·가상 액터·요구 분석·아키텍처/데이터 수집 계획 선행 | PR-001·002·003·013, DR-023 | 완전 | 본 리뷰로 적대적 검증 완료. DCP-01은 설계 단계 |
| UR-03 | 개발 → 검증/보완 → 통합, 회고 | PR-005·009·015·017·018, NFR-MAINT-004·009·012, FR-DSH-009·012, FR-CUR-026 | 완전 | VC-1 + RETRO 3회, 기준선 = 이 표 |
| UR-04 | 디자인 스킬·웹서비스 참고, 최신·세련된 디자인 | PR-012·016, FR-UX-001~016, NFR-UX-001~014, FR-DSH-001·003·004 | 완전 | 시각 품질은 INT별 T1 루브릭 판정(주관 요소 잔존, D-13) |
| UR-05 | 아키텍처 확정 후 개발, 순서 불변 | PR-003·004·014, CON-010, NFR-MAINT-006, DR-020, NFR-DATA-013, FR-CUR-016·017, FR-SET-018 | 완전 | `lint:hooks` PG-2 게이트 |
| UR-06 | 코드 = 하위 모델, 기획·논의 = 상위 모델 | PR-006, CON-011 | 완전 | 모델 ID 교차 검증 |
| UR-07 | SI 산출물 활용 | PR-007·013, NFR-MAINT-010·011, NFR-SEC-015, FR-CUR-015, FR-STD-023·026, FR-LAB-015, FR-UX-002 | 완전 | |
| UR-08 | 서비스별 분리 | CON-004, NFR-MAINT-001~003, NFR-DATA-013, FR-SET-001·002, NFR-AVL-002·003·006, IR-015 | 완전 | 서비스 수 ARC 확정(AQ-01) |
| UR-09 | graphify로 구조 파악·작업 흐름 탐색 | PR-008, NFR-MAINT-001, IR-013 | 완전(프로세스) | 명령 실측 확인. 제품 내 Repo Lens는 v1.x DEF-01 |
| UR-10 | 이론 → 코드 → 핵심 | FR-CUR-005~008·026, FR-STD-008·010, FR-LAB-003·007·017, FR-IMP-011 | **부분** | 불변식 469 전부. 전체 본문 72(15.4%) · lite 120(25.6%) · 골격 277(59.1%) → 팩 증분·Tier C 승격 |
| UR-11 | 초급 ~ 전문가 | FR-PRG-008~014·028·032·033, FR-CUR-025, FR-STD-007·008·017·025·026·034·035, FR-UX-006·015, FR-DSH-002 | **조건부** | 규칙 L1→L5 완비. cap L5 13 · L4 6(alg·cs·net·lang·fe·linux). OFFLINE 승급은 잠정. **SP-6 통과가 조건** |
| UR-12 | 15년차 이상 전문가까지 | FR-PRG-001~003·016~018·029~031, FR-STD-027·034, FR-CUR-004·013·014·020~023, FR-SET-004~007·022·025, FR-DSH-005·014, NFR-DATA-001~013, NFR-PERF-005·011, NFR-PORT-009 | **부분** | 데이터 수명 완전. 전문가 콘텐츠 장기 공급은 L4+ Tier A 18·Case 22·산출물 12 + 변형 재도전 + 사용자 로컬 파이프라인 의존. 자동 신선도 감시 v1.x |
| UR-13 | 양질의 문제 생성·개념 가져오기 | FR-QST-001~016, FR-IMP-001~014, FR-CUR-010·020·021·023, FR-STD-029, FR-AI-016·027, NFR-AVL-010, NFR-DATA-009, NFR-MAINT-013 | 완전 | |
| UR-14 | 개념이해·실습·문제·디깅·OX·백지노트, 질리지 않게 | FR-STD-001~035, FR-CUR-007, FR-LAB-001~017, FR-QST-025, FR-PRG-022 | 완전(6계열) | 21종 카탈로그 중 Should 모드는 cut 가능(매니페스트) |
| UR-15 | 로컬, API·codex/claude/기타 LLM CLI | FR-AI-001~004·006~010·019·021~026, FR-SET-008·012·013·023·024·026, IR-001~008·010·014·018, NFR-AVL-001, NFR-SEC-001·004·005·020, NFR-PORT-001~009 | 완전 | 폰 채널 v1.x(DEF-32) |
| UR-16 | 분석·판단에는 Jev | FR-AI-005·011~014·018·027, FR-QST-017·019, FR-STD-019·020·022~025, FR-IMP-005·006·008·014, IR-008, CON-003 | 완전 | 한국어 품질 = SP-1(V-live) + 사용자 확정 골드셋 |
| UR-17 | 기능성·운영성·UI/UX | FR-SET-001~026, NFR-AVL-001~012, FR-AI-007·008·015·021·025·026, NFR-DATA-011·012, FR-UX-*, NFR-UX-* | 완전 | |
| UR-18 | 계획·검증 후 바로 코드, 한 번에 완료 | PR-010·011·017·018, CON-013·015 | **조건부(계획)** | 169u + 34cu, GC 103u, Must lite·콘텐츠 하한 사전 정의, **VC-1 재투영** |

**집계**: 완전 13 · 부분 3 · 조건부 2 (18/18 대응).

---

## 4. 아키텍처 단계로 이관한 미결 질문

> **결정 주체 = 아키텍처 단계**(ARC-01 아키텍처정의서 · IF-01 인터페이스정의서 · DB-01 데이터베이스설계서 · DCP-01 데이터 수집 계획 · SCR-01 화면설계서 · STD-01 개발표준정의서 · TST-01 테스트계획서). 모두 PG-2(설계 동결) 이전에 결정하며, 결과는 파라미터·어댑터·플래그 수준에서만 기획 기준선을 바꾼다(UR-05).

| AQ | 질문 | 기획 단계 권고 | 결정 주체 (아키텍처 단계) | 기한 |
|---|---|---|---|---|
| AQ-01 | `content`와 `assessment`를 병합해 서비스 수·홉을 줄일 것인가 (REQ Q-7) | 병합 검토. 어느 경우든 러너는 별도 자식 프로세스 풀, 증거 단일 writer = `learning` | ARC-01 | PG-2 |
| AQ-02 | 서비스 간 상태 전파(API 조회 vs 이벤트 알림)와 transactional outbox 구현 방식 (Q-3) | learning 원장 + outbox 테이블 + SSE 알림, Idempotency-Key 필수 | ARC-01 · IF-01 | PG-2 |
| AQ-03 | 디깅·Feynman·Case 대화 상태기계 소유 (Q-1) | 턴 판정·루브릭 = assessment(또는 병합 서비스), 세션 상태·재개 = learning | ARC-01 | PG-2 |
| AQ-04 | 브라우저 세션: HttpOnly 쿠키 vs sessionStorage + BroadcastChannel (Q-8) | 쿠키 + Host·Origin·CSRF 헤더(NFR-SEC-019 v1.1), ADR로 확정 | ARC-01 · IF-01 | PG-2 |
| AQ-05 | CLI 격리 플래그 최종 조합, codex `CODEX_HOME` 격리 (Q-10) | canary hook 계약 테스트로 결정(SP-8) | IF-01 | PG-2(모의) / 첫 V-live |
| AQ-06 | API 키·KEK 저장 OS별 절차와 위협 모델 (Q-5) | 키체인 > 암호 파일 > env, stdin 전달, KEK 평문 동일 디스크 금지 | ARC-01(ADR) | PG-2 |
| AQ-07 | FSRS 파라미터 최적화 구현: 순수 WASM vs 선택적 Python (Q-9) | WASM 가용성 확인 `[검증 필요]`, 없으면 Python(uv) | ARC-01 | IT-07 전 |
| AQ-08 | 선호 고정 포트 기본값 (Q-11) | 4747 `[추정]` | ARC-01 | PG-2 |
| AQ-09 | 러너 풀 구조(프리포크 vs 요청당 spawn), OS별 RSS 감시 구현, `prlimit` 가용성, Node 권한 모델 fs 읽기 allowlist | SP-2 결과로 결정, 요청당 spawn을 기본으로 p95 ≤ 1.5s 확인 | ARC-01 (SP-2) | PG-2 |
| AQ-10 | `ext` 컬럼 형식(JSON text + `schema_version`)과 이름 훅 인덱스 | 엔티티마다 `ext TEXT CHECK(json_valid(ext))` + 버전 | DB-01 | PG-2 |
| AQ-11 | 정책 파일(`method_policy`·`mastery_rules`(AI 모드 프로파일)·`ldi_params`·`gaming_params`) 저장 위치와 초기값 | 콘텐츠 팩과 분리된 `policy/` 버전 파일, 초기값 = REQ 부록 A + SP-3·SP-6 결과 | ARC-01 (SP-3·SP-6) | PG-2 |
| AQ-12 | v1.1 신규 화면(트랙 범위 진입, 오버레이 편집, 블루프린트 커버리지, 병합 마법사, 대량 작업 승인 다이얼로그)을 기존 18화면에 흡수할지 | 기존 화면의 패널·다이얼로그로 흡수(화면 수 18 유지 목표) | SCR-01 | PG-2 |
| AQ-13 | 공식 출제기준(Q-Net 정보처리기사, CNCF CKA curriculum) 입수 경로와 판본 기록 — 프록시가 일부 도메인을 막음 | CNCF는 GitHub 저장소, Q-Net은 사용자 제공 파일 또는 수동 입력 | DCP-01 | IT-07 콘텐츠 cu 전 |
| AQ-14 | TS 7 세대 정적 게이트 구현 방식 | SP-7 PoC, 실패 시 도구 전용 TS 6.x pin | STD-01 | INT-1a G1 전 |
| AQ-15 | V-ci 워크플로 범위(3 OS × 3 엔진 × LTS 2)와 V-live 스모크 목록 | TST-01에 등급별 스위트 분리 | TST-01 | PG-2 |
| AQ-16 | PWA 서비스 워커 범위(앱 셸만)와 127.0.0.1 origin·포트 폴백 시 설치 유지 | 선호 포트 고정이 전제, 폴백 시 재설치 안내 | ARC-01 · SCR-01 | IT-03 전 |
| AQ-17 | 알고리즘 복잡도 테스트의 시간 예산을 러너 p95 편차에 강건하게 잡는 방법 | 입력 크기 비율 대비 시간 비율(로그 기울기) 판정 | TST-01 · DCP-01 | IT-05 전 |

---

## 5. Planning Baseline v1.0 — 서명

> 이 절이 **동결된 기획 범위**다. 아키텍처 단계(ARC·IF·DB·DCP·SCR·STD·TST)는 이 기준선만을 입력으로 쓰며, 기준선 변경은 CR(가산적 변경) 또는 ADR(파괴적 변경)로만 한다.

### 5.1 기준 문서

| 문서 | ID | 버전 | 상태 |
|---|---|---|---|
| `00-brief/project-brief.md` | BRIEF | — | 원천(불변) |
| `01-planning/01-actors-personas.md` | PLN-ACT-01 | v1.0 | Frozen (SCN-01·E3 서술은 PLN-CNV-01 §7.9 v1.1 판정이 우선) |
| `01-planning/02-ideation/*` | DES·JTB·SCA·SIX·LEA·PED·MOR | v1.0 | Frozen (JTB DO-07 "과충족" 판정은 DEC-CNV-27로 정정) |
| `01-planning/03-convergence.md` | PLN-CNV-01 | **v1.1** | Frozen |
| `01-planning/04-requirements-spec.md` | REQ-01 | **v1.1** | Frozen |
| `01-planning/05-use-cases.md` | UC-01 | **v1.1** | Frozen |
| `01-planning/06-user-story-map.md` | USM-01 | **v1.1** | Frozen |
| `01-planning/07-planning-review.md` | PLN-REV-01 | v1.0 | Frozen |

### 5.2 제품

| 항목 | 기준선 |
|---|---|
| 제품명 | **Fathom · 깊이** (한글 표기 패덤, 앱 제목 `Fathom 깊이`) |
| 슬로건 | 깊이는 증거로 남는다. — *Prove your depth.* |
| 정체성 | 로드맵 위에서 증거로 증명되는 깊이, 15년 동안 함께 자라는 **로컬 우선 개발 공부 OS** |
| CLI · 데이터 | `fathom` (`up / down / status / open / doctor [--fix] / backup / restore / export [--since] / import [--merge] / capture / seed / pack refresh / autostart`) · `~/.fathom`(Windows `%APPDATA%\fathom`, `FATHOM_HOME`) |
| North Star | **LDI** = `Σ w_k · d(L_k) · R_k(t) · E_k · F_k` (d: 1/2/3/5/8, 초기값 REQ 부록 A). 홈은 형태만, 숫자는 주간 리뷰·시즌 회고 |
| 사용 채널 | 개인 노트북·데스크톱(Windows·macOS·Linux), 127.0.0.1 전용. 다기기는 파일 병합. 폰 채널은 v1.x |

### 5.3 학습 모드 (UR-14)

- **UR-14 6개 명명 계열(항상 포함)**: 개념이해(M-01 3단 레슨, M-02 프리테스트) · 실습(M-10 코드 과제·알고리즘 은행·보안 패치, M-11 카타, M-12 인프라 lite, M-17 PR 리뷰) · 문제(M-04~M-09, M-16, M-18) · 개념 디깅(M-14, M-15) · OX(M-03) · 백지노트(M-13, M-21).
- **카탈로그 21종**: M-01 3단 레슨 · M-02 프리테스트 · M-03 OX 스프린트 · M-04 문제 믹스 · M-05 코드 읽기 · M-06 오류 찾기 · M-07 헷갈림 쌍 · M-08 페르미 · M-09 조건 반전 쌍 · M-10 코드 과제 · M-11 카타 · M-12 인프라 lite · M-13 백지노트 · M-14 디깅 · M-15 Feynman · M-16 AI 답안 감사 · M-17 PR 리뷰 · M-18 역출제 · M-19 Case · M-20 산출물(**Must**) · M-21 과거의 나. 릴리스 포함 여부는 `modes.manifest.json`이 정한다.
- **수식어 5종**: ◆보스 · ◆검증 받기 · ◆약점 드릴 · ◆깊이 당김 · ◆Wildcard. **v1.1 추가 포맷**: 마이크로 판단(조건 반전 1쌍·결정점 1개, Should).
- **반지루함**: 2단 스케줄러, 형태학적 거리, 변주 예산, 엔트로피 가드 H_min = min(2.3, 0.8·log2(min(k, B))), 난이도 파도·성공 마무리, 역할 반전, 과거의 나, 문형 로테이션, 보상 금지 목록(NG-G1~G7).

### 5.4 트랙과 레벨

| 항목 | 기준선 |
|---|---|
| 트랙 | 코어 19: alg · cs · net · lang · fe · be · db · linux · docker · k8s · cicd · sre · cloud · sec · ml · llm · arch · eng · lead + 확장 `data`. 트랙군 6: 기초(alg·cs·net·lang·linux) · 앱(fe·be·db) · 인프라(docker·k8s·cicd·sre·cloud) · 보안(sec) · AI(ml·llm) · 설계·리더십(arch·eng·lead) |
| 개념 | 469 (Tier A 72 · Tier B 120 · Tier C 277 목표 / 하한 A 40 · B 60 · C 나머지). 모든 개념은 3단(티어별 최소 사양) |
| 레벨 | L0 미진입 · L1 입문 · L2 실무 기초 · L3 독립 수행 · L4 설계·판단 · L5 전문가(가르치기·표준 수립). 트랙 단위, 강등 없음(녹슴 표시) |
| 숙달 | P ≥ 0.80 ∧ 형식 F ≥ 3(w_format ≥ 0.7 ∧ w_grader ≥ 0.6) ∧ 서로 다른 날 ≥ 2 |
| 승급 L1→L4 | 필수 개념(Tier A/B) ≥ 85% Mastered(희소 레벨 규칙) + 12문항 평가 CBM ≥ 70% + (L2→L3 D4 개념 ≥ min(5, 가능 수)·최소 2) + (L3→L4 Case ≥ 2.5/4) |
| 승급 L4→L5 | L4 필수 Mastered∧Retained + L4+ Case 2개 ≥ 3.0 + (Taught ≥ 2 **또는** 산출물 2개 ≥ 3.0 + 반박 방어) + CBM ≥ 75% |
| OFFLINE | 대체 증거(D4 MCQ·결정점 D·T2 매칭), 자기채점뿐인 판정은 잠정(AI 복귀 후 확정·철회, 강등 없음) |
| 트랙 cap (목표) | **L5**: be · db · docker · k8s · cicd · sre · cloud · sec · ml · llm · arch · eng · lead (13) / **L4**: alg · cs · net · lang · fe · linux (6). 하한 시 실측 cap을 D-11로 게시, 전 트랙 ≥ L3 보장 |

### 5.5 v1 범위

| 항목 | 기준선 |
|---|---|
| 수렴 기능 | 65개 (Must 47 · Should 18) — v1.x 23 · v2 6(보류, 스키마 훅/`ext` 보유) |
| 요구 | **408**: FR 236(Must 203 · Should 33) · NFR 93 · DR 28 · IR 18 · CON 15 · PR 18. 보류 DEF-01~32 |
| 유스케이스 · 스토리 | UC 36(상세 11) · 업무 규칙 BR-01~25 · 스토리 168 |
| 서비스(가칭, ARC 확정) | web · gateway · content · assessment · learning(증거 단일 writer) · ai-gateway · ops(supervisor). content + assessment 병합 검토(AQ-01) |
| 콘텐츠 | 목표/하한: Tier A 72/40 · Tier B 120/60 · Case 30/12 · 산출물 12/6 · 알고리즘 구현 40/24 · 보안 패치 8/6 · 조건 반전 쌍 30/15 · 카타 24/12 · 저작 문항 1,464/780 · 블루프린트 3/2 · 골드셋 60(+변형 100, 사용자 확정 후 calibrated) |
| 용량 | 코드 **169u**(Must 136 · Should 33) + 콘텐츠 **34cu**(하한 20). **보장 코어 ≈ 103u** |
| 반복 | INT-1a/1b(R0 16u) → VC-1 → INT-2~3(R1 53u) → RETRO-01 → INT-4~5(R2 50u) → RETRO-02 → INT-6~7(R3 50u) → RETRO-03(INT-6 뒤) → Product DoD |
| cut 순서 | ① Should 이월 ② Must lite 전환(사전 정의 30개 기능) ③ 콘텐츠 목표 → 하한. 불가침: 보장 코어·UR-14 6계열·R0 스키마 |
| v1 제외(명시) | 라이브 kind 랩(DEF-12), 런타임 Python(DEF-31), LAN 페어링·폰(DEF-32), Repo Lens(DEF-01), SCT(DEF-08), 캠페인(DEF-24) 등 |

### 5.6 AI 강등 사다리

| 모드 | 조건 | 동작 |
|---|---|---|
| `FULL` | Jev + LLM ≥ 1(API·Claude Code CLI·Codex·Gemini·**범용 CLI**·Ollama) | 전부 |
| `JUDGE_ONLY` | Jev만 | 정밀 채점·게이트, 템플릿 피드백·질문 은행 발화 |
| `LLM_ONLY` | LLM만 | 생성 전부, 판단은 LLM-judge(w 0.6, 비보정 배지, 타 계열 우선) |
| `OFFLINE` | 없음 | 시드(`seed_reviewed`) + T1/T2 + 결정적·휴리스틱 채점 + 자기채점 + 보류 큐 + 대체 증거·잠정 판정 |

**공통 규칙**: 결정적 과업은 어떤 모드에서도 AI를 쓰지 않는다 · 판단 게이트는 휴리스틱으로 통과시키지 않는다(`deferred` 출제 금지) · interactive 데드라인 3s, 밴드가 바뀔 때만 갱신 · 비보정 판정은 FSRS에 확인 후, 숙달·LDI에는 w 감쇠 · 외부 페이로드는 **로컬** Privacy Firewall 통과 · 제출 전 생성 호출 금지 · 대량 작업은 미리보기·승인, 구독 쿼터 예산 준수 · 첫 기동은 OFFLINE, 동의한 제공자만 연결.
**증거 가중(w_grader)**: 결정적 1.0 · Jev calibrated 0.9 · Jev 보정 전 0.7 · Jev confidence < 0.6 → 0.4 · LLM-judge 0.6 · 휴리스틱 0.4 · 자기 0.3 · 보류 0(소급은 새 이벤트).

### 5.7 동결 조건 (PG-2 게이트 입력)

1. 스파이크: SP-2(러너 격리) · SP-3(리플레이·부하) · SP-4(`node:sqlite`) · SP-6(승급 도달 가능성) · SP-7(TS 7 툴체인) 통과 또는 사전 확정 대응 적용. SP-1·SP-8은 V-live이므로 사전 확정 대응으로 충족.
2. `lint:hooks`: DR-020 이름 훅 + `ext` 컬럼이 DB-01·contracts에 존재.
3. ARC 동결 조건: 단일 writer = learning · outbox + Idempotency-Key · 리플레이 입력 내장 · epoch 백업 · 이벤트 envelope(ULID·device_id·device_seq·client_ts) 상세 동결.
4. 2단 동결(NFR-MAINT-006): 아키텍처·R0/R1 계약 상세, R2/R3 개요.
5. AQ-01~06·08·09·10·11·12·15의 PG-2 기한 항목 결정 완료.
6. `verification-class.json`·`modes.manifest.json` 초안과 RTM-01 등급 열.

### 5.8 Product DoD (V-build)

D-1 UR-14 6계열 + 매니페스트 모드 OFFLINE E2E·외부 호출 0 · D-2 설치 → 첫 세션 ≤ 3분 · D-3 첫 문항 p95 ≤ 2s · D-4 원장만 리플레이 = 라이브, 병합 순서 무관 · D-5 T1 = 실행 100% · D-6 게이트 없는 AI 문항·deferred 출제 0 · D-7 SCN-01~14(v1 범위) · D-8 export ↔ import·epoch 복원 · D-9 서비스 1개 종료 시 학습 계속 · D-10 NG-G·대비·타이포 lint · D-11 콘텐츠 하한 + 3단 KPI + cap 표 · D-12 러너 차단 목록 + RSK-RUN · D-13 디자인 루브릭 ≥ 4.0 + 사용성 5종 · D-14 V-live 작업 자동 생성.

### 5.9 수용한 잔여 위험

| 위험 | 수용 근거 | 감시 |
|---|---|---|
| cap L4 트랙 6개는 v1에서 L5 불가 | 정직하게 표시, 팩 증분·파운드리·pack refresh 경로 존재 | RETRO-03, D-11 |
| OFFLINE 승급은 잠정 | 서술 판정 없이 확정하면 증거 원칙(PP-01) 위반 | 잠정 비율 지표 |
| Jev 한국어 품질 미측정(빌드 환경 키 없음) | 사전 확정 대응(w 0.7 유지, 숙달 산입 유지) | SP-1 V-live, RETRO-02 |
| 러너는 OS 수준 격리가 아님(같은 사용자 권한) | 출처 정책 + 모듈 차단 + RSS 감시, Docker 선택 경로 | RSK-RUN, SEC-INT |
| 디자인 품질 판정의 주관성 | 루브릭·참조 세트·과업 기반 사용성으로 보완 | NFR-UX-012·013 추세 |
| 구독 쿼터 추정·CLI 활동 감지의 휴리스틱 한계 | 보수적 기본값, 대량 작업 승인 | 비용·쿼터 화면, RETRO-02 |
| 콘텐츠 제작 속도(CLI 쿼터 병목) | 목표/하한 분리, 하한 20cu | VC-1, RETRO-01 |

### 5.10 서명

| 역할 | 주체 | 판정 | 일자 |
|---|---|---|---|
| 기획·수렴·요구 정의 | T1 상위 모델(기획 에이전트) | 작성 완료 | 2026-09-30 |
| 적대적 리뷰 반영·기준선 확정 | T1 상위 모델(리뷰 반영, 작성자와 다른 컨텍스트) | **승인 — 51/51 해소, Planning Baseline v1.0 동결** | 2026-09-30 |
| 사용자 위임 근거 | 사용자 원 요청 UR-18("계획을 세우고 검증한 이후에는 바로 코드작업에 들어갈 수 있도록") | 기준선 동결 후 즉시 아키텍처 단계(PG-2)로 진행 | — |

*끝. 이 문서는 Planning Baseline v1.0의 정본이다. 변경은 CR(가산) / ADR(파괴)로만 하며, 변경 시 §3 판정과 §5 기준선을 함께 갱신한다.*
