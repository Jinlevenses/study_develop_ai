# ADR-013. 백업·복원·업그레이드·롤백 — epoch 프로토콜과 중단 규칙, 커서 되감기, 증분·2차 대상, `fathom upgrade`

- **상태**: Accepted · **일자**: 2026-10-01 · **결정자**: T1(아키텍처)
- **Trace**: UR-12·17, NFR-DATA-003·004·008·012·013, NFR-AVL-004·009, NFR-SEC-014·018, FR-SET-004·005·006·014·018·022, FR-PRG-003, PLN-REV-01 PX-10·FE-07, SP-3 §6.4 + 감사(체인 헤드 앵커·이벤트 버전 파라미터), SP-4 §4.5·§6.5·R-3·R-9 + 감사(`backup()` 완료 시간 무한, 백업·대량 작업 = 별도 프로세스), 심사 기록(B epoch 중단 규칙, A→C 자기 DB만 스냅샷, 신규 `fathom upgrade`)
- **관련**: ARC-01 §15, ADR-002·003·011·012

## 맥락 (Context)

- 서비스마다 DB 파일이 따로 있어 "모든 DB가 같은 시점"인 백업을 그냥은 만들 수 없다(FE-07). NFR-DATA-012: 쓰기 quiesce(최대 2s) → 전 DB 스냅샷 → 전역 epoch 매니페스트, epoch 불일치 조합 복원 거부. RPO ≤ 26h(증분)·≤ 8일(스냅샷), RTO ≤ 5분, 2차 대상·선택 암호화(PX-10).
- ops-api는 다른 서비스의 DB 파일을 열면 안 된다(NFR-MAINT-002; C의 forge.db 직접 스냅샷은 위반으로 기각).
- SP-4(감사 정정): 연속 쓰기 중 기본 `backup()`은 **완료 시간이 한정되지 않는다**(재실행에서는 608회 재시작 후 303ms에 끝나기도 함 — 비결정), `VACUUM INTO`는 라이브 writer 아래에서도 일관 사본, 백업 Promise가 끝나기 전 원본 `close()`는 네이티브 크래시 가설과 연결, 대형 DB(수백 MB) 소요는 미측정. 감사 구속: **백업과 대량 작업은 별도 프로세스**에서. SP-3: 병합·복원 후 전체 리플레이 ≈ 7.5~12s. SP-3 감사: 체인 헤드가 앵커되지 않으면 꼬리 변조·절단을 탐지할 수 없다.
- 세 제안 모두 업그레이드·롤백 절차가 얇았다(심사 신규 graft): 업그레이드 전 자동 epoch, 서빙 밖 migrate dry-run, 혼합 버전 기동 거부, 2세대 번들 롤백.

## 결정 (Decision)

### 1. epoch 스냅샷 프로토콜 (ops-api 조율, 각 서비스가 자기 DB만)

1. ops-api가 `epoch_id`(ULID)와 `backups/snap/<epoch_id>/`를 만든다. 정기 스냅샷(주 1회, `ops_policy@v1`)은 **유휴 창**(`idle_window_open`)에서만 시작한다. 수동(`fathom backup`)·마이그레이션 전·`doctor --fix` 전 스냅샷은 즉시.
2. **quiesce**(병렬, ack 기한 **2s**): `POST /internal/v1/admin/quiesce {epoch_id}` → 서비스는 쓰기 게이트를 닫고(새 쓰기 tx 대기열), 진행 중 tx를 끝내고, relay·inbox 처리를 일시정지한 뒤 ack.
3. 한 서비스라도 2s 안에 ack하지 못하면 **epoch 중단**: 전원 `resume`, 매니페스트 미기록, `ops.backup.completed{outcome:'aborted'}` + 배너, 다음 주기 재시도(일 최대 3회).
4. **snapshot**(병렬, 기한 **30s**): `POST /internal/v1/admin/snapshot {epoch_id, dir}` → 서비스가 **단명 자식 job `snapshot`**(`--mode=job --job=snapshot`, ADR-002 §3)을 fork → job이 자기 연결로 `VACUUM INTO '<dir>/<file>.tmp'` → 사본 `PRAGMA integrity_check` → rename → sha256 → 사본에서 seq·커서·워터마크·앵커 읽기 → IPC 결과 → 응답 `{file, sha256, bytes, schema, outbox_head_seq, delivery, inbox_watermark}`(+ learning `projection_hash`, `fsrs_impl`, **`ledger_head{device_id: {seq, hash}}` = 체인 헤드 앵커**). **seq·커서·워터마크·앵커는 사본에서 읽는다.** 기한 초과·실패·job 크래시 = epoch 중단(3과 같음). `DatabaseSync.backup()`은 쓰지 않는다.
5. 전원 `resume` → ops-api가 자기 `ops.db` 스냅샷 → `manifest.json`을 임시 이름으로 쓰고 rename(원자) → `op_backup` 기록 → `ops.backup.completed{outcome:'ok'}`. **부분 매니페스트는 절대 기록하지 않는다.**
6. 쓰기 게이트가 닫힌 동안 들어온 interactive 쓰기는 대기하며, 3s를 넘기면 gateway가 `503 Retry-After: 1`(web attempt 큐가 흡수).
7. 포함: `content.db`·`learning.db`·`ai.db`·`ops.db`. 제외: `insight.db`(재구성), `ai-cache.db`(재생성), `run/`·`logs/`·`tmp/`, `secrets/ai-keys.enc`(기본 제외, 사용자 선택 시 포함). 7세대 보관(8번째 생성 시 가장 오래된 것 삭제).

매니페스트 스키마 정본: `@fathom/contracts/admin/epoch-manifest`(필드: v, epoch_id, kind, created_at, app_version, contracts_hash, device_id, policy_lock_sha256, prompts_lock_sha256, packs[], services{svc: {file, sha256, bytes, schema, outbox_head_seq, delivery, inbox_watermark, (learning) projection_hash, ledger_head}}, excluded[]).

### 2. 일 증분과 2차 대상

- **일 증분**(앱을 매일 켜면 RPO ≤ 26h): ops-api가 learning `GET /internal/v1/ledger/export?since=<checkpoint>`(기기별 원장 JSONL) + content `GET /internal/v1/catalog/overlays/export?since=` + ai-gateway `GET /internal/v1/calibration/gold/export?since=` → `backups/incr/<device_id>/<YYYY-MM-DD>.jsonl`(줄당 ≤ 1MB, 파일 sha256 기록).
- **2차 대상**(`backups/secondary.json`): 외장·NAS·동기화 폴더 경로(백업 파일만, 라이브 DB 금지 — FR-SET-025), 복제 지연 ≤ 1h, 선택 암호화 = 파일별 AES-256-GCM, 키 = `scrypt(passphrase, N = 2^17, r = 8, p = 1, maxmem = 256MiB)`(passphrase는 저장하지 않고 AI 키 KEK와 별도, ADR-009). 형식: `<file>.fenc` = `{v, kdf{N, r, p, salt}, iv, tag, ct}` 헤더 + 본문. 7일 미설정이면 배너 1회.

### 3. 복원 (`fathom restore <epoch_id|--latest> [--rehearse]`, RTO ≤ 5분)

1. 매니페스트·파일 sha256 검증(불일치 = 거부, NFR-SEC-018). 서로 다른 epoch의 파일 조합은 거부. learning 사본의 기기별 체인 헤드가 매니페스트 `ledger_head`와 같아야 한다(꼬리 변조·절단 탐지, ADR-011 §2).
2. ops-api → supervisor `svc.stop`(content·learning·ai-gateway). gateway는 유지(유지보수 화면).
3. **커서 되감기 계산**: 생산자 P의 durable 목적지 D마다 `delivery[D] := min(manifest[P].delivery[D], manifest[D].inbox_watermark[P])`.
4. supervisor `svc.run_mode{svc, mode:'restore', args:{from, rewind_cursors}}` → 각 서비스의 **단명 restore 프로세스가 자기 파일만** 교체(`close` 상태 확인, `-wal`·`-shm` 삭제, 사본 복사, `integrity_check`, `outbox_delivery` 커서 되감기).
5. 기동 → learning job `rebuild`(전체 리플레이 — 이벤트가 참조하는 정책 버전 파라미터로만, ADR-011 §5) → `projection_hash` = 매니페스트 값 확인(같은 플랫폼·Node 버전일 때; 다르면 로컬 재계산을 정본으로 하고 차이만 보고) → `insight.db` 재구성 → 이후 날짜의 증분 JSONL을 병합 import(job `merge`, 헤더 앵커 검증)로 적용(멱등) → 배너.
6. **리허설**(`--rehearse`): 임시 `FATHOM_HOME`에 같은 절차를 verify 모드로 수행하고 체크섬·행 수·투영 해시를 비교해 `op_backup.rehearsal_result`에 기록(R1 수동, R3 분기 자동, 실패 시 배너 GR-11).

### 4. export ↔ import (FR-SET-006·022)

`fathom export [--since]` → ops-api가 서비스별 export API로 JSONL(원장·오버레이·설정 이벤트·골드셋 확정) + Markdown(`[[wikilink]]` 개념 노트)을 `exports/` 또는 지정 경로(경로 탈출 거부)에 쓴다. `fathom import [--merge]`는 스트리밍 파서(줄당 ≤ 1MB, 전체 상한 8GB 기본)·체인·매니페스트 검증 후 소유 서비스별 import API로 분배(ADR-011 §6). 55만 이벤트 왕복 메모리 피크 ≤ 512MB.

### 5. 스키마 마이그레이션 규칙

전진 전용 `migrations/<module>/NNNN_<desc>.sql`(+ 공통 `_infra`), 적용 파일 sha256 기록·변경 시 기동 거부, **단명 `--mode=migrate`에서만** 실행(서빙 모드는 버전 불일치 시 exit 78), 가산 = CR·파괴 = ADR, 원장은 재작성 금지(upcaster, ADR-011). 마이그레이션 직전 스냅샷 100%(NFR-AVL-004).

### 6. `fathom upgrade <bundle.tar>` · `--rollback`

1. 번들 `bundle.manifest.json`의 파일별 sha256 검증, Node 버전 호환 확인(번들에 런타임 동봉 시 그것을 사용).
2. **업그레이드 전 자동 epoch**(실패 시 업그레이드 중단).
3. `FATHOM_HOME/app/<new>/`에 전개.
4. **dry-run**: 스냅샷 사본을 `tmp/migrate/`에 복사 → `node app/<new>/services/<svc>/dist/main.js --mode=migrate --dry-run --db <copy>`(서비스별) → `integrity_check` + learning `--mode=verify`(구·신 리플레이 해시 비교, `fsrs_impl`·upcaster 변경 리포트). 실패 = 중단(데이터 무변경).
5. `fathom down` → 실제 `--mode=migrate`(순서: ops → ai-gateway → content → learning), 하나라도 실패하면 즉시 롤백(7).
6. `app/current.json = {version: new, previous: old}`, 3세대째 번들 삭제 → `fathom up` → supervisor **핸드셰이크**(`contracts_hash`·`schema_versions`, ADR-012). 실패 = 롤백.
7. **롤백**(`fathom upgrade --rollback` 또는 자동): 정지 → `current.json`을 previous로 → 업그레이드 전 epoch 복원(신 스키마는 구버전과 호환되지 않으므로) → 기동. 신버전에서 기록된 원장 이벤트는 증분 JSONL에 남아 있으므로, `schema_version`이 구버전이 아는 범위면 병합 import로 흡수하고, 더 높으면 `backups/incr/_held/`에 보류했다가 재업그레이드 때 흡수한다.
8. **데이터 업그레이드**: 정책 새 버전은 리플레이 비교 리포트(큐 구성·숙달 수·LDI 변화량, FR-SET-018) → 사용자 승인 → `policy.switched`. 팩 새 버전은 blue/green + 오버레이 재적용(ADR-004). 프롬프트 새 버전은 평가 회귀 통과 후 activation(ADR-005).

## 대안 (Alternatives)

| 대안 | 장점 | 단점 | 판정 |
|---|---|---|---|
| ops-api가 각 DB 파일을 직접 복사·스냅샷(C) | 조율 단순 | NFR-MAINT-002 위반, 쓰기 중 경합·일관성 위험 | 기각 |
| SQLite 기본 `backup()` API | 표준 | 연속 쓰기 중 완료 시간 무한(SP-4 감사) | 기각(`VACUUM INTO`) |
| 서빙 프로세스의 worker_threads로 스냅샷 | 생성 비용 작음 | 네이티브 크래시가 서빙 프로세스까지 죽임(SP-4 R-3) | 기각(감사 구속) → 단명 자식 job |
| 파일시스템 스냅샷(APFS·VSS·LVM) | 원자적 | OS별·권한 의존, 3 OS 불가 | 기각 |
| 연속 복제(litestream류) | RPO 최소 | 상주 프로세스·외부 저장소, 로컬 단일 사용자에 과잉 | 기각 |
| 중단 없이 부분 매니페스트 기록 | 백업 빈도 | 불일치 조합 복원 위험 | 기각(중단 규칙) |
| 업그레이드 롤백 없음(전진 수정만) | 단순 | 15년 동안 1회 실패도 데이터 위험 | 기각 |

## 결과 (Consequences)

- **긍정**: 교차 서비스 일관성을 "게이트 + 사본 기준 매니페스트 + 복원 시 커서 되감기"의 세 겹으로 보장한다. 업그레이드 실패가 데이터 손실로 이어지지 않는다. RPO·RTO가 수치로 검증된다.
- **부정**: 스냅샷 동안 쓰기가 잠시 멈춘다(유휴 창 정책으로 완화). 2세대 번들 보관으로 디스크를 더 쓴다. 대형 DB 스냅샷 시간은 INT-3에서 측정해 기한(30s)을 조정해야 한다.
- **후속**: `tests/integration/{epoch-backup,restore-rewind,upgrade}.spec.ts`(쓰기 부하 중 100회, epoch 불일치 거부, migrate 실패 자동 롤백). DB-01이 `op_backup`·`op_epoch_manifest` 스키마 확정.

## 동결 영향

epoch 프로토콜·중단 규칙·매니페스트 스키마·커서 되감기 식·restore·migrate 모드·업그레이드 단계는 상세 동결이다. 주기·기한·보존 세대 수는 `ops_policy@v1` 값이다.
