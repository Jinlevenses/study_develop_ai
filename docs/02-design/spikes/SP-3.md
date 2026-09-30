# SP-3 — FSRS 부하 예측 · 이벤트 원장 리플레이 결정성

> 상태: 실측 완료(Linux 컨테이너, V-build). Windows·실사용자 데이터는 **V-live / V-field 대기**.
> 코드: `/home/user/study_develop_ai/spikes/sp3-replay-determinism/` (`npm run spike`)
> 원자료: 같은 디렉터리 `results.json` (전체 실행 결과 JSON)

---

## 1. 가설

`03-convergence.md` §11 SP-3 행의 가설을 6개 하위 가설로 분해했다.

| # | 가설 | 통과 기준 (출처) |
|---|---|---|
| H1 | 시드 고정 합성 학습자로 15년 × 일 100리뷰(≈55만 행) 로그를 컨테이너에서 60초 안에 생성할 수 있고, 같은 시드는 같은 로그를 낸다 | 생성 ≤ 60s, 같은 시드 → 같은 로그 (NFR-MAINT-012) |
| H2 | 원장(`events`)만으로 재구성한 투영(카드별 FSRS 상태 + 개념별 Elo/숙달)이 라이브 투영과 바이트 단위로 같다 | 리플레이 = 라이브 100% (NFR-DATA-002, NFR-DATA-013, FR-PRG-001) |
| H3 | FSRS fuzz는 끄거나 시드를 이벤트에 내장하면 결정적이다 | 리플레이 = 라이브 (FR-PRG-005) |
| H4 | 두 기기 원장을 어떤 순서로 병합해도 투영이 같다 | 병합 순서 무관 (FR-SET-022, NFR-DATA-011) |
| H5 | 30일 리뷰 부하 예측 오차가 15% 이하다 | ≤ 15% (FR-PRG-018) |
| H6 | 전체 리플레이 시간이 허용 범위이고 증분 갱신이 1초 이하다 | 전체 리플레이 ≤ 120s `[추정]`, 증분 ≤ 1s (NFR-PERF-005) |

---

## 2. 방법

### 2.1 합성 학습자·앱 시뮬레이터 (`src/sim.ts`)

- **PRNG**: sfc32(splitmix32 시드). 상태 복제 가능. 세션 시작 시각은 `(tplSeed, day)`만으로 결정해 두 기기가 같은 시각에 세션을 여는 충돌 스트레스를 만든다.
- **학습자 숨은 진실**(원장에 들어가지 않음): 개념별 참 θ ~ N(0.5, 1), 개념 β ~ N(0, 0.8), 카드별 기억 배율 `f_c = exp(N(ln memMean, 0.25))`. 참 회상확률 `R_true = forgetting_curve(default_w, t_frac, S_fsrs · f_c · drift)`. 기본 `memMean = 0.95`(FSRS 기본 파라미터보다 약간 빨리 잊음), 연주기 drift ±8%.
- **찍기 정책**: 회상 실패 시 형식별 찍기 확률(mcq .25, ox .5, match .1, cloze .03, free_text .02, code 0)로 정답 처리. 회상 성공 시 `σ(θ−β+5)` 확률로 정답(실수 항). `rapid` 응답 1.2%는 `gaming_factor = 0`, grade 상한 Hard.
- **세션 빈도**: 요일별 활성 확률(0.7~0.9), 하루 0.4% 확률로 7~21일 휴가. 세션 상한 320 리뷰, 신규 도입은 `min(10, 75 − 오늘 due)`.
- **앱 = FSRS**: `ts-fsrs 5.4.2`, `enable_fuzz=false`, `enable_short_term=true`(기본 학습 단계 1m/10m), `request_retention=0.9`. 세션 안에서 학습·재학습 단계 카드는 due가 되면 같은 세션에 다시 나온다.
- **이벤트 종류**: `review`(대부분), `correction`(FR-QST-011 G3형: 과거 리뷰를 무효화, 약 462건). 카드 = 24,000장 풀(개념 469개에 균등 배분, facet 6종 순환)에서 순차 도입.

### 2.2 원장·투영 (`src/ledger.ts`, `src/projection.ts`)

- **envelope**: `id`(ULID) · `device_id`(ULID) · `device_seq` · `client_ts`(ms) · `type` · `payload`(JSON). 카드·개념 ID는 payload에서 **STORED 생성 열**(`card_id`, `concept_id`)로 꺼내 색인한다.
- **payload에 내장한 리플레이 입력**: `card_id, concept_id, facet, format, tier, rating, result, w_format, w_grader, gaming_factor, rapid, latency_ms, item_beta(스냅샷), grader, policy_version, [fuzz_seed], prev_hash`. 리플레이는 이 필드와 `client_ts`만 읽는다(content·assessment DB 없음).
- **투영**: 순수 리듀서 `(state, event) → state`. 카드 = ts-fsrs `Card` 전 필드, 개념 = w 가중 Elo(θ, K=0.2), w = `w_format × w_grader × gaming_factor`, 숙달 = `P ≥ 0.8 ∧ 형식 ≥ 3(w_format ≥ 0.7 ∧ w_grader ≥ 0.6 정답) ∧ 서로 다른 날 ≥ 2`(FR-PRG-009 축약형).
- **투영 해시**: 카드·개념 ID를 바이트 순 정렬 → 필드를 `|`로 이은 정준 문자열(JS 숫자는 최단 왕복 표기라 비트 정확) → SHA-256.
- **append-only**: `BEFORE UPDATE/DELETE` 트리거가 `RAISE(ABORT)`. 기기별 해시 체인(`prev_hash`) 포함.
- **라이브 경로 vs 리플레이 경로**: 시뮬레이터의 라이브 투영은 직렬화 이전의 **메모리 상 이벤트 객체**로 갱신하고, 리플레이는 SQLite에서 읽어 `JSON.parse`한 이벤트로 갱신한다. 그래서 직렬화 손실·순서·누락 입력이 있으면 해시가 갈라진다.

### 2.3 측정 항목별 방법

| 항목 | 방법 |
|---|---|
| H1 | 시뮬레이터만 실행(`gen_only`)하고 라이브 투영 해시·체인 헤드를 기록. 이어서 같은 시드로 원장 삽입까지 하는 본 실행(`main_run`)을 하고 두 해시·체인 헤드를 비교 |
| H2 | 본 실행 원장을 `ORDER BY client_ts, device_id, device_seq`로 읽어 새 `Projector`로 재구성 → 라이브와 카드·개념 단위 diff. 별도로 (a) 체인 검증, (b) UPDATE/DELETE 거부, (c) `TZ=Asia/Seoul`, `TZ=America/Los_Angeles` 자식 프로세스 재구성 해시 비교 |
| H3 | 730일 로그로 4모드 비교: `off` / `embedded`(이벤트에 `fuzz_seed` 저장) / `default`(라이브러리 기본 시드) / `random`(시드를 저장하지 않은 `Math.random` — 음성 대조). `embedded`는 15년 전체로도 1회 |
| H4 | 15년 원장의 마지막 60일 앞(day 5,419)에서 두 기기(A, B)로 분기. 둘 다 같은 동기화 상태에서 출발해 60일간 서로 모르고 학습. 기기 시각은 1초 해상도로 양자화, 세션 시작 시각 동일(충돌 스트레스), B는 +30일째부터 시계 −30시간 어긋남. 병합 3종(A→B, B→A, 전체 셔플+20% 중복) + 증분 병합 + 재수입 멱등 + 음성 대조 |
| H5 | 15년 원장 리플레이 중 16개 시점(day 180 … 5,445)에서 카드 상태를 스냅샷 → 그 시점의 카드 상태·직전 90일 통계만으로 30일 예측 → 실제 이후 30일 리뷰 수와 비교. 다른 학습자 2종(빨리 잊음, 덜 성실)을 10년 로그로 추가 |
| H6 | 전체 리플레이 시간, 디스크 파일 SQLite(WAL)에서 이벤트 1건 append + 투영 갱신 지연(동기 모드 NORMAL/FULL), 과거 ts 이벤트(지각 도착) 지연, LDI 증분 vs 전체 재계산 |

### 2.4 예측기 (`src/forecast.ts`)

- 시점 T0의 카드 상태에서 각 카드를 "due에 복습" → 결과를 **분기 기대값**으로 전개(Again / Hard / Good / Easy, 확률 < 0.02 가지는 최빈 경로만 유지)하고 `fsrs.next()`로 다음 상태를 계산해 30일 안 리뷰 횟수를 누적한다.
- 성공확률 `r`: Review 상태 카드는 `model`(FSRS의 R) 또는 `observed`(직전 90일 관측 유지율 상수), New/학습 단계 카드는 직전 90일 관측값. Hard/Easy 비율, 신규 도입률(일 평균)도 직전 90일 원장에서 얻는다.
- 신규 카드는 "1장을 도입했을 때의 30일 기대 리뷰 곡선"을 도입률로 합성곱한다.
- 기준선으로 **순진한 due 수**(30일 안에 due인 카드 수)를 함께 낸다.

---

## 3. 환경

| 항목 | 값 |
|---|---|
| `node -v` | **v22.22.2** |
| OS | Linux 6.18.44-fc-v50 x86_64 (컨테이너 VM) |
| CPU / 메모리 | Intel Xeon 2.80GHz, 4 코어 / 15.7 GB |
| TZ | 미설정(UTC). 자식 프로세스에서 Asia/Seoul, America/Los_Angeles도 실측 |
| ts-fsrs | 5.4.2 (`default_w` = FSRS-6 기본 21개 파라미터) |
| SQLite | `node:sqlite`(Node 22.22.2 내장), WAL, `cache_size=256MB` |
| 실행 방식 | `node --no-warnings --import tsx src/spike.ts` (tsx 4.23) |
| 시드 | `20260930` (전체 실행 2회, 모든 해시 동일) |

시뮬레이션 결과 규모: **554,066 이벤트**(리뷰 553,604 + 정정 462), 15년 = 5,479일, 일평균 **101.1건**, 카드 13,779장, 개념 270개(카드를 순차 도입하므로 469개 중 일부만 도달). 연도별 리뷰 수 25k → 42k로 증가 후 안정.

---

## 4. 결과

### 4.1 (1) 생성 시간과 시드 결정성

| 측정 | 실행 A (기록용) | 실행 B (최종 `results.json`) |
|---|---|---|
| 시뮬레이터만(FSRS + 라이브 투영 + ULID + SHA-256 체인 + JSON 직렬화, DB 없음) | 22.2 s | **18.1 s** (30.6k 이벤트/s) |
| 본 실행 = 시뮬레이터 + 원장 INSERT + 분기 시뮬 2대(각 60일) | 42.9 s | **34.8 s** (INSERT만 11.5 s) |
| 최대 RSS(시뮬레이터 단독) | — | 567 MB |
| 원장 파일 크기 | 352 MB | 352 MB (**이벤트당 666 B**: payload 평균 304 B + 색인 3개 + 생성 열) |
| 같은 시드 → 같은 로그 | 체인 헤드 `108a861d…` · 투영 해시 `5d6dd51c…` | 시뮬레이터 단독 실행, 본 실행(중간에 분기 시뮬 삽입), **실행 A·B 모두 동일** |

### 4.2 (2) 리플레이 = 라이브

| 측정 | 결과 |
|---|---|
| 이벤트 수 | 554,066 (무효 처리된 정정 대상 462건 제외 적용) |
| 카드 차이 / 개념 차이 | **0 / 13,779, 0 / 270** → 일치율 100% |
| 투영 해시 | 라이브 = 리플레이 = `5d6dd51c986122dd5575168a0cd434a6b3dd2882fbd3ace6882c8f94616a8888` (바이트 동일) |
| 리플레이 시간 | **9.9 s** (55.8k 이벤트/s, `JSON.parse` 포함; 실행 A 10.0 s) |
| 해시 체인 검증(별도 패스) | 554,066건 끊김 0, 5.3 s |
| UPDATE / DELETE 시도 | 둘 다 트리거로 거부(`ledger is append-only`) |
| 타임존 독립성 | UTC · Asia/Seoul · America/Los_Angeles 세 프로세스의 해시 동일 (자식 프로세스는 각 8.8~9.0 s) |
| content·assessment DB 필요 여부 | 없음. 리플레이는 `events` 테이블만 읽는다. 병합 실험의 M1~M3 DB도 원장 수입만으로 만든 파일이다 |

### 4.3 (3) fuzz 결정성 (730일 ≈ 55k 이벤트, 마지막 행만 15년 전체)

| 모드 | 리플레이 = 라이브 | 카드 불일치 |
|---|---|---|
| `off` (fuzz 끔, 권장 기본) | **일치** | 0 / 3,327 |
| `embedded` (이벤트에 `fuzz_seed = "<device_id>:<device_seq>"` 저장) | **일치** | 0 / 3,380 |
| `default` (ts-fsrs 기본 시드 `time_reps_(D×S)`) | **일치** (입력이 같으면 결정적) | 0 / 3,270 |
| `random` (시드 미저장 `Math.random`, 음성 대조) | **불일치** | **3,040 / 3,316 (92%)** |
| `embedded`, 15년 전체 | **일치** | 0 / 13,960 (리플레이 15.0 s) |

### 4.4 (4) 다기기 병합

시나리오: 공통 기반 546,926건 + A 단독 6,910건 + B 단독 6,563건 = 유일 이벤트 560,399건. 60일 분기 동안 **양쪽이 모두 리뷰한 카드 2,607장**, 서로 다른 기기가 **같은 `client_ts`를 가진 시각 206곳**(같은 카드가 같은 초에 겹친 경우 4건), B의 시계 −30시간 어긋남 포함.

| 병합 경로 | 전체 리플레이 시간 | 투영 해시 |
|---|---|---|
| M1: 기반 → A → B (벌크 INSERT) | 11.2 s | `494f1cc2…8345` |
| M1': 위 상태에서 A 투영을 저장해 두고 B를 **증분 병합**(영향 카드 2,607 · 개념 267 재도출) | 병합 9.1 s | `494f1cc2…8345` (= 전체 재구성) |
| M2: 기반 → B → A | 10.4 s | `494f1cc2…8345` |
| M3: 전체 셔플, 5,000건 배치, 20% 중복 재전송(672,479건 전달 → 560,399건 삽입) | 12.3 s | `494f1cc2…8345` |
| 재수입(멱등) | 삽입 0건 | 투영 불변 |
| A 기기 로컬 투영(병합 전) 리플레이 = 라이브 | 일치 | (A 로컬 해시 ≠ 병합 해시: 병합은 재계산이며 기기별 로컬 뷰는 병합 후 교체됨) |

음성 대조(정렬 키가 필요한 이유):

| 대조 | 결과 |
|---|---|
| 도착 순서(`rowid`)로 리플레이 | ts-fsrs가 **`FSRSValidationError: Invalid delta_t "-54"`로 예외를 던진다**. 음수 경과일을 강제로 0 처리(4,257건)하면 해시가 달라지고 카드 1,408장이 총순서 결과와 다르다 |
| `ORDER BY client_ts`만 사용 | 이번 데이터에서는 M1 = M2 (SQLite가 `ix_order` 색인 순서로 동률을 풀었기 때문. **검증력 없음**) |
| `client_ts` 동률을 도착 순서(`rowid`)로 풀기 | M1 ≠ M2 (`494f1cc2…` vs `d6660a7c…`) → 동률 해소에 `device_id, device_seq`가 필요함을 확인 |

### 4.5 (5) 30일 부하 예측 오차

**주 시나리오(15년, memMean 0.95) 16개 시점.** 오차 = (예측 − 실제) / 실제, 30일 총 리뷰 수 기준.

| 시작 일차 | 30일 중 활동일 | 실제 | 예측(`model`) | 오차 `model` | 오차 `observed` | 오차 순진한 due 수 |
|---|---|---|---|---|---|---|
| 180 | 26 | 2,322 | 2,042 | −12.1% | −5.1% | −77.1% |
| 365 | 28 | 2,604 | 2,546 | −2.2% | +4.5% | −68.4% |
| 730 | **10** | 2,093 | 3,045 | **+45.5%** | +54.7% | −41.4% |
| 1,095 | 24 | 2,872 | 2,795 | −2.7% | +5.3% | −63.0% |
| 1,460 | 24 | 2,876 | 2,966 | +3.1% | +13.5% | −54.1% |
| 1,825 | 26 | 3,052 | 2,934 | −3.9% | +2.7% | −57.1% |
| 2,190 | 24 | 3,380 | 3,487 | +3.2% | +10.2% | −52.5% |
| 2,555 | 24 | 3,298 | 3,153 | −4.4% | +5.8% | −56.9% |
| 2,920 | 19 | 3,110 | 3,304 | +6.2% | +19.8% | −51.1% |
| 3,285 | 22 | 3,178 | 3,206 | +0.9% | +12.2% | −52.1% |
| 3,650 | 21 | 3,201 | 3,416 | +6.7% | +18.8% | −51.3% |
| 4,015 | 24 | 3,378 | 3,085 | −8.7% | +2.5% | −58.8% |
| 4,380 | 25 | 3,511 | 3,507 | −0.1% | +10.8% | −52.2% |
| 4,745 | 23 | 3,505 | 3,463 | −1.2% | +9.6% | −52.1% |
| 5,110 | 28 | 3,801 | 3,537 | −6.9% | +4.2% | −56.4% |
| 5,445 | 27 | 3,607 | 3,436 | −4.7% | +4.1% | −53.4% |

요약(절대 오차):

| 시나리오 | 예측기 | 중앙값 | 평균 | p90 | 최대 | ≤15% 창 수 |
|---|---|---|---|---|---|---|
| **주(15y)** 전체 16창 | `model` | **3.9%** | **7.0%** | 12.1% | 45.5% | **15 / 16** |
| 〃 활동일 ≥ 20인 14창 | `model` | — | 4.3% | — | 12.1% | **14 / 14** |
| 〃 전체 16창 | `observed` | 5.8% | 11.5% | 19.8% | 54.7% | 13 / 16 |
| 〃 전체 16창 | 순진한 due 수 | — | 56.1% | 68.4% | 77.1% | 0 / 16 |
| alt1 (더 빨리 잊음 memMean 0.80, 10y) 10창 | `model` | 4.6% | 7.5% | 13.8% | 20.1% (day 730, 활동일 16) | 9 / 10 |
| alt2 (기억 좋음 1.05 + 활동 0.75배, 10y) 10창 | `model` | 14.7% | 23.6% | 30.7% | **89.1%** (day 365, 활동일 7) | 5 / 10 (활동일 ≥ 20인 창 없음) |

부가 지표(주 시나리오, `model`): 기존 카드만의 예측 오차는 16창 중 11창이 ±5% 이내, 15창이 ±10% 이내(day 730의 +22.6%만 예외), 일별 MAPE 평균 35.9%, 주별 MAPE 평균 15.2%. 예측 계산 시간은 시점당 `model`+`observed` 두 번 합쳐 0.9~2.2 s(카드 1k~14k장).

### 4.6 (6) 리플레이·증분 지연

| 측정 | n | p50 | p95 | p99 | 최대 |
|---|---|---|---|---|---|
| 이벤트 1건 append + 투영 갱신, WAL `synchronous=NORMAL` (정상 경로) | 1,415 | 0.11 ms | 0.64 ms | 11.3 ms | 16.2 ms |
| 〃 `synchronous=FULL` | 300 | 0.52 ms | 3.6 ms | 8.0 ms | 11.6 ms |
| 지각 도착 이벤트(과거 `client_ts`) append + 카드·개념 **키 재도출** | 200 | 16.7 ms | 35.4 ms | 45.3 ms | 165.9 ms |
| LDI 개념 단위 증분 갱신 (스탠드인 LDI) | 1,715 | 0.14 ms | 0.31 ms | 0.50 ms | 15.0 ms |
| LDI 전체 재계산(카드 13.8k장) | — | 14.2 ms | | | |
| 전체 리플레이(554k) | — | 9.9 s (이벤트 추가 후 11.1 s) | | | |

- 정상 경로 1,715건 모두 fast path(카드 `last_review < client_ts` ∧ 개념 `last_ts < client_ts`), 지각 200건 중 171건이 slow path(키 재도출), 29건은 우연히 fast path.
- 세 곳이 서로 같은 해시: **증분 갱신된 영속 투영 = 시뮬레이터 라이브 = 전체 리플레이** (`576d8ef4…`). 지각 도착 200건 뒤에도 영속 투영 = 전체 리플레이.
- LDI 증분 합계 vs 전체 재계산 상대 오차 **6.1e-16**(기준 < 1e-9).

---

## 5. 합격 기준 대비 판정

| # | 기준 | 판정 | 근거 |
|---|---|---|---|
| 1 | 55만 행 생성 ≤ 60 s, 같은 시드 → 같은 로그 | **PASS** | 시뮬레이터 18.1 s(재실행 22.2 s), 원장 저장 포함 34.8 s(42.9 s). 체인 헤드·투영 해시 실행 간 동일 |
| 2 | 리플레이 = 라이브 100% (원장만으로) | **PASS** | 카드 0/13,779, 개념 0/270 불일치, 해시 바이트 동일. UTC/Seoul/LA 3 프로세스 동일. `embedded` fuzz 15년 전체도 일치 |
| 3 | fuzz 비활성 또는 시드 고정으로 결정적 | **PASS** (조건부) | `off`·`embedded`·`default` 일치, 시드 미저장 fuzz는 92% 카드 불일치 → **시드를 이벤트에 내장하지 않는 fuzz는 금지**해야 함 |
| 4 | 다기기 병합 순서 무관 | **PASS** | 3개 순서 + 증분 병합 + 재수입 모두 동일 해시. 음성 대조(도착 순서, 동률 rowid)는 실패로 확인 |
| 5 | 30일 예측 오차 ≤ 15% | **PARTIAL** | 규칙적 학습자(30일 중 활동일 ≥ 20)는 주 시나리오 14/14, alt1 9/9가 ≤ 15%(최대 13.8%). 그러나 휴가·불규칙 학습에서는 최대 +45%(주), +89%(alt2). 순진한 due 수는 −41~−77%로 쓸 수 없음. → 사전 확정 대응인 **"범위로만 표시"를 채택** |
| 6a | 전체 리플레이 ≤ 120 s `[추정]` | **PASS** | 9.9 s (기준의 8%) |
| 6b | 증분 갱신 ≤ 1 s | **PASS** | 정상 append p99 11 ms(NORMAL)/8 ms(FULL), 지각 도착 p99 45 ms·최대 166 ms. LDI 증분 = 전체 재계산 |

부가 확인: LDI 증분 오차 6.1e-16(FR-PRG-017 [T] < 1e-9) PASS. 벌크 병합 후 투영 재구성은 "증분 ≤ 1 s"의 대상이 아니며 9~12 s 걸린다(§6.4).

---

## 6. 설계 권고

### 6.1 이벤트 envelope과 총순서 (동결 후보)

```sql
CREATE TABLE events(
  id         TEXT PRIMARY KEY,                 -- ULID (멱등 수입의 키)
  device_id  TEXT NOT NULL,
  device_seq INTEGER NOT NULL,
  client_ts  INTEGER NOT NULL,                 -- epoch ms, 기기별 단조(아래 규칙)
  type       TEXT NOT NULL,
  payload    TEXT NOT NULL CHECK (json_valid(payload)),
  card_id    TEXT GENERATED ALWAYS AS (json_extract(payload,'$.card_id'))    STORED,
  concept_id TEXT GENERATED ALWAYS AS (json_extract(payload,'$.concept_id')) STORED,
  UNIQUE(device_id, device_seq)
);
CREATE INDEX ix_order   ON events(client_ts, device_id, device_seq);
CREATE INDEX ix_card    ON events(card_id,    client_ts, device_id, device_seq);
CREATE INDEX ix_concept ON events(concept_id, client_ts, device_id, device_seq);
CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'ledger is append-only'); END;
CREATE TRIGGER events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'ledger is append-only'); END;
```

- **총순서 = `(client_ts, device_id, device_seq)`**, `device_id`는 ASCII ULID라 SQLite BINARY와 JS `<`가 같다. **`rowid`·`id`(ULID)로 리플레이하지 않는다.** 실험적으로 도착 순서는 ts-fsrs가 예외를 던지고, 동률을 `rowid`로 풀면 병합 순서에 따라 결과가 달라졌다.
- 삽입은 `INSERT OR IGNORE`(id 중복 · `(device_id, device_seq)` 중복 무시)로 멱등. `changes`는 `number | bigint`라 `Number()`로 감싼다.
- **기기별 `client_ts` 단조 규칙**(FR-PRG-027 연계): `ts = max(wall_now, last_ts_of_this_device + 1)`. 시뮬레이터가 이 규칙으로 B의 −30시간 시계 어긋남을 흡수했고 병합은 결정적이었다. 추가로 "수입한 모든 기기의 최대 ts 이후로 클램프"(하이브리드 논리 시계 효과)는 지각 도착을 줄일 것으로 보이나 **이번에 측정하지 않았다**. 결정적 순서 자체에는 HLC가 필요 없다.
- HLC 도입 여부: 이번 실험 범위(순서 불변·결정성)에서는 **불필요**. 인과 정합성(다른 기기 리뷰를 본 뒤의 리뷰가 앞서 정렬되지 않게 하는 것)이 제품 요구가 되면 그때 `client_ts`에 논리 카운터를 접는 방식으로 가산 변경한다(ts 자리는 이미 단조 규칙으로 예약).

### 6.2 FSRS 호출 규약 (그대로 재사용 가능)

```ts
import { fsrs, generatorParameters, StrategyMode, DefaultInitSeedStrategy } from 'ts-fsrs';

const f = fsrs(generatorParameters({
  enable_fuzz: false,          // R0 권위 투영은 fuzz 끔 (아래 6.3)
  enable_short_term: true,     // 기본 학습 단계 1m/10m 유지 (실측 조건)
  request_retention: 0.90,     // 계층별 retention(core .92 … archive .80)은 이번에 미측정: 계층당 fsrs 인스턴스를 두는 안
}));

// 카드 상태는 number(ms)만 저장한다. Date 객체를 영속 상태에 넣지 않는다.
const { card } = f.next(cardState /* due:number, last_review:number|null … */, ts /* number */, rating /* 1..4 */);
```

- **`f.repeat()`가 아니라 `f.next(card, now, grade)`**를 쓴다(단일 grade 계산, 결과에 Date가 섞이지만 즉시 `getTime()`으로 정규화).
- 리플레이 대상 상태는 `Card` 전 필드(`due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review`)다. `elapsed_days`는 ts-fsrs가 "6.0.0에서 제거 예정(deprecated)"이라고 명시한 필드다. **ts-fsrs 버전은 정확히 고정(`5.4.2`)**하고, 업그레이드는 "전체 재구성 + 해시 차이 보고" 마이그레이션으로 다룬다. 투영 해시에는 `fsrs_impl` 버전 태그를 함께 저장한다.
- **경과일은 UTC 달력일 차**(`dateDiffInDays`가 `getUTC*` 사용)라 프로세스 TZ와 무관하다(3 TZ 실측). FR-PRG-027의 "하루 시작 04:00" 경계를 FSRS 입력에 반영하려면 리플레이 시점의 설정값으로 다시 계산하지 말고, **이벤트 생성 시점에 정한 `fsrs_at`(논리 시각, ms)을 payload에 내장**해 그 값을 `next()`에 넘긴다. (미측정 설계 권고)
- **ts-fsrs는 음수 경과일에서 `FSRSValidationError`를 던진다.** 리플레이·증분 경로 모두 "같은 카드의 이벤트는 총순서(ts 비감소)로만 적용"을 보장해야 한다. 예외가 나면 삼키지 말고 원장 정합성 경보로 처리한다.

### 6.3 fuzz 정책

1. **R0 권위 투영은 `enable_fuzz: false`.** 결정성 논증이 필요 없고 계층·병합·정정 재도출이 모두 단순해진다. 분산 효과(같은 날 몰림 방지)가 필요하면 **큐 조립 단계에서 비영속 지터**로 처리한다(투영 상태에 넣지 않는다).
2. fuzz가 꼭 필요하면 **`fuzz_seed`를 이벤트 payload에 내장**한다(실측: 15년 전체 리플레이 일치).
   ```ts
   const self = { seed: undefined as string | undefined };
   f.useStrategy(StrategyMode.SEED, function (this: any) {
     return self.seed !== undefined ? self.seed : (DefaultInitSeedStrategy as any).call(this);
   });
   self.seed = payload.fuzz_seed;          // 예: `${device_id}:${device_seq}` (병합에도 불변)
   ```
3. 라이브러리 기본 시드(`time_reps_(D×S)`)는 같은 입력이면 결정적이었지만 내부 공식·부동소수 곱에 의존하므로 권위 경로로 쓰지 않는다.
4. **시드를 저장하지 않는 fuzz는 금지**: 카드 92%가 불일치했다. `check` 규칙으로 "fuzz on ⇒ payload에 `fuzz_seed` 필수"를 zod 스키마에서 강제한다.

### 6.4 투영·재도출 패턴

- **투영 = 순수 리듀서**(`apply(state, event)`). 입력은 payload와 `client_ts`뿐. 시계·난수·설정·다른 DB 조회 금지.
- **정정 이벤트(`correction`)는 2-패스**: ① `ix_corr`(부분 색인 `WHERE type='correction'`)로 무효 대상 ID 집합을 먼저 읽고 ② 본 패스에서 대상 리뷰를 건너뛴다. 무효 집합은 순서에 무관하므로 병합에 안전하다(정정 이벤트가 다른 기기에서 오는 경우는 **미측정**, 로직상 순서 무관).
- **증분 경로**(정상 도착):
  ```ts
  fast  = (!card || card.last_review < ev.client_ts) && (!concept || concept.last_ts < ev.client_ts)
  if (fast) applyAndUpsert(card, concept)            // 한 트랜잭션: INSERT event + UPSERT 2행
  else      rederiveKey(card_id); rederiveKey(concept_id)   // ix_card / ix_concept로 해당 키 이벤트를 총순서로 접기
  ```
  `<`는 엄격 부등호다(동률은 slow path). 정정도 slow path. 카드 키 재도출은 평균 카드당 수십 건, 개념 키는 개념당 수천 건을 접는다(지각 도착 p50 17 ms).
- **병합(벌크 수입) 후 재구성**: 영향 키만 재도출(카드 2,607 + 개념 267)해도 9.1 s로 전체 리플레이(11.2 s)와 거의 같다(개념 재도출이 이벤트 대부분을 다시 읽음). 따라서 **R1은 "병합 후 전체 리플레이를 백그라운드로 돌리고 투영 테이블을 원자적으로 교체"**로 충분하다(55만 건 ≈ 10~12 s로 120 s 기준의 약 1/10). 필요해지면 개념 단위 체크포인트(스키마 훅)로 최적화한다.
- **투영 해시 사용처**: (a) `projection_hash`를 체크포인트 매니페스트(FR-PRG-003)에 기록, (b) 병합/업그레이드 후 회귀 비교, (c) 야간 무결성 점검(전체 리플레이 10 s)에서 라이브 투영과 비교. 해시는 카드·개념 ID 바이트 순, 필드 고정 순서, 숫자 최단 왕복 표기로 만든 정준 문자열의 SHA-256이다(참고 구현: `src/projection.ts`의 `projectionHash`).
- **투영 테이블**: `card_state(card_id PK, concept_id, json)`, `concept_state(concept_id PK, json)`, `WITHOUT ROWID`. `json`은 정준 필드 순서로 저장한다(왕복 정확).

### 6.5 SQLite 운용

- `PRAGMA journal_mode=WAL`. 원장 DB는 **`synchronous=FULL` 권고**: append p50 0.52 ms · p99 8 ms로 1초 기준 대비 두 자릿수 이상 여유이고, NORMAL은 전원 손실 시 마지막 커밋 유실 가능성이 있는데 원장에는 이득이 작다(측정은 NORMAL p50 0.11 ms).
- 대량 삽입은 트랜잭션 단위 배치(2만 건/배치에서 55만 건 11.5 s ≈ 48k/s).
- 이벤트당 디스크 666 B(payload 평균 304 B, 나머지 ≈ 360 B은 행 오버헤드·STORED 생성 열 2개·색인 3개이며 항목별 기여는 미측정). 15년치 ≈ 350 MB. `ix_concept`는 개념 키 재도출을 실제로 쓰는 경우에만 유지한다.
- `node:sqlite`: `StatementSync.iterate()`·STORED 생성 열·JSON 함수·트리거·부분 색인이 22.22.2에서 모두 동작했다. `ExperimentalWarning`은 `--no-warnings`로 억제한다.

### 6.6 부하 예측기 (FR-PRG-018)

- 예측은 **분기 기대값 전개 + FSRS의 R(`model`)**을 쓴다. 관측 유지율 상수(`observed`)는 계통적으로 +5~20% 높게 나와 채택하지 않는다. 순진한 due 수는 −41~−77%로 폐기(재복습·신규 카드의 재등장을 놓침).
- 입력은 **직전 90일 원장 통계**(New/학습 단계 성공률, Hard/Easy 비율, 신규 도입률)와 현재 카드 상태뿐이다.
- **표시는 범위로**: 30일 총량은 `[0.85 F, 1.15 F]`를 기본 띠로 두고, 직전 30일 활동일이 적은 학습자(<20일)는 띠를 넓힌다(관측 p90 오차: 규칙적 12~14%, 불규칙 31%; 이 대리 지표가 예측력을 갖는지는 **미검증**). **일 단위 값은 표시하지 않는다**(일별 MAPE 36%, 주별 15%). 부하 거버너(DEC-CNV-16)의 임계 비교는 "예측 하한 > 예산" 같은 보수적 형태로 쓴다.
- 계산 비용은 `model` 1회 ≈ 0.5~1.1 s(카드 13.8k)이므로 세션 시작 경로가 아니라 유휴/백그라운드에서 갱신한다.

### 6.7 LDI 증분 (NFR-PERF-005 / FR-PRG-017)

- `LDI(t)`는 시각 t에 의존하므로 "합계 하나를 갱신"하지 않는다. **개념별 항(term)을 캐시**하고, 이벤트 1건에는 해당 개념의 카드 행(≈50장)만 다시 읽어 항을 갱신, 표시 시점 t에는 전체 항을 합산(전체 재계산 14 ms). 증분 = 전체 재계산 상대 오차 6.1e-16으로 검증. (스탠드인 LDI라 실제 `L_k` 규칙은 mastery_rules@v1에서 온다.) 별도 스냅샷 테이블(전환 대응)은 이번 결과로는 **필요 없다** — 스키마 훅만 유지한다.

### 6.8 `payload`에 반드시 내장할 리플레이 입력 (NFR-DATA-013 확정 목록)

`card_id`(concept×facet), `concept_id`, `format`, `facet`, `tier`, `rating`(추천 grade 확정값), `result`, `w_format`, `w_grader`, `gaming_factor`, `rapid`, `item_beta`(스냅샷), `policy_version`, `fuzz_seed`(fuzz 사용 시), `prev_hash`, 그리고 (일 경계 규칙을 쓰면) `fsrs_at`. 하나라도 빠지면 리플레이가 설정·콘텐츠 DB에 의존하게 된다.

---

## 7. 잔여 위험

| # | 위험 | 상태 / 대응 |
|---|---|---|
| RSK-1 | **Windows·macOS·다른 V8 버전에서 부동소수 결과가 갈라질 수 있음** (`Math.exp/pow` 구현 차이) | **V-live 대기**. 이번에는 Linux x64 Node 22.22.2 + TZ 3종만 검증. 기기 간 바이트 일치를 요구하지 말고 **기기별 투영은 로컬 무결성용**으로 쓰며, 크로스 플랫폼 비교가 필요하면 유효숫자 9자리 등으로 반올림한 별도 해시를 쓴다(미측정 권고). Node 메이저 변경 시 전체 재구성 + 차이 보고 |
| RSK-2 | 부하 예측은 불규칙 학습(휴가·활동일 < 20/30)에서 15%를 크게 초과(+45%, +89%) | "범위 표시"로 대응. 예측 창 안의 휴가는 원리적으로 예측 불가 |
| RSK-3 | 예측 정확도는 **합성 학습자**로만 측정. 실제 사용자의 망각 곡선·세션 패턴은 V-field | FR-PRG-029(개인화 최적화) 이후 재측정. 기본 파라미터 그대로일 때의 결과임 |
| RSK-4 | ts-fsrs 6.0의 `elapsed_days` 제거 등 필드 변화 | 버전 고정 + 해시 포맷 버전 + 업그레이드 시 회귀 리플레이 |
| RSK-5 | 지각 도착 slow path 최대 166 ms, 개념 재도출은 개념당 이벤트 수에 비례(15년 뒤 개념당 수천 건) | 1 s 기준 충분히 여유. 병합 뒤에는 백그라운드 전체 리플레이(≈10 s)로 교체 |
| RSK-6 | **다기기 정정 이벤트**(다른 기기에서 온 `correction`)와 병합의 결합은 미측정. 정정 대상 집합을 먼저 읽는 2-패스라 로직상 순서 무관하지만 실측 아님 | 통합 단계(INT-1)에서 테스트 추가 |
| RSK-7 | 3대 이상 기기, 분기 기간 60일 초과, 정정·시계 역행이 섞인 병합은 미측정 | 순서 결정이 데이터의 순수 함수라 논리상 확장되지만 실측 아님 |
| RSK-8 | 동률 `client_ts`의 비교에서 `device_id` 문자열이 비ASCII가 되면 SQLite BINARY와 JS 비교가 달라질 수 있음 | `device_id`는 ULID(ASCII)로 고정, 스키마 CHECK로 `[0-9A-HJKMNP-TV-Z]{26}` 강제 권고 |
| RSK-9 | Elo/숙달의 정확성(참 θ와의 상관)·LDI 파라미터 민감도는 **이 스파이크에서 검증하지 않음**. 시뮬레이터가 능력을 정답률에 약하게 결합(`slipOffset 5`)하므로 270개 중 267개가 숙달로 나옴 | 투영에 순서 의존적 상태를 갖게 하는 용도로만 썼다. SP-6/시뮬레이터 정교화에서 다룬다 |
| RSK-10 | 원장 크기 350 MB/15년(이벤트당 666 B, payload는 304 B) | 필요 시 `ix_concept` 제거·payload 필드명 축약(`prev_hash` 32 B/건 포함). 항목별 기여는 미측정 |

---

## 8. 재현 방법

```bash
cd /home/user/study_develop_ai/spikes/sp3-replay-determinism
npm install                 # ts-fsrs@5.4.2, tsx, typescript
npm run spike               # 전체(약 8분, 임시 DB ≈ 1.5 GB를 .data/에 만들고 끝나면 삭제) → results.json + 요약 JSON 출력
npm run spike:quick         # 1,200일 축소판(약 1분, .data 유지, results.quick.json)
SPIKE_DATA_DIR=/tmp/x npm run spike   # DB 위치 변경
```

- 필요 자원: 메모리 ≈ 1.5 GB(시뮬레이터 RSS 570 MB + 병합 단계에서 행 배열 보유), 디스크 ≈ 1.5 GB.
- 결정적 결과: 시드(`DEFAULT_SIM.seed = 20260930`)가 같으면 투영 해시 `5d6dd51c…8888`, 체인 헤드 `108a861d…`, 병합 해시 `494f1cc2…8345`, 예측 오차표가 실행마다 동일하다(2회 실행 확인). 시간·지연 값만 실행마다 다르다.
- 파일 구성:

| 파일 | 역할 |
|---|---|
| `src/util.ts` | PRNG(sfc32), ULID 생성기, SHA-256, 백분위 |
| `src/projection.ts` | 순수 리듀서(FSRS + 개념 Elo/숙달), 정준 투영 해시, diff |
| `src/sim.ts` | 합성 학습자·앱 시뮬레이터, 기기 분기(`fork`), 정정 이벤트 |
| `src/ledger.ts` | 스키마·트리거, 리플레이, 체인 검증, 증분 갱신(`LiveLedger`), 병합 수입 |
| `src/forecast.ts` | 30일 부하 예측기(분기 기대값), 직전 90일 통계 |
| `src/ldi.ts` | 스탠드인 LDI(개념 항 캐시) |
| `src/spike.ts` | 전체 측정 오케스트레이션 → `results.json` |
| `src/replay-cli.ts` | 원장 파일만 열어 해시를 출력(TZ·프로세스 독립성 확인용) |

> **V-live 대기 항목**: Windows 재현, 실제 사용자 로그 기반 예측 정확도(V-field), 다기기 정정 병합(RSK-6).
