# R4. 커리큘럼 택소노미·레벨 모델·콘텐츠 스키마·소스 라이선스

> **추적(Trace)**: UR-01(전 분야·섹션 분리), UR-10(이론→코드→핵심개념), UR-11(초급~전문가 깊이), UR-12(0년차→15년차+ 장기 사용), 보조: UR-13(개념 가져오기·문제 생성 재료), UR-14(학습 모드 affordance), UR-07(SI 산출물 문화), UR-15(로컬).
> **정합 문서**: R1(학습과학 — 레벨 L1~L5, 지식유형 K-F/K-C/K-P/K-M/K-S, 숙달 규칙 §7), R2(문항 생성 — KU·오개념·관계 간선).
> **작성 기준일**: 2026-09-30. 라이선스는 해당일 GitHub 원본 license 파일로 실측한 항목에 `✔실측`, 작성자 지식 기반 항목에 `△지식` 표기(구현 전 재확인 필요). 법률 자문 아님.

---

## 0. 핵심 결론 (TL;DR)

1. **계층 구조**: `Track(19 코어 + 1 확장) → Module(선택 그룹) → Concept(= R1의 KC, 코어 459 + 확장 10 = 469개 시드) → KU(R2의 원자 명제) + Misconception + Case`. Concept가 학습·숙달·그래프의 기본 단위, KU가 출제·채점·근거의 기본 단위, **Case(장애/설계 사례)가 L4~L5 판단력의 기본 단위**다.
2. **레벨 L1~L5는 R1과 동일 경계**(0–1 / 1–3 / 3–6 / 6–10 / 10–15년+)를 채택하고, 사용자 전체가 아닌 **(Track × Concept) 단위로 부여**한다. 경력 연수는 "참고 앵커"일 뿐 판정은 증거(Evidence) 기반. L5 이후의 성장은 레벨이 아니라 **폭(breadth, T→π→comb형) 지표**로 측정한다(15년+ 사용 가정의 천장 문제 해결).
3. **Track vs Tag**: "한 개념의 주거지(home)"가 필요한 도메인 = Track(UR-01 섹션). 여러 트랙을 가로지르는 **품질 속성·수명주기·맥락·자격증** = Tag. 성능(performance)·테스트(testing)·관측성(observability)·보안(security)은 **Track이면서 동시에 Tag**(홈 개념은 트랙에, 타 트랙 개념에는 태그로 교차 부착).
4. **지식 유형 D/C/P/S**(= R1 K-F/K-C/K-P/K-S)가 **학습 레이어와 문항 affordance를 결정**한다. D→핵심 비중↑(OX·카드), C→이론 비중↑(설명·디깅), P→코드 비중↑(실습·Parsons·디버깅), S→코드 레이어를 **사례(Case)/시나리오 레이어로 치환**(트레이드오프·설계 리뷰, Jev `score` 채점).
5. **나선형(spiral) 설계**: 같은 개념을 레벨별 `depth_facets`로 재방문하되, **선수 개념이 바뀌거나 지식 유형이 바뀌면 개념을 분리**한다(예: `db.index`(L2) ↔ `db.btree-internals`(L4)).
6. **라이선스 핵심 발견**: `roadmap.sh`는 **개인 열람만 허용, 콘텐츠 재사용·재배포 금지**(✔실측) → 커버리지 점검용 링크로만 사용, 구조·문구 복제 금지. Kubernetes·React·TypeScript·OpenTelemetry·Microsoft Learn 문서는 **CC BY 4.0**, MDN 산문은 **CC BY-SA 2.5 / 코드 예제 CC0**, OWASP는 **CC BY-SA 4.0**, Docker docs·Prometheus docs·CNCF glossary는 **Apache-2.0**, Python 문서 코드 예제는 **0BSD**(모두 ✔실측). 시드 콘텐츠는 **자체 저술(원문 비복제) + 섹션 앵커 링크 인용**이 기본이며, 사용자가 로컬에서 가져온(import) 원문은 **로컬 전용·내보내기 제외** 플래그로 격리한다.

---

## 1. 용어와 모델 계층

| 개체 | 정의 | 예 | 주 소비자 |
|---|---|---|---|
| **Track** | UR-01의 "섹션". 개념의 단일 홈 도메인. 트랙별 독립 레벨 보유 | `k8s` Kubernetes | 내비게이션, 레벨 판정 |
| **Module** | 트랙 내 UI 그룹(선택 필드) | `k8s/networking` | 목차·진도 표시 |
| **Concept** (= R1 KC) | 학습·숙달 추적의 최소 의미 단위. 이론/코드/핵심 3레이어를 가짐 | `k8s.probes` | 학습 세션, Elo/FSRS, 그래프 |
| **KU** (R2) | 참/거짓 판정 가능한 단일 명제 + 적용범위 | `k8s.probes#ku03` | 문항 생성·채점·근거 |
| **Misconception** (R2) | 실제로 사람들이 틀리는 방식 | `k8s.probes!mc01` | 오답/OX 거짓 진술 |
| **Case** (신규) | 장애·설계·리뷰 사례. 여러 Concept에 걸침 | `case.k8s-liveness-restart-storm` | L3~L5 시나리오·디깅·설계 과제 |
| **Path** | 역할 기반 개념 순서열(트랙 횡단) | `path.ai-fullstack-engineer` | 추천·온보딩 |
| **Tag** | 다대다 교차 속성 | `qa:performance`, `ctx:si` | 필터·교차 복습(interleaving) |
| **Source** | 출처 레지스트리(라이선스·버전 포함) | `src.k8s-docs` | 인용·provenance·import |

**ID 규약** (그래프 키·Jev 객체 키로 사용 — brief의 "배열 인덱스 금지" 함정 대응):
- Concept: `^[a-z0-9]+(\.[a-z0-9-]+)+$` → `k8s.pod`, `net.tcp-handshake`. 트랙 접두어 = 트랙 ID.
- KU: `<concept>#ku<nn>`, 오개념: `<concept>!mc<nn>`, Case: `case.<slug>`, Source: `src.<slug>`.
- **ID는 불변**. 이름 변경은 `aliases`, 병합·분할은 `supersedes`/`superseded_by`로 기록(15년 운영 시 학습 이력 보존 — UR-12/UR-17 운영성).
- R2 초안의 `c_k8s_service`, `ku_k8s_svc_001` 표기는 본 규약(`k8s.service`, `k8s.service#ku01`)으로 **통일 제안**(§10 결정 D-1).

---

## 2. 레벨 모델 L1~L5 (UR-11, UR-12)

### 2.1 레벨 정의표

| 레벨 | 명칭 | 경력 앵커 | Dreyfus | Bloom 주력 | SOLO | 한 줄 정의 | 이론:코드:핵심 비중(권장) |
|---|---|---|---|---|---|---|---|
| **L1** | 입문 (Novice) | 0–1년 | Novice | Remember, Understand | Uni→Multi | 용어와 규칙을 알고, 안내에 따라 따라 할 수 있다 | 40 : 30 : 30 |
| **L2** | 주니어 (Advanced Beginner) | 1–3년 | Advanced Beginner | Understand, Apply | Multistructural | 전형적 과제를 혼자 구현하고, 왜 그렇게 하는지 설명한다 | 30 : 45 : 25 |
| **L3** | 미드레벨 (Competent) | 3–6년 | Competent | Apply, Analyze | Relational | 비전형 문제를 분해·디버깅하고, 대안 중 근거 있게 선택한다 | 25 : 45 : 30 (코드 중 1/3은 디버깅·리뷰) |
| **L4** | 시니어 (Proficient) | 6–10년 | Proficient | Analyze, Evaluate | Relational→Extended | 전체 시스템 관점에서 이상 징후를 감지하고 트레이드오프를 정량 평가한다 | 20 : 30(+사례) : 20 + **사례 30** |
| **L5** | 전문가/아키텍트 (Expert) | 10–15년+ | Expert | Evaluate, Create | Extended abstract | 새 문제를 정의하고 표준·원칙을 만들며, 타인을 가르쳐 조직 역량을 올린다 | 15 : 15 : 20 + **사례·설계 50** |

> **경력 앵커 결정**: 오케스트레이터 예시(3–7/7–12/12–15+)와 R1(3–6/6–10/10–15+)이 다르다. **R1 경계를 채택**한다. 이유: ① 이미 R1의 숙달·승급 규칙이 이 경계 전제, ② 한국 SI/엔터프라이즈 직급(사원·대리 ~3년, 과장 ~6년, 차장 ~10년, 부장/수석 10년+)과 대체로 정렬, ③ L5 체류 기간이 길어지는 문제는 §2.4 폭 지표로 해결. 경력은 온보딩 초기 추정(prior)에만 사용하고 판정은 증거로 한다.

### 2.2 레벨별 "숙달(Mastery)"의 의미 — 행동 증거와 서비스 측정 기준

| 레벨 | 행동 증거 (무엇을 할 수 있어야 하나) | 서비스 측정 가능한 증거 (R1 §7 정합) | 대표 과제 형태 |
|---|---|---|---|
| L1 | 정의·명령·구성요소를 인식/회상, 예제 코드를 수정해 실행 | KU 회상 정확도 ≥ 85%(OX는 가중 0.5), Worked example 완료, FSRS 2회 이상 간격 인출 성공 | OX, 카드, 빈칸, Parsons, 예제 따라하기 |
| L2 | 가이드 없이 전형 과제 구현, 결과 예측, 기본 오류 수정, "왜"에 1단계 답 | Elo P(정답\|L2 중앙난이도) ≥ 0.80 + **형식 ≥ 3종** + 서로 다른 날짜 ≥ 2, 실습 테스트 통과 | 코드 작성·출력 예측·faded example·자기설명 |
| L3 | 비전형 문제 분해, 원인 추적 디버깅, 대안 2개 이상 비교 선택, 개념 간 관계 설명 | 위 + find-the-bug/시나리오 정답률 ≥ 70%, **개념 디깅 D4 도달**(R1 §3.5), 백지노트 SOLO ≥ Relational | 디버깅, 설정 리뷰, 대조 사례, 백지노트, 개념맵 |
| L4 | 트레이드오프를 비용·지연·신뢰성 숫자로 평가, 장애 원인 가설 수립·검증, 타인 설계 리뷰 | **Case 루브릭 평균 ≥ 2.5/4**(Jev `score`), 포스트모템 분석 과제, 설계 리뷰 코멘트의 핵심 이슈 재현율 ≥ 70% | 인시던트 시뮬레이션, 설계 리뷰, 용량 산정, 트레이드오프 매트릭스 |
| L5 | 문제 재정의, 원칙·표준·ADR 작성, 경계조건·실패 모드 예견, 가르치기 | ADR/설계서 루브릭 ≥ 3/4, Feynman 설명(AI 학생 대상) 커버리지 ≥ 90% KU + 오개념 교정 성공, 반례·경계조건 생성 과제 | ADR 작성, 표준 정의(예: 개발표준정의서 조항), 설계 방어(소크라테스 반박), 교안 만들기 |

**레벨 승급(트랙 단위)**: R1 §7.3을 그대로 적용한다 — 해당 트랙 Lk 필수 Concept의 ≥ 85% Mastered + 승급 평가(CBM ≥ 70%) + (L3+) 디깅 D4 ≥ 5개 + (L4+) Case 루브릭 ≥ 2.5/4. **강등 없음**, 유지율 하락은 "녹슨(rusty)" 배지.

### 2.3 Concept의 레벨 속성 — 단일 레벨 + 나선형 facet

- `level`: 이 개념을 **처음 숙달 목표로 삼는 레벨**(= 진입 레벨).
- `depth_facets`: 같은 개념을 상위 레벨에서 재방문할 때의 학습 목표(선택). 예) `db.index`
  - L2: "WHERE/ORDER BY에 맞는 단일·복합 인덱스를 설계한다"
  - L3: "복합 인덱스 컬럼 순서와 선택도, covering index를 실행계획으로 검증한다"
- **분리 규칙(Split rule)**: 상위 facet이 ① 새로운 선수 개념을 요구하거나 ② 지식 유형이 바뀌거나(C→S) ③ 학습 시간이 60분을 넘으면 **새 Concept로 분리**한다. 예: B+Tree 페이지 분할·fill factor는 `db.btree-internals`(L4, 선수 `alg.balanced-tree`).
- **선수 레벨 불변식**: `level(prereq) ≤ level(concept)`. 위반은 린트 오류(§9). 트랙 간 선수는 허용하되 soft gate(R1 §7.1).

### 2.4 L5 이후: 폭(Breadth) 지표 — 15년+ 사용의 천장 해결

L5는 "끝"이 아니라 **판단의 범위가 넓어지는 단계**다. 따라서 L5 도달 후에는 레벨 대신 다음 지표로 성장을 보여준다.

| 지표 | 정의 | 목적 |
|---|---|---|
| **T-index** | L4+ 트랙 수(깊이 축) × L2+ 트랙 수(폭 축) | T형(1 깊이) → π형(2) → comb형(3+) 전이 가시화 |
| **Case 커버리지** | 해결한 Case의 트랙 교차 수(예: `k8s`+`db`+`sre` 복합 장애) | 전문가 판단 = 경계에서 발생하는 문제 |
| **Teaching score** | Feynman/멘토링 모드에서 AI 학생 오개념 교정 성공률 | L5 정의의 "가르치기" |
| **Freshness** | `volatility: volatile` 개념의 최신 버전 KU 인출 성공률 | 15년 동안 기술 변화 추적(버전 드리프트) |

### 2.5 레벨별 콘텐츠 비중 가이드 (시드 규모)

전체 시드 469 Concept의 레벨 분포(§5 표 실측 집계): **L1 16% · L2 26% · L3 30% · L4 19% · L5 8%**. 목표 밴드는 L1 15~25% · L2 25~30% · L3 25~30% · L4 15~20% · L5 5~10%로 두고 린트(R-DIST)로 감시한다. L4~L5 Concept 수가 적은 것은 의도적이다 — 상위 레벨 학습은 **새 개념보다 Case·시나리오·교차 문제의 비중**이 크기 때문(Case 시드: 트랙당 L3 3개·L4 3개·L5 2개 ≈ 150개 권장).

---

## 3. 트랙 체계 (UR-01)

### 3.1 트랙 vs 태그 판정 기준

| 기준 | Track | Tag |
|---|---|---|
| 독자적 선수 그래프·L1 진입점이 있는가 | 예 | 아니오 |
| 개념의 "주거지"로 쓸 수 있는가(한 개념 = 한 홈) | 예 | 아니오(다대다) |
| 독립 레벨을 매기는 것이 의미 있는가("보안 L2, 프론트 L4") | 예 | 아니오 |
| 여러 도메인에 같은 이름으로 반복 등장하는가 | 드묾 | 예(성능, 테스트, 보안, 비용, 접근성) |

### 3.2 코어 트랙 19 + 확장 트랙

| 그룹 | Track ID | 트랙 | UR-01 대응 | 시드 Concept 수 | CS2023 KA / SWEBOK v4 KA 매핑 |
|---|---|---|---|---|---|
| A. 기초 | `alg` | 알고리즘·자료구조 | 알고리즘 | 29 | AL / Computing Foundations |
| | `cs` | 컴퓨터 시스템 (OS·아키텍처·동시성) | 서버(기반) | 23 | OS, AR, SF, PDC / Computing Foundations |
| | `net` | 네트워크·프로토콜 | 서버(기반) | 26 | NC / Computing Foundations |
| | `lang` | 프로그래밍 언어·런타임 | (전 분야 기반) | 23 | FPL, SDF / Construction |
| B. 애플리케이션 | `fe` | 프론트엔드 | 프론트 | 27 | SPD, HCI / Design, Construction |
| | `be` | 백엔드 | 백 | 26 | SPD, SE / Design, Construction |
| | `db` | 데이터베이스 | 백(데이터) | 26 | DM / Computing Foundations |
| C. 인프라·운영 | `linux` | 서버·리눅스 운영 | 서버 | 22 | OS, NC / SE Operations |
| | `docker` | 컨테이너 (Docker/OCI) | 인프라(도커) | 20 | SF / SE Operations |
| | `k8s` | Kubernetes | 인프라(쿠버) | 28 | PDC / SE Operations |
| | `cicd` | CI/CD·DevOps | CI/CD | 21 | SE / Configuration Mgmt, Operations |
| | `sre` | SRE·관측성 | 서버·운영 | 20 | SE / SE Operations, Quality |
| | `cloud` | 클라우드·IaC | 인프라 | 21 | PDC, NC / SE Operations |
| D. 보안 | `sec` | 보안 | 보안 | 27 | SEC / Software Security |
| E. AI | `ml` | AI/ML | AI | 23 | AI, MSF / Mathematical Foundations |
| | `llm` | LLM·GenAI 엔지니어링 | LLM | 27 | AI, SEP / — |
| F. 설계·실천·리더십 | `arch` | 소프트웨어 아키텍처·시스템 설계 | (15년차 필수) | 26 | SE, PDC / Architecture, Design |
| | `eng` | 소프트웨어 엔지니어링 실천 (Git·테스트·품질·SI 산출물) | (UR-07 SI) | 24 | SE, SDF / Testing, Quality, Process, Requirements |
| | `lead` | 기술 리더십·전문가 실천 | (L4~L5 필수) | 20 | SEP / Professional Practice, Management, Economics |
| 확장(v2) | `data` | 데이터 엔지니어링 | (사용자 DataAnalysis 이력) | 10 | DM / — |
| 확장(후보) | `mobile`, `graphics`, `embedded` | — | — | 0 | SPD, GIT |

- CS2023의 17 KA(AL, AR, AI, DM, FPL, GIT, HCI, MSF, NC, OS, PDC, SDF, SE, SEC, SEP, SPD, SF)와 SWEBOK v4의 18 KA는 **커버리지 점검용 좌표**로만 사용(본문 복제 없음). GIT(그래픽스)·SPD 중 모바일/게임은 확장 트랙 후보로 남긴다.
- **트랙 분리 근거**:
  - `docker`와 `k8s`를 분리: UR-01이 명시, 각 20+ 개념의 깊이, CKA/CKAD 자격증 태그와 1:1 대응.
  - `sre`를 `cicd`에서 분리: 전달(delivery)과 운영 신뢰성(reliability)은 선수 그래프가 다름(`cicd`는 `eng.git-basics`, `sre`는 `net`/`be` 계열).
  - `lang` 신설: 이벤트 루프·GC·메모리 모델은 fe/be/ml 모두의 선수이며 15년차 차별점.
  - `lead` 신설: L4~L5 정의 자체가 "판단·가르치기·표준 수립"이므로 기술 트랙만으로는 UR-12 달성 불가.
  - `eng`에 **SI 산출물**을 포함: 사용자 상황(SK 계열 SI 지향, UR-07)과 직접 연결.

### 3.3 교차 태그(Tag) 패싯

| 패싯 | 값 | 용도 |
|---|---|---|
| `qa:` 품질 속성 (ISO/IEC 25010 기반) | `performance`, `reliability`, `security`, `maintainability`, `usability`, `compatibility`, `portability`, `scalability`, `cost`, `accessibility` | "성능만 모아 교차 복습" 같은 interleaving 세트 |
| `lc:` 수명주기 | `requirements`, `design`, `build`, `test`, `deploy`, `operate`, `retire` | SI 단계(분석/설계/구현/시험/이행)와 매핑 |
| `ctx:` 맥락 | `si`(한국 SI/공공), `startup`, `cloud-native`, `enterprise`, `regulated`(금융/공공) | 사용자 상황 필터 |
| `stack:` 기술 | `ts`, `python`, `java`, `go`, `react`, `spring`, `fastapi`, `postgres`, `aws`, `ncp` … | 스택 기반 경로 |
| `cert:` 자격증 | `정보처리기사`, `CKA`, `CKAD`, `CKS`, `AWS-SAA`, `정보보안기사` | 목표 시험 대비 모드 |
| `vol:` 변동성 | `stable`(10년+ 불변: TCP, B-Tree), `evolving`(연 단위: React, K8s API), `volatile`(월 단위: LLM 모델·프레임워크) | 콘텐츠 재검증 주기(§7.6) |
| `mode:` 학습 affordance | `ox`, `parsons`, `predict`, `debug`, `lab-docker`, `design`, `incident` | 모드 로테이션(UR-14) |

### 3.4 역할 경로(Path) — 트랙 횡단 순서열

| Path | 구성 트랙(주→보조) | 대상 |
|---|---|---|
| `path.ai-fullstack-engineer` **(기본 추천)** | llm, be, fe, db, docker, k8s, cicd, ml | 가상 액터(AI/데이터 배경 + 부트캠프 풀스택/클라우드 주니어) |
| `path.backend-engineer` | be, db, net, lang, arch, sre | 백엔드 전향 |
| `path.platform-engineer` | linux, docker, k8s, cicd, cloud, sre, sec | 인프라/플랫폼 |
| `path.si-enterprise-developer` | eng(SI 산출물), be(Spring), db, sec(compliance-kr), cloud(korea) | SI 실무 |
| `path.security-engineer` | sec, net, linux, cloud, k8s | 보안 |
| `path.architect` (L4+) | arch, lead, sre, db, cloud, sec | 15년차 목표 |

Path는 Concept ID의 **순서 제안 + 목표 레벨**만 가진다(콘텐츠 중복 없음). 자체 저술이며 roadmap.sh의 구조를 복제하지 않는다(§7.2).

---

## 4. 지식 유형 × 학습 레이어 (UR-10, UR-14)

### 4.1 지식 유형 코드 (R1 §1.1과 1:1)

| 코드 | 유형 | R1 코드 | 판별 질문 | 예 |
|---|---|---|---|---|
| **D** | Declarative/Factual (사실) | K-F | "외워서 답할 수 있는가?" | HTTP 상태코드, `kubectl` 서브커맨드 |
| **C** | Conceptual (개념·원리·모델) | K-C | "왜/어떻게 동작하는지 설명해야 하는가?" | MVCC, 이벤트 루프, Attention |
| **P** | Procedural (절차·기능) | K-P | "손으로 만들어/실행해야 증명되는가?" | Dockerfile 작성, 이진탐색 구현 |
| **S** | Strategic/Judgment (판단) | K-S | "정답이 상황 의존(it depends)인가?" | 모놀리스 vs MSA, 배포 전략 선택 |

(K-M 메타인지는 개념이 아니라 모든 세션에 붙는 활동 — 확신도 표시·백지 diff — 이므로 Concept 태그에서 제외)

### 4.2 레이어 정의 — "코드"의 일반화

| 레이어 | 기호 | 내용 | 산출물 스펙 |
|---|---|---|---|
| **이론 (Theory)** | 이 | 정신 모델: 정의, 동기(왜 존재), 메커니즘, 다이어그램(이중부호화), 역사적 맥락(L4+) | 800~2,000자 + Mermaid 1개 이상 + 사전질문(pre-question) 2개 |
| **코드 (Code)** | 코 | **실행 가능한 산출물**: 소스 코드, 설정(YAML/Dockerfile/HCL), CLI 명령, SQL, 쿼리(PromQL) | worked → faded → 빈 과제의 3단계, 테스트/검증 스크립트, 실행 환경(`runtime`) 명시 |
| **사례 (Case)** | 사 | S 유형에서 코 레이어를 **대체/보완**: 시나리오, 장애 타임라인, 설계 요구 + 제약 | 상황·제약·선택지·루브릭(Jev `score` 4단계) |
| **핵심 (Key points)** | 핵 | 장기 보존 대상: KU 목록, 오개념, 대조쌍, 한 줄 요약, 기억 고리(mnemonic) | KU 5~15개 → FSRS 카드 자동 적립 |

### 4.3 유형별 레이어 적용 규칙 (문항 생성 입력)

| 유형 | 필수 레이어 | 비중 | 우선 문항/모드 (R2 카탈로그) |
|---|---|---|---|
| D | 이·핵 (코는 명령어·설정일 때만) | 핵 50% | OX, 빈칸, 매칭, 카드 |
| C | 이·핵 (+코: 메커니즘 시뮬레이션 코드 권장) | 이 45% | 설명형, 개념 디깅, 인과 OX, 대조 사례, 개념맵 |
| P | 이·코·핵 | 코 50% | Parsons, 출력 예측, 코드 완성, find-the-bug, 실습 |
| S | 이·사·핵 (+코: 트레이드오프 실험) | 사 50% | 시나리오 MCQ, 트레이드오프 비교, 설계 리뷰, ADR 작성 |

아래 트랙 표의 **층** 열은 `이·코·핵`처럼 해당 개념에 적용되는 레이어를 표시한다(모든 개념은 최소 `이·핵`).

---

## 5. 트랙별 Concept 목록 (시드 택소노미)

표기: **L** = 진입 레벨, **K** = 지식 유형(주/보조), **층** = 학습 레이어, **선수** = prerequisite 간선(`requires`). 교차 트랙 선수는 굵게. 모든 선수는 `level(prereq) ≤ level(concept)` 불변식을 만족하도록 설계했다.

### 5.1 `alg` 알고리즘·자료구조 (29)
모듈: basics / linear / tree·graph / paradigms / advanced

| id | 개념 | L | K | 층 | 선수 |
|---|---|---|---|---|---|
| alg.complexity | 시간·공간 복잡도 (Big-O/Θ/Ω) | L1 | C | 이·코·핵 | — |
| alg.array-list | 배열·동적 배열 | L1 | C | 이·코·핵 | alg.complexity |
| alg.linked-list | 연결 리스트 | L1 | P | 이·코·핵 | alg.array-list |
| alg.stack-queue | 스택·큐·덱 | L1 | P | 이·코·핵 | alg.array-list |
| alg.hash-table | 해시 테이블 (충돌 해결, load factor) | L1 | C | 이·코·핵 | alg.array-list |
| alg.recursion | 재귀·호출 스택 | L1 | P | 이·코·핵 | alg.stack-queue |
| alg.sorting | 비교 정렬 (병합·퀵·힙), 안정성 | L1 | P | 이·코·핵 | alg.recursion |
| alg.binary-search | 이분 탐색·파라메트릭 서치 | L1 | P | 이·코·핵 | alg.sorting |
| alg.two-pointer-window | 투 포인터·슬라이딩 윈도우 | L2 | P | 이·코·핵 | alg.array-list |
| alg.tree-bst | 트리·이진 탐색 트리·순회 | L2 | C/P | 이·코·핵 | alg.recursion |
| alg.heap-pq | 힙·우선순위 큐 | L2 | C/P | 이·코·핵 | alg.tree-bst |
| alg.graph-repr | 그래프 표현 (인접 리스트/행렬) | L2 | D | 이·코·핵 | alg.hash-table |
| alg.bfs-dfs | BFS·DFS | L2 | P | 이·코·핵 | alg.graph-repr, alg.stack-queue |
| alg.backtracking | 백트래킹·가지치기 | L2 | P | 이·코·핵 | alg.recursion |
| alg.greedy | 그리디·교환 논증 | L2 | S | 이·코·핵 | alg.sorting |
| alg.dp | 동적 계획법 (메모이제이션/타뷸레이션, 상태 설계) | L2 | S/P | 이·코·핵 | alg.recursion |
| alg.shortest-path | 최단 경로 (Dijkstra·Bellman-Ford·Floyd) | L3 | P | 이·코·핵 | alg.heap-pq, alg.bfs-dfs |
| alg.mst-union-find | MST·Union-Find | L3 | P | 이·코·핵 | alg.graph-repr, alg.greedy |
| alg.topo-sort | 위상 정렬·DAG | L3 | P | 이·코·핵 | alg.bfs-dfs |
| alg.amortized | 분할상환 분석 | L3 | C | 이·핵 | alg.complexity |
| alg.string-algo | 문자열 (KMP·Trie·롤링 해시) | L3 | P | 이·코·핵 | alg.hash-table |
| alg.balanced-tree | 균형 트리 (AVL·Red-Black·B-Tree) | L3 | C | 이·코·핵 | alg.tree-bst |
| alg.segment-fenwick | 세그먼트 트리·펜윅 트리 | L3 | P | 이·코·핵 | alg.tree-bst |
| alg.network-flow | 네트워크 플로우·이분 매칭 | L4 | C/P | 이·코·핵 | alg.bfs-dfs |
| alg.np-reduction | NP-완전성·환원 | L4 | C | 이·핵 | alg.complexity |
| alg.probabilistic-ds | 확률적 자료구조 (Bloom filter, HyperLogLog, Count-Min) | L4 | C | 이·코·핵 | alg.hash-table |
| alg.approx-randomized | 근사·랜덤화 알고리즘 | L4 | S | 이·코·핵 | alg.np-reduction |
| alg.cache-aware | 캐시 친화·외부 메모리 알고리즘 | L5 | S | 이·코·핵 | alg.amortized, **cs.memory-hierarchy** |
| alg.algorithm-engineering | 알고리즘 엔지니어링 (입력 분포, 벤치마크, 상수항) | L5 | S | 이·사·핵 | alg.cache-aware |

대조쌍(R2 형제 개념): BFS↔DFS, 그리디↔DP, 병합정렬↔퀵정렬, Dijkstra↔Bellman-Ford, AVL↔Red-Black.

### 5.2 `cs` 컴퓨터 시스템 — OS·아키텍처·동시성 (23)

| id | 개념 | L | K | 층 | 선수 |
|---|---|---|---|---|---|
| cs.binary-data | 이진수·비트 연산·문자 인코딩 (UTF-8) | L1 | D | 이·코·핵 | — |
| cs.number-repr | 정수 오버플로·부동소수점 (IEEE 754) | L1 | C | 이·코·핵 | cs.binary-data |
| cs.cpu-memory | CPU·메모리 기본 (폰 노이만, 명령어 사이클) | L1 | C | 이·핵 | — |
| cs.process-thread | 프로세스·스레드 | L1 | C | 이·코·핵 | cs.cpu-memory |
| cs.memory-hierarchy | 메모리 계층·CPU 캐시·지역성 | L2 | C | 이·코·핵 | cs.cpu-memory |
| cs.virtual-memory | 가상 메모리·페이징·TLB | L2 | C | 이·핵 | cs.memory-hierarchy |
| cs.scheduling | CPU 스케줄링·컨텍스트 스위칭 | L2 | C | 이·핵 | cs.process-thread |
| cs.syscall | 시스템 콜·유저/커널 모드 | L2 | C | 이·코·핵 | cs.process-thread |
| cs.file-system | 파일 시스템·inode·fsync·페이지 캐시 | L2 | C | 이·코·핵 | cs.syscall |
| cs.concurrency-basics | 경쟁 조건·임계 구역 | L2 | C | 이·코·핵 | cs.process-thread |
| cs.sync-primitives | 뮤텍스·세마포어·조건 변수 | L3 | P | 이·코·핵 | cs.concurrency-basics |
| cs.deadlock | 교착 상태 (조건, 회피, 탐지) | L3 | C | 이·코·핵 | cs.sync-primitives |
| cs.io-models | 블로킹/논블로킹·I/O 멀티플렉싱 (epoll, io_uring) | L3 | C | 이·코·핵 | cs.syscall |
| cs.ipc | IPC (파이프, 유닉스 소켓, 공유 메모리) | L3 | P | 이·코·핵 | cs.syscall |
| cs.virtualization | 가상화 (하이퍼바이저, HW 지원) | L3 | C | 이·핵 | cs.virtual-memory |
| cs.storage-devices | 스토리지 (SSD, 블록 I/O, 쓰기 증폭) | L3 | C | 이·핵 | cs.file-system |
| cs.memory-model | 메모리 모델·원자성·가시성 (happens-before) | L4 | C | 이·코·핵 | cs.sync-primitives |
| cs.lock-free | Lock-free·CAS·ABA | L4 | P | 이·코·핵 | cs.memory-model |
| cs.cache-coherence | 캐시 일관성·false sharing·NUMA | L4 | C | 이·코·핵 | cs.memory-hierarchy |
| cs.kernel-internals | 커널 내부 (프로세스·메모리·VFS 서브시스템) | L4 | C | 이·핵 | cs.syscall |
| cs.perf-analysis | 성능 분석 (perf, flame graph, 오프CPU 분석) | L4 | P | 이·코·핵 | cs.scheduling |
| cs.ebpf | eBPF 관측·네트워킹 | L5 | P | 이·코·핵 | cs.kernel-internals |
| cs.systems-perf-design | 시스템 성능 설계 (latency numbers, mechanical sympathy) | L5 | S | 이·사·핵 | cs.perf-analysis, cs.cache-coherence |

### 5.3 `net` 네트워크·프로토콜 (26)

| id | 개념 | L | K | 층 | 선수 |
|---|---|---|---|---|---|
| net.osi-tcpip | OSI·TCP/IP 계층 모델 | L1 | D | 이·핵 | — |
| net.ip-addressing | IP·서브넷·CIDR | L1 | P | 이·코·핵 | net.osi-tcpip |
| net.tcp-udp | TCP vs UDP | L1 | C | 이·핵 | net.osi-tcpip |
| net.dns | DNS 해석 과정·레코드 타입 | L1 | C | 이·코·핵 | net.ip-addressing |
| net.http-basics | HTTP 메서드·상태 코드·헤더 | L1 | D | 이·코·핵 | net.osi-tcpip |
| net.tcp-handshake | TCP 연결 수립/종료·상태 (TIME_WAIT) | L2 | C | 이·코·핵 | net.tcp-udp |
| net.socket | 소켓 프로그래밍 | L2 | P | 이·코·핵 | net.tcp-handshake, **cs.syscall** |
| net.nat-routing | 라우팅·NAT·ARP | L2 | C | 이·핵 | net.ip-addressing |
| net.http-caching | HTTP 캐싱 (Cache-Control, ETag) | L2 | C | 이·코·핵 | net.http-basics |
| net.tls | TLS 1.3·인증서 체인 | L2 | C | 이·코·핵 | net.tcp-handshake, **sec.crypto-basics** |
| net.proxy | 포워드/리버스 프록시 | L2 | C | 이·코·핵 | net.http-basics |
| net.websocket-sse | 실시간 통신 (WebSocket, SSE, long polling) | L2 | P | 이·코·핵 | net.http-basics |
| net.http2-3 | HTTP/2·HTTP/3 (QUIC) | L3 | C | 이·핵 | net.http-basics, net.tls |
| net.load-balancing | L4/L7 로드밸런싱·알고리즘 | L3 | C | 이·코·핵 | net.proxy, net.tcp-handshake |
| net.tcp-flow-congestion | 흐름 제어·혼잡 제어 (CUBIC, BBR) | L3 | C | 이·핵 | net.tcp-handshake |
| net.cdn | CDN·Anycast | L3 | C | 이·핵 | net.dns, net.http-caching |
| net.vpn-tunnel | VPN·터널링 (IPsec, WireGuard) | L3 | C | 이·코·핵 | net.nat-routing |
| net.packet-analysis | 패킷 분석 (tcpdump, Wireshark) | L3 | P | 이·코·핵 | net.tcp-handshake |
| net.grpc-protobuf | gRPC·Protocol Buffers | L3 | P | 이·코·핵 | net.http2-3 |
| net.bgp | BGP·인터넷 라우팅 | L4 | C | 이·핵 | net.nat-routing |
| net.dns-advanced | DNS 심화 (TTL 전파, DNSSEC, split-horizon) | L4 | C | 이·코·핵 | net.dns |
| net.latency-tail | 지연·대역폭·BDP·tail latency | L4 | S | 이·사·핵 | net.tcp-flow-congestion |
| net.sdn-overlay | 오버레이 네트워크 (VXLAN)·SDN | L4 | C | 이·핵 | net.nat-routing |
| net.kernel-net | 커널 네트워크 스택 튜닝 (backlog, conntrack, SO_REUSEPORT) | L5 | P | 이·코·핵 | net.socket, **cs.kernel-internals** |
| net.protocol-design | 프로토콜 설계 (버전 협상, 멱등성, backpressure) | L5 | S | 이·사·핵 | net.grpc-protobuf |
| net.troubleshooting-method | 네트워크 장애 분석 방법론 (계층별 가설 소거) | L3 | S | 이·사·핵 | net.packet-analysis |

### 5.4 `lang` 프로그래밍 언어·런타임 (23)

| id | 개념 | L | K | 층 | 선수 |
|---|---|---|---|---|---|
| lang.types | 타입 시스템 기초 (정적/동적, 강/약) | L1 | C | 이·코·핵 | — |
| lang.functions-scope | 함수·스코프·클로저 | L1 | P | 이·코·핵 | — |
| lang.oop | OOP (캡슐화·상속·다형성·합성) | L1 | C | 이·코·핵 | lang.functions-scope |
| lang.error-handling | 예외·에러 처리 (Result 타입 포함) | L1 | P | 이·코·핵 | lang.functions-scope |
| lang.collections-iter | 컬렉션·이터레이터·제너레이터 | L2 | P | 이·코·핵 | lang.functions-scope |
| lang.fp | 함수형 프로그래밍 (불변성, 고차 함수, 순수성) | L2 | C | 이·코·핵 | lang.functions-scope |
| lang.memory-management | 메모리 관리 (스택/힙, 참조/값, 소유권 개요) | L2 | C | 이·코·핵 | **cs.cpu-memory** |
| lang.js-event-loop | JS 이벤트 루프·태스크/마이크로태스크 | L2 | C | 이·코·핵 | lang.functions-scope |
| lang.ts-types | TypeScript 타입 (제네릭, 유니온, 좁히기) | L2 | P | 이·코·핵 | lang.types |
| lang.module-build | 모듈·패키징 (ESM/CJS, pnpm, uv, Gradle) | L2 | P | 이·코·핵 | — |
| lang.async-models | 비동기 모델 (async/await, 코루틴, 그린 스레드, goroutine) | L3 | C | 이·코·핵 | lang.js-event-loop, **cs.io-models** |
| lang.ts-advanced | 고급 타입 (조건부·매핑·템플릿 리터럴 타입) | L3 | P | 이·코·핵 | lang.ts-types |
| lang.generics-variance | 제네릭·공변/반공변 | L3 | C | 이·코·핵 | lang.ts-types |
| lang.gc | GC 알고리즘 (mark-sweep, generational, concurrent) | L3 | C | 이·핵 | lang.memory-management |
| lang.python-runtime | Python 런타임 (GIL/free-threading, 데이터 모델, asyncio) | L3 | C | 이·코·핵 | lang.memory-management |
| lang.jvm | JVM (클래스 로딩, JIT, 메모리 영역) | L3 | C | 이·코·핵 | lang.gc |
| lang.compilation | 컴파일·인터프리트·JIT·AOT | L3 | C | 이·핵 | **cs.cpu-memory** |
| lang.metaprogramming | 메타프로그래밍 (데코레이터, 리플렉션, 애너테이션) | L3 | P | 이·코·핵 | lang.oop |
| lang.go-runtime | Go 런타임 (GMP 스케줄러, 채널) | L4 | C | 이·코·핵 | lang.async-models |
| lang.concurrency-patterns | 동시성 패턴 (Actor, CSP, structured concurrency) | L4 | S | 이·코·핵 | lang.async-models, **cs.sync-primitives** |
| lang.runtime-tuning | 런타임 튜닝 (GC 튜닝, 힙 덤프·메모리 누수 분석) | L4 | P | 이·코·핵 | lang.gc |
| lang.language-design | 언어 설계 트레이드오프 (Rust ownership, 효과 시스템) | L5 | S | 이·사·핵 | lang.generics-variance, lang.memory-management |
| lang.dsl-parsing | 파서·DSL 구현 | L5 | P | 이·코·핵 | lang.compilation |

### 5.5 `fe` 프론트엔드 (27)
모듈: web-basics / react / rendering / quality / architecture

| id | 개념 | L | K | 층 | 선수 |
|---|---|---|---|---|---|
| fe.html-semantics | HTML 시맨틱 마크업 | L1 | D | 이·코·핵 | — |
| fe.css-box-layout | CSS 박스 모델·Flexbox·Grid | L1 | P | 이·코·핵 | — |
| fe.responsive | 반응형 디자인·미디어/컨테이너 쿼리 | L1 | P | 이·코·핵 | fe.css-box-layout |
| fe.js-dom | DOM 조작·이벤트 (버블링, 위임) | L1 | P | 이·코·핵 | **lang.functions-scope** |
| fe.fetch-api | 네트워크 요청 (fetch, AbortController) | L1 | P | 이·코·핵 | **net.http-basics** |
| fe.browser-rendering | 브라우저 렌더링 파이프라인 (CRP, reflow/repaint) | L2 | C | 이·핵 | fe.html-semantics, fe.css-box-layout |
| fe.component-model | 컴포넌트 모델 (props, 합성) | L2 | C | 이·코·핵 | fe.js-dom |
| fe.react-rendering | React 렌더링·훅·재조정 | L2 | C/P | 이·코·핵 | fe.component-model |
| fe.state-management | 상태 관리 (로컬/전역/서버/URL 상태) | L2 | S | 이·코·핵 | fe.component-model |
| fe.forms-validation | 폼·검증 | L2 | P | 이·코·핵 | fe.component-model |
| fe.routing | SPA 라우팅 | L2 | P | 이·코·핵 | fe.component-model |
| fe.accessibility | 접근성 (WCAG 2.2, ARIA, 키보드) | L2 | P | 이·코·핵 | fe.html-semantics |
| fe.build-tooling | 번들러·빌드 (Vite, tree-shaking, code splitting) | L2 | P | 이·코·핵 | **lang.module-build** |
| fe.rendering-strategies | CSR/SSR/SSG/ISR/Streaming | L3 | S | 이·사·핵 | fe.react-rendering |
| fe.server-components | React Server Components·하이드레이션 | L3 | C | 이·코·핵 | fe.rendering-strategies |
| fe.data-fetching | 데이터 페칭·캐시 (TanStack Query) | L3 | P | 이·코·핵 | fe.state-management, **net.http-caching** |
| fe.web-vitals | Core Web Vitals (LCP, INP, CLS) | L3 | P | 이·코·핵 | fe.browser-rendering |
| fe.testing | FE 테스트 (Testing Library, Playwright) | L3 | P | 이·코·핵 | fe.component-model, **eng.unit-testing** |
| fe.web-security | FE 보안 (CSP, 토큰 저장, sanitization) | L3 | P | 이·코·핵 | **sec.xss**, **sec.csrf-sop** |
| fe.design-system | 디자인 시스템·디자인 토큰 | L3 | S | 이·코·핵 | fe.component-model |
| fe.css-architecture | CSS 아키텍처 (Tailwind, CSS Modules, cascade layers) | L3 | S | 이·코·핵 | fe.css-box-layout |
| fe.i18n | 국제화·지역화 | L3 | P | 이·코·핵 | fe.component-model |
| fe.browser-internals | 브라우저 엔진 내부 (V8, 컴포지터, 스레드) | L4 | C | 이·핵 | fe.browser-rendering, **lang.js-event-loop** |
| fe.fe-architecture | FE 아키텍처 (모노레포, 경계, FSD) | L4 | S | 이·사·핵 | fe.design-system |
| fe.micro-frontend | 마이크로 프론트엔드 (Module Federation) | L4 | S | 이·사·핵 | fe.build-tooling, **arch.modularity** |
| fe.perf-engineering | 대규모 FE 성능 엔지니어링 (RUM, 성능 예산) | L5 | S | 이·사·핵 | fe.web-vitals |
| fe.web-platform-strategy | 웹 플랫폼 전략 (표준 추적, 프레임워크 마이그레이션) | L5 | S | 이·사·핵 | fe.fe-architecture |

### 5.6 `be` 백엔드 (26)

| id | 개념 | L | K | 층 | 선수 |
|---|---|---|---|---|---|
| be.http-server | HTTP 서버·요청 생명주기 | L1 | P | 이·코·핵 | **net.http-basics** |
| be.rest-design | REST API 설계 (리소스, 상태 코드 선택) | L1 | C | 이·코·핵 | be.http-server |
| be.routing-middleware | 라우팅·미들웨어 | L1 | P | 이·코·핵 | be.http-server |
| be.validation-serialization | 입력 검증·직렬화 (DTO, Pydantic, Zod) | L1 | P | 이·코·핵 | be.http-server |
| be.layering | 계층화 (controller-service-repository)·DI | L2 | C | 이·코·핵 | be.routing-middleware |
| be.orm | ORM·데이터 접근 (N+1, lazy/eager) | L2 | P | 이·코·핵 | **db.sql-basics** |
| be.authn | 인증 구현 (세션, JWT, OAuth2 클라이언트) | L2 | P | 이·코·핵 | **sec.session-token** |
| be.error-logging | 에러 처리·로깅 (에러 모델, RFC 9457) | L2 | P | 이·코·핵 | be.layering |
| be.api-docs | OpenAPI 스펙·API 계약 | L2 | P | 이·코·핵 | be.rest-design |
| be.caching | 캐싱 전략 (cache-aside, TTL, 무효화) | L2 | S | 이·코·핵 | be.layering |
| be.pagination-search | 페이지네이션 (offset vs cursor)·필터 | L2 | P | 이·코·핵 | be.rest-design, **db.index** |
| be.transactions-app | 애플리케이션 트랜잭션 경계 | L3 | C | 이·코·핵 | **db.transactions** |
| be.async-jobs | 비동기 작업·큐 (워커, 재시도, DLQ) | L3 | P | 이·코·핵 | be.layering |
| be.idempotency | 멱등성·재시도·idempotency key | L3 | C | 이·코·핵 | be.rest-design |
| be.rate-limit | 레이트 리밋·백프레셔 (token bucket) | L3 | P | 이·코·핵 | be.http-server |
| be.concurrency-control | 동시성 제어 (낙관/비관 락, 분산 락) | L3 | S | 이·코·핵 | **db.isolation-levels** |
| be.api-evolution | API 버저닝·하위 호환성 | L3 | S | 이·사·핵 | be.api-docs |
| be.graphql | GraphQL (스키마, N+1, DataLoader) | L3 | C | 이·코·핵 | be.rest-design |
| be.messaging | 메시징 (Kafka/RabbitMQ, 전달 보장) | L3 | C | 이·코·핵 | be.async-jobs |
| be.file-streaming | 대용량 파일·스트리밍 (presigned URL, multipart) | L3 | P | 이·코·핵 | be.http-server |
| be.domain-modeling | 도메인 모델링 (DDD 전술: Aggregate, VO) | L4 | S | 이·코·핵 | be.layering |
| be.framework-internals | 프레임워크 내부 (Spring DI/AOP, ASGI) | L4 | C | 이·코·핵 | be.layering, **lang.metaprogramming** |
| be.perf-tuning | 백엔드 성능 튜닝 (커넥션 풀, 프로파일링) | L4 | P | 이·코·핵 | be.orm, **cs.perf-analysis** |
| be.multitenancy | 멀티테넌시 (격리 모델) | L4 | S | 이·사·핵 | **db.schema-design** |
| be.saga-outbox | 분산 트랜잭션 (Saga, Transactional Outbox) | L4 | S | 이·코·핵 | be.messaging, be.transactions-app |
| be.api-governance | API 거버넌스·플랫폼 API 설계 | L5 | S | 이·사·핵 | be.api-evolution |

### 5.7 `db` 데이터베이스 (26)

| id | 개념 | L | K | 층 | 선수 |
|---|---|---|---|---|---|
| db.relational-model | 관계형 모델·키·제약 | L1 | C | 이·코·핵 | — |
| db.sql-basics | SQL 기본 (SELECT, JOIN, GROUP BY) | L1 | P | 이·코·핵 | db.relational-model |
| db.normalization | 정규화 (1NF~BCNF)·반정규화 | L2 | C | 이·코·핵 | db.relational-model |
| db.schema-design | 스키마 설계·ERD | L2 | S | 이·코·핵 | db.normalization |
| db.sql-advanced | 윈도우 함수·CTE·서브쿼리 | L2 | P | 이·코·핵 | db.sql-basics |
| db.index | 인덱스 기본 (단일·복합) | L2 | C | 이·코·핵 | db.sql-basics |
| db.transactions | 트랜잭션·ACID | L2 | C | 이·코·핵 | db.sql-basics |
| db.connection-pool | 커넥션 관리·풀 | L2 | P | 이·코·핵 | db.sql-basics |
| db.nosql-models | NoSQL 모델 (KV, 문서, 컬럼, 그래프) | L2 | C | 이·코·핵 | db.relational-model |
| db.redis | Redis 자료구조·만료·영속성 | L2 | P | 이·코·핵 | db.nosql-models |
| db.isolation-levels | 격리 수준·이상 현상 | L3 | C | 이·코·핵 | db.transactions |
| db.query-plan | 실행 계획 (EXPLAIN ANALYZE) | L3 | P | 이·코·핵 | db.index |
| db.replication | 복제 (동기/비동기, 복제 지연) | L3 | C | 이·코·핵 | db.transactions |
| db.backup-pitr | 백업·PITR·RPO/RTO | L3 | P | 이·코·핵 | db.replication |
| db.migration | 스키마 마이그레이션 (무중단, expand-contract) | L3 | P | 이·코·핵 | db.schema-design |
| db.search-engine | 전문 검색 (역색인, BM25, FTS/OpenSearch) | L3 | C | 이·코·핵 | db.index |
| db.vector-db | 벡터 DB·ANN (HNSW, IVF, pgvector) | L3 | C | 이·코·핵 | db.index, **ml.embeddings** |
| db.btree-internals | B+Tree·페이지·스토리지 엔진 내부 | L4 | C | 이·핵 | db.index, **alg.balanced-tree** |
| db.mvcc | MVCC (스냅샷, vacuum, undo) | L4 | C | 이·코·핵 | db.isolation-levels |
| db.wal-recovery | WAL·체크포인트·크래시 복구 | L4 | C | 이·핵 | db.transactions, **cs.file-system** |
| db.lsm-tree | LSM-Tree·컴팩션 | L4 | C | 이·핵 | db.btree-internals |
| db.partitioning-sharding | 파티셔닝·샤딩 (키 선택, 리밸런싱) | L4 | S | 이·사·핵 | db.replication |
| db.olap-columnar | OLAP·컬럼 스토어 | L4 | C | 이·코·핵 | db.index |
| db.query-optimizer | 옵티마이저 내부 (카디널리티 추정, 조인 알고리즘) | L5 | C | 이·코·핵 | db.query-plan |
| db.distributed-sql | 분산 SQL·NewSQL (Spanner, CockroachDB) | L5 | S | 이·사·핵 | db.partitioning-sharding, **arch.consistency-models** |
| db.data-architecture | 데이터 아키텍처 전략 (polyglot persistence, OLTP/OLAP 분리) | L5 | S | 이·사·핵 | db.nosql-models, db.olap-columnar |

### 5.8 `linux` 서버·리눅스 운영 (22)

| id | 개념 | L | K | 층 | 선수 |
|---|---|---|---|---|---|
| linux.shell-basics | 셸·파일 명령·파이프/리다이렉션 | L1 | P | 이·코·핵 | — |
| linux.permissions | 권한·사용자·그룹·sudo | L1 | P | 이·코·핵 | linux.shell-basics |
| linux.process-mgmt | 프로세스 관리 (ps, signal, kill, nohup) | L1 | P | 이·코·핵 | **cs.process-thread** |
| linux.package-mgmt | 패키지 관리 (apt/dnf) | L1 | P | 이·코·핵 | linux.shell-basics |
| linux.ssh | SSH·키 인증·터널링 | L1 | P | 이·코·핵 | linux.shell-basics |
| linux.text-processing | 텍스트 처리 (grep/sed/awk/jq) | L2 | P | 이·코·핵 | linux.shell-basics |
| linux.shell-scripting | 셸 스크립트 (`set -euo pipefail`, trap) | L2 | P | 이·코·핵 | linux.text-processing |
| linux.systemd | systemd·유닛·journald | L2 | P | 이·코·핵 | linux.process-mgmt |
| linux.networking-tools | 네트워크 진단 (ip, ss, dig, curl, traceroute) | L2 | P | 이·코·핵 | **net.ip-addressing** |
| linux.filesystem-disk | 디스크·마운트·LVM·df/du | L2 | P | 이·코·핵 | **cs.file-system** |
| linux.logs | 로그 관리 (logrotate, rsyslog) | L2 | P | 이·코·핵 | linux.systemd |
| linux.web-server | Nginx (리버스 프록시, TLS 종료) | L2 | P | 이·코·핵 | **net.proxy** |
| linux.resource-monitoring | 리소스 모니터링 (top, vmstat, iostat, sar) | L2 | P | 이·코·핵 | linux.process-mgmt |
| linux.firewall | 방화벽 (nftables/iptables, firewalld) | L3 | P | 이·코·핵 | **net.nat-routing** |
| linux.performance-troubleshoot | 성능 트러블슈팅 (USE 방법론, 60초 분석) | L3 | S | 이·사·핵 | linux.resource-monitoring, **cs.scheduling** |
| linux.kernel-params | 커널 파라미터 (sysctl, ulimit) | L3 | P | 이·코·핵 | **cs.syscall** |
| linux.cgroups-namespaces | cgroups v2·namespaces | L3 | C | 이·코·핵 | **cs.syscall**, **cs.process-thread** |
| linux.config-mgmt | 구성 관리 (Ansible) | L3 | P | 이·코·핵 | linux.ssh |
| linux.hardening | 서버 하드닝 (CIS 벤치마크, 주요정보통신기반시설 가이드) | L3 | S | 이·코·핵 | linux.permissions |
| linux.boot-process | 부팅 과정 (UEFI, initramfs, systemd target) | L3 | C | 이·핵 | linux.systemd |
| linux.debugging-tools | 저수준 디버깅 (strace, lsof, gdb, core dump) | L4 | P | 이·코·핵 | **cs.syscall** |
| linux.fleet-ops | 대규모 서버 운영 (immutable infra, golden image) | L5 | S | 이·사·핵 | linux.config-mgmt, **cloud.iac** |

### 5.9 `docker` 컨테이너 (20)

| id | 개념 | L | K | 층 | 선수 |
|---|---|---|---|---|---|
| docker.container-concept | 컨테이너 vs VM (격리의 실체) | L1 | C | 이·핵 | **cs.process-thread** |
| docker.image-layer | 이미지·레이어·레지스트리 | L1 | C | 이·코·핵 | docker.container-concept |
| docker.run-lifecycle | 컨테이너 생명주기 (run/exec/logs/rm) | L1 | P | 이·코·핵 | docker.container-concept |
| docker.dockerfile | Dockerfile 작성 | L1 | P | 이·코·핵 | docker.image-layer |
| docker.volumes | 볼륨·바인드 마운트 | L1 | P | 이·코·핵 | docker.run-lifecycle |
| docker.build-cache | 빌드 캐시·레이어 순서 | L2 | C | 이·코·핵 | docker.dockerfile |
| docker.multistage | 멀티스테이지·이미지 경량화 | L2 | P | 이·코·핵 | docker.build-cache |
| docker.networking | 컨테이너 네트워크 (bridge, 포트 매핑, 내장 DNS) | L2 | C | 이·코·핵 | docker.run-lifecycle, **net.ip-addressing** |
| docker.compose | Docker Compose | L2 | P | 이·코·핵 | docker.networking, docker.volumes |
| docker.env-config | 환경 변수·설정 주입·12-Factor | L2 | C | 이·코·핵 | docker.run-lifecycle |
| docker.healthcheck-signals | 헬스체크·시그널·PID 1 문제 | L2 | C | 이·코·핵 | docker.run-lifecycle, **linux.process-mgmt** |
| docker.resource-limits | 리소스 제한 (--memory, --cpus, OOM) | L2 | P | 이·코·핵 | docker.run-lifecycle |
| docker.dev-environment | 개발 환경 컨테이너화 (devcontainer) | L2 | P | 이·코·핵 | docker.compose |
| docker.image-security | 이미지 보안 (non-root, distroless, 스캔) | L3 | P | 이·코·핵 | docker.multistage |
| docker.buildkit | BuildKit·buildx·멀티플랫폼 | L3 | P | 이·코·핵 | docker.build-cache |
| docker.registry-tagging | 레지스트리·태깅 전략 (immutable tag, digest pinning) | L3 | S | 이·코·핵 | docker.image-layer |
| docker.troubleshooting | 컨테이너 트러블슈팅 (exit code, OOMKilled, 네트워크) | L3 | P | 이·코·핵 | docker.healthcheck-signals |
| docker.oci-runtime | OCI 스펙·containerd·runc | L4 | C | 이·핵 | docker.image-layer, **linux.cgroups-namespaces** |
| docker.storage-driver | 스토리지 드라이버 (overlayfs, CoW) | L4 | C | 이·핵 | docker.image-layer, **cs.file-system** |
| docker.sandbox-runtime | rootless·샌드박스 런타임 (gVisor, Kata) | L5 | S | 이·사·핵 | docker.oci-runtime |

### 5.10 `k8s` Kubernetes (28)
모듈: workloads / networking / storage / config·security / operations / extensibility

| id | 개념 | L | K | 층 | 선수 |
|---|---|---|---|---|---|
| k8s.architecture | 클러스터 아키텍처 (control plane, kubelet, 선언형 모델) | L1 | C | 이·핵 | **docker.container-concept** |
| k8s.kubectl-basics | kubectl·매니페스트 구조 | L1 | P | 이·코·핵 | k8s.architecture |
| k8s.namespace-labels | 네임스페이스·라벨·셀렉터·어노테이션 | L1 | D | 이·코·핵 | k8s.kubectl-basics |
| k8s.pod | Pod (멀티 컨테이너, init/sidecar) | L1 | C | 이·코·핵 | k8s.architecture, **docker.run-lifecycle** |
| k8s.deployment | Deployment·ReplicaSet·롤링 업데이트 | L1 | P | 이·코·핵 | k8s.pod |
| k8s.service | Service (ClusterIP/NodePort/LoadBalancer) | L1 | C | 이·코·핵 | k8s.pod, k8s.namespace-labels |
| k8s.configmap-secret | ConfigMap·Secret | L1 | P | 이·코·핵 | k8s.pod |
| k8s.probes | liveness/readiness/startup probe | L2 | C | 이·코·핵 | k8s.pod, **docker.healthcheck-signals** |
| k8s.resources | requests/limits·QoS·OOMKilled | L2 | C | 이·코·핵 | k8s.pod, **docker.resource-limits** |
| k8s.ingress | Ingress·Gateway API | L2 | P | 이·코·핵 | k8s.service, **net.proxy** |
| k8s.storage | PV·PVC·StorageClass | L2 | C | 이·코·핵 | k8s.pod |
| k8s.workload-types | StatefulSet·DaemonSet·Job/CronJob | L2 | C | 이·코·핵 | k8s.deployment, k8s.storage |
| k8s.helm-kustomize | Helm·Kustomize | L2 | P | 이·코·핵 | k8s.deployment |
| k8s.troubleshooting | 트러블슈팅 (CrashLoopBackOff, Pending, ImagePullBackOff) | L2 | P | 이·코·핵 | k8s.probes, k8s.resources |
| k8s.rbac | RBAC·ServiceAccount | L3 | P | 이·코·핵 | k8s.namespace-labels, **sec.access-control** |
| k8s.scheduling | 스케줄링 (affinity, taint/toleration, topology spread) | L3 | C | 이·코·핵 | k8s.resources |
| k8s.autoscaling | HPA·VPA·Cluster Autoscaler/Karpenter·KEDA | L3 | P | 이·코·핵 | k8s.resources |
| k8s.networking-cni | 네트워킹 모델·CNI·kube-proxy (iptables/IPVS/eBPF) | L3 | C | 이·핵 | k8s.service, **net.nat-routing** |
| k8s.network-policy | NetworkPolicy | L3 | P | 이·코·핵 | k8s.networking-cni |
| k8s.controller-pattern | 컨트롤러·reconcile loop·desired state | L3 | C | 이·코·핵 | k8s.architecture |
| k8s.gitops | GitOps (Argo CD, Flux) | L3 | P | 이·코·핵 | k8s.helm-kustomize, **cicd.pipeline-basics** |
| k8s.crd-operator | CRD·Operator 개발 | L4 | P | 이·코·핵 | k8s.controller-pattern |
| k8s.etcd-apiserver | etcd·API 서버 내부 (watch, admission, 버전 스큐) | L4 | C | 이·핵 | k8s.controller-pattern, **arch.consensus** |
| k8s.cluster-ops | 클러스터 운영 (업그레이드, etcd 백업, 인증서 갱신) | L4 | P | 이·코·핵 | k8s.etcd-apiserver |
| k8s.service-mesh | 서비스 메시 (Istio/Linkerd, sidecar vs ambient) | L4 | S | 이·사·핵 | k8s.networking-cni |
| k8s.cost-capacity | 용량·비용 최적화 (bin packing, right-sizing) | L4 | S | 이·사·핵 | k8s.autoscaling, **cloud.finops** |
| k8s.scheduler-internals | 스케줄러·kubelet 내부, 대규모 튜닝 | L5 | C | 이·핵 | k8s.scheduling |
| k8s.multi-cluster | 멀티 클러스터·플랫폼 설계 (fleet, 테넌시) | L5 | S | 이·사·핵 | k8s.cluster-ops, k8s.gitops |

대조쌍: Deployment↔StatefulSet, liveness↔readiness, ConfigMap↔Secret, Ingress↔Gateway API, requests↔limits, Helm↔Kustomize.

### 5.11 `cicd` CI/CD·DevOps (21)

| id | 개념 | L | K | 층 | 선수 |
|---|---|---|---|---|---|
| cicd.ci-concept | CI 개념·빌드 자동화 | L1 | C | 이·핵 | **eng.git-basics** |
| cicd.pipeline-basics | 파이프라인 작성 (GitHub Actions: workflow/job/step) | L1 | P | 이·코·핵 | cicd.ci-concept |
| cicd.test-automation | 테스트 자동화 게이트 | L2 | P | 이·코·핵 | cicd.pipeline-basics, **eng.unit-testing** |
| cicd.artifact-mgmt | 아티팩트·버전 (SemVer, 재현 가능 빌드) | L2 | C | 이·코·핵 | cicd.pipeline-basics |
| cicd.caching-matrix | 캐싱·매트릭스·병렬화 | L2 | P | 이·코·핵 | cicd.pipeline-basics |
| cicd.cd-concept | 지속적 전달 vs 지속적 배포 | L2 | C | 이·핵 | cicd.ci-concept |
| cicd.container-build-push | 컨테이너 빌드·푸시 파이프라인 | L2 | P | 이·코·핵 | cicd.pipeline-basics, **docker.dockerfile** |
| cicd.branching | 브랜치 전략 (trunk-based, GitFlow) | L2 | S | 이·사·핵 | **eng.git-basics** |
| cicd.secrets-in-ci | CI 시크릿·OIDC 페더레이션 | L3 | P | 이·코·핵 | cicd.pipeline-basics, **sec.secrets-mgmt** |
| cicd.deploy-strategies | 배포 전략 (rolling, blue-green, canary) | L3 | S | 이·코·핵 | cicd.cd-concept, **k8s.deployment** |
| cicd.feature-flags | 피처 플래그·다크 런치 | L3 | S | 이·코·핵 | cicd.deploy-strategies |
| cicd.env-promotion | 환경 승격 (dev→stg→prod)·설정 분리 | L3 | P | 이·코·핵 | cicd.cd-concept |
| cicd.db-migration-in-cd | 파이프라인 내 DB 마이그레이션 | L3 | P | 이·코·핵 | **db.migration** |
| cicd.quality-gates | 품질 게이트 (커버리지, 정적 분석, 보안 스캔) | L3 | P | 이·코·핵 | cicd.test-automation, **sec.sast-dast** |
| cicd.release-mgmt | 릴리스 관리·체인지로그·롤백 | L3 | P | 이·코·핵 | cicd.artifact-mgmt |
| cicd.dora-metrics | DORA 지표 (배포 빈도, 리드타임, 변경 실패율, 복구 시간) | L3 | C | 이·핵 | cicd.cd-concept |
| cicd.monorepo-ci | 모노레포 CI (affected build, 원격 캐시) | L4 | S | 이·코·핵 | cicd.caching-matrix |
| cicd.progressive-delivery | 점진적 배포 자동 분석 (Argo Rollouts, SLO 기반 중단) | L4 | S | 이·코·핵 | cicd.deploy-strategies, **sre.slo** |
| cicd.pipeline-security | 파이프라인 보안 (SLSA provenance, 러너 격리, 권한 최소화) | L4 | P | 이·코·핵 | **sec.supply-chain** |
| cicd.runner-infra | 러너 인프라 (ephemeral, ARC) | L4 | P | 이·코·핵 | **k8s.autoscaling** |
| cicd.platform-eng | 플랫폼 엔지니어링·IDP (golden path, Backstage) | L5 | S | 이·사·핵 | cicd.progressive-delivery, **k8s.gitops** |

### 5.12 `sre` SRE·관측성 (20)

| id | 개념 | L | K | 층 | 선수 |
|---|---|---|---|---|---|
| sre.monitoring-basics | 모니터링 기초 (메트릭·로그·트레이스) | L1 | C | 이·핵 | — |
| sre.logging | 구조화 로깅·로그 파이프라인 (상관 ID) | L2 | P | 이·코·핵 | sre.monitoring-basics |
| sre.metrics-prometheus | 메트릭 타입·Prometheus·PromQL | L2 | P | 이·코·핵 | sre.monitoring-basics |
| sre.golden-signals | Golden Signals·RED·USE | L2 | C | 이·핵 | sre.monitoring-basics |
| sre.dashboards-alerting | 대시보드·증상 기반 알림 | L2 | S | 이·코·핵 | sre.metrics-prometheus |
| sre.distributed-tracing | 분산 트레이싱·OpenTelemetry | L3 | P | 이·코·핵 | sre.logging |
| sre.slo | SLI·SLO·에러 버짓·번 레이트 알림 | L3 | C/S | 이·코·핵 | sre.golden-signals |
| sre.incident-mgmt | 인시던트 대응·온콜 | L3 | S | 이·사·핵 | sre.dashboards-alerting |
| sre.postmortem | 비난 없는 포스트모템 | L3 | S | 이·사·핵 | sre.incident-mgmt |
| sre.capacity-load | 용량 계획·부하 테스트 (k6) | L3 | P | 이·코·핵 | sre.golden-signals |
| sre.resilience-patterns | 복원력 패턴 (timeout, retry+jitter, circuit breaker, bulkhead) | L3 | C | 이·코·핵 | **be.idempotency** |
| sre.high-availability | 고가용성·장애 도메인·다중 AZ | L3 | S | 이·사·핵 | sre.golden-signals |
| sre.toil-automation | 토일 감소·운영 자동화 | L3 | S | 이·사·핵 | sre.incident-mgmt |
| sre.dr | 재해 복구 전략 (backup/pilot light/warm/active-active) | L4 | S | 이·사·핵 | sre.high-availability, **db.backup-pitr** |
| sre.chaos-engineering | 카오스 엔지니어링 | L4 | P | 이·코·핵 | sre.resilience-patterns |
| sre.observability-cost | 관측성 비용·카디널리티·샘플링 | L4 | S | 이·사·핵 | sre.metrics-prometheus, sre.distributed-tracing |
| sre.observability-arch | 관측성 아키텍처 (OTel Collector, eBPF 계측) | L4 | S | 이·코·핵 | sre.distributed-tracing |
| sre.debugging-production | 프로덕션 디버깅 (가설 기반, 이상 탐지) | L4 | S | 이·사·핵 | sre.distributed-tracing |
| sre.cascading-failure | 연쇄 장애·메타스테이블 장애 | L5 | C | 이·사·핵 | sre.resilience-patterns |
| sre.reliability-strategy | 조직 신뢰성 전략 (SLO 거버넌스, PRR) | L5 | S | 이·사·핵 | sre.slo |

### 5.13 `cloud` 클라우드·IaC (21)

| id | 개념 | L | K | 층 | 선수 |
|---|---|---|---|---|---|
| cloud.models | 서비스 모델 (IaaS/PaaS/SaaS)·책임 공유 모델 | L1 | C | 이·핵 | — |
| cloud.regions-az | 리전·가용 영역 | L1 | D | 이·핵 | cloud.models |
| cloud.compute | 컴퓨트 (VM, 인스턴스 유형, 오토스케일링 그룹) | L1 | P | 이·코·핵 | cloud.models |
| cloud.storage | 스토리지 (Object/Block/File) | L1 | C | 이·코·핵 | cloud.models |
| cloud.vpc | VPC·서브넷·라우팅·보안 그룹 | L2 | P | 이·코·핵 | **net.ip-addressing** |
| cloud.iam | IAM (정책, 역할, 최소 권한) | L2 | C | 이·코·핵 | **sec.authn-authz** |
| cloud.managed-db | 관리형 DB (RDS류, 백업·페일오버) | L2 | P | 이·코·핵 | **db.transactions** |
| cloud.serverless | 서버리스 (FaaS, 콜드 스타트, 이벤트 소스) | L2 | C | 이·코·핵 | cloud.compute |
| cloud.iac | IaC (Terraform/OpenTofu, state, plan) | L2 | P | 이·코·핵 | cloud.compute |
| cloud.load-balancer-cdn | 클라우드 LB·CDN | L3 | P | 이·코·핵 | **net.load-balancing**, **net.cdn** |
| cloud.iac-advanced | IaC 모듈화·드리프트·Policy as Code (OPA) | L3 | S | 이·코·핵 | cloud.iac |
| cloud.managed-k8s | 관리형 Kubernetes (EKS/GKE/AKS/NKS) | L3 | P | 이·코·핵 | **k8s.deployment**, cloud.vpc |
| cloud.messaging | 관리형 메시징 (SQS/SNS/PubSub) | L3 | C | 이·코·핵 | **be.messaging** |
| cloud.well-architected | Well-Architected 원칙 | L3 | S | 이·사·핵 | cloud.models |
| cloud.finops | FinOps·비용 최적화 | L3 | S | 이·사·핵 | cloud.compute |
| cloud.korea-context | 국내 클라우드 (NCP, KT Cloud, NHN)·CSAP·공공 클라우드 | L3 | D | 이·핵 | cloud.models |
| cloud.networking-advanced | 고급 네트워킹 (PrivateLink, Transit GW, 하이브리드 연결) | L4 | C | 이·코·핵 | cloud.vpc |
| cloud.multi-account | 멀티 계정·랜딩 존·조직 정책 | L4 | S | 이·코·핵 | cloud.iam |
| cloud.migration | 클라우드 마이그레이션 (7R) | L4 | S | 이·사·핵 | cloud.well-architected |
| cloud.data-services | 클라우드 데이터 서비스 (데이터 레이크, 관리형 분석) | L4 | C | 이·핵 | cloud.storage |
| cloud.multi-cloud | 멀티/하이브리드 클라우드 전략·주권(sovereignty) | L5 | S | 이·사·핵 | cloud.multi-account |

### 5.14 `sec` 보안 (27)

| id | 개념 | L | K | 층 | 선수 |
|---|---|---|---|---|---|
| sec.cia-triad | CIA·보안 원칙 (최소 권한, 심층 방어) | L1 | D | 이·핵 | — |
| sec.authn-authz | 인증 vs 인가 | L1 | C | 이·핵 | sec.cia-triad |
| sec.password-storage | 비밀번호 저장 (argon2/bcrypt, salt, pepper) | L1 | P | 이·코·핵 | sec.authn-authz |
| sec.owasp-top10 | OWASP Top 10 개관 | L1 | D | 이·핵 | sec.cia-triad |
| sec.crypto-basics | 암호 기초 (대칭/비대칭, 해시, MAC, 서명) | L2 | C | 이·코·핵 | sec.cia-triad |
| sec.injection | 인젝션 (SQLi, OS command) | L2 | P | 이·코·핵 | sec.owasp-top10, **db.sql-basics** |
| sec.xss | XSS (저장/반사/DOM) | L2 | P | 이·코·핵 | sec.owasp-top10, **fe.js-dom** |
| sec.csrf-sop | SOP·CORS·CSRF | L2 | C | 이·코·핵 | **net.http-basics** |
| sec.session-token | 세션·토큰 보안 (JWT 함정, 쿠키 속성) | L2 | C | 이·코·핵 | sec.authn-authz |
| sec.oauth-oidc | OAuth 2.x·OIDC 플로우 (PKCE) | L3 | C | 이·코·핵 | sec.session-token |
| sec.access-control | 접근 제어 모델 (RBAC/ABAC/ReBAC)·IDOR | L3 | S | 이·코·핵 | sec.authn-authz |
| sec.secrets-mgmt | 시크릿 관리 (Vault, KMS, envelope encryption) | L3 | P | 이·코·핵 | sec.crypto-basics |
| sec.pki-tls | PKI·인증서 운영·mTLS | L3 | P | 이·코·핵 | **net.tls** |
| sec.ssrf-deser | SSRF·역직렬화·XXE·경로 탐색 | L3 | P | 이·코·핵 | sec.injection |
| sec.threat-modeling | 위협 모델링 (STRIDE, DFD, 공격 트리) | L3 | S | 이·사·핵 | sec.cia-triad |
| sec.sast-dast | 보안 테스트 (SAST/DAST/SCA) | L3 | P | 이·코·핵 | sec.owasp-top10 |
| sec.supply-chain | 공급망 보안 (SBOM, SLSA, sigstore) | L3 | S | 이·코·핵 | **cicd.pipeline-basics** |
| sec.llm-security | LLM 보안 (프롬프트 인젝션, OWASP LLM Top 10) | L3 | C | 이·코·핵 | sec.injection, **llm.prompting** |
| sec.logging-detection | 보안 로깅·탐지 (SIEM, 탐지 규칙) | L4 | P | 이·코·핵 | **sre.logging** |
| sec.container-k8s-security | 컨테이너·K8s 보안 (PSA, 런타임 탐지) | L4 | P | 이·코·핵 | **k8s.rbac**, **docker.image-security** |
| sec.cloud-security | 클라우드 보안 (IAM 최소 권한, CSPM) | L4 | S | 이·코·핵 | **cloud.iam** |
| sec.zero-trust | 제로 트러스트 아키텍처 | L4 | S | 이·사·핵 | sec.access-control |
| sec.incident-response | 침해 사고 대응 (포렌식 기초, 격리) | L4 | S | 이·사·핵 | sec.logging-detection |
| sec.pentest-method | 침투 테스트 방법론 (MITRE ATT&CK) | L4 | P | 이·코·핵 | sec.ssrf-deser |
| sec.compliance-kr | 규제·컴플라이언스 (개인정보보호법, ISMS-P, 전자금융감독규정) | L4 | D | 이·핵 | sec.cia-triad |
| sec.crypto-engineering | 암호 엔지니어링 (AEAD, nonce 재사용, 키 순환, 부채널) | L5 | C | 이·코·핵 | sec.crypto-basics |
| sec.appsec-program | 보안 프로그램·SDL·DevSecOps 거버넌스 | L5 | S | 이·사·핵 | sec.threat-modeling |

### 5.15 `ml` AI/ML (23)

| id | 개념 | L | K | 층 | 선수 |
|---|---|---|---|---|---|
| ml.math-foundations | 선형대수·확률·미분 (ML용 최소 수학) | L1 | C | 이·코·핵 | — |
| ml.ml-basics | 지도/비지도·학습/검증/테스트 분할 | L1 | C | 이·코·핵 | — |
| ml.data-prep | 데이터 전처리·피처 엔지니어링 (pandas) | L1 | P | 이·코·핵 | ml.ml-basics |
| ml.linear-logistic | 선형·로지스틱 회귀 | L2 | C | 이·코·핵 | ml.math-foundations |
| ml.gradient-descent | 경사 하강·옵티마이저 (SGD, Adam) | L2 | C | 이·코·핵 | ml.math-foundations |
| ml.eval-metrics | 평가 지표 (precision/recall, ROC-AUC, calibration) | L2 | C | 이·코·핵 | ml.ml-basics |
| ml.overfitting | 과적합·정규화·교차 검증·데이터 누수 | L2 | C | 이·코·핵 | ml.eval-metrics |
| ml.trees-ensembles | 트리·앙상블 (RF, GBDT) | L2 | P | 이·코·핵 | ml.ml-basics |
| ml.unsupervised | 군집·차원 축소 | L2 | P | 이·코·핵 | ml.ml-basics |
| ml.neural-networks | 신경망·역전파 | L3 | C | 이·코·핵 | ml.gradient-descent |
| ml.pytorch | PyTorch 학습 루프 | L3 | P | 이·코·핵 | ml.neural-networks |
| ml.cnn-rnn | CNN·RNN | L3 | C | 이·코·핵 | ml.neural-networks |
| ml.transformer | 트랜스포머·어텐션 | L3 | C | 이·코·핵 | ml.neural-networks |
| ml.embeddings | 임베딩·표현 학습·유사도 | L3 | C | 이·코·핵 | ml.neural-networks |
| ml.experiment-tracking | 실험 관리 (MLflow, 재현성) | L3 | P | 이·코·핵 | ml.eval-metrics |
| ml.model-serving | 모델 서빙 (배치 vs 온라인, FastAPI/Triton) | L3 | P | 이·코·핵 | **be.http-server** |
| ml.mlops-pipeline | MLOps 파이프라인·피처 스토어 | L4 | S | 이·코·핵 | ml.experiment-tracking, **cicd.pipeline-basics** |
| ml.data-drift | 드리프트·모델 모니터링 | L4 | P | 이·코·핵 | ml.model-serving |
| ml.distributed-training | 분산 학습 (DDP, FSDP, 병렬화 전략) | L4 | C | 이·코·핵 | ml.pytorch |
| ml.inference-opt | 추론 최적화 (양자화, 배칭, ONNX) | L4 | P | 이·코·핵 | ml.model-serving |
| ml.research-reading | 논문 읽기·재현 | L4 | S | 이·사·핵 | ml.transformer |
| ml.responsible-ai | 책임 있는 AI (공정성, 설명 가능성, AI 기본법) | L4 | S | 이·사·핵 | ml.eval-metrics |
| ml.ml-system-design | ML 시스템 설계 (추천·랭킹·검색) | L5 | S | 이·사·핵 | ml.mlops-pipeline |

### 5.16 `llm` LLM·GenAI 엔지니어링 (27)

| id | 개념 | L | K | 층 | 선수 |
|---|---|---|---|---|---|
| llm.llm-basics | LLM 동작 원리 (다음 토큰 예측, 샘플링, temperature) | L1 | C | 이·핵 | — |
| llm.prompting | 프롬프트 엔지니어링 기초 (역할, few-shot, 구조화) | L1 | P | 이·코·핵 | llm.llm-basics |
| llm.api-usage | LLM API (messages, 스트리밍, 에러·재시도) | L1 | P | 이·코·핵 | llm.llm-basics |
| llm.tokenization | 토크나이저·컨텍스트 윈도우·비용 | L2 | C | 이·코·핵 | llm.llm-basics |
| llm.structured-output | 구조화 출력·JSON Schema | L2 | P | 이·코·핵 | llm.api-usage |
| llm.tool-use | Tool/function calling | L2 | P | 이·코·핵 | llm.structured-output |
| llm.embeddings-search | 임베딩 검색 기초 | L2 | C | 이·코·핵 | llm.llm-basics |
| llm.rag-basics | RAG 기초 (청킹, 검색, 근거 기반 생성) | L2 | P | 이·코·핵 | llm.embeddings-search |
| llm.local-llm | 로컬 LLM (Ollama, GGUF, 양자화 선택) | L2 | P | 이·코·핵 | llm.api-usage |
| llm.cli-agents | LLM CLI 자동화 (claude -p, codex exec, headless 모드) | L2 | P | 이·코·핵 | llm.api-usage |
| llm.rag-advanced | 고급 RAG (하이브리드, rerank, query rewrite, GraphRAG) | L3 | S | 이·코·핵 | llm.rag-basics, **db.search-engine** |
| llm.agents | 에이전트 (ReAct, 계획, 메모리) | L3 | C | 이·코·핵 | llm.tool-use |
| llm.mcp | MCP (Model Context Protocol) 서버·클라이언트 | L3 | P | 이·코·핵 | llm.tool-use |
| llm.agent-frameworks | 오케스트레이션 (LangGraph 등 상태 그래프) | L3 | P | 이·코·핵 | llm.agents |
| llm.evaluation | LLM 평가 (골든셋, LLM-as-judge, 편향) | L3 | S | 이·코·핵 | llm.rag-basics |
| llm.judgment-models | 판정 전용 모델 활용 (분류·루브릭 채점, Jev `noul/choice/score`) | L3 | C/P | 이·코·핵 | llm.evaluation |
| llm.guardrails | 가드레일·안전 필터 | L3 | P | 이·코·핵 | **sec.llm-security** |
| llm.caching-cost | 프롬프트 캐싱·비용/지연 최적화·라우팅 | L3 | S | 이·코·핵 | llm.tokenization |
| llm.observability | LLM 관측성 (트레이스, 프롬프트 버전) | L3 | P | 이·코·핵 | **sre.distributed-tracing** |
| llm.multimodal | 멀티모달 (비전·음성 입력) | L3 | C | 이·코·핵 | llm.api-usage |
| llm.transformer-internals | 트랜스포머 내부 (KV cache, attention 변형, MoE) | L4 | C | 이·코·핵 | **ml.transformer** |
| llm.fine-tuning | 파인튜닝 (SFT, LoRA/QLoRA, 데이터 큐레이션) | L4 | P | 이·코·핵 | **ml.pytorch** |
| llm.alignment | 정렬 (RLHF, DPO, 헌법적 AI) | L4 | C | 이·핵 | llm.fine-tuning |
| llm.serving | LLM 서빙 (vLLM, paged attention, continuous batching) | L4 | P | 이·코·핵 | llm.transformer-internals, **ml.inference-opt** |
| llm.llmops | LLMOps (프롬프트 레지스트리, 회귀 평가, 온라인 실험) | L4 | S | 이·코·핵 | llm.evaluation, llm.observability |
| llm.agent-system-design | 에이전트 시스템 설계 (멀티에이전트, 신뢰성·비용 경계) | L5 | S | 이·사·핵 | llm.agents, llm.llmops |
| llm.ai-product-strategy | AI 제품 전략·리스크 거버넌스 | L5 | S | 이·사·핵 | llm.llmops, **ml.responsible-ai** |

(`llm.cli-agents`는 UR-15의 사용 환경 — Claude Code/Codex CLI 연동 — 과 직결되어 포함)

### 5.17 `arch` 소프트웨어 아키텍처·시스템 설계 (26)

| id | 개념 | L | K | 층 | 선수 |
|---|---|---|---|---|---|
| arch.design-principles | SOLID·결합도/응집도·DRY/YAGNI | L2 | C | 이·코·핵 | **lang.oop** |
| arch.system-design-basics | 시스템 설계 기초 (수직/수평 확장, 무상태, 캐시) | L2 | C | 이·사·핵 | **be.caching** |
| arch.layered-hexagonal | 계층형·헥사고날·클린 아키텍처 | L3 | S | 이·코·핵 | arch.design-principles |
| arch.modularity | 모듈화·경계·모듈러 모놀리스 | L3 | S | 이·코·핵 | arch.layered-hexagonal |
| arch.quality-attributes | 품질 속성·시나리오·트레이드오프 (ISO 25010, ATAM) | L3 | S | 이·사·핵 | arch.system-design-basics |
| arch.monolith-vs-msa | 모놀리스 vs MSA 판단 | L3 | S | 이·사·핵 | arch.modularity |
| arch.msa-patterns | MSA 패턴 (API Gateway, BFF, 서비스 디스커버리) | L3 | P | 이·코·핵 | arch.monolith-vs-msa |
| arch.cap-pacelc | CAP·PACELC | L3 | C | 이·핵 | **db.replication** |
| arch.adr | ADR·아키텍처 문서화 (C4, arc42) | L3 | S | 이·사·핵 | arch.quality-attributes |
| arch.event-driven | 이벤트 기반 아키텍처 (pub/sub, Event Sourcing, CQRS) | L4 | S | 이·코·핵 | **be.messaging** |
| arch.ddd-strategic | DDD 전략 설계 (Bounded Context, Context Map) | L4 | S | 이·사·핵 | **be.domain-modeling**, arch.modularity |
| arch.consistency-models | 일관성 모델 (linearizable, causal, eventual) | L4 | C | 이·핵 | arch.cap-pacelc |
| arch.consensus | 합의 (Raft, Paxos)·리더 선출 | L4 | C | 이·코·핵 | arch.consistency-models |
| arch.distributed-time | 시간·순서 (Lamport, vector clock, HLC) | L4 | C | 이·코·핵 | arch.consistency-models |
| arch.scalability-patterns | 확장성 패턴 (샤딩, 캐시 계층, 읽기 모델) | L4 | S | 이·사·핵 | arch.system-design-basics, **db.partitioning-sharding** |
| arch.caching-architecture | 다계층 캐시 설계 (일관성, stampede, hot key) | L4 | S | 이·코·핵 | **be.caching** |
| arch.system-design-cases | 시스템 설계 사례 (URL 단축, 피드, 채팅, 결제, 예약) | L4 | S | 이·사·핵 | arch.scalability-patterns |
| arch.api-contracts | 서비스 간 계약 (CDC, 스키마 레지스트리) | L4 | P | 이·코·핵 | **be.api-evolution** |
| arch.data-intensive | 데이터 집약 설계 (스트림/배치, 람다/카파) | L4 | S | 이·사·핵 | arch.event-driven |
| arch.legacy-modernization | 레거시 현대화 (Strangler Fig, 점진 이행) | L4 | S | 이·사·핵 | arch.monolith-vs-msa |
| arch.evolutionary | 진화적 아키텍처·fitness function | L5 | S | 이·코·핵 | arch.adr |
| arch.enterprise-arch | 엔터프라이즈 아키텍처 (EA, TOGAF 개요, SI 아키텍처 정의서) | L5 | S | 이·사·핵 | arch.adr |
| arch.sociotechnical | 사회기술적 설계 (Conway 법칙, Team Topologies) | L5 | S | 이·사·핵 | arch.ddd-strategic |
| arch.cost-aware | 비용·성능·신뢰성 통합 의사결정 | L5 | S | 이·사·핵 | arch.quality-attributes, **cloud.finops** |
| arch.formal-methods | 정형 명세 개요 (TLA+, 모델 체킹) | L5 | C | 이·코·핵 | arch.consensus |
| arch.architecture-review | 아키텍처 리뷰 수행 (리스크 식별, 결정 감사) | L5 | S | 이·사·핵 | arch.adr, arch.scalability-patterns |

### 5.18 `eng` 소프트웨어 엔지니어링 실천 (24)

| id | 개념 | L | K | 층 | 선수 |
|---|---|---|---|---|---|
| eng.git-basics | Git 기초 (commit, branch, merge, remote) | L1 | P | 이·코·핵 | — |
| eng.clean-code | 클린 코드·네이밍·함수 설계 | L1 | C | 이·코·핵 | — |
| eng.coding-standards | 코딩 표준·린터/포매터 (ESLint, Ruff) | L1 | P | 이·코·핵 | eng.clean-code |
| eng.debugging | 디버깅 방법론 (재현→가설→이분 탐색) | L1 | P | 이·코·핵 | — |
| eng.unit-testing | 단위 테스트 (AAA, 경계값) | L1 | P | 이·코·핵 | — |
| eng.git-internals | Git 내부 (객체 모델, rebase vs merge, reflog) | L2 | C | 이·코·핵 | eng.git-basics |
| eng.test-doubles | 테스트 더블 (mock/stub/fake/spy) | L2 | C | 이·코·핵 | eng.unit-testing |
| eng.tdd | TDD (Red-Green-Refactor) | L2 | P | 이·코·핵 | eng.unit-testing |
| eng.test-strategy | 테스트 전략 (피라미드/트로피, 통합·E2E) | L2 | S | 이·사·핵 | eng.test-doubles |
| eng.refactoring | 리팩터링 (코드 스멜, 안전한 단계) | L2 | P | 이·코·핵 | eng.unit-testing |
| eng.design-patterns | 디자인 패턴 (GoF 핵심) | L2 | P | 이·코·핵 | **lang.oop** |
| eng.code-review | 코드 리뷰 (관점, 코멘트 작성) | L2 | S | 이·사·핵 | eng.clean-code |
| eng.dev-process | 개발 프로세스 (애자일·스크럼·워터폴·V-모델) | L2 | C | 이·핵 | — |
| eng.requirements | 요구사항 분석 (기능/비기능, 유스케이스, 추적성 매트릭스) | L2 | S | 이·사·핵 | eng.dev-process |
| eng.si-deliverables | SI 산출물 (요구사항정의서, 개발표준정의서, 테스트계획/결과서, 이행계획서) | L2 | D | 이·핵 | eng.requirements |
| eng.documentation | 기술 문서화 (Docs-as-code, Diátaxis) | L2 | P | 이·코·핵 | — |
| eng.ai-assisted-dev | AI 보조 개발 (코딩 에이전트 운용, 산출물 검증) | L2 | P | 이·코·핵 | **llm.prompting** |
| eng.contract-testing | 계약 테스트 (Pact) | L3 | P | 이·코·핵 | eng.test-strategy |
| eng.legacy-code | 레거시 코드 다루기 (특성 테스트, seam) | L3 | S | 이·코·핵 | eng.refactoring |
| eng.tech-debt | 기술 부채 관리 (분류, 상환 전략) | L3 | S | 이·사·핵 | eng.refactoring |
| eng.estimation | 추정·계획 (상대 추정, 불확실성 콘) | L3 | S | 이·사·핵 | eng.dev-process |
| eng.software-metrics | 품질 메트릭 (복잡도, 결합도, 커버리지 해석) | L3 | C | 이·코·핵 | eng.unit-testing |
| eng.property-mutation | 속성 기반·뮤테이션 테스트 | L4 | P | 이·코·핵 | eng.tdd |
| eng.quality-strategy-org | 조직 품질 전략 (테스트 거버넌스, 품질 문화) | L5 | S | 이·사·핵 | eng.test-strategy |

### 5.19 `lead` 기술 리더십·전문가 실천 (20)

| id | 개념 | L | K | 층 | 선수 |
|---|---|---|---|---|---|
| lead.communication | 기술 커뮤니케이션 (결론 먼저, 맥락 맞춤) | L1 | P | 이·사·핵 | — |
| lead.learning-how | 학습법·지식 관리 (메타 학습) | L1 | S | 이·사·핵 | — |
| lead.collaboration | 협업·이슈 트래킹·질문하는 법 | L1 | P | 이·사·핵 | — |
| lead.ownership | 오너십·문제 정의 | L2 | S | 이·사·핵 | lead.collaboration |
| lead.career-dev | 커리어 설계 (T형, 전문 분야 선택) | L2 | S | 이·사·핵 | lead.learning-how |
| lead.retrospective | 회고 (KPT, 4L) | L2 | P | 이·사·핵 | lead.collaboration |
| lead.design-doc | 설계 문서·RFC 작성 | L3 | P | 이·사·핵 | **arch.adr** |
| lead.mentoring | 멘토링·리뷰 코칭 | L3 | S | 이·사·핵 | **eng.code-review** |
| lead.stakeholder | 이해관계자 관리·요구 협상 | L3 | S | 이·사·핵 | **eng.requirements** |
| lead.si-project-mgmt | SI 프로젝트 관리 (WBS, 감리, 검수, 변경 관리) | L3 | D | 이·핵 | **eng.si-deliverables** |
| lead.ethics | 직업 윤리·AI 윤리 | L3 | C | 이·사·핵 | — |
| lead.tech-decision | 기술 선택 프레임 (Build vs Buy, 가역성, 비용) | L4 | S | 이·사·핵 | **arch.quality-attributes** |
| lead.project-leadership | 프로젝트 리딩·리스크 관리 | L4 | S | 이·사·핵 | **eng.estimation** |
| lead.incident-command | 인시던트 지휘 (IC, 커뮤니케이션 리드) | L4 | S | 이·사·핵 | **sre.incident-mgmt** |
| lead.hiring-interview | 채용·기술 면접 설계 | L4 | S | 이·사·핵 | lead.mentoring |
| lead.business-acumen | 비즈니스 이해 (ROI, 원가, SI 계약 형태) | L4 | S | 이·사·핵 | lead.stakeholder |
| lead.tech-strategy | 기술 전략·로드맵 | L5 | S | 이·사·핵 | lead.tech-decision |
| lead.engineering-culture | 엔지니어링 문화·표준 수립 | L5 | S | 이·사·핵 | lead.mentoring |
| lead.team-topology | 팀 설계·조직 구조 | L5 | S | 이·사·핵 | **arch.sociotechnical** |
| lead.org-influence | 조직 영향력 (Staff+ 역할 유형) | L5 | S | 이·사·핵 | lead.tech-strategy |

### 5.20 `data` 데이터 엔지니어링 (확장 v2, 시드 10)

| id | 개념 | L | K | 층 | 선수 |
|---|---|---|---|---|---|
| data.pipeline-basics | ETL/ELT·배치 파이프라인 | L2 | C | 이·코·핵 | **db.sql-basics** |
| data.warehouse-modeling | 차원 모델링 (스타 스키마, SCD) | L3 | S | 이·코·핵 | data.pipeline-basics, **db.normalization** |
| data.analytics-sql | 분석 SQL 변환 (dbt) | L3 | P | 이·코·핵 | **db.sql-advanced** |
| data.orchestration | 워크플로 오케스트레이션 (Airflow, Dagster) | L3 | P | 이·코·핵 | data.pipeline-basics |
| data.batch-spark | 분산 배치 처리 (Spark) | L3 | P | 이·코·핵 | data.pipeline-basics |
| data.data-quality | 데이터 품질·계약 | L3 | S | 이·코·핵 | data.pipeline-basics |
| data.streaming | 스트림 처리 (Kafka Streams, Flink, 윈도우·워터마크) | L4 | C | 이·코·핵 | **be.messaging** |
| data.cdc | CDC (Debezium, 로그 기반) | L4 | P | 이·코·핵 | **db.wal-recovery** |
| data.lakehouse | 레이크하우스 (Iceberg/Delta 테이블 포맷) | L4 | C | 이·코·핵 | **db.olap-columnar** |
| data.governance-lineage | 데이터 거버넌스·계보 | L4 | S | 이·사·핵 | data.data-quality |

### 5.21 트랙 간 핵심 간선 요약 (그래프 품질 점검용)

- **인프라 체인**: `cs.process-thread → docker.container-concept → k8s.architecture → k8s.pod`; `linux.cgroups-namespaces → docker.oci-runtime`; `docker.healthcheck-signals → k8s.probes`.
- **데이터 체인**: `db.transactions → db.isolation-levels → db.mvcc`; `db.replication → arch.cap-pacelc → arch.consistency-models → arch.consensus → k8s.etcd-apiserver`.
- **AI 체인**: `ml.neural-networks → ml.transformer → llm.transformer-internals → llm.serving`; `ml.embeddings → db.vector-db`; `llm.rag-basics → llm.evaluation → llm.judgment-models`.
- **보안 교차**: `sec.authn-authz → cloud.iam → sec.cloud-security`; `sec.access-control → k8s.rbac → sec.container-k8s-security`; `llm.prompting → sec.llm-security → llm.guardrails`.
- **전달 체인**: `eng.git-basics → cicd.ci-concept → cicd.pipeline-basics → k8s.gitops → cicd.platform-eng`; `sre.slo → cicd.progressive-delivery`.
- **리더십 체인**: `eng.code-review → lead.mentoring → lead.engineering-culture`; `arch.quality-attributes → lead.tech-decision → lead.tech-strategy`.

### 5.22 규모 집계 (시드, §5 표에서 스크립트로 실측)

| 트랙 | L1 | L2 | L3 | L4 | L5 | 계 |
|---|---|---|---|---|---|---|
| alg | 8 | 8 | 7 | 4 | 2 | 29 |
| cs | 4 | 6 | 6 | 5 | 2 | 23 |
| net | 5 | 7 | 8 | 4 | 2 | 26 |
| lang | 4 | 6 | 8 | 3 | 2 | 23 |
| fe | 5 | 8 | 9 | 3 | 2 | 27 |
| be | 4 | 7 | 9 | 5 | 1 | 26 |
| db | 2 | 8 | 7 | 6 | 3 | 26 |
| linux | 5 | 8 | 7 | 1 | 1 | 22 |
| docker | 5 | 8 | 4 | 2 | 1 | 20 |
| k8s | 7 | 7 | 7 | 5 | 2 | 28 |
| cicd | 2 | 6 | 8 | 4 | 1 | 21 |
| sre | 1 | 4 | 8 | 5 | 2 | 20 |
| cloud | 4 | 5 | 7 | 4 | 1 | 21 |
| sec | 4 | 5 | 9 | 7 | 2 | 27 |
| ml | 3 | 6 | 7 | 6 | 1 | 23 |
| llm | 3 | 7 | 10 | 5 | 2 | 27 |
| arch | 0 | 2 | 7 | 11 | 6 | 26 |
| eng | 5 | 12 | 5 | 1 | 1 | 24 |
| lead | 3 | 3 | 5 | 5 | 4 | 20 |
| **코어 19 합계** | **74** | **123** | **138** | **86** | **38** | **459** |
| data (확장) | 0 | 1 | 5 | 4 | 0 | 10 |
| **총계** | **74** | **124** | **143** | **90** | **38** | **469** |

린트 실측 결과(§9 규칙을 본 문서 표에 적용): **선수 간선 518개(트랙 간 121개)**, 누락 참조 0, 순환 0, `level(prereq) > level(concept)` 위반 0, 최장 선수 체인 11(`lead.org-influence`), 고립 개념 4(`eng.debugging`, `eng.documentation`, `lead.communication`, `lead.ethics` — 기초 소양형으로 의도된 고립, R-ORPHAN warn 허용 목록).
- 모든 트랙이 트랙 내 선수 없는 진입 개념을 1개 이상 가진다. `arch`는 L2부터 시작(설계 원칙은 `lang.oop` 선수 필요 — 의도된 예외), `sre`는 L1이 1개뿐이며 L2 비중이 낮아 v1.1에서 L1~L2 보강 후보(예: 로그 읽기, 헬스체크 엔드포인트).
- `linux`·`docker`·`eng`는 L4~L5가 얇다 → 상위 레벨 학습은 `arch`·`sre`·`lead`의 Case와 교차 트랙 문제로 채운다(§2.5 원칙).

---

## 6. Concept 콘텐츠 스키마 (UR-10·UR-13 생성 가능성 확보)

### 6.1 설계 원칙

1. **구조화 필드 우선**: 이론/코드/핵심을 자유 텍스트 하나로 두지 않고, 문항 생성기가 바로 쓰는 원자 필드(KU, 오개념, 대조쌍, 코드 단계, 루브릭)로 분해한다.
2. **출처(provenance) 필수**: 모든 KU와 코드 예제는 `source_refs`를 가진다(저작권 방어 + Jev 근거 검증 입력).
3. **버전·변동성 1급 필드**: 15년 사용 시 가장 큰 품질 위험은 **버전 드리프트**(R2 `version_drift` 오개념).
4. **생성 주체 기록**: `authored | generated | imported` + 검증 상태 → 신뢰도 UI 표시와 재생성 정책 결정.
5. **Jev 친화**: 모든 참조를 객체 키(ID)로. 배열 인덱스 의존 금지(brief §3 함정).

### 6.2 Concept 스키마 (YAML, 콘텐츠 팩 저장 형식)

```yaml
Concept:
  id: k8s.probes                         # 불변 ID
  track: k8s
  module: workloads                      # 선택
  title: { ko: "Probe (liveness/readiness/startup)", en: "Kubernetes Probes" }
  aliases: ["헬스 체크 프로브", "health probe"]
  summary_one_line: "kubelet이 컨테이너 상태를 주기 점검해 재시작(liveness)·트래픽 제외(readiness)·기동 유예(startup)를 결정하는 메커니즘"
  level: L2                              # 진입 레벨
  knowledge_type: { primary: C, secondary: [P] }
  layers: [theory, code, key]            # theory|code|case|key
  tags: [qa:reliability, lc:operate, cert:CKAD, vol:evolving, mode:debug, mode:incident]
  estimated_minutes: { theory: 12, code: 20, key: 8 }

  relations:                             # R2 §2.5 간선 타입과 동일
    requires: [k8s.pod, docker.healthcheck-signals]
    part_of: [k8s.workloads]
    contrasts_with: [k8s.resources]      # "재시작 원인" 혼동 대상
    often_confused_with: []
    alternative_to: []
    related_cases: [case.k8s-liveness-restart-storm]

  objectives:                            # Bloom 동사 + 조건 + 기준 (ABCD 형식)
    - { bloom: understand, text: "세 가지 probe의 실패 시 kubelet 동작 차이를 설명한다" }
    - { bloom: apply,      text: "느린 기동 앱에 startupProbe를 설계해 재시작 루프를 방지한다" }
    - { bloom: analyze,    text: "이벤트/로그로 probe 기인 재시작과 OOMKilled를 구분한다" }
  depth_facets:
    L3: "의존성(DB) 상태를 liveness에 넣었을 때의 연쇄 재시작 위험을 분석한다"
    L4: "대규모 롤아웃 중 readiness gate·PDB와 결합한 가용성 설계를 평가한다"

  theory:
    motivation: "..."                    # 왜 존재하는가 (문제 → 해결)
    mechanism_md: "..."                  # 메커니즘 설명 (자체 저술)
    diagram_mermaid: "sequenceDiagram ..."
    pre_questions: ["readiness가 실패하면 컨테이너가 재시작될까?"]   # 사전 인출
    analogies: [{ text: "...", limits: "비유가 깨지는 지점" }]         # analogy_overreach 방지
    history_context: null                # L4+에서 사용 (설계 결정의 역사)

  code:
    runtime: { kind: k8s-manifest, sandbox: kind-cluster|dry-run|none, version_range: ">=1.29" }
    stages:
      worked:  { files: {deployment.yaml: "..."}, walkthrough: ["..."] }
      faded:   { files: {...}, blanks: [{key: startup_threshold, answer: "30", why: "..."}] }
      task:    { prompt: "...", starter: {...}, checks: [{kind: kubeconform}, {kind: yq-assert, expr: ".spec..."}] }
    predict_prompts: [{ snippet_ref: worked, question: "이 설정에서 앱 기동이 90초 걸리면?" }]
    bug_variants: [{ id: bug01, mutation: "livenessProbe.initialDelaySeconds 제거", symptom: "CrashLoopBackOff" }]

  case:                                  # S 유형 또는 L4+ facet에서 사용
    ref: case.k8s-liveness-restart-storm

  key:
    kus:                                 # R2 KnowledgeUnit (id: <concept>#kuNN)
      - { id: "k8s.probes#ku01", type: mechanism,
          statement: "readinessProbe 실패는 컨테이너를 재시작하지 않고 Service 엔드포인트에서 Pod를 제외한다.",
          scope: "Kubernetes ≥1.20", level_min: L2, bloom_affordance: [understand, analyze],
          cloze_keys: ["엔드포인트", "재시작하지 않고"], source_refs: ["src.k8s-docs#probes"] }
    misconceptions:
      - { id: "k8s.probes!mc01", kind: sibling_confusion,
          wrong_belief: "readiness 실패가 반복되면 kubelet이 컨테이너를 재시작한다",
          correction: "재시작은 liveness(및 startup) 실패에만 연동된다", prevalence: high,
          refutes: ["k8s.probes#ku01"] }
    contrast_pairs: [{ a: liveness, b: readiness, axis: "실패 시 동작" }]
    mnemonic: "Live=살려두나(재시작), Ready=손님 받나(트래픽)"
    blank_note_outline: ["세 probe의 목적", "실패 시 동작", "설정 필드 4개", "대표 장애 패턴"]  # 백지노트 채점 커버리지 기준
    dig_chain:                           # 개념 디깅 D1~D5 (R1 §3.5)
      - "왜 readiness와 liveness를 분리했는가?"
      - "liveness에 외부 의존성을 넣으면 무엇이 일어나는가?"

  assessment:
    item_affordances: [ox, mcq, cloze, predict, find_bug, scenario, blank_note, dig]
    mastery_evidence: { min_formats: 3, requires_code_task: true }
    rubrics:                             # Jev score 입력 (desc0..descN)
      explain: ["핵심 누락", "부분 정확", "정확하나 관계 설명 없음", "정확 + 실패 시 동작 대비 + 사례"]

  sources:
    refs:
      - { source_id: src.k8s-docs, locator: "/docs/concepts/configuration/liveness-readiness-startup-probes/",
          section: "Types of probe", retrieved_at: 2026-09-30, product_version: "1.34",
          usage: paraphrase }            # paraphrase | short_quote | code_adapted | link_only
  versioning:
    volatility: evolving                 # stable | evolving | volatile
    review_interval_days: 180
    verified_against: "Kubernetes 1.34"
    last_verified_at: 2026-09-30
  provenance:
    origin: generated                    # authored | generated | imported
    generator: { model_tier: upper, prompt_id: "gen.concept.v1" }
    review: { jev_grounding_min: 0.86, level_fit: 2.1, human_reviewed: false }
    trust: curated                       # official | curated | user | llm_unverified
    content_hash: "sha256:..."
  status: published                      # draft | review | published | deprecated
  supersedes: []
```

### 6.3 Case 스키마 (L3~L5 판단력 단위)

```yaml
Case:
  id: case.k8s-liveness-restart-storm
  kind: incident                         # incident | design | review | migration | tradeoff
  level: L3
  concepts: [k8s.probes, k8s.resources, sre.cascading-failure, db.connection-pool]   # 복수 트랙
  situation_md: "배포 직후 DB 지연 증가 → liveness가 DB 핑 포함 → 전 Pod 동시 재시작 → ..."
  artifacts: { logs: "...", metrics_csv: "...", manifests: {...} }   # 합성 데이터(자체 생성)
  constraints: ["SLO 99.9%", "롤백 5분 내"]
  decision_points:
    - { id: dp1, question: "즉시 조치는?", options: {o1: "...", o2: "..."}, best: o2, rationale: "..." }
  rubric: { dims: {diagnosis: [...4단계], mitigation: [...], prevention: [...]} }  # Jev score
  expert_debrief_md: "..."               # 전문가 해설 (LLM 생성 + 상위 모델 검토)
  inspired_by: [{ source_id: src.public-postmortem-x, usage: link_only }]    # 실제 사례는 링크·재구성만
```

### 6.4 Source 레지스트리 스키마

```yaml
Source:
  id: src.k8s-docs
  title: "Kubernetes Documentation"
  publisher: "The Kubernetes Authors / CNCF"
  base_url: "https://kubernetes.io/docs/"
  repo: "github.com/kubernetes/website"
  license: { spdx: CC-BY-4.0, class: A, verified: 2026-09-30, evidence: "repo LICENSE" }
  code_license: { spdx: CC-BY-4.0 }      # 코드 예제 라이선스가 다르면 분리 (MDN: CC0)
  attribution_template: "Source: Kubernetes Documentation (CC BY 4.0), {section}, {url}"
  allowed_usage: [link, short_quote, paraphrase, adapt_with_attribution, store_local]
  versioned_by: product_version          # 문서가 제품 버전 따라감
  fetch: { method: git-sparse|http, path_glob: "content/en/docs/**/*.md", robots_ok: true }
```

### 6.5 필드별 생성 책임 (UR-06 상위/하위 모델, UR-16 Jev)

| 필드 | 1차 생성 | 검증 | 비고 |
|---|---|---|---|
| id, track, level, relations, tags, objectives | **상위 모델 저술** (택소노미 = 본 문서) | 린트(§9) + 적대적 리뷰 | 구조는 사람이/상위 모델이 고정 |
| theory.* | LLM 생성 (소스 발췌를 컨텍스트로, 원문 복제 금지) | Jev `noul` 근거 일치(KU 단위), 복제 가드(§7.4) | 상위 모델 권장 |
| code.stages / bug_variants | LLM 생성 (하위 모델 가능) | **실행 검증**(sandbox에서 checks 통과) | 실행 불가 코드는 publish 금지 |
| key.kus | LLM 추출 → | Jev `noul`(원문 근거 P(yes) ≥ 0.8), `choice`(KU 유형 분류) | R2 §2 |
| key.misconceptions | 상위 모델 시드 + 학습자 오답 로그 | Jev `noul`("이 진술은 실제로 틀렸는가") | R2 §2.4 |
| assessment.rubrics | 상위 모델 | Jev `score` 파일럿 채점 일관성 | R1 §9 |
| level fit | — | Jev `score`(L1~L5 서술 루브릭) | 생성물이 목표 레벨을 벗어나면 재생성 |
| versioning | 소스 메타에서 자동 | 주기적 재검증 잡 | §7.6 |

---

## 7. 데이터 소스·라이선스·인용 정책

### 7.1 라이선스 등급 (Class)

| Class | 조건 | 허용 사용 | 대표 |
|---|---|---|---|
| **A 허용형** | CC BY 4.0, Apache-2.0, MIT, BSD, PostgreSQL, 0BSD, CC0 | 링크·인용·의역·**출처 표기 후 개작/번역·로컬 저장**·(코드) 예제 차용 | Kubernetes·React·TypeScript·OTel·MS Learn 문서, Docker docs, Prometheus docs, CNCF glossary, MDN 코드 예제, Python 문서 코드, PostgreSQL 문서 |
| **B 동일조건(Share-Alike)** | CC BY-SA 2.5/4.0 | 링크·짧은 인용·**의역(사실 추출)**. 개작물을 그대로 포함하면 SA 전파 → **원문 기반 개작 텍스트는 별도 저장·동일 라이선스 표시**, 시드 본문에는 혼입 금지 | MDN 산문(CC BY-SA 2.5), OWASP Top 10·Cheat Sheet Series(CC BY-SA 4.0), coding-interview-university(CC BY-SA 4.0) |
| **C 비상업·변경금지(NC/ND)** | CC BY-NC-ND 등 | 링크 + 요지 의역(사실·아이디어 수준)만. 발췌 저장 금지 | Google SRE 책(CC BY-NC-ND 4.0, △지식), Pro Git(CC BY-NC-SA 3.0, △지식) |
| **D 권리유보·개인 이용 한정** | All rights reserved, personal use only | **링크만**. 구조·목차·문구 복제 금지. 사용자의 개인 import 시 로컬 전용 격리 | **roadmap.sh**(✔실측), 상용 도서, 블로그 다수, IEEE SWEBOK(개인용 무료 다운로드, △지식), 대부분의 벤더 교육 자료 |
| **P 공공저작물·표준** | IETF RFC(TLP), NIST(미 연방정부 저작물), 국내 공공누리 | RFC: 원문 전체 복제·번역 허용 범위 있음, 코드 컴포넌트는 BSD(△지식) → 실무상 **섹션 앵커 링크 + 짧은 인용**. NIST SP는 자유 이용(△지식). 공공누리는 유형(1~4) 확인 | RFC 9110(HTTP), RFC 8446(TLS 1.3), NIST SP 800-63B, KISA 가이드 |

### 7.2 주요 소스 매핑표 (트랙별 1차 근거)

| 트랙 | 1차 소스 (공식) | 라이선스 | 비고 |
|---|---|---|---|
| fe | MDN Web Docs | 산문 CC BY-SA 2.5 / 2010-08-20 이후 코드 예제 **CC0** (✔실측) | 코드는 자유 차용, 산문은 의역 |
| fe | react.dev | 문서 CC BY 4.0 (✔실측, LICENSE-DOCS) | |
| fe/lang | TypeScript Handbook (TypeScript-Website) | CC BY 4.0 (✔실측) | |
| fe | WCAG 2.2 (W3C) | W3C Document License (△지식) | 링크·짧은 인용 |
| lang/be | Python 문서 | PSF, 문서 내 코드 **0BSD** (✔실측) | |
| lang/be | Node.js 문서 | MIT 계열 (✔실측, repo LICENSE) | |
| lang | Go 문서 (go.dev) | 코드 BSD-3 (✔실측), 사이트 콘텐츠 CC BY 4.0 (△지식) | |
| db | PostgreSQL 문서 | PostgreSQL License (✔실측, COPYRIGHT) | 허용형 |
| docker | Docker docs | Apache-2.0 (✔실측) | |
| k8s | kubernetes.io | CC BY 4.0 (✔실측) | CKA/CKAD 태그 근거 |
| sre | OpenTelemetry 문서 | CC BY 4.0 (✔실측) | |
| sre | Prometheus 문서 | Apache-2.0 (✔실측) | |
| k8s/cloud | CNCF Glossary | Apache-2.0 (✔실측) | 용어 정의 시드로 최적 |
| cloud | Microsoft Learn (azure-docs) | 문서 CC BY 4.0, 코드 MIT (✔실측) | |
| cloud | AWS 문서 | 대부분 저장소 아카이브·라이선스 혼재 (△지식) | 링크 우선 |
| sec | OWASP Top 10 / Cheat Sheet Series / ASVS | CC BY-SA 4.0 (✔실측: Top10, CheatSheet) | B 등급 처리 |
| sec | MITRE ATT&CK / CWE | MITRE 이용 약관(출처 표기 조건부 허용, △지식) | ID(CWE-79 등)는 사실 → 태그로 사용 |
| sec | KISA 가이드, 개인정보보호법(국가법령정보센터) | 법령은 저작권 보호 대상 아님(저작권법 제7조), KISA 자료는 공공누리 유형 확인 | `sec.compliance-kr` |
| net | IETF RFC | IETF Trust TLP (△지식) | 섹션 앵커 링크 (예: RFC 9110 §9.2.2 멱등성) |
| ml/llm | PyTorch 문서(BSD △지식), Hugging Face 문서(Apache-2.0 ✔실측: transformers repo) | | |
| llm | Anthropic/OpenAI 공식 문서 | 권리유보 (△지식) | **D 등급: 링크만**, 개념은 자체 저술 |
| llm | 논문 (arXiv) | 논문별 상이 (대개 arXiv 비독점 배포권만) | 인용·요약, 그림 복제 금지 |
| alg | 자체 저술 + TheAlgorithms(MIT ✔실측), javascript-algorithms(MIT ✔실측) | 코드 참고 가능 | 알고리즘 자체는 저작권 대상 아님 |
| arch | system-design-primer (CC BY 4.0, △지식 — LICENSE 머리말만 확인) | | 사례 영감 |
| 커리큘럼 좌표 | CS2023 (ACM/IEEE-CS/AAAI, 공개 무료), SWEBOK v4 (IEEE CS, 개인용 무료) | 본문 복제 금지 (△지식) | **KA 명칭·분류 매핑만** 사용 (§3.2) |
| 커버리지 점검 | roadmap.sh | **개인 이용 한정, 콘텐츠 반출·재게시 금지** (✔실측) | 링크 + 개인적 누락 점검에만. 노드·순서·문구 복제 금지 |

### 7.3 인용·저술 규칙 (원문 비복제)

1. **사실·개념·아이디어는 보호 대상이 아니다**(표현만 보호). 따라서 "TCP 3-way handshake는 SYN, SYN-ACK, ACK로 구성" 같은 KU는 자유롭게 **자체 문장으로** 작성한다.
2. **짧은 인용**은 따옴표 + 출처(섹션 앵커) + 라이선스 표기, 1~2문장/개념 이하로 제한(한국 저작권법 제28조 "정당한 범위·공정한 관행" 준수 취지). 인용은 정의(normative) 문장처럼 **원문 그대로여야 의미가 있는 경우**에만.
3. **번역도 2차적저작물**이다 → A 등급만 출처 표기 후 번역·개작 허용. B 등급 번역물은 SA 라이선스 명시 + 분리 저장. C/D는 번역 저장 금지.
4. **코드 예제**: MDN(CC0)·Python(0BSD)·A 등급 코드는 출처 주석과 함께 차용 가능. 그 외는 자체 작성.
5. **다이어그램**: 원 그림 복제 금지. Mermaid로 **자체 재작성**(구조가 사실을 표현하는 수준까지는 허용).
6. **LLM 생성 텍스트**: 학습 데이터 기억에 의한 원문 재현 위험 → §7.4 복제 가드 통과 필수.
7. 각 Concept 페이지 하단에 **"참고 자료"** 블록: 소스명·섹션·URL·라이선스·검증일. 원문 읽기(개념 디깅 D5 "1차 문헌 확인")로 유도.

### 7.4 복제 가드 (Copy Guard) — 생성 파이프라인 검증 단계

- 생성 시 컨텍스트로 제공한 소스 발췌와 생성 결과의 **최장 공통 부분 문자열 ≤ 80자**, **8-gram 중복률 ≤ 10%** (한국어는 형태소가 아닌 문자 n-gram 기준, 영어 원문 대비 번역 복제는 역번역 없이 탐지 어려우므로 A 등급 외 소스는 컨텍스트 제공 자체를 **요약 사실 목록(fact list)으로 제한**).
- 초과 시 자동 재생성(최대 2회) → 실패하면 `status: review`.
- `usage: short_quote`로 명시된 구간은 예외(따옴표·출처 필수).

### 7.5 사용자 가져오기(Import, UR-13) 정책

- 사용자가 URL/파일을 가져오면 로컬 DB에 `Source{origin: user_import, license.class: unknown→자동 추정}` 로 저장. 개인 로컬 학습은 사용자의 행위이므로 저장·요약·출제 허용.
- **격리 규칙**: `class ∈ {C, D, unknown}`인 import 원문과 그 발췌는 ① 콘텐츠 팩 내보내기(export)·공유 시 **제외**, ② LLM 생성 문항에는 출처 링크만 남기고 원문 인용 금지, ③ UI에 "개인용 자료" 배지.
- A 등급 판정(도메인 → 라이선스 매핑 테이블, 예: `kubernetes.io → CC-BY-4.0`)이 되면 일반 콘텐츠처럼 활용.
- robots.txt·이용약관 준수, 크롤링은 사용자 트리거 단건만(대량 수집 없음).

### 7.6 신선도(Freshness)·버전 관리 — 15년 운영(UR-12, UR-17)

| volatility | 예 | 재검증 주기 | 트리거 |
|---|---|---|---|
| stable | TCP, B-Tree, 정규화, 알고리즘 | 3년 | 표준 개정(RFC obsoletes) |
| evolving | K8s API, React, Docker, Terraform, PostgreSQL | 6개월 (K8s는 마이너 릴리스 주기에 맞춤) | 소스 repo 변경 감지(git diff on locator path) |
| volatile | LLM 모델·API·프레임워크, 클라우드 가격 | 1~3개월 | 수동 + 생성 시점 경고 표시 |

- KU에 `scope`(버전 범위) 필수 → 폐기 사실은 삭제하지 않고 `deprecated_since`로 남겨 **`version_drift` 오개념 문항의 재료**로 재활용(예: "Docker Compose `version:` 키는 필수다" → 거짓).
- 콘텐츠 팩은 SemVer(`content-pack@2026.10.0`)로 배포, 학습 이력은 Concept ID에 붙으므로 팩 업데이트 후에도 보존.

---

## 8. 콘텐츠 수집·생성 파이프라인 (아키텍처 입력)

```
[1 택소노미 YAML (본 문서 §5, 상위 모델 저술)]
      │  lint(§9)
      ▼
[2 소스 매핑] concept → source_refs(locator) — Source 레지스트리(§6.4)
      │  A: git sparse clone/HTTP로 섹션 발췌 로컬 캐시 / B·P: 발췌→fact list 변환 / C·D: 링크만
      ▼
[3 생성(LLM: API 또는 claude -p / codex exec)] theory → code stages → KUs → misconceptions → rubrics
      │  프롬프트에 level·objectives·fact list·금지 규칙(원문 복제 금지) 주입
      ▼
[4 검증] (a) Jev noul: KU 근거 일치 (b) Jev score: 레벨 적합도 (c) Jev choice: KU 유형/오개념 kind
      │  (d) 코드 샌드박스 실행 (e) 복제 가드 (f) 스키마 검증
      ▼
[5 리뷰 큐] 실패/경계 항목 → 상위 모델 또는 사용자 검토
      ▼
[6 콘텐츠 팩 빌드] content/tracks/<track>/<concept>.yaml + sources.yaml + cases/ → SQLite 적재(FTS5 trigram)
```

- 시드 범위(MVP 권장): 전체 469 Concept의 **메타데이터(§5)** 는 전부 적재, 본문 생성은 **기본 Path(`path.ai-fullstack-engineer`)의 L1~L2 약 90개 + 각 트랙 L1 진입 개념**부터(나머지는 on-demand 생성 — 사용자가 개념을 열 때 생성·검증·캐시).
- On-demand 생성은 로컬 LLM CLI/API 연결 상태에 의존(UR-15) → 오프라인이면 메타데이터·KU 시드·링크만 표시.

---

## 9. 택소노미 검증 규칙 (린트 — CI에서 실행)

| 규칙 | 내용 | 심각도 |
|---|---|---|
| R-ID | ID 정규식 `^[a-z0-9]+(\.[a-z0-9-]+)+$`, 접두어 = 트랙 ID, 전역 유일 | error |
| R-DAG | `requires` 간선 비순환 | error |
| R-LVL | `level(prereq) ≤ level(concept)` | error |
| R-REF | 모든 간선 대상 ID 존재 | error |
| R-ENTRY | 트랙마다 트랙 내 선수 없는 L1(또는 명시적 예외) 개념 ≥ 1 | warn |
| R-LAYER | `knowledge_type=S` → `case` 레이어 포함, `P` → `code` 포함 | warn |
| R-DIST | 트랙별 레벨 분포가 목표(§2.5) ±15%p 이탈 | info |
| R-SRC | published Concept는 A/B/P 등급 소스 ≥ 1 또는 `origin: authored` | error |
| R-DEPTH | 선수 체인 최대 깊이 ≤ 12 (학습 경로 과도 방지) | warn |
| R-ORPHAN | 선수도 후행도 없는 고립 개념 | warn |

이 린트 결과(개념 수·레벨 분포·교차 간선 수)는 graphify 코드 그래프와 별개로 **콘텐츠 그래프 리포트**로 출력해 회고(UR-03)에서 "초기 계획 대비 커버리지"를 점검하는 지표로 쓴다.

---

## 10. 설계 결정 제안 (아키텍처 단계로 이관)

| # | 결정 | 근거 |
|---|---|---|
| D-1 | Concept ID는 `track.slug`, KU는 `concept#kuNN`, 오개념은 `concept!mcNN` — R2 표기 통일 | Jev 객체 키 참조, 가독성, 15년 불변 |
| D-2 | 레벨 경계 R1 채택(0–1/1–3/3–6/6–10/10–15+), 레벨은 트랙 단위, L5 이후 폭 지표 | §2.1, §2.4 |
| D-3 | 코어 19트랙 + `data` 확장. 성능·테스트·관측성·보안은 트랙 + 태그 이중화 | §3.1 |
| D-4 | 지식 유형 D/C/P/S가 레이어·문항 affordance 결정. S 유형은 `case` 레이어 필수 | §4.3 |
| D-5 | Case를 1급 엔티티로 도입(복수 Concept 연결) — L4/L5 학습의 주 재료 | §6.3 |
| D-6 | 콘텐츠 팩 = YAML(Git 관리) → 빌드 시 SQLite 적재. 택소노미는 사람이 리뷰 가능한 텍스트 | 운영성(UR-17), diff 가능 |
| D-7 | roadmap.sh 등 D 등급은 링크만. 시드는 자체 저술 + A 등급 차용 + B 등급 사실 추출 | §7 |
| D-8 | 본문은 on-demand 생성 + 검증 + 캐시, 메타데이터는 전량 시드 | 규모(469×3레이어) 대비 현실성 |
| D-9 | 모든 KU에 `scope`·`volatility`, 폐기 사실은 `deprecated_since`로 보존해 버전 드리프트 문항 재료화 | §7.6 |

**미결 이슈(Open issues)**
- O-1: `data`·`mobile` 트랙을 v1 코어에 넣을지(사용자 DataAnalysis 이력 고려 시 `data`는 v1.1 권장).
- O-2: SWEBOK v4·CS2023의 정확한 라이선스 문구(개인용 무료 확인, 재사용 조건 미확인) — KA 명칭 매핑만 쓰므로 위험 낮음.
- O-3: 일부 `△지식` 라이선스(SRE 책, Pro Git, AWS 문서, RFC TLP 세부)는 구현 전 원문 확인 필요.
- O-4: Case 합성 데이터(로그·메트릭)의 현실성 확보 방법 — 로컬 Docker/kind로 실제 장애 재현 후 캡처하는 "랩 기반 케이스" 옵션 검토.

---

## 참고 (Sources)

실측(2026-09-30, 저장소 원본 license 파일):
- [roadmap.sh license (nilbuild/developer-roadmap)](https://github.com/kamranahmedse/developer-roadmap) — `license` 파일: "personal use … not allowed to use it for any other purpose"
- [MDN content LICENSE.md](https://github.com/mdn/content/blob/main/LICENSE.md) — 산문 CC BY-SA 2.5, 2010-08-20 이후 코드 CC0
- [OWASP CheatSheetSeries LICENSE](https://github.com/OWASP/CheatSheetSeries), [OWASP Top10 LICENSE](https://github.com/OWASP/Top10) — CC BY-SA 4.0
- [docker/docs LICENSE](https://github.com/docker/docs) — Apache-2.0
- [kubernetes/website LICENSE](https://github.com/kubernetes/website) — CC BY 4.0
- [TypeScript-Website LICENSE](https://github.com/microsoft/TypeScript-Website) — CC BY 4.0
- [react.dev LICENSE-DOCS](https://github.com/reactjs/react.dev) — CC BY 4.0
- [opentelemetry.io LICENSE](https://github.com/open-telemetry/opentelemetry.io) — CC BY 4.0; [prometheus/docs](https://github.com/prometheus/docs) — Apache-2.0; [cncf/glossary](https://github.com/cncf/glossary) — Apache-2.0
- [cpython Doc/license.rst](https://github.com/python/cpython/blob/main/Doc/license.rst) — 문서 내 코드 0BSD; [postgres COPYRIGHT](https://github.com/postgres/postgres/blob/master/COPYRIGHT); [MicrosoftDocs/azure-docs](https://github.com/MicrosoftDocs/azure-docs) — CC BY 4.0 / 코드 MIT
- [TheAlgorithms/Python](https://github.com/TheAlgorithms/Python), [trekhleb/javascript-algorithms](https://github.com/trekhleb/javascript-algorithms) — MIT; [coding-interview-university](https://github.com/jwasham/coding-interview-university) — CC BY-SA 4.0

웹 검색:
- [CS2023 – ACM/IEEE-CS/AAAI Computer Science Curricula](https://csed.acm.org/), [IEEE CS press release](https://www.computer.org/press-room/new-cs2023-curriculum-guide)
- [SWEBOK — IEEE Computer Society](https://www.computer.org/education/bodies-of-knowledge/software-engineering), [SWEBOK v4 release note](https://www.basicinputoutput.com/2024/10/guide-to-swebok-v40-has-been-released.html) — 18 KA, 2024-10-15 공개, 개인용 무료

작성자 지식 기반(미검증, `△지식`): Dreyfus(1980), Anderson & Krathwohl(2001), Biggs & Collis SOLO(1982), ISO/IEC 25010, Google SRE Book 라이선스, IETF Trust Legal Provisions, 한국 저작권법 제7조·제28조·제35조의5, Team Topologies, ATAM.
