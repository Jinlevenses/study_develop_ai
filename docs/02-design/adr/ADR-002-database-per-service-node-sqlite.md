# ADR-002. 서비스별 데이터베이스 — `node:sqlite`, `openDb()` 팩토리·SQLite 규약, 대량 작업 = 단명 자식 job, `ext`/`ext_v`, 모듈별 마이그레이션

- **상태**: Accepted · **일자**: 2026-10-01 · **결정자**: T1(아키텍처)
- **Trace**: UR-08·12·15, CON-005, NFR-MAINT-002, NFR-PORT-003·005·009, NFR-DATA-001·003·006·012, NFR-PERF-006, FR-CUR-011, DR-020, PLN-REV-01 AQ-10, SP-3 §6.5, **SP-4 전체 + 감사 PARTIAL(구속 결정 15항)**, SP-7 감사(SQL 규약)
- **관련**: ARC-01 §5.4·§9·부록 B.3, ADR-001·010·011·012·013

## 맥락 (Context)

- 서비스는 자기 데이터만 소유해야 하고(NFR-MAINT-002), 네이티브 빌드는 금지다(NFR-PORT-003). `node:sqlite`(Node 22.22, SQLite 3.51.2)는 플래그 없이 동작하지만 experimental이다.
- SP-4 실측(Linux, 감사 재현): 서비스별 파일 3개·프로세스 3개 동시 쓰기에 BUSY/LOCKED 0(`busy_timeout=0`에서도), 75만 커밋·읽기 4,737회 오류 0, 같은 파일 2프로세스는 `BEGIN IMMEDIATE` + busy_timeout이면 오류 0이지만 지연 `BEGIN` 승격은 BUSY·BUSY_SNAPSHOT(517) 발생(오류 수는 실행마다 수 배 변동 — 방향만 재현), `timeout` 기본값 0, `synchronous=FULL`은 NORMAL의 1/3.8 처리량, `VACUUM INTO`는 라이브 writer 아래에서도 일관 사본, `Date` 바인딩은 조용히 NULL, 알 수 없는 생성자 옵션은 조용히 무시, `.code`는 항상 `ERR_SQLITE_ERROR`, 원인 미규명 SIGSEGV 2회(백업 중 close 가설, 감사 재실행에서는 0회). 실행 간 편차는 보고된 ±10~20%보다 크다(단일 writer 14,599 → 25,683 txn/s, 준비 문장 재사용 이득 6.7배 → 3.5배, 1.2만 건 검색 p95 25.3 → 17.2ms).
- **감사 정정**: 기본 `backup()`이 "항상 실패"는 틀렸고 **완료 시간이 한정되지 않는다**가 맞다(재실행 303ms에 608회 재시작 후 완료). 검색: 따옴표 인용은 안전하지만 **토큰의 구두점·따옴표가 제거되지 않아** `(쿠버네티스`·사용자가 입력한 `"캐시"`가 0건. `LIKE`는 `%`·`_`에서 310건 전부를 반환(instr와 같지 않음). 2음절 재현율 0.991은 순환(관련 집합 = 문자 포함 문서)이라 근거가 아니다. Windows·macOS 지원은 확립되지 않았다.
- SP-3: 원장은 `synchronous=FULL`에서도 append p99 11.7ms(감사)로 여유가 크고, NORMAL은 전원 손실 시 마지막 커밋을 잃을 수 있다.
- 15년 수명 동안 스키마가 바뀐다. DR-020은 이름 훅(실제 열) + `ext` JSON 2층을 요구하고, AQ-10은 `ext` 형식과 승격 방법을 묻는다. 병렬 에이전트가 같은 마이그레이션 디렉터리를 동시에 건드리면 충돌한다.

## 결정 (Decision)

1. **파일 소유**: `content.db`(content) · `learning.db`·`insight.db`(learning) · `ai.db`·`ai-cache.db`(ai-gateway) · `ops.db`(ops-api). 파일당 소유 서비스 1개(W1). 서비스 간 DB 경로 문자열·`ATTACH` 0(`check:db-paths` 정적 검사 + 런타임 파일 핸들 검사). gateway·supervisor는 DB가 없다. 소유 서비스의 단명 자식 job과 보조 도구(seed·restore·doctor)는 그 파일에 **`BEGIN IMMEDIATE` + 짧은 배치 tx로만** 쓴다(W3) — 단일 writer는 규약 + 안전망이지 하드 락이 아니다.
2. **`SqlitePort` 어댑터**(`@fathom/shared-kernel/sqlite/sqlite`)만 `node:sqlite`를 import하고, 서비스 코드의 `new DatabaseSync` 직접 호출은 금지다(`check:boundaries` 규칙 `sqlite-direct`).
   - **연결 = `openDb(path, {readOnly?, synchronous, recursiveTriggers?})` 팩토리**: `new DatabaseSync(path, { readOnly, timeout: 5000, enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false })`, 옵션 키 화이트리스트(모르는 키 = 예외). 읽기 전용 소비자는 `readOnly: true`(WAL 스냅샷 읽기는 writer를 막지 않으므로 검색 읽기 복제본은 두지 않는다).
   - PRAGMA: 생성·마이그레이션 시 `journal_mode=WAL` 1회. 매 연결 `synchronous=NORMAL`, **`learning.db`만 `FULL`**, 원장 연결은 `recursive_triggers=ON`(ADR-011). 유휴 5분마다 `wal_checkpoint(PASSIVE)`, `journal_size_limit=67108864`(INT-1b 측정 후 확정). `cache_size`·`temp_store`·`mmap_size`는 측정 전 변경 금지.
   - 쓰기: `tx(fn)` = `BEGIN IMMEDIATE … COMMIT`만. 지연 `BEGIN` 후 승격 금지(`busy_timeout`을 우회). tx ≤ 100ms(서빙 프로세스), tx 안 `await`·외부 호출 금지(대기자는 정확히 `busy_timeout`에서 실패). 중첩 시작은 `db.isTransaction`으로 차단.
   - 바인딩 가드: `number | string | bigint | Uint8Array | null`만. `Date`·`boolean`·`undefined` → 예외.
   - **SQL 텍스트 규약(STD-01, SP-7 감사)**: SQL 텍스트 입구는 `prepare(sql: string)`·`exec(sql: string)` 둘뿐이다(다른 편의 메서드에 SQL 문자열을 받지 않는다). 인자는 **정적 SQL**만 — 문자열 리터럴, `${}` 없는 템플릿, 리터럴 + 리터럴, `${ident(x)}`·`${placeholders(n)}`·`${sqlInt(n)}` 보간, `*.sql.ts`에서 import한 `UPPER_SNAKE` 상수(정의도 같은 규칙으로 검사). 값은 항상 `?`/`:name` 바인딩. 예외는 `// sql-ok: <사유>`(사유 없으면 무효). 헬퍼: `ident(name)` = `/^[A-Za-z_][A-Za-z0-9_]*$/` 검증 후 `"…"` 인용, `placeholders(n)` = `?, ?, …`(1 ≤ n ≤ 999), `sqlInt(n)` = `Number.isSafeInteger` 검증 후 10진 문자열. 강제 = `check:sql`(tokens) + `check:sql-typed`(tsgo, 수신자 타입 `SqlitePort`·`DatabaseSync`). 준비 문장 캐시(재사용 이득 3.5~6.7배), `prepare()` 다문장 금지.
   - 오류 정규화: `errcode & 0xff` → 5 `busy`(유일한 재시도 대상), 6 `locked`, 19 `constraint`, 8 `readonly`, 나머지 `other`. 확장 코드 517(BUSY_SNAPSHOT)은 **코드 결함 신호**(재시도 금지, 오류 로그 + 계약 테스트 실패).
3. **대량 작업 = 단명 자식 job**(SP-4 감사 구속 "백업과 대량 작업은 별도 프로세스"): 스냅샷(`VACUUM INTO`)·팩 적재·병합·재구축·전체 리플레이 검증·무결성 검사·FSRS 최적화는 소유 서비스가 `@fathom/shared-kernel/jobs/jobs`의 `jobs.run(name)`으로 **자기 `main.js`를 `--mode=job --job=<name>`으로 fork**해 수행한다(HTTP 없음, 토큰 없음, 부모 DB 파일만, 서비스당 동시 1개). 네이티브 크래시는 job 프로세스만 죽인다. worker_threads는 DB 핸들이 없는 순수 CPU 계산(learning `forecast`)에만 쓴다.
4. **백업 규칙**: `vacuumInto(path)`는 job 안에서만(임시 이름 → rename → 사본 `integrity_check` → sha256). `DatabaseSync.backup()`은 라이브 쓰기 중 완료 시간이 한정되지 않으므로 쓰지 않는다. 백업 promise가 걸린 원본 연결은 닫지 않는다.
5. **크래시 후 검사**: supervisor 자동 재시작 뒤, 직전 종료가 비정상이면 ready 전 `PRAGMA quick_check`, ready 후 job `integrity`(`integrity_check` + `foreign_key_check`) → 실패 시 `degraded` + 배너 + doctor. 종료는 신호가 아니라 HTTP·IPC 경유 `db.close()`(Windows, ADR-012).
6. **스키마 규약**: 전 테이블 `STRICT`. ID = ULID `TEXT CHECK(length(…)=26)`, 시각 = epoch ms `INTEGER`(UTC 저장, 표시만 로컬, NFR-DATA-006), 불리언 = `INTEGER CHECK(x IN (0,1))`, JSON 열 `CHECK(json_valid(…))`, 2^53 초과 정수 = `TEXT`. 원장·판정 로그·봉인 레코드·오버레이는 `BEFORE UPDATE/DELETE` 트리거로 append-only(NFR-DATA-001) — 트리거는 실수 방지용이며 원장은 추가로 `INSERT OR IGNORE` 전용·`recursive_triggers=ON`·체인 앵커로 보호한다(ADR-011).
7. **`ext`와 이름 훅(AQ-10)**: 모든 엔티티 테이블에 `ext TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(ext))` + `ext_v INTEGER NOT NULL DEFAULT 1`. 키는 `"<feature>.<field>"`. DR-020 이름 훅은 실제 열이며 목록 정본은 `packages/contracts/src/db-hooks.ts`, `lint:hooks`(`tools/gates/check-hooks.mjs`)가 마이그레이션 SQL과 대조한다. `ext` 키 승격은 `ALTER TABLE … ADD COLUMN … GENERATED ALWAYS AS (json_extract(ext,'$."<feature>.<field>"')) VIRTUAL` + 인덱스(가산 CR). STORED 생성 열은 최초 `CREATE TABLE`에서만(예: `lr_event.card_id`·`concept_id`).
8. **마이그레이션**: 모듈 디렉터리별 전진 전용 SQL `migrations/<module>/NNNN_<desc>.sql`. 공통 인프라 테이블(`outbox`, `outbox_delivery`, `inbox_*`, `idem_request`, `schema_migrations`)은 모듈 `_infra`이며, SQL 정본은 `packages/shared-kernel/infra-migrations/`(export `@fathom/shared-kernel/infra-migrations/*`) 한 곳이다. 서비스는 복사하지 않고 마이그레이션 실행기가 `_infra`를 항상 먼저 적용한다. 적용 기록 `schema_migrations(module, version, name, sha256, applied_at)`, 적용된 파일 해시가 바뀌면 기동 거부. 마이그레이션은 **단명 `--mode=migrate`에서만** 실행하고, 서빙 모드는 버전 불일치 시 exit 78(ADR-012·013).
9. **보존**: `ai-cache.db`(판단 30일·생성 7일·상한 90일)와 `insight.db`(재구성 가능)는 epoch 백업에서 제외한다.
10. **경고 억제**(SP-4 §6.6 + 감사): 모든 Node 실행에 `--disable-warning=ExperimentalWarning` — fork·worker는 `execArgv` 상속, supervisor는 자식 env `NODE_OPTIONS`에도 병합(spawn은 `execArgv`를 상속하지 않음). 진입점은 `process.emitWarning`을 래핑한 뒤 `await import('node:sqlite')`(리터럴 동적 import). `--no-warnings`·`NODE_NO_WARNINGS`·`removeAllListeners('warning')`·`process.on('warning')`(억제 안 됨) 금지. E2E가 모든 서비스 stderr를 검사한다.
11. **검색**(content catalog): SP-4 V2 하이브리드 — `ct_search_doc(…, ntext, compact)` + `fts_tri`(trigram, external content) + `fts_cmp`(공백 제거) + 동기화 트리거. 색인·질의 모두 NFC + 소문자. 질의 토큰은 **구두점·따옴표 문자를 제거**한 뒤 3자 이상은 큰따옴표 인용(내부 `"`는 `""`), 3자 미만은 `instr()` 스캔(**`LIKE` 금지**), 조사 제거·공백 제거·IDF OR·동순위 가산, `hangul_initials` deterministic 사용자 함수 열 인덱스. 문서 수가 `search_params@v1.v3_switch_docs = 20000`(보수값 — 실행 간 지연 편차 최대 1.5배)을 넘으면 짧은 토큰 경로를 V3(unicode61 prefix)로 전환. 2음절 부분집합 재현율은 DCP-01 120질의(문자 일치 > 10건인 짧은 질의 + 진부분집합 정답, 재현율 + P@10)로 검증한다(CR-24). 한글 개념마다 영문 alias·동의어가 있어야 한다(packc R-ALIAS).
12. **플랫폼**: 데이터 경로 기본값 Windows `%LOCALAPPDATA%\Fathom`(CR-01), 동기화 폴더·네트워크 경로·WSL 경로는 경고. Windows·macOS의 경로·필수 잠금·AV 잠금·`-shm`·MAX_PATH·셔뱅 동작은 **V-ci 후속 게이트**로 확인하기 전까지 "두 OS PASS"로 표시하지 않는다(RK-21). doctor는 Node 22 EOL(2027-04-30)과 experimental `node:sqlite`를 경고한다.

## 대안 (Alternatives)

| 대안 | 장점 | 단점 | 판정 |
|---|---|---|---|
| 공유 SQLite 1파일(서비스별 스키마) | 교차 서비스 원자성 | 소유권·경계 붕괴(UR-08), 쓰기 락 경합, 백업·복원 단위 불명확 | 기각 |
| better-sqlite3 | 성숙·동기 API | 네이티브 빌드(NFR-PORT-003 위반), Windows 설치 마찰 | 기각 |
| Postgres·임베디드 DB 서버 | 동시성·기능 | 상주 인프라·설치 3분(D-2) 위반 | 기각 |
| content를 BC별 파일 5개로 | 재분리 시 파일 이동만 | 백업·트랜잭션 원자성 상실(오버레이 + 보정 1 tx 불가) | 기각(접두어 + 모듈 마이그레이션으로 충분) |
| `ext` 승격을 STORED로(C) | 읽기 빠름 | `ALTER TABLE ADD COLUMN`으로 추가 불가 → 테이블 재작성 마이그레이션 | 기각 |
| 대량 작업을 worker_threads로 | 생성 비용 작음 | 네이티브 크래시가 서빙 프로세스를 죽임(SP-4 R-3) | 기각(감사 구속) → job 프로세스 |
| `backup()` API(rate 조절) | 페이지 단위 진행 | 라이브 쓰기 중 완료 시간 무한(감사) | 기각 → `VACUUM INTO` |
| `SqlText` 태그 브랜드(ARC 초안) | 타입 수준 강제 | STD-01 SQL 형태·SP-7 스캐너와 불일치 | 기각 → 규약 + 2엔진 게이트 |

## 결과 (Consequences)

- **긍정**: 네이티브 0·브로커 0으로 3 OS 설치가 단순하다. 파일 분리로 쓰기 경합이 구조적으로 0이고, 백업·복원 단위가 서비스와 일치한다. 대량 작업의 네이티브 크래시가 서빙 경로를 죽이지 않는다. `ext` + VIRTUAL 승격으로 15년 가산 변경을 재작성 없이 흡수한다.
- **부정**: `node:sqlite` experimental API 변화와 Node 22 EOL 위험 → `SqlitePort` 어댑터, doctor 경고, V-ci 22·24 매트릭스. job 프로세스 기동 비용(≈ 50~100ms)과 IPC 프레임 유지 → 대량 작업에만 쓰므로 무시 가능. Windows 필수 파일 잠금 → 복원·교체는 반드시 `close()` 후 단명 `--mode=restore`에서. 대형 DB `VACUUM INTO` 소요 미측정 → INT-3에서 350MB 측정.
- **후속**: DB-01이 테이블별 DDL을 작성한다. `lint:hooks`를 PG-2·IT-01 게이트에 둔다. `journal_size_limit`·체크포인트 주기는 INT-1b 측정으로 확정(CR). Windows·macOS V-ci 잡을 플랫폼 지원 판정 게이트로 둔다.

## 동결 영향

파일 소유 표, `SqlitePort`·`openDb()` 표면과 SQL 텍스트 규약, job 규약, 공통 인프라 테이블 DDL, `ext`/`ext_v` 규약, 마이그레이션 규칙은 상세 동결이다. 테이블별 DDL은 DB-01 동결 대상이다. `search_params` 값은 정책 파일(버전 교체 = CR).
