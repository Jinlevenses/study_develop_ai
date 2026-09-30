# SP-4 스파이크 보고서 — `node:sqlite` 다중 프로세스·WAL·FTS5 trigram 한국어 검색

- 대상 요구: NFR-MAINT-002(서비스별 SQLite 파일 소유), NFR-PORT-003/009, NFR-PERF-006(검색 p95 ≤ 100ms), FR-CUR-011(한국어 부분 일치 검색), FR-SET-012(ExperimentalWarning 억제), FR-SET-025(동기화 폴더 경고), FR-IMP-014(FTS5 상위 10 매칭), `03-convergence.md` SP-4 행
- 코드: `/home/user/study_develop_ai/spikes/sp4-node-sqlite/` (독립 패키지, 런타임 의존성 0, devDependency는 `tsx`만 — 경고 억제 검증용)
- 원시 결과: `spikes/sp4-node-sqlite/results/{summary,concurrency,search,features,warnings}.json`
- 검증 등급: 이 보고서의 모든 수치는 **Linux 컨테이너 실측(V-build)**이다. **Windows·macOS는 실행하지 못했으므로 해당 항목은 "V-live pending"**으로 표시한다(§5, §8).

## 1. 가설

> `node:sqlite`(Node 22.22, SQLite 3.51.2)는 (a) 서비스별 DB 파일을 WAL 모드로 소유하는 3개 프로세스가 동시에 쓰고 읽어도 `SQLITE_BUSY/LOCKED` 쓰기 경합 오류가 0이고, (b) FTS5 `trigram` + 짧은 질의 폴백으로 한·영·약어 혼합 검색의 상위 10 재현율 ≥ 0.8을 낼 수 있으며, (c) ExperimentalWarning을 억제할 수 있고, (d) 온라인 백업·JSON·STRICT 등 필요한 기능을 갖춘다.

합격 기준(`03-convergence.md`): 쓰기 경합 오류 0 / 검색 상위 10 재현율 ≥ 0.8 / 양 OS 동작. 실패 시 대응: 검색 전용 읽기 복제 또는 `content` 서비스 단일 쓰기 창구(Node SEA는 v1.x).

## 2. 환경

| 항목 | 값 |
|---|---|
| Node | `v22.22.2` (`/opt/node22/bin/node`) |
| OS | Linux 6.18.44-fc-v50 x86_64 (컨테이너/microVM), 4 vCPU, RAM 16GB, ext4(`/dev/vda`), uid 0 |
| SQLite | 3.51.2, `THREADSAFE=1`, `ENABLE_FTS5`, `ENABLE_FTS3`, `ENABLE_MATH_FUNCTIONS`, `ENABLE_DBSTAT_VTAB`, `ENABLE_SESSION`, `ENABLE_PREUPDATE_HOOK`, `MAX_ATTACHED=10`, `DEFAULT_WAL_AUTOCHECKPOINT=1000`, `DEFAULT_WAL_SYNCHRONOUS=2`. `generate_series` 없음, `loadExtension` 기본 차단(`allowExtension:false`) |
| 보조 | tsx 4.23.x (경고 억제 검증) |
| 미검증 | Windows(10/11), macOS, 비 root 사용자, NTFS/APFS, 네트워크·동기화 폴더 |

## 3. 방법

`npm run spike`는 4개 단계를 **단계별 별도 프로세스**로 실행하고(§7 잔여 위험 R-3 참조) `results/*.json`을 쓴 뒤 요약 JSON을 출력한다.

1. **동시성**(`src/concurrency.mjs`, `writer.mjs`, `reader.mjs`)
   - 쓰기 자식 프로세스: `events` 테이블(STRICT, `(writer,batch_id)` 인덱스)에 5행씩 묶은 `BEGIN IMMEDIATE … COMMIT` 트랜잭션을 **쉬지 않고** 반복(≈250B/행). `synchronous=NORMAL`, `timeout` 옵션(=busy_timeout) 5000ms. 모든 자식은 절대 시각 `startAt`에 동시에 시작.
   - 읽기 자식 프로세스: 3개 파일을 `readOnly:true`로 열어 `count(*)`를 연속 실행하고, 초당 1회 `(writer,batch_id)`별 행 수가 5가 아닌 배치(=찢어진 트랜잭션)를 검사한다. 카운트 단조 증가도 검사한다.
   - 시나리오: A 단일 쓰기 기준선 5s / A2 `synchronous` NORMAL vs FULL / **B1 파일 3개×쓰기 프로세스 3개(각자 자기 파일) + 읽기 프로세스 1개, 20s, busy_timeout 5000** / B2 동일 구성 10s, busy_timeout 0 / **C1~C4 두 프로세스가 같은 파일에 쓰기** (C1 `BEGIN IMMEDIATE`+5000ms 20s, C2 지연 `BEGIN`+읽기 후 쓰기 승격 10s, C3 `IMMEDIATE`+busy_timeout 0 10s, C4 7초짜리 쓰기 트랜잭션 vs busy_timeout 3000 대기자) / D 쓰기 중 `SIGKILL` 후 복구 / E 라이브 쓰기 중 `backup()`·`VACUUM INTO`.
   - 오류 분류는 `error.errcode & 0xff`(5=BUSY, 6=LOCKED)와 확장 코드(517=`BUSY_SNAPSHOT`)로 한다. 모든 시나리오 끝에서 `PRAGMA integrity_check`와 찢어진 배치 수를 검증한다.
2. **검색**(`src/search.mjs`, `search-eval.mjs`, `corpus-data.txt`, `corpus.mjs`, `heldout.mjs`)
   - 코퍼스: 개발자 개념 **310건**을 직접 작성(네트워크·K8s·도커·CI/CD·보안·DB·자료구조·OS·JS/TS·웹·아키텍처·테스트·운영). 각 문서는 `title / alias(영문·약어·동의어) / body`. 예: `쿠버네티스 파드 스케줄링`, `TCP 3-way handshake`, `K8s`, `CI/CD 파이프라인`, `JWT 토큰 검증`, `인덱스 B-Tree`.
   - 질의 **40건**(헤드라인): 한글 3자 이상 10 / 영문·약어 10 / **한글 1~2자 10**(캐시·해시·파드·도커·큐·락·소켓·세션·트리·스택) / 혼합 10(`DB 인덱스`, `CI 파이프라인`, `JWT 검증`, `redis 캐시` 등, 2자 토큰+긴 토큰 혼합 포함). 실패 유형 프로브 2건(`이벤트루프`=띄어쓰기 차이, `쿠버네티스에서 파드`=조사). **홀드아웃 20건**은 휴리스틱을 동결한 뒤 작성해 튜닝하지 않았다.
   - 정답(rel)은 검색 방법과 무관하게 **의도 기준으로 수기 주석**했다. 재현율 = `|top10 ∩ rel| / min(|rel|, 10)`.
   - 변형: **V0** 원시 trigram(`MATCH '"질의 전체"'`) / **V1** 하이브리드 기본(토큰 분리, ≥3자 토큰은 FTS trigram AND, <3자 토큰은 `instr()` 필터·스캔) / **V2** V1 + 공백 제거 컬럼 trigram 단계 + 조사 제거 단계 + IDF 가중 OR 채움(짧은 토큰=`instr` 스캔) / **V3** V2에서 짧은 토큰을 `unicode61 prefix` 인덱스로 대체.
   - 지연: 310건 / 12,310건(개념 469+KU 1,076+사용자 KU 10k 규모, NFR-PERF-006 가정) / 50,310건(합성 문서, 지연 전용) 각각에서 62개 질의를 워밍 후 반복 측정(p50/p95/p99/max).
3. **경고 억제**(`src/warnings.mjs`): 21개 조합을 자식 프로세스로 실행해 stderr의 `ExperimentalWarning` 유무 판정.
4. **기능 점검**(`src/features.mjs`): 생성자 옵션, 준비된 문장 재사용 처리량, 트랜잭션·SAVEPOINT, 사용자 함수/집계, `backup()`, JSON/STRICT, `readOnly`, `timeout`, 세션/체인지셋, 경로 처리.

## 4. 결과

### 4.1 동시성 — 서비스별 파일 3개 + 읽기 프로세스 (합격기준: 쓰기 경합 오류 0)

| 시나리오 | 쓰기 프로세스 | 커밋 수 | 처리량 | BUSY/LOCKED | 기타 오류 |
|---|---|---|---|---|---|
| A 단일 쓰기 5s (기준선) | 1 | 73,067 | 14,599 txn/s | 0 | 0 |
| **B1 각자 파일 ×3 + 읽기 1, 20s, busy_timeout 5000** | 3 | **689,756** (225,778 / 227,690 / 236,288) | 합 34,447 txn/s (프로세스당 11.3~11.8k) | **0** | 0 |
| B2 동일 구성 10s, **busy_timeout 0** | 3 | 276,869 | 합 27,685 txn/s | **0** | 0 |

- B1 커밋 지연: p50 0.027ms, p95 0.064ms, p99 0.15ms, max 63~64ms(체크포인트 시점). 3,448,780행 삽입, 종료 후 3개 파일 `integrity_check` = ok, 찢어진 배치 0.
- B1 **읽기 프로세스**(3개 파일 `readOnly:true`, 연속 조회): 3,654회, **오류 0**, 카운트 역행 0, 일관성 검사 37회에서 찢어진 배치 0. 읽기 p50 0.5ms, p95 30.6ms(쓰기 3개+읽기 1개가 4 vCPU를 포화시킨 상태에서 110만 행 `count(*)` 전체 스캔 포함이므로 하한이 아닌 상한 근사).
- WAL 파일 최대 크기(200ms 표본): 47 / 46 / 63 MB(11k txn/s×20s 극단 부하 + 읽기 스냅샷 공존 상태). DB 파일 274~288MB.
- 쓰기 부하는 실제 Fathom(학습 이벤트, 사람 속도)보다 **수 자릿수** 높은 것으로 추정한다. busy_timeout이 0이어도 파일이 분리되어 있으면 경합이 없다(B2). 읽기 프로세스가 쓰기를 막지도 않았다.

### 4.2 동시성 — 같은 파일에 쓰는 두 프로세스 (단일 쓰기 규칙 특성화)

| 시나리오 | 커밋 수(합) | 처리량(합) | BUSY 오류 | 비고 |
|---|---|---|---|---|
| **C1** `BEGIN IMMEDIATE` + busy_timeout 5000, 20s | 474,740 | 23,737 txn/s | **0** | 커밋 p99 1.5~1.6ms(파일 분리 시 0.15ms의 약 10배), max 79ms |
| C2 지연 `BEGIN`→SELECT→INSERT(읽기 스냅샷 후 승격), busy_timeout 5000, 10s | 230,198 | 23,019 txn/s | **5,969** (2.5%) | `errcode=5` 3,706 + **`errcode=517`(BUSY_SNAPSHOT)** 2,263. 오류 대기 최대 10.8ms → **busy_timeout이 무시됨** |
| C3 `IMMEDIATE`, busy_timeout **0**, 10s | 256,410 | 25,641 txn/s | **4,404** (1.7%) | 모두 즉시 `SQLITE_BUSY`(`database is locked`) |
| C4 7.0s 쓰기 트랜잭션 vs 대기자 busy_timeout 3000 | 대기자 32,033 | — | 대기자 **2건**, 각 **3,008~3,010ms 후** 실패 | 타임아웃은 정확히 준수. 홀더 커밋 후 대기자는 정상 재개 |

- 모든 C 시나리오에서 데이터 손상 0(`integrity_check` ok, 찢어진 배치 0). 경합은 **오류로만** 나타나며 조용한 손상은 없다.
- 결론: 같은 파일을 두 프로세스가 써도 **`BEGIN IMMEDIATE` + busy_timeout** 조합이면 오류 0이다. 쓰기 락은 파일당 1개이므로 처리량 이득이 아니라 **꼬리 지연 증가(p99 약 10배)**가 비용이다(합 23.7k txn/s는 단일 14.6k보다 높게 나왔는데, 락 대기 중 다른 프로세스의 준비 작업이 겹치기 때문으로 보이며 이 값에 의미를 두지 않는다).

### 4.3 동시성 — 크래시 복구(D)

쓰기 자식을 2.5초 시점에 **`SIGKILL`** → WAL 4.1MB 잔존 → 재오픈: `integrity_check` = ok, 찢어진 배치 0(169,435행 보존) → 새 쓰기 프로세스가 22,789 txn을 오류 0으로 이어서 기록. `synchronous=NORMAL`+WAL에서 프로세스 크래시로는 손상·부분 커밋이 생기지 않았다(전원 장애는 미검증; NORMAL은 마지막 커밋 유실 가능, 손상은 없음이 SQLite 문서 보장).

### 4.4 `synchronous` 비용 (WAL, 단일 쓰기 4s)

| 모드 | txn/s | 커밋 p50 | p99 |
|---|---|---|---|
| NORMAL | 15,103 | 0.027ms | 0.146ms |
| FULL | 3,983 | 0.220ms | 0.699ms |

### 4.5 온라인 백업 (라이브 쓰기 중, 7MB→수십 MB 원본)

| 방법 | 쓰기 부하 | 결과 | 사본 검증 |
|---|---|---|---|
| `backup(db, path)` 기본 rate(100쪽) | 없음 | 완료 34~38ms (1,766쪽) | ok, 30,000행, 찢어진 배치 0 |
| `backup()` 기본 rate | 20ms 간격 쓰기 | 완료 24~76ms (재시작 0~2회) | ok |
| `backup()` 기본 rate | **최대 속도 쓰기** | **20초 내 미완료**(진행 콜백 57,194회, 되감기 36,702회 관측). 쓰기 중지 후 0.87s에 완료 | ok |
| `backup(..., {rate:1000})` | 최대 속도 쓰기 | **3회 중 2회 완료**(0.29s·1.0s), 1회 20초 미완료 | ok |
| `backup(..., {rate:100000})` (≥ 전체 쪽 수) | 최대 속도 쓰기 | 3/3 완료 50~65ms (한 단계) | ok |
| **`VACUUM INTO ?`** | 최대 속도 쓰기 | 3/3 완료 74~188ms (약 20MB) | ok, 찢어진 배치 0 |
| `VACUUM INTO ?` | 없음 | 27~33ms | ok |

- 모든 완료된 사본은 `integrity_check` ok이며 배치 원자성이 유지되었다(스냅샷 일관).
- `backup(db, dest)`의 `dest`는 **문자열 경로만** 허용(`DatabaseSync` 전달 시 `ERR_INVALID_ARG_TYPE`). 반환은 `Promise<number>`(총 쪽 수), 옵션 `{rate, progress, source, target}`.
- `VACUUM INTO`는 대상 파일이 이미 있으면 `output file already exists` 오류 → 임시 이름에 쓰고 rename.

### 4.6 FTS5 trigram 검색 — 메커니즘 사실 (310건 코퍼스)

| 사실 | 실측 |
|---|---|
| 2자 한글 `MATCH '"캐시"'` | **0행, 오류 없음** (같은 질의 `instr` 스캔은 15행) |
| 2자 ASCII `MATCH '"db"'` | 0행 |
| 3자 한글 `"스케줄링"` / 3자 ASCII `"k8s"` | 3행 / 5행 |
| 대소문자 | 무시됨(`"jwt"` → `JWT` 문서 2행) |
| **NFD 질의 vs NFC 색인** | **0행** (NFC 질의는 3행) → 색인·질의 모두 `normalize('NFC')` 필수 |
| 인용 없이 `MATCH 'CI/CD'` | `fts5: syntax error near "/"` (errcode 1) → 토큰은 항상 `"…"`로 인용 |
| 공백 포함 구문 `"3-way handshake"` | 1행 (정상) |
| 외부 콘텐츠 FTS + 트리거(INSERT/UPDATE/DELETE) | 갱신·삭제 즉시 반영, `integrity-check` ok |
| `unicode61` prefix로 "네티스"("쿠버네티스" 중간 부분) | **0행** (trigram은 8행) → prefix 방식은 어중간 부분 일치를 못 찾는다 |
| `EXPLAIN QUERY PLAN`의 LIKE | 2자·3자 모두 같은 `SCAN fts_tri VIRTUAL TABLE INDEX 0:L2` 표시 → 계획 문자열로 인덱스 사용 여부를 구분할 수 없어 **의존하지 않음** |

### 4.7 검색 재현율 @10 (합격기준 ≥ 0.8)

| 변형 | 헤드라인 40 | 한글 ≥3 | 영문·약어 | **한글 1~2자** | 혼합 | 프로브 2 | 홀드아웃 20 | 합산 60 |
|---|---|---|---|---|---|---|---|---|
| V0 원시 trigram | 0.467 | 0.783 | 0.933 | **0.000** | 0.150 | 0.00 | 0.575 | 0.503 |
| V1 하이브리드 기본 | 0.855 | 0.783 | 0.933 | 0.988 | 0.717 | 0.25 | 0.925 | 0.878 |
| **V2 하이브리드 전체(짧은 토큰=instr)** | **0.943** | 0.883 | 0.933 | **0.988** | 0.967 | 1.00 | **1.000** | **0.962** |
| V3 V2 + 짧은 토큰=unicode61 prefix | 0.951 | 0.883 | 0.933 | 0.988 | 1.000 | 1.00 | 1.000 | 0.967 |

- 한글 1~2자 질의만 모으면(헤드라인 10 + 홀드아웃 4 = 14건): V0 0.000, V1·V2·V3 **0.991**. FR-CUR-011의 "2음절 부분집합 ≥ 0.8"에 해당하는 지표다.
- V2 헤드라인에서 재현율 1.0 미만인 질의 5건과 원인(자동 진단):
  - `데드락`(교착 상태 문서에 "데드락" 없음), `Redis`(캐시 문서에 "Redis" 없음), `가상 메모리`(관련 문서에 "가상" 없음), `CI 파이프라인`(정답 문서에 "파이프라인" 없음) → **어휘 격차(동의어·별칭 부재)** 4건. 검색 방식이 아니라 **콘텐츠 별칭 큐레이션** 문제다.
  - `트리`(0.875): 2자 부분 일치의 **오탐**(레지스트리·트리거·엔트리·스트리밍 속 "트리")이 정답 1건을 상위 10 밖으로 밀어냄 → **랭킹 미스** 1건. 단어 시작 위치 가산으로 완화했으나(0→0.875) 완전 해소는 아님.
- 정답 주석 감사: 리터럴로 질의를 포함하지만 rel에 없는 문서를 자동 목록화해 검토한 뒤 **6건을 rel에 추가**했다(캐시+`os.fsync`, 큐+`algo.dijkstra`, 소켓+`net.websocket`, 세션+`net.tls-handshake`, 힙+`algo.sorting-compare`, 토큰+`sec.csrf`). 검색 결과가 아니라 문서 내용만 보고 한 보정이다. 나머지 오탐 후보(예: "누락"의 "락", "급락")는 무관 문서로 유지.
- **정직성 주의**: (1) 코퍼스·질의·정답·알고리즘을 같은 사람이 작성했다 → 낙관적이다. (2) V1→V2 개선(단어 시작 가산, IDF 가중 OR, 공백 제거·조사 제거 단계)은 헤드라인 40건 결과를 보고 넣은 것이므로 헤드라인 0.943은 **튜닝된 값**이다. 튜닝 후 작성한 **홀드아웃 20건 1.000**이 더 신뢰할 만한 지표이나 홀드아웃은 상대적으로 쉽다. (3) 실제 KU는 더 길고 다양하다. 이 결과는 **메커니즘 타당성**을 보이는 것이고, 최종 수치는 DCP-01의 120질의 평가셋으로 같은 하니스(`recallAtK`, `evalSet`)를 재실행해 확정해야 한다.

### 4.8 검색 지연 (NFR-PERF-006: p95 ≤ 100ms)

전체 62개 질의, 단위 ms. 합성 문서(본문 14단어 무작위)는 지연 측정 전용이며 어휘 중복이 커서 후보 집합이 실제보다 큰 보수적 조건이다.

| 문서 수 | 변형 | p50 | **p95** | p99 | max | 한글 1~2자만 p95 |
|---|---|---|---|---|---|---|
| 310 | V0 원시 trigram | 0.08 | 0.24 | 0.41 | 1.30 | 0.06 |
| 310 | V2 | 0.30 | **0.82** | 1.28 | 2.69 | 0.42 |
| 310 | V3 | 0.26 | 0.86 | 1.36 | 3.45 | 0.47 |
| **12,310** | V0 | 0.35 | 1.11 | 2.00 | 2.41 | 0.07 |
| **12,310** | **V2** | 6.5 | **25.3** | 34.8 | 45.6 | 22.7 |
| **12,310** | V3 | 2.7 | 18.5 | 20.1 | 23.2 | 6.3 |
| 50,310 | V0 | 0.43 | 3.8 | 6.6 | 7.2 | 0.04 |
| 50,310 | V2 | 9.4 | 73.0 | 131.7 | 166.1 | 66.2 |
| 50,310 | V3 | 7.7 | 27.4 | 32.0 | 56.1 | 15.8 |

- 색인 크기(12,310건): 원문 `docs` 7.6MB, `fts_tri` 6.1MB, `fts_cmp`(공백 제거) 5.1MB, `fts_uni` 3.6MB. 적재 시간(트리거 3개 포함) 310건 42ms / 12,310건 3.5s / 50,310건 16.2s.
- V2의 병목은 한글 1~2자 `instr` 전수 스캔(선형)과 후보 300건 bm25 정렬이다. **약 4만 건 부근까지 p95 100ms 이내**, 그 이상이면 V3(unicode61 prefix)로 전환 가능하다.

### 4.9 ExperimentalWarning 억제 (Node 22.22.2에서 21개 조합)

| # | 방법 | 결과 |
|---|---|---|
| 1 | 기본 | 경고 출력: `ExperimentalWarning: SQLite is an experimental feature and might change at any time` |
| 2, 3 | `node --disable-warning=ExperimentalWarning` (ESM·CJS) | **억제** |
| 4 | `--no-warnings` | 억제(모든 경고를 숨김 — 비권장) |
| 5 | `NODE_OPTIONS=--disable-warning=ExperimentalWarning` | **억제** |
| 6 | `NODE_NO_WARNINGS=1` | 억제(모든 경고) |
| 7, 8 | `process.on('warning', …)` 핸들러만 등록(동적/정적 import) | **억제되지 않음**(핸들러는 이벤트를 받지만 기본 출력은 그대로) |
| 9 | `process.removeAllListeners('warning')` 후 동적 import | 억제(기본 출력 리스너까지 제거 — 모든 경고 손실) |
| 10 | `process.emitWarning` 재정의로 `ExperimentalWarning`만 필터 후 **동적 import** | **억제**(정적 import는 호이스팅되어 본문보다 먼저 평가되므로 같은 파일에서는 동적 import 필수 — 정적 import+재정의 조합은 미검증) |
| 11 | 오타 `--disable-warning=Experimental` | 억제 안 됨(유형명 정확 일치) |
| 12~15 | tsx: 기본은 경고 / `tsx --disable-warning=…` / `node --disable-warning=… --import tsx` / `NODE_OPTIONS` | 기본만 경고, 나머지 **억제** |
| 16 | `fork()` 자식(부모에 플래그) | **억제**(`execArgv` 상속) |
| 17 | `spawn(process.execPath)` 자식(부모에만 플래그) | **경고 출력**(execArgv 미상속) |
| 18 | `spawn()` 자식, 부모 `NODE_OPTIONS` | **억제**(env 상속) |
| 19, 20 | `worker_threads` (부모 플래그 유/무) | 유: 억제 / 무: 경고 |
| 21 | 셔뱅 `#!/usr/bin/env -S node --disable-warning=ExperimentalWarning` | **억제**(Linux; Windows는 §5.5) |

### 4.10 DatabaseSync 기능 (Node 22.22.2 실측)

| 항목 | 결과 |
|---|---|
| 표면 API | `DatabaseSync`(`open/close/prepare/exec/function/aggregate/location/createSession/applyChangeset/enableLoadExtension/loadExtension`, `isOpen`, `isTransaction`, `Symbol.dispose`), `StatementSync`(`run/get/all/iterate/columns/setReadBigInts/setReturnArrays/setAllowBareNamedParameters/setAllowUnknownNamedParameters`, `sourceSQL`), `backup`, `constants` |
| 준비된 문장 재사용 | 조회 **871,418 ops/s**(재사용) vs 129,256 ops/s(매번 prepare) = **6.7배**(이전 실행 618,745 vs 131,728 = 4.7배; 실행마다 변동). 메모리 DB 단일 트랜잭션 삽입 604,023행/s. 파일 WAL+NORMAL 자동 커밋 삽입 47,149행/s |
| 트랜잭션 | `BEGIN [IMMEDIATE]`/`COMMIT`/`ROLLBACK`/`SAVEPOINT`/`ROLLBACK TO` 정상. 중첩 `BEGIN`은 `cannot start a transaction within a transaction`. `db.isTransaction` 존재(boolean) |
| 사용자 함수 | `db.function(name, {deterministic, varargs, useBigIntArguments}, fn)` 정상. **deterministic 함수 위 표현식 인덱스 생성 가능**. `REGEXP` 연산자 구현 가능. 함수 안 예외는 SQL 오류로 전파. 예: 초성 추출 함수(`쿠버네티스 파드`→`ㅋㅂㄴㅌㅅ ㅍㄷ`) |
| 사용자 집계 | `db.aggregate(name, {start, step, result, inverse})` 정상(윈도우 `inverse` 포함) |
| 백업 | §4.5 |
| JSON | `json_extract`, `->`, `->>`, `json_each`, `json_group_array`, `jsonb()` 정상. `CHECK (json_valid(col))`가 잘못된 JSON을 거부(errcode 275). `json_extract` 표현식 인덱스가 covering으로 사용됨 |
| STRICT | 정상. `'abc'`→INTEGER 열은 errcode 3091로 거부, `'42'`는 42로 **강제 변환 후 저장**, `ANY` 열 허용, `VARCHAR(10)` 등 비표준 타입은 생성 거부 |
| `readOnly` | 읽기 정상, 쓰기는 `errcode=8 attempt to write a readonly database`. 존재하지 않는 파일은 `errcode=14`(unable to open). **다른 프로세스가 WAL 쓰기 중이어도 `readOnly` 조회 정상**(§4.1) |
| `timeout` 옵션 | `PRAGMA busy_timeout` 읽기 값 == 지정값(4321 확인). **기본값은 0** → 반드시 지정 |
| 기타 옵션 | `enableForeignKeyConstraints` 기본 **true**(`foreign_keys=1`), `enableDoubleQuotedStringLiterals` 기본 false, `readBigInts`, `returnArrays`, `open:false`+`open()` 정상. **알 수 없는 옵션은 조용히 무시**(오타 위험) |
| 세션/체인지셋 | `createSession()` → `changeset()` → 다른 DB에 `applyChangeset()` 정상(34바이트, 2행 적용) — FR-SET-022 다기기 병합의 후보 도구(이번 스파이크에서는 동작만 확인) |
| 오류 객체 | `code`는 항상 `ERR_SQLITE_ERROR`, 세부는 `errcode`(**확장 코드**: 1555=PK 충돌, 3091=STRICT 위반, 517=BUSY_SNAPSHOT)와 `errstr` |
| 함정 | ① `Date`를 바인딩하면 **오류 없이 NULL**이 저장됨 ② `boolean`·`undefined` 바인딩은 `ERR_INVALID_ARG_TYPE` ③ 2^53 초과 정수 읽기는 `ERR_OUT_OF_RANGE`(`setReadBigInts(true)` 필요) ④ `prepare()`에 여러 문장을 주면 **첫 문장만** 컴파일(나머지 무시) ⑤ 결과 행은 **null 프로토타입 객체** ⑥ `close()` 두 번 호출은 `ERR_INVALID_STATE` ⑦ 닫힌 DB의 문장 사용은 `statement has been finalized` |
| ATTACH | 다른 파일 ATTACH·조회 가능(기술적으로는 가능하나 NFR-MAINT-002가 금지 → 정적 검사 대상) |
| `PRAGMA user_version` / `application_id` | 읽기·쓰기 정상 → 마이그레이션 버전 관리에 사용 가능 |

## 5. 합격기준 대비 판정

| # | 기준 | 판정 | 근거 |
|---|---|---|---|
| 1 | 서비스별 파일 3개 프로세스 동시 쓰기 20s: `SQLITE_BUSY/LOCKED` 0 (busy_timeout 설정) | **PASS** | 689,756 커밋·3.45M행, BUSY/LOCKED 0, 기타 오류 0. 읽기 프로세스(3파일 readOnly) 3,654회 오류 0, 찢어진 배치 0. busy_timeout 0에서도 0(B2) |
| 1b | 같은 파일 2프로세스 쓰기 특성화 | **PASS(조건부)** | `BEGIN IMMEDIATE`+busy_timeout: 오류 0. 지연 `BEGIN`→승격: BUSY 5,969건(517 포함). busy_timeout 0: 4,404건. 데이터 손상 0 → 단일 쓰기 규칙은 "강제 잠금"이 아니라 **관행+안전망**으로 충분(§6.2) |
| 2 | FTS5 trigram 한·영·약어 혼합 상위 10 재현율 ≥ 0.8 | **PASS(낙관 편향 주의)** | V2: 헤드라인 40건 0.943, 홀드아웃 20건 1.000, 합산 0.962, 한글 1~2자 0.991. **원시 trigram(V0)은 0.467로 FAIL** → 짧은 질의 폴백이 **필수** |
| 2b | 검색 지연 p95 ≤ 100ms (NFR-PERF-006, 약 1.15만 건) | **PASS** | V2 p95 25.3ms(12,310건), V3 18.5ms. 50,310건 V2 73ms(p99 132ms) |
| 3 | ExperimentalWarning 억제 | **PASS** | `--disable-warning=ExperimentalWarning`, `NODE_OPTIONS`, `NODE_NO_WARNINGS`, `emitWarning` 재정의(동적 import 한정) 동작. `process.on('warning')`은 **억제 불가** |
| 4 | DatabaseSync 기능(준비 재사용·트랜잭션·사용자 함수·backup·JSON·STRICT·readOnly·timeout) | **PASS**, backup은 **PARTIAL** | 전부 동작. 단 기본 `backup()`은 연속 쓰기 중 무한 재시작(20초 미완료) → `VACUUM INTO` 사용(§6.5) |
| 5 | 양 OS 동작(Windows 경로 포함) | **V-live pending** | Linux만 실행. Windows/macOS 미검증. §5.5는 문서화만 |
| — | 종합 | **PARTIAL → 동결 진행 가능** | Linux V-build 기준 전 항목 통과. 폴백(검색 전용 읽기 복제/`content` 단일 쓰기 창구)은 **발동 불필요**. Windows V-live와 DCP-01 120질의 재평가가 남음 |

### 5.5 Windows 경로·플랫폼 우려 (문서화만 — V-live pending)

Linux에서 확인된 것: 한글+공백 경로(`한글 경로 with space/데이터/학습 기록.db`), `URL`(`pathToFileURL`)·`Buffer` 경로, `file:...?mode=ro` 문자열, 상대 경로, 378자 경로, `db.location()`이 모두 정상. 이것은 UTF-8 경로 처리만 증명하며 Windows를 대변하지 않는다.

1. **기본 데이터 경로**: `%LOCALAPPDATA%\Fathom`. `%APPDATA%`(로밍), `Documents`·`Desktop`(Windows 11에서 OneDrive로 자동 리디렉션될 수 있음)은 WAL 손상 위험(FR-SET-025) → 기동 시 경로 휴리스틱 경고.
2. **필수 파일 잠금**: 열린 DB(및 `-wal`/`-shm`)는 삭제·이름 변경이 `EBUSY/EPERM`으로 실패한다. 테스트 정리와 복원·교체 절차는 반드시 `db.close()` 후 수행. 백신·인덱서의 일시 잠금은 `SQLITE_BUSY`/IO 오류로 나타날 수 있으므로 `timeout` 5000 유지, 열기 재시도 1~2회.
3. **경로 길이**: 260자(MAX_PATH) 미검증. 데이터 경로를 짧게 유지하고 Windows 긴 경로 여부를 V-live에서 확인.
4. **한글 사용자 폴더**(`C:\Users\홍길동\…`): SQLite는 UTF-8→UTF-16 변환을 하므로 이론상 정상이나 미검증.
5. **WSL·네트워크 드라이브**: Windows Node가 `\\wsl$`나 UNC 공유의 DB를 열거나, WSL의 Node가 `/mnt/c`의 DB를 열면 WAL의 공유 메모리(`-shm`)가 신뢰할 수 없다 → 로컬 네이티브 파일시스템만 지원(doctor 경고).
6. **시그널**: Windows에는 `SIGTERM` 우아한 종료가 없다(`kill`=강제 종료). 종료는 HTTP `/shutdown` 또는 IPC 메시지로 `db.close()`하게 하고, 강제 종료 복구는 §4.3으로 안전(크래시 시 손상 0).
7. **경고 억제 문법**: `package.json` scripts의 `NODE_OPTIONS=… cmd`는 cmd.exe에서 동작하지 않는다 → `node --disable-warning=… x.js` 형태를 쓰거나 `cross-env`. **셔뱅의 `env -S node --flag`는 Windows에서 무시**되므로 `fathom` 진입점은 (a) 코드 첫 줄에서 `process.emitWarning` 필터 + 동적 import, (b) 자식 스폰 시 `NODE_OPTIONS` 전달을 함께 쓴다(§6.6).
8. **macOS**: 사용자 입력·붙여넣기 문자열이 NFD일 수 있다(§4.6: NFD 질의는 0행) → 색인·질의 양쪽 `normalize('NFC')`. APFS 파일명 정규화는 DB 내용과 무관.
9. **내구성 수치**: `synchronous=FULL`은 Linux ext4에서 NORMAL의 약 1/3.8 처리량(§4.4). Windows의 `FlushFileBuffers` 비용은 미측정.

## 6. 설계 권고

### 6.1 연결 팩토리·PRAGMA (SqlitePort 어댑터의 `open`)

```ts
import { DatabaseSync } from 'node:sqlite';

export function openDb(path: string, { readOnly = false } = {}): DatabaseSync {
  const db = new DatabaseSync(path, { readOnly, timeout: 5000 }); // timeout = busy_timeout (기본 0!)
  if (!readOnly) db.exec('PRAGMA synchronous=NORMAL');           // WAL에서 FULL 대비 3.8배 처리량, 크래시 안전
  return db;                                                     // foreign_keys는 기본 ON
}
// DB 생성/마이그레이션 시 1회: PRAGMA journal_mode=WAL (파일에 영속). 자식 프로세스는 다시 지정하지 않는다.
```

- 테이블은 **`STRICT`** + `CHECK (json_valid(...))`. 불리언은 `INTEGER CHECK (x IN (0,1))`, 시각은 epoch ms `INTEGER` 또는 ISO `TEXT`(**`Date` 직접 바인딩 금지**: 조용히 NULL), ID는 ULID `TEXT`, 2^53 초과 정수는 `TEXT`로 저장.
- 생성자 옵션 오타가 조용히 무시되므로 어댑터에서 옵션 키를 화이트리스트 검증. 오류는 `errcode & 0xff`로 분류(5=BUSY 재시도 대상, 그 외 즉시 실패), 517(`BUSY_SNAPSHOT`)은 **코드 결함 신호**.
- `db.isOpen`/`isTransaction`이 있으므로 트랜잭션 헬퍼에서 중첩 시작을 방지할 수 있다.

### 6.2 쓰기 규칙 (단일 쓰기 규칙의 구체화)

```ts
export function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');           // 절대 지연 BEGIN 후 읽기→쓰기 승격을 쓰지 않는다 (C2: BUSY 5,969건, busy_timeout 무시)
  try { const v = fn(); db.exec('COMMIT'); return v; }
  catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
}
```

- **W1**: DB 파일당 소유 서비스 프로세스 1개가 쓴다(NFR-MAINT-002). 서비스 간 DB 파일 직접 접근·ATTACH 금지(정적 검사).
- **W2**: 모든 쓰기는 `tx()`(=`BEGIN IMMEDIATE`)로만. 쓰기 트랜잭션은 **짧게(수 ms~100ms 이하)** — busy_timeout(5000ms)은 대기자를 정확히 그 시간 후에 실패시키므로(C4), 긴 트랜잭션(외부 호출·`await` 포함)을 금지.
- **W3**: 보조 도구(`fathom seed`, restore, doctor)가 서비스 실행 중 같은 파일에 쓰는 경우는 **허용**한다: W2를 지키면 오류 0(C1)이고 손상 0이다. 다만 읽기-후-쓰기 승격 패턴만은 금지.
- **W4**: 읽기 전용 소비자(검색·리포트 프로세스)는 `openDb(path, {readOnly:true})`. WAL에서 쓰기를 막지 않고 스냅샷 일관성이 유지됨을 확인(오류 0, 찢어진 배치 0). → 동결 표의 폴백 "검색 전용 읽기 복제"는 **불필요**.
- **W5**: 콘텐츠 팩 적재(FR-CUR-002)는 단일 `tx()`. 서비스 간 원자적 쓰기는 여전히 불가능하므로 ARC 동결 조건(FE-07)의 보상·멱등 규칙은 그대로 필요.
- WAL 파일은 극단 부하(서비스당 11k txn/s, 읽기 스냅샷 공존)에서 47~63MB까지 커졌다. 실사용 부하에서는 무관하나 소유 서비스가 유휴 시 `PRAGMA wal_checkpoint(PASSIVE)`를 주기 실행하고 `PRAGMA journal_size_limit`을 설정할 것을 권고한다(둘 다 이번에 **미측정**).

### 6.3 검색 스키마와 질의 파이프라인 (FR-CUR-011, NFR-PERF-006)

```sql
CREATE TABLE docs(id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL, alias TEXT NOT NULL, body TEXT NOT NULL,
  ntext TEXT NOT NULL,      -- NFC + lower(title||alias||body), 짧은 토큰 instr() 스캔용
  compact TEXT NOT NULL     -- ntext에서 공백 제거, 띄어쓰기 차이 흡수용
) STRICT;
CREATE VIRTUAL TABLE fts_tri USING fts5(title, alias, body, content='docs', content_rowid='id', tokenize='trigram');
CREATE VIRTUAL TABLE fts_cmp USING fts5(compact,            content='docs', content_rowid='id', tokenize='trigram');
-- + 외부 콘텐츠 동기화 트리거 3종(AI/AD/AU: 'delete' 명령 후 재삽입). 구현은 spikes/sp4-node-sqlite/src/search.mjs
```

질의 처리(`searchHybrid`, 단계별로 미등장 문서를 추가하며 10건 채움):

1. **정규화**: `normalize('NFC').toLowerCase()`를 색인 시·질의 시 모두 적용. 공백으로 토큰 분리.
2. **AND 단계**: 토큰이 3자 이상이면 `MATCH '"tok1" AND "tok2"'`(**항상 큰따옴표 인용**, `CI/CD` 같은 기호 안전), `ORDER BY bm25(fts_tri, 10.0, 5.0, 1.0) LIMIT 300`. 3자 미만 토큰은 후보에 `instr(ntext, tok) > 0` 필터로 적용. 모두 짧으면 `SELECT … FROM docs WHERE instr(ntext, ?) > 0` 스캔(**LIKE 대신 `instr`** — 이스케이프 불필요, 결과 동일).
3. **조사 제거 AND**: `에서/에게/으로/에는/이란/라는/…/을/를/은/는/이/가/에/의/와/과/도/로` 접미 제거(남는 길이 ≥ 3자일 때만) 후 재시도.
4. **공백 제거 단계**: 질의에서 공백을 제거해 `fts_cmp`(≥3자) 또는 `instr(compact, …)`(<3자)로 조회 → "이벤트루프"↔"이벤트 루프".
5. **OR 단계**: 남은 슬롯은 토큰별 후보의 합집합을 **IDF 가중**(`log(1+N/df)`)으로 순위화 — 희귀 토큰(`파이프라인`)이 흔한 토큰(`ci`)을 이기게 한다.
6. **동순위 가산**: 제목 일치 > 제목 접두 > **단어 시작 위치 일치** > 제목 부분 > 별칭 > 본문. 2자 한글의 어중간 부분 오탐(`트리`⊂`레지스트리`)을 억제한다.

- **콘텐츠 정책**: 별칭(alias) 열에 영문 정식명·약어·동의어를 반드시 넣는다(`데드락`/`교착 상태`, `Redis`, `K8s`/`Kubernetes`). 어휘 격차 4건이 재현율 손실의 대부분이다(R1 lint 규칙 후보: "한글 개념은 영문 alias 1개 이상").
- `unicode61`+prefix(V3)는 어중간 부분 일치를 못 찾는다(0행 vs trigram 8행) → **기본 채택하지 않는다**. 사용자 KU가 약 3~4만 건을 넘어 V2 p95가 80ms에 접근할 때만 짧은 토큰 경로를 V3로 교체(색인 +3.6MB/1.2만 건).
- FR-STD-019(오프라인 trigram 힌트)와 FR-IMP-014(Inbox 상위 10 매칭, p95 ≤ 300ms)는 같은 모듈을 재사용한다(12,310건에서 p95 25ms).
- 초성 검색(es-hangul)은 별도 경로: 사용자 함수(`hangul_initials`, deterministic)로 초성 컬럼을 채워 인덱스하는 방식이 가능함을 확인했다(§4.10).

### 6.4 SqlitePort 표면 (NFR-PORT-009)

어댑터가 노출할 최소 표면: `open(path, {readOnly})`, `exec(sql)`, `prepare(sql) → {run,get,all,iterate}`(문장 캐시로 재사용 4.7~6.7배), `tx(fn)`, `function(name, opts, fn)`, `backupTo(path)`, `close()`. 오류는 `{kind:'busy'|'constraint'|'readonly'|'other', errcode}`로 정규화. `node:sqlite`가 experimental이므로 doctor가 Node 22 EOL(2027-04-30)과 API 변화를 경고한다(NFR-PORT-009).

### 6.5 백업 (`fathom backup`, 복원 검증)

```ts
// 권장: 단일 스냅샷 읽기 트랜잭션으로 일관된 복사본. 대상 파일이 이미 있으면 오류이므로 임시 이름 + rename.
db.prepare('VACUUM INTO ?').run(tmpPath);          // 라이브 쓰기 중에도 74~188ms(~20MB)에 완료, 사본 integrity ok
fs.renameSync(tmpPath, finalPath);
// 사본 검증: new DatabaseSync(tmpPath).prepare('PRAGMA integrity_check').get()
```

- **`backup(db, dest)` 기본 rate(100쪽)는 연속 쓰기 프로세스가 있으면 계속 되감겨 완료되지 않을 수 있다**(20초·되감기 36,702회). 써야 한다면 `rate`를 전체 쪽 수 이상(예: 100000)으로 주어 한 단계로 끝내거나, 쓰기를 잠시 멈춘다. **반환된 Promise가 끝나기 전에 원본 `db.close()`를 호출하지 말 것**(§7 R-3).
- `VACUUM INTO`는 읽기 스냅샷을 유지하는 동안 WAL 체크포인트가 그 지점을 넘지 못한다 → 대형 DB(수백 MB)의 소요 시간은 INT 단계에서 별도 측정한다(이번엔 ≤ ~45MB).

### 6.6 ExperimentalWarning 억제 (FR-SET-012)

- **1순위**: 모든 Node 실행에 `--disable-warning=ExperimentalWarning`. `package.json` scripts(`"start": "node --disable-warning=ExperimentalWarning dist/cli.js"`), tsx(`tsx --disable-warning=ExperimentalWarning`)에 명시.
- **자식 프로세스**: 감독자(`fathom up`)가 서비스를 `spawn`할 때 `env.NODE_OPTIONS`에 플래그를 **병합해 전달**(spawn은 execArgv를 상속하지 않음; `fork`·`worker_threads`는 상속). 러너 자식(SP-2)도 동일.
```ts
const F = '--disable-warning=ExperimentalWarning';
process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, F].filter(Boolean).join(' ');
```
- **진입점 안전망**(셔뱅·Windows 셔뱅 무시 대비): 진입 파일 첫 줄에서 `process.emitWarning`을 `ExperimentalWarning`만 걸러내도록 감싼 뒤 `await import('node:sqlite')`. `process.on('warning')`은 쓰지 않는다(억제 불가).
- `--no-warnings`·`NODE_NO_WARNINGS`·`removeAllListeners('warning')`는 다른 경고(예: 보안·폐기 예고)까지 삼키므로 비권장.
- 수용기준 "콘솔 출력에 ExperimentalWarning 0"은 (1)+(자식 전달)로 충족되며 E2E에서 감독자가 띄우는 **모든 서비스 프로세스의 stderr**를 검사한다.

### 6.7 동결 문서 반영 요약

| 항목 | 반영 |
|---|---|
| 동결 표 SP-4 행 | "쓰기 경합 오류 0"·"재현율 ≥ 0.8" 통과(Linux). 폴백 미발동. "양 OS 동작"은 V-live pending으로 이월 |
| NFR-MAINT-002 | 파일 분리+W1~W5. 서비스 간 ATTACH는 정적 검사로 금지(기술적으로는 가능함을 확인) |
| FR-CUR-011 | 3경로(trigram/짧은 토큰 스캔/초성)+공백 제거·조사 제거 단계 추가, 별칭 큐레이션 규칙 추가. **V0(원시 trigram)만으로는 0.467로 부족** |
| NFR-PERF-006 | 1.2만 건 p95 25ms. 스케일 상한 표시(약 4만 건) |
| FR-SET-012 | §6.6 |
| NFR-PORT-009 | §6.4 |

## 7. 잔여 위험

| ID | 위험 | 대응/상태 |
|---|---|---|
| R-1 | **Windows·macOS 미검증**(경로, 필수 잠금, 백신 잠금, `-shm`, 시그널, 셔뱅) | V-live pending. §5.5 체크리스트를 Windows CI/실기에서 재현. 실패 시 어댑터·플래그 수준(경로, timeout, 종료 절차)으로 대응 |
| R-2 | 검색 평가의 **낙관 편향**(작성자=평가자, 310건 소형 코퍼스, 헤드라인은 휴리스틱 튜닝 후 값) | DCP-01 120질의로 재평가(같은 하니스). 홀드아웃과의 차이를 확인 |
| R-3 | **원인 미규명 네이티브 크래시(SIGSEGV) 2회**: 모든 단계를 한 프로세스에서 순차 실행한 초기 하니스의 전체 실행 **2회 모두**에서 발생(1회는 백업 단계 중, 1회는 검색 단계 중; 백업 단계 코드는 당시 타임아웃 후 진행 중인 `backup()` Promise를 두고 `db.close()`를 호출했음). 이후 단계별 프로세스 분리 전체 실행 2회, 검색 단독 2회, 기능+검색 4회, 동시성 단독 1회, 경고 제외 전체 3회, 백업 중 `close()` 5회, 라이브 쓰기+백업 중 `close()` 8회, GC 압박 시나리오 11종(세션·사용자 함수·집계·닫힌 문장 등)에서는 **0회**. 원인 미확정(GC 시점 또는 진행 중 백업 중 close 가설) | 백업 Promise 완료 전 원본 `close()` 금지, 백업·대량 작업은 **별도 프로세스**, 서비스는 감독자 자동 재시작 + 크래시 후 `integrity_check`(SIGKILL 복구는 안전함, §4.3). 필요 시 `npm run spike:hazard`로 재현 시도. 릴리스 전 22.x 최신 패치로 재확인 |
| R-4 | `node:sqlite`는 experimental: API 변경·22.x EOL(2027-04-30) | `SqlitePort` 어댑터 + doctor 경고 + LTS 매트릭스 CI(NFR-PORT-009) |
| R-5 | 실제 사용자 KU 규모·문서 길이가 합성 가정보다 크면 V2의 짧은 토큰 스캔이 선형으로 느려짐 | 약 4만 건 도달 시 V3 경로로 교체(설계에 스위치 확보). 문서 평균 길이가 4배가 되면 임계도 1/4로 본다 |
| R-6 | 어휘 격차(별칭 부재)가 재현율 손실의 주원인 | 콘텐츠 lint에 영문 alias·동의어 필수 규칙(R1) |
| R-7 | 정전 시 `synchronous=NORMAL`은 마지막 커밋 유실 가능(손상 없음). 정전 내구성은 이번에 미측정 | 이벤트 원장은 다기기 병합·재전송 설계(FR-PRG-001/003)로 흡수. 중요 쓰기는 백업 주기와 병행 |
| R-8 | WAL 크기 상한·체크포인트 정책 미측정(극단 부하에서 63MB) | 서비스 유휴 시 PASSIVE 체크포인트 + `journal_size_limit` 검증을 INT 단계에서 |
| R-9 | 큰 DB의 `VACUUM INTO` 소요·읽기 스냅샷 유지 영향 미측정(≤ ~45MB만 측정) | INT 단계에서 최대 예상 크기로 측정 |
| R-10 | `Date` 무경고 NULL 바인딩 등 API 함정 | 어댑터에서 바인딩 값 타입 검증(허용: number, string, bigint, Uint8Array, null) |

## 8. 재현 방법

```bash
cd /home/user/study_develop_ai/spikes/sp4-node-sqlite
npm install                 # devDependency: tsx 만
npm run spike               # 전체(약 4분): features → warnings → search → concurrency. 요약 JSON 출력, 상세는 results/*.json
npm run spike -- --seconds=5            # 20초 시나리오를 5초로 단축(빠른 확인)
npm run spike:concurrency   # 동시성+백업만 (약 3분)
npm run spike:search        # 검색 재현율·지연만 (약 45s)
npm run spike:warnings      # 경고 억제 21조합
npm run spike:features      # DatabaseSync 기능 점검
npm run spike:hazard        # (선택) 라이브 쓰기 중 backup() + close() 크래시 재현 시도
npm run clean               # .work/(약 3.3GB 임시 DB) 삭제
```

- 주요 파일: `src/concurrency.mjs`(오케스트레이터), `writer.mjs`/`reader.mjs`(자식), `backup-suite.mjs`/`backup-hazard*.mjs`(백업), `search.mjs`(검색 모듈: 스키마·트리거·`searchHybrid`·`recallAtK`), `search-eval.mjs`(평가·지연), `corpus-data.txt`(310건)·`corpus.mjs`(헤드라인 40+프로브 2)·`heldout.mjs`(20), `warnings.mjs`, `features.mjs`, `spike.mjs`(드라이버).
- 수치는 4 vCPU 공유 환경의 단일 실행값이다. 처리량·지연은 실행마다 ±10~20% 변동한다(같은 코드 3회 실행에서 백업 완료 시간, 오류 건수가 달랐음을 §4.2·§4.5에 범위로 표기).
- 결과 JSON 전체는 `results/`에 있으며 다른 OS에서 같은 명령으로 재실행해 V-live를 채울 수 있다(경로 구분자는 `path.join` 사용).
