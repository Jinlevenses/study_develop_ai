# SP-6 스파이크 보고서 — 승급 도달 가능성 시뮬레이션

- 대상 요구: FR-PRG-009 / FR-PRG-013 / FR-PRG-032 / FR-PRG-033, FR-CUR-025, NFR-MAINT-012 (`03-convergence.md` SP-6 행, 리뷰 BC-01·PX-02·FE-06)
- 코드: `/home/user/study_develop_ai/spikes/sp6-promotion-reachability/` (독립 패키지, `npm run spike`, `npm test`)
- 원시 결과: `spikes/sp6-promotion-reachability/results/result.json`(전체), `results/matrix.md`(전 조합 행렬)
- 검증 등급: 모든 수치는 **Linux 컨테이너 실측(V-build, 합성 학습자)**이다. 실제 콘텐츠 팩·실제 Jev·실제 학습자는 없으므로 이 보고서는 "규칙과 인벤토리가 구조적으로 도달 가능한가"와 "합성 학습자가 그 규칙 위에서 어떻게 움직이는가"를 답한다. 실사용 도달률은 **V-field pending**, Jev 보정 결과(SP-1)는 **V-live pending**이다(가중치·오판율 가정으로만 반영).

## 1. 가설

> 19트랙 × 전이 4(L1→L2 … L4→L5) × AI 모드 4(FULL·JUDGE_ONLY·LLM_ONLY·OFFLINE) × SP-1 결과 2(Jev 보정 통과/실패)의 모든 조합에서, (a) 이상적 학습자는 트랙 cap 이하의 모든 전이에 도달한다(OFFLINE은 잠정 포함), (b) 무작위 찍기 에이전트는 θ를 0.02 넘게 올리지 못하고 Mastered를 하나도 얻지 못한다.

## 2. 방법

1. **참조 구현(순수 TS)**: `src/promotion.ts`는 I/O·시계·난수·전역이 없는 순수 모듈이고, 모든 함수가 `MasteryRules` 정책 객체(`src/policy.ts`, `mastery_rules@v1`·`method_policy@v1` 형태)를 인자로 받는다. 구현한 규칙: 증거 가중 `w = w_format × w_grader × gaming`(FR-PRG-002), 가중 Elo(FR-PRG-008), Mastered 2조건(FR-PRG-009), 승급 T1~T4 게이트(FR-PRG-013/032: 필수 개념 85% 또는 희소 레벨 규칙, 12문항 평가·CBM, D4, Case, Transferred, Taught|산출물), 잠정 판정과 철회(FR-PRG-033), 구조적 도달 가능성 분석 `structuralFeasibility()`, cap 오라클 `computeCap()`(FR-CUR-025). 단위 테스트 15건(경계값: 0.7×0.9=0.63, LLM-judge 0.6 경계, CBM 27/36=0.75, 필수 개념 비율 등) 전부 통과.
2. **인벤토리**(`src/inventory.ts`): R4 §5.22(트랙×레벨 개념 수), CNV §9.3(Tier A 배분·cap 표), §9.2(Tier B 120 구성), §9.4(풀 크기), §9.5(Case 30개, 트랙 태그·하한 표시)에서 파생. **Tier B의 트랙별 배분은 문서에 총합만 있으므로 최대잉여법으로 배분한 가정**이다(합계 A 72 · B 120 일치 확인). 실제 팩의 `required_for_level`로 교체해야 한다.
3. **합성 학습자**(`src/sim.ts`, 시드 고정 결정적):
   - 이상적: θ* = 2.8(중앙 문항 정답률 ≈ 0.94), 하루 24문항, 매일 학습, 오채점·급답·힌트 없음, CBM은 높은 확신도로 정직하게 보고.
   - 현실적: θ*가 노출 횟수에 따라 −0.5 → N(2.3, 0.5)로 성장(τ = 10), 하루 14문항·주 5일, 급답 8%(w=0)·힌트 10%, 자기채점 거짓 양성 15%, 과신 +0.08, Case N(2.9, 0.55).
   - 무작위 찍기: 닫힌 형식은 1/선택지 수, 열린 형식은 0, 자기채점은 정직하게 0점, 하루 60문항, 60일. 변형 `random_ox`(가장 찍기 유리한 OX만 반복), 확장 적대 에이전트 `gamer_pure`(자기채점 형식만 반복하며 전부 정답 표시), `gamer_seq`(30일간 자기채점으로 θ 부풀림 → 이후 결정적 형식을 찍어 F ≥ 3을 운으로 수집).
   - 시뮬레이터는 매일 (1) 필수 개념 학습(라우터: 미충족 산입 형식 우선) (2) 게이트 활동(디깅·Case·Feynman·산출물) (3) `decidePromotion()` 호출, 자격이 되면 12문항 평가를 치르고 실패 시 14일 뒤 재도전한다.
4. **판정 방식**: 조합마다 먼저 `structuralFeasibility()`(콘텐츠 인벤토리와 정책만으로 원리상 불가능한 조합) → 통과한 조합만 몬테카를로 실행. 이상적 학습자 10시드(≥ 95% 도달이면 도달, 200일), 현실적 30시드(240일), 무작위 6시드(60일). 기호: `C` 도달·확정 / `P` 도달·잠정 / `X` 구조적 도달 불가 / `x` 기간 내 미도달 / `-` cap 초과(정책이 제안하지 않음).
5. **세 정책 변형**: A = 문서 그대로, B = 정책만 수정(F1+F2+F3), C = 정책 수정(F1+F3+F4) + 콘텐츠 Brief. 각 수정은 6장.

## 3. 환경

| 항목 | 값 |
|---|---|
| Node | `v22.22.2` |
| OS | Linux 6.18.44-fc-v50 x86_64 (컨테이너, 4 vCPU) |
| 의존성 | tsx 4.23, typescript 7.0.2 (`tsc --noEmit` 통과), @types/node. 런타임 외부 의존 없음 |
| 실행 시간 | `npm run spike` 111초, `npm run spike:quick` 약 35초 |
| 미검증 | Windows/macOS(무관, 순수 계산), 실제 콘텐츠 팩, 실제 Jev(SP-1), 실사용자 |

## 4. 결과

### 4.1 인벤토리와 cap 오라클 (`computeCap`, OFFLINE 기준)

필수 개념 = 해당 레벨 Tier A + B 수(가정). 열은 L1~L5.

| 트랙 | 필수 개념 수 L1/L2/L3/L4/L5 | 선언 cap | 오라클 cap(문서대로) | 정책 수정+Brief 후 |
|---|---|---|---|---|
| alg | 7/1/1/0/0 | L4 | L4 | L4 |
| cs · net · lang · linux | 4/1/1/0/0 | L4 | L4 | L4 |
| fe | 4/7/4/0/0 | L4 | L4 | L4 |
| be | 4/6/4/1/0 | L5 | L5 | L5 |
| db | 2/7/4/1/1 | L5 | L5 | L5 |
| docker | 5/7/4/0/0 | L5 | **L4** | L5 |
| k8s | 6/6/4/1/0 | L5 | L5 | L5 |
| cicd | 2/6/4/0/0 | L5 | **L4** | L5 |
| sre | 1/1/1/2/1 | L5 | L5 | L5 |
| cloud | 4/1/1/0/0 | L5 | **L4** | L5 |
| sec | 4/1/1/2/1 | L5 | L5 | L5 |
| ml | 3/5/4/0/0 | L5 | **L4** | L5 |
| llm | 3/6/4/1/1 | L5 | L5 | L5 |
| arch | 0/1/1/2/1 | L5 | **L1** | L5 |
| eng | 4/5/1/0/0 | L5 | **L4** | L5 |
| lead | 3/0/0/2/1 | L5 | **L2** | L5 |

- 문서의 cap 표(L5 13트랙·L4 6트랙) 중 **7개 트랙(docker·cicd·cloud·ml·eng·arch·lead)은 문서 규칙 그대로 계산하면 선언 cap에 못 미친다**. 원인은 §4.3.
- FULL 모드로 계산하면 arch만 L1(나머지는 Tier C 온디맨드 생성으로 L5). JUDGE_ONLY는 OFFLINE과 같은 결과.
- **하한 시나리오**(Case를 ● 12개로 축소, Tier A/B는 목표 그대로): 문서대로 arch L1·lead L2이므로 "모든 트랙 cap ≥ L3" 보장이 깨지고, 수정 후(F1+F3+Brief) 최저 cap = alg·lang·fe·arch **L3** → 보장 성립. (하한 Tier A 40 목록이 미공개라 Case만 바꾼 민감도다.)

### 4.2 이상적 학습자 — 문서 그대로(정책 A)

608조합 중 cap 초과 48(6트랙×8, 정책이 `blocked_cap`으로 거부함을 확인) → 대상 **560조합**: 도달 확정 468 · 도달 잠정 52 · **도달 불가 40**.

| 트랙 | cap | FULL·SP1통과 | FULL·SP1실패 | JUDGE·SP1통과 | JUDGE·SP1실패 | LLM_ONLY | OFFLINE |
|---|---|---|---|---|---|---|---|
| alg | L4 | CCC- | CCC- | CCC- | CCC- | CCC- | CCP- |
| cs | L4 | CCC- | CCC- | CCC- | CCC- | CCC- | CCP- |
| net | L4 | CCC- | CCC- | CCC- | CCC- | CCC- | CCP- |
| lang | L4 | CCC- | CCC- | CCC- | CCC- | CCC- | CCP- |
| fe | L4 | CCC- | CCC- | CCC- | CCC- | CCC- | CCP- |
| be | L5 | CCCC | CCCC | CCCC | CCCC | CCCC | CCPP |
| db | L5 | CCCC | CCCC | CCCC | CCCC | CCCC | CCPP |
| linux | L4 | CCC- | CCC- | CCC- | CCC- | CCC- | CCP- |
| docker | L5 | CCCC | CCCC | CCC**X** | CCC**X** | CCCC | CCP**X** |
| k8s | L5 | CCCC | CCCC | CCCC | CCCC | CCCC | CCPP |
| cicd | L5 | CCCC | CCCC | CCC**X** | CCC**X** | CCCC | CCP**X** |
| sre | L5 | CCCC | CCCC | CCCC | CCCC | CCCC | CCPP |
| cloud | L5 | CCCC | CCCC | CCC**X** | CCC**X** | CCCC | CCP**X** |
| sec | L5 | CCCC | CCCC | CCCC | CCCC | CCCC | CCPP |
| ml | L5 | CCCC | CCCC | CCC**X** | CCC**X** | CCCC | CCP**X** |
| llm | L5 | CCCC | CCCC | CCCC | CCCC | CCCC | CCPP |
| arch | L5 | **X**CCC | **X**CCC | **XX**CC | **XX**CC | **X**CCC | **XX**PP |
| eng | L5 | CCCC | CCCC | CCC**X** | CCC**X** | CCCC | CCP**X** |
| lead | L5 | CCCC | CCCC | C**XX**C | C**XX**C | CCCC | C**XX**P |

(각 셀 = T1 T2 T3 T4. LLM_ONLY·OFFLINE은 Jev를 쓰지 않아 SP-1 결과와 무관하다. 코드로 보장: `jEngine`·`assessmentEngines`·`rubricEngine`이 sp1 인자를 무시하며, 행렬에서도 동일.)

- **SP-1 결과(Jev 보정 통과/실패)는 어떤 조합의 도달 가능성도 바꾸지 않았다.** 승급 평가는 결정적 형식만으로 구성 가능하고(보정 엔진 규칙), 서술형 증거는 Jev 미보정 0.7·LLM-judge 0.6이 형식 산입 2조건을 통과하기 때문이다. SP-1은 도달 여부가 아니라 **표시 배지·재채점 부담**에만 영향을 준다.
- **잠정(P) 52개는 전부 OFFLINE T3·T4**다. 이는 FR-PRG-033·SCN-07("OFFLINE = 잠정")과 일치한다. OFFLINE T1·T2(D4 MCQ 포함)는 확정으로 도달, FULL·JUDGE_ONLY·LLM_ONLY는 전 구간 확정이다.
- 도달 불가 40조합의 원인(구조적 분석과 시뮬레이션 일치):

| 조합 | 수 | 원인(blocker) | 근거 |
|---|---|---|---|
| docker·cicd·cloud·ml·eng T4 × (JUDGE_ONLY 2 + OFFLINE 2) | 20 | `NO_ASSESSMENT_POOL:L4` — L4에 Tier A/B가 0개라 12문항 결정적 평가 풀이 0(Tier C는 골격뿐이라 문항 없음). FULL·LLM_ONLY는 Tier C 온디맨드 생성으로 우회 | FR-PRG-013 ②, CNV §9.2 |
| arch T1 × 8 | 8 | `EMPTY_LEVEL` — arch는 L1 개념이 0개(R4 "L2부터 시작, 의도된 예외")인데 규칙에 빈 레벨 처리가 없음 | R4 §5.22 |
| arch T2 × (JUDGE_ONLY·OFFLINE 4) | 4 | `D4_POSSIBLE<REQUIRED` — D4 가능 개념(레벨 ≤ 2, JUDGE_ONLY·OFFLINE에서는 Tier A만) = 1 < "최소 2" | FR-PRG-013 ③ |
| lead T2 × 4 (JUDGE_ONLY·OFFLINE) | 4 | L2에 Tier A/B 0 → 평가 풀 0, D4 가능 1 < 2 | CNV §9.3 |
| lead T3 × 4 | 4 | L3에 Tier A/B 0 → 평가 풀 0 | CNV §9.3 |

### 4.3 왜 규칙이 이런 결과를 낳는가

- Tier B는 코어 L1, 경로 트랙(llm·be·fe·db·docker·k8s·cicd·ml) L2·L3, eng L2에만 있다. **sre·sec·cloud·arch·lead·eng L3 등 비경로 트랙 L2·L3와 거의 모든 트랙 L4·L5는 Tier A(0~2개)뿐**이다. 필수 개념이 3개 미만이면 희소 레벨 규칙으로 개념 게이트는 면제되지만 **평가 12문항은 면제되지 않는데**, 그 문항은 해당 레벨의 Tier A/B에서만 나온다. lead L2·L3(Tier C 3·5개), docker·cicd·cloud·ml·eng L4가 이 구멍에 빠진다.
- 문서의 cap 계산 정의("Lk→Lk+1 조건의 OFFLINE 증거가 모두 존재하는 최고 레벨")에는 **평가 문항 풀**이 항목으로 들어 있지 않아, 깊이 자산(Case·Tier A) 표만 보면 이 결함이 보이지 않는다.

### 4.4 이상적 학습자 — 수정 후

| 변형 | 대상 조합 | 확정 | 잠정 | 도달 불가 |
|---|---|---|---|---|
| A 문서 그대로 | 560 | 468 | 52 | **40** |
| B 정책만 수정(F1+F2+F3) | 560 | 494 | 62 | **4** (lead T3 JUDGE_ONLY·OFFLINE) |
| C 정책(F1+F3+F4) + 콘텐츠 Brief | 560 | 496 | 64 | **0** |

변형 C에서 잠정 64개 = OFFLINE T3 38(19트랙 × SP-1 2) + OFFLINE T4 26(cap L5 13트랙 × 2), 나머지는 모두 확정.

### 4.5 현실적 학습자(정보용, 합격 기준 없음)

30시드, 240일 안에 도달한 비율(대상 조합은 도달 불가 제외). 변형 C 기준 모드×전이별 평균 도달률과 중앙값(일):

| 모드 | T1 | T2 | T3 | T4 |
|---|---|---|---|---|
| FULL | 0.85 / 38일 | 0.89 / 52일 | 0.91 / 46일 | 0.88 / 37일 |
| JUDGE_ONLY | 0.84 / 37일 | 0.89 / 27일 | 0.91 / 17일 | 0.89 / 29일 |
| LLM_ONLY | 0.85 / 44일 | 0.89 / 51일 | 0.91 / 50일 | 0.91 / 38일 |
| OFFLINE | 0.87 / 37일 | 0.93 / 30일 | 0.91 / 18일 | 1.00 / 21일 |

- 문서 그대로(A)도 도달 가능한 조합의 평균은 0.84~0.99로 같은 범위다. 최저 도달률 셀: docker T4 LLM_ONLY 0.50, k8s T1 FULL·SP1실패 0.60(필수 개념 6개), cs T1 OFFLINE 0.63(필수 4개).
- **필수 개념 비율 85%는 n ≤ 6에서 사실상 100%다**: n=3·4·5·6 → 각각 3·4·5·6개 전부, n=7 → 6, n=8 → 7, n=12 → 11(`neededMastered`). 현실적 학습자가 낮은 셀에서 걸리는 지점이 이 개념 하나(마지막 Mastered)였다.
- 12문항 평가의 CBM은 C3 확신 기준으로 **정확도 90% 이상**이 있어야 한다(아래 표). 한 문항 틀림(27/36 = 75%)이 70%·75% 기준을 모두 통과하고, 두 문항 틀림(50%)은 모두 탈락한다 → **L4→L5의 75%는 L1~L4의 70%와 12문항에서는 같은 기준**이다. 전부 정답이어도 C2로만 답하는 정직한 학습자는 66.7%로 탈락한다.

| 참 정확도 | C3 응답 시 1회 통과확률(70% = 75%) | 95% 도달까지 필요 시도 |
|---|---|---|
| 0.80 | 0.275 | 10 |
| 0.85 | 0.443 | 6 |
| 0.90 | 0.659 | 3 |
| 0.95 | 0.882 | 2 |
| 0.97 | 0.951 | 1 |

(재도전 14일 간격이므로 정확도 0.85 학습자는 평균 약 2~3개월이 걸린다.)

### 4.6 무작위 찍기 에이전트 (정책 A, 6시드 × 19트랙 × 4전이 × 모드; 이벤트 ≥ 30인 개념 실행 기준)

| 에이전트 | 모드 | 표본 | 최종 Δθ 평균 | p95 | 최대 | Δθ > 0.02 비율 | 순간 최고 Δθ(p95 / 최대) | Mastered | 승급 |
|---|---|---|---|---|---|---|---|---|---|
| 혼합 찍기 | FULL | 5016 | −3.01 | −2.55 | −2.08 | 0 | +0.28 / +0.87 | **0** | 0 |
| 혼합 찍기 | JUDGE_ONLY | 2232 | −3.06 | −2.59 | −2.17 | 0 | +0.29 / +0.62 | **0** | 0 |
| 혼합 찍기 | LLM_ONLY | 2508 | −2.99 | −2.54 | −2.03 | 0 | +0.28 / +0.64 | **0** | 0 |
| 혼합 찍기 | OFFLINE | 1116 | −3.24 | −2.81 | −2.35 | 0 | +0.27 / +0.43 | **0** | 0 |
| OX만 반복(추측 보정 Elo) | 전 모드 | 각 1116~5016 | −2.17~−2.30 | −1.57~−1.71 | −0.75~−1.23 | 0 | +0.47~0.48 / +0.9~1.0 | **0** | 0 |
| OX만 반복(**보정 없는 순진한 Elo**) | 전 모드 | 각 1116~5016 | **+0.49~+0.50** | +0.62~0.67 | +0.80~0.92 | **1.00** | +1.25 / +1.83 | 0 | 0 |

(θ는 하한 −4로 고정되어 평균이 −3 부근에서 포화한다. 초기 θ0 = −0.5.)

- **추측 보정 Elo(`P = c + (1−c)·σ(θ−β)`, c = 1/선택지 수)가 있어야만 기준이 성립한다.** 보정이 없으면 OX(c = 0.5)를 반복하는 찍기가 θ를 +0.5까지 올린다(합격 기준 25배 초과). 혼합 형식 찍기는 빈칸·단답이 0점이라 순진한 Elo에서도 우연히 통과하므로, **OX 반복 변형이 필수 회귀 테스트**다.
- 순간 최고치: 찍기가 몇 번 연속 맞히면 θ가 일시적으로 +0.3~+1.0까지 오른다(MCQ 한 번 우연히 맞히면 +0.26). 기준을 "궤적의 어느 순간도 +0.02 이하"로 엄격히 읽으면 **어떤 K 스케줄로도 불가능**하다(학습 속도가 사라진다). 아래 5장에서 최종·세션 단위 기준으로 정의한다.

### 4.7 적대적 자기채점 에이전트 (문서의 "무작위" 범위를 넘는 확장; OFFLINE만 영향)

| 에이전트 · 정책 | OFFLINE 최종 Δθ 평균 | p95 | Δθ>0.02 비율 | **Mastered(개념 실행 1116 중)** |
|---|---|---|---|---|
| gamer_pure · 문서 그대로(자기채점 편향 추적 켬) | **+3.17** | +3.53 | 1.00 | 0 (형식 F < 3) |
| gamer_pure · 편향 추적 끔 | +3.16 | +3.52 | 1.00 | 0 |
| gamer_seq(30일 자기채점 → 이후 결정적 형식 찍기) · 문서 그대로 | −0.06 | **+2.31** | 0.155 | **115** |
| gamer_seq · 편향 추적 끔 | +0.28 | +2.36 | 0.64 | **123** |
| gamer_pure · **F4(θ_eff = min(θ, θ_q + 0))** | −0.11 | 0 | 0.013 | 0 |
| gamer_seq · **F4** | −2.90 | −2.23 | 0 | **0** |
| (민감도) gamer_pure · F4 상한 +0.5 | +0.40 | +0.50 | 0.94 | 0 |

- FULL·JUDGE_ONLY·LLM_ONLY에서는 자기채점 경로가 없어 모든 적대 에이전트가 무력하다(Δθ −2~−3, Mastered 0).
- **문서 그대로의 OFFLINE에서는 자기채점만 반복해도 θ가 +3 이상 오르고**(w_grader 0.3이어도 무한 반복하면 누적), 자기채점 편향 추적 계수(`selfBiasFactor`)는 **결정적 증거가 5건 미만이면 1(무효)**이라 기준선이 없는 공격은 못 막는다. 이후 결정적 형식을 찍어 우연히 F ≥ 3을 채우면 P ≥ 0.8이 이미 부풀어 있으므로 **Mastered가 나온다**(115건). 승급은 결정적 12문항 평가(CBM 70%)가 막아 0건이었다.
- F4(유효 θ = 결정적·산입 가능 엔진 증거로만 오른 θ_q를 넘지 못함)로 두 공격 모두 차단된다.

### 4.8 (참고) 정직한 학습자에 대한 F4 부작용 없음
현실적 학습자 변형 C(F4 포함) 도달률은 문서 그대로와 같은 범위(§4.5 표는 변형 C 값)이며 이상적 학습자는 496+64 = 560 전부 도달한다.

## 5. 합격 기준 대비 판정

| 기준 | 판정 | 근거 |
|---|---|---|
| (1) 이상적 학습자가 cap 이하 모든 전이 도달(OFFLINE 잠정 허용) | **FAIL(문서 그대로) → 수정 후 PASS** | A: 560 중 520 도달·**40 도달 불가**(docker·cicd·cloud·ml·eng T4 JUDGE/OFFLINE 20, arch T1·T2 12, lead T2·T3 8). C(F1+F3+F4+Brief): 560/560 (확정 496·잠정 64) |
| (1a) 잠정은 OFFLINE에서만, FULL·JUDGE·LLM은 확정 | PASS | 잠정 52/52가 OFFLINE T3·T4. OFFLINE T1·T2는 결정적 D4 MCQ로 확정 |
| (1b) cap 초과 승급은 제안하지 않음 | PASS | 48조합 전부 `blocked_cap` |
| (1c) 선언 cap이 인벤토리 오라클과 일치(FR-CUR-025) | **FAIL(7트랙)** | docker·cicd·cloud·ml·eng = L4, arch = L1, lead = L2로 계산됨(§4.1). 수정 후 전부 일치 |
| (2) 무작위 에이전트 θ 상승 ≤ 0.02 | **PASS(최종·세션 단위) / PARTIAL(순간 최고치)** | 최종 Δθ 평균 −3.0(전 모드), 0.02 초과 0%. 단 추측 보정 Elo가 **필수**(순진한 Elo에서 OX 반복 +0.50 FAIL). 순간 최고 p95 +0.28, 최대 +1.0 |
| (3) 무작위 에이전트 Mastered 0 | **PASS** | 4개 모드 합 0(혼합·OX 반복). 승급 0 |
| (3a) 적대적 자기채점(확장) Mastered 0 | **FAIL(OFFLINE, 문서 그대로) → F4로 PASS** | gamer_seq 115건 → 0건 |
| 참고: 현실적 학습자 | 정보 | 도달률 0.84~1.00, 중앙값 17~52일. 필수 개념 n ≤ 6에서 85%가 100%가 되는 점이 최대 마찰 |

**종합**: SP-6 통과 조건은 **"적용 대응(F1·F3·F4 + 콘텐츠 Brief 7건 + 추측 보정 Elo 필수화)이 확정되면 PASS"**로 판정한다. 그대로는 통과하지 못한다.

## 6. 설계 권고

### 6.1 최소 정책·파라미터 수정 (각각 `mastery_rules@v1` 한 줄)

| ID | 수정 | 해소하는 조합 | 검증 |
|---|---|---|---|
| **F0 (필수)** | `elo.guess_correction: true` — `P = c + (1−c)·σ(θ−β)`, c = 1/선택지 수(열린 형식 0). `item_options`를 문항 메타(`n_options`)로 저장 | 무작위(OX 반복) θ | 순진한 Elo +0.50 → −2.2 |
| **F1** | `promotion.empty_level: "skip"` — 트랙의 해당 레벨 개념이 0개면 그 전이는 자동 충족, 트랙 시작 레벨 = 첫 비어 있지 않은 레벨 | arch T1 (8) | arch cap 1 → 5 |
| **F3** | `d4.floor_mode: "min_with_possible"` — 필요 D4 개념 수 = `max(min(2, possible), min(5, possible))`. 불가능한 "최소 2"를 두지 않음 | arch T2 (4), lead T2(JUDGE·OFFLINE) | possible < 2 트랙 해소 |
| **F4** | `elo.unqualified_ceiling: 0` — 유효 θ = `min(θ_all, θ_q + 0)`, θ_q는 `w_format ≥ 0.7 ∧ w_grader ≥ 0.6` 이벤트로만 갱신. 숙달 P·LDI 입력은 유효 θ 사용 | 자기채점 부풀림 | gamer_seq Mastered 115 → 0, 정직 학습자 도달률 불변. 상한 +0.5는 gamer_pure Δθ +0.40으로 부족 |
| F2 (비권장) | `sparse.fallback_pool: "adjacent_level_ab"` — 평가 풀이 모자라면 한 레벨 아래 Tier A/B에서 차용 | docker·cicd·cloud·ml·eng T4 (20) | lead T3 4조합은 남고, **낮은 레벨 문항으로 상위 승급을 판정하는 약한 증거**라 채택하지 않음 |

### 6.2 콘텐츠 보강 Brief (코드 구조 불변, SP-6 폴백 "cap 하향 표시 + 콘텐츠 보강 Brief")

`proposeBrief()`가 정책 C에서 모든 선언 cap 전이를 모든 모드에서 구조적으로 도달 가능하게 만드는 **최소 Tier B `required_for_level` 추가**를 산출했다.

| 트랙·레벨 | 추가 Tier B | 비고 |
|---|---|---|
| docker L4, cicd L4, cloud L4, ml L4, eng L4 | 각 1 | Tier C → B 승격. 20문항(저작 5 + T2 15) 풀로 평가 12문항·형식 4 충족. **여유를 위해 각 2 권장**(풀 20 − 학습 소모 후 신규 문항 마진 없음) |
| lead L2, lead L3 | 각 1 | lead L2·L3는 현재 Tier C뿐(3·5개). **각 2~3 권장**(≥ 3이면 개념 게이트가 정상 적용) |
| 합계 | 7개(권장 약 14개) | 34cu 목표 대비 1cu 미만. cap 하향 대안: 위 5+2 트랙을 v1 cap L4/L2로 표시 |

Brief가 없으면 해당 트랙 cap은 표 4.1의 오라클 값으로 **지도에 정직하게 표시**해야 한다(docker·cicd·cloud·ml·eng = L4, arch·lead는 F1·F3 없이는 L1·L2).

### 6.3 코드 재사용 지침 (`promotion.ts` → `services/learning`)

- **정책 객체**: 모든 임계값(`mastered.formatCounts {wFormatMin 0.7, wGraderMin 0.6}`, `promotion.requiredMasteredRatio 0.85`, `minRequiredForConceptGate 3`, `assessment {items 12, formatsMin 4, cbmMin {1..3: 0.7, 4: 0.75}, retryDays 14}`, `d4`, `caseGate`, `l5`)와 AI 모드 프로파일(엔진 사다리)을 정책 파일 값으로 두고, 순수 함수에 인자로 넘긴다. 이벤트에 `policy_version` 기록(FR-CUR-017).
- **임계 비교는 항상 `geq(a, b)`(ε = 1e-9)**: `27/36 ≥ 0.75`, `LLM-judge 0.6 ≥ 0.6`, `0.7×1.0` 같은 경계가 부동소수점에서 어긋난다.
- **형식 산입은 곱이 아니라 2조건**: `geq(w_format, 0.7) && geq(w_grader, 0.6) && correct && gaming > 0 && !pending`(DEC-CNV-19). 급답(w=0)은 형식 수에도 안 들어간다.
- **`applyResponse(policy, state, event) → {state, weight}`**: 이벤트는 불변, 상태는 새 객체. `w ≤ 0`이면 θ 불변. Elo K = `α/(1+b·n)`(α 0.8, b 0.05), n은 w>0 관측 수. θ_q를 같이 갱신한다.
- **`structuralFeasibility(policy, inventory, transition, mode, sp1)`를 승급 화면의 "부족 조건" 표시와 팩 리포트(FR-CUR-025 cap)에 그대로 재사용**한다. 학습자 없이 인벤토리와 정책만으로 blocker 코드(`NO_ASSESSMENT_POOL`, `EMPTY_LEVEL`, `D4_POSSIBLE<REQUIRED`, `CASE_L4+<2`, `MASTERY_FORMATS<3:<id>`)를 반환한다. **cap 계산에 "레벨별 평가 문항 풀 ≥ 12·형식 ≥ 4"를 항목으로 추가**한다(FR-CUR-025 수용기준 변경).
- **평가 구성 `composeAssessment`**: 결정적(D) 형식 + (SP-1 통과 시) calibrated Jev 형식만, 형식 라운드로빈으로 12문항, 형식 ≥ 4 미달이면 `ok=false`와 사유를 반환한다.
- **판정 카드**: `decidePromotion()`이 `profile`(`정책버전/AI모드/SP1`)과 `gates[]`(id·ok·detail)를 반환하므로 FR-PRG-033 "적용 프로파일 표기 100%"를 그대로 렌더링한다.
- **잠정**: 게이트 증거 중 자기채점·휴리스틱이 결정적이면 `provisional=true`. `reconcileProvisional(levelNow, regradePassed)`는 **어떤 경우에도 레벨을 내리지 않고** `provisional_revoked` + "재확인 필요"만 반환한다(BR-14).

### 6.4 필수 회귀 테스트(이 스파이크의 테스트를 그대로 수용기준화)

1. OX(w 0.5) 20회 정답은 Mastered 아님 / Tier B OFFLINE MCQ·빈칸·매칭 3형식 + 2일 → Mastered.
2. 자기채점 반복 400회 후 유효 θ ≤ θ0 + 0, Mastered 불가(F4).
3. OX 반복 찍기 600회 후 Δθ < 0.02, 보정 끄면 > 0.3(테스트가 "보정이 필요함"을 증명).
4. 19트랙×4전이×8조합 구조적 도달 가능성: 선언 cap 이하 blocker 0(CI 게이트, 팩 변경마다).
5. cap 초과 전이는 `blocked_cap`.

### 6.5 정책 명확화가 필요한 항목 (설계 결정 요청)

1. **CBM 기준**: 12문항에서 75%와 70%가 동치이고(1문항 오답 = 75%), C2 전부 정답 = 66.7% < 70%. 의도가 "90% 이상 정확도 + 높은 확신"이면 그대로 두되 명시하고, 아니라면 분모를 `기대 최대(자기 확신도 기준)` 등으로 재정의한다. `cbm_min`을 파라미터로 이미 분리했다.
2. **필수 개념 비율**: n ≤ 6에서 85% = 100%. 현실적 학습자 마찰의 주원인이며 완화안(예: `max(n−1, ceil(0.85n))`, n ≥ 5)은 **이 스파이크에서 미검증**이다(파라미터 `requiredMasteredRatio` 재조정 후 `npm run spike`로 검증 가능).
3. **"해당 트랙 깊이 자산 증거 1건"**을 트랙 수준(문자 그대로)으로 해석했다. 레벨 수준으로 좁히면 lead L2가 추가로 막힌다(`sparse.depthScope: "level"` 스위치 구현됨).
4. **D4 가능 개념 집합**을 "레벨 ≤ k"로 해석했다. 트랙 전체(`any_level`)로 넓히면 arch T2가 풀리지만 상위 레벨 개념을 승급 전에 디깅해야 한다.
5. **cap은 모든 AI 모드에 적용**한다고 해석했다(FR-PRG-013 "offline_cap_level을 넘는 승급은 제안하지 않음"). FULL에서 cap을 넘기려면 L5 Case·Tier A가 필요하므로 어차피 콘텐츠가 없다.

## 7. 잔여 위험

| ID | 위험 | 대응 |
|---|---|---|
| R-1 | **Tier B 트랙별 배분은 가정**(총합 120만 문서에 있음). 실제 배분이 다르면 필수 개념 수·희소 레벨 분포가 달라진다 | 팩 확정 시 `buildInventory()`를 실제 `required_for_level` 로더로 교체하고 4번 회귀 테스트로 재판정 |
| R-2 | 현실적 학습자 파라미터(θ 성장, 급답·힌트 비율 등)는 전부 [ASSUME] — 절대 도달 일수는 근거 없음. 부등식(어느 조합이 막히는가)만 신뢰 가능 | RETRO-01·V-field에서 실제 로그로 보정 |
| R-3 | SP-1(Jev)은 w_grader(0.9/0.7)와 오판율 5%/10%로만 반영. 실제 Jev가 특정 과업에서 크게 어긋나면 서술 증거 기반 게이트(Case·Teaching) 통과율이 달라짐 | V-live. 도달 여부는 결정적 증거 경로가 있어 영향 작음 |
| R-4 | **Retained(L4→L5 ①)는 시뮬레이션하지 않음**. 현재 L4에서 필수 개념 ≥ 3인 트랙이 없어 개념 게이트 경로가 미사용(sre·sec·arch·lead = 2). 팩이 L4 필수를 3개 이상으로 늘리면 FSRS R 모델링 필요 | 그때 SP-3의 ts-fsrs 시뮬레이터와 결합 |
| R-5 | 산출물 과제를 모든 트랙 공통 12개로 가정(트랙 태그 미정). alg의 "구현 은행 L4 8문제"·조건 반전 쌍·T1 생성기의 레벨 태그는 평가 풀에 넣지 않음(alg는 cap L4라 영향 없음, docker·cicd 등은 Brief로 대체) | 팩 확정 후 풀 계산에 포함 |
| R-6 | 문항 풀 소모: 이상적 학습자 OFFLINE에서 문항 재노출(`poolReuse`)이 발생(예: be L1 이상적 학습자 4일에 96이벤트 중 45 재사용). variant·T1 로테이션이 실제로 흡수하는지 미검증 | SP-3/콘텐츠 팩 리포트에서 fresh-item 비율 지표 추가 |
| R-7 | 순간 θ 상승(+1.0까지)이 화면에 노출되면 "찍었는데 실력이 올랐다"로 보일 수 있음 | 개념 θ를 이벤트 ≥ 30 미만에서는 UI에 표시하지 않고, 적응 난이도 조절에만 사용 |
| R-8 | 자기채점 편향 추적은 결정적 기준선이 없으면 무력(공격자가 결정적 문항을 피하면). F4가 유일한 방어이므로 F4 미채택 시 OFFLINE Mastered 오염 위험 | F4 채택. θ_q 갱신 규칙을 정책 버전에 포함 |
| R-9 | 빈 레벨·희소 레벨은 **팩 lint**(FR-CUR-025)에서 "레벨별 평가 풀 ≥ 12"를 검사하지 않으면 재발 | lint R-POOL 추가 제안 |

## 8. 파일 목록

| 파일 | 내용 |
|---|---|
| `spikes/sp6-promotion-reachability/src/policy.ts` | 정책 객체 타입·기본값(각 값에 출처 [SPEC]/[ASSUME]/[FIX]), 형식 카탈로그, `withFixes()` |
| `.../src/promotion.ts` | **순수 참조 구현**(가중치·Elo·Mastered·CBM·평가 구성·게이트·`decidePromotion`·`structuralFeasibility`·`computeCap`·`reconcileProvisional`) |
| `.../src/inventory.ts` | 19트랙 개념·Tier·Case 30 인벤토리, 콘텐츠 Brief 반영 |
| `.../src/sim.ts` | 합성 학습자 4+ 종(이상·현실·무작위·OX 반복·적대 2종), 일 단위 시뮬레이터 |
| `.../src/run.ts` | 전체 측정(`npm run spike`), JSON 요약 stdout, `results/` 출력 |
| `.../src/promotion.test.ts` | 단위 테스트 15건(`npm test`) |
| `.../results/result.json`, `matrix.md` | 원시 결과·전 조합 행렬(정책 A/B/C, 현실적 학습자) |

## 9. 재현 방법

```bash
cd /home/user/study_develop_ai/spikes/sp6-promotion-reachability
npm install
npm test               # 단위 테스트 15건
npm run typecheck      # tsc --noEmit
npm run spike          # 전체(약 2분), JSON 요약 stdout, results/result.json·matrix.md
npm run spike:quick    # 시드 축소(약 35초)
```

시드는 `hash(라벨|에이전트|트랙|전이|조합|번호)`로 고정되어 같은 입력이면 같은 결과다(단위 테스트로 검증). 정책 값을 바꿔 재판정하려면 `src/policy.ts`의 `DEFAULT_POLICY` 또는 `withFixes()`를 수정하면 된다.
