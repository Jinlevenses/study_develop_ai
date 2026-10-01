# ADR-007. 러너 격리 — SP-2 확정 플래그, 요청당 전용 자식, 25~50ms 감시자, SQL 토크나이저, 부모 판정 채점, OS별 활성화 게이트

- **상태**: Accepted · **일자**: 2026-10-01 · **결정자**: T1(아키텍처)
- **Trace**: UR-01·14·17, FR-LAB-001·002·011·014·015·016·017, NFR-SEC-006·012, NFR-PERF-007, BR-16·20, PLN-REV-01 FE-03·AQ-09·AQ-17, **SP-2(구속) + 감사(2026-09-30, PASS, 구속 결정 10항)**, 심사 기록 AQ-09
- **관련**: ARC-01 §6·§12.6·부록 B, ADR-001·010·016

## 맥락 (Context)

- 학습자의 임의 JS/TS·SQL을 Docker 없이 로컬에서 실행해야 한다. Node 22.22 `--permission`은 fs·child_process·worker는 막지만 **네트워크·`sqlite ATTACH`·`process.kill`·`report`는 막지 않는다**. `--max-old-space-size`는 힙 밖 `Buffer`를 못 막는다(SP-2 실측).
- SP-2(Linux, uid 0)와 감사 재실행: 전용 자식 + `--permission` + preload 가드 + rlimit + RSS 감시자 + SQL 토크나이저로 **격리 공격 37건 `full` 층 뚫림 0**, 자원 격리 14건 전부 기대 상태로 종료, 잔존 프로세스 0. **RES-14(결과 위조)는 막히지 않는 수용 위험**이다(보고서의 "52/52"는 이것을 통과로 센 과대 집계 — 감사). 37행 중 20행의 none 층 양성 대조는 자식이 스스로 찍은 `ESCAPED:` 마커에만 기대고 호스트 측 효과는 관측되지 않았다. SQL 16건 중 무토크나이저 대조군이 있는 것은 5건뿐이다. 모든 공격은 JS 진입으로만 돌았고 TS(`.mts`) 진입은 지연만 측정했다.
- 감시 주기별 RSS 오버슈트(감사 재실행 표본값, 상한 아님, 한도 256MB): **100ms 394MB(1.54배) · 50ms 355MB · 25ms 309MB**. 정상 실행 p95(감사 재실행): JS 63ms · TS 155ms · SQL 74ms · 동시 4개 65ms(목표 1.5s). pre-fork는 실행마다 권한·한도를 바꿀 수 없어 격리가 약해진다. `RLIMIT_AS`와 TS 스트리핑(wasm) 공존에는 `--disable-wasm-trap-handler`가 필수, `RLIMIT_NPROC`는 UID 전체에 걸려 쓰면 안 된다. 출력 캡은 `>=`로 판정해야 한다(배압 함정). netns 단독 실험에서도 NET-07(localhost DNS)·NET-10(netns 안 루프백 listen)은 성공했다(호스트 도달 0).
- Windows·macOS는 `prlimit`·`/proc`이 없고 SP-2 스위트가 한 번도 돌지 않았다(V-live pending). Windows에서 `tasklist`를 100ms마다 spawn하는 감시는 실현성이 낮다(심사).

## 결정 (Decision)

1. **소유·위치**: content의 runner BC. 포트 `services/content/src/domain/runner/ports.ts`, 구현 `src/infra/runner/`, 자식 자산 `services/content/assets/runner/{guard.mjs, sql-entry.mjs, sql-tokenizer.mjs, harness-entry.mjs, win-rss-helper.ps1}`(SP-2 `spikes/sp2-runner-isolation/src/*` 이식). 호출자: grading(채점), itembank(T1 정답 계산, `sourceKind: 't1'`), gateway 경유 학습자 "실행" 버튼(`POST /internal/v1/runner/runs`). content 본 프로세스는 학습자 코드·SQL을 절대 실행하지 않는다.
2. **포트**(불변 유지, SP-2 §7.3 + 하네스):
   ```ts
   export interface RunRequest {
     kind: 'code' | 'sql'; lang?: 'js' | 'ts'; code: string;              // code ≤ 64KB
     sourceKind: 'learner' | 'seed' | 't1';                               // 그 밖(t3·t4·imported·llm) → 'rejected' 403
     harness?: { mode: 'hidden_tests' | 'stdout_compare' | 'complexity'; ref: string };
     timeoutMs?: number;      // JS/TS 3000, SQL 2000
     rssLimitMB?: number;     // 256
     outCapBytes?: number;    // 65536 — 판정은 stdout+stderr 합 >= outCapBytes
     writableTmp?: boolean;   // false(과제 opt-in)
     netns?: boolean;         // Linux 선택 하드닝(unshare -Urn)
   }
   export type RunStatus = 'ok' | 'error' | 'timeout' | 'memory_limit' | 'output_limit' | 'rejected' | 'platform_disabled' | `killed_${string}`;
   export interface RunResult {
     status: RunStatus; stdout: string; stderr: string /* 러너 경로 치환 후 */; exitCode: number | null;
     durationMs: number; peakRssMB: number; outputTruncated: boolean; reason?: string;
     harness?: { passed: number; failed: number; cases: { id: string; ok: boolean }[]; complexity?: { slope: number; method: 'ops' | 'cpu' } };
   }
   ```
3. **요청당 전용 자식, 재사용 풀 금지**. 동시성 = 세마포어 `min(3, max(1, os.availableParallelism() − 1))`, 대기 큐 ≤ 20(초과 `429 CT-LIMIT-001`). 유일한 예외 = **1회용 prewarm 예비 1개**이며, 차단 스위트 전체가 예비 경로로 통과한 뒤에만 켤 수 있다(그 전에는 코드 경로 자체를 비활성).
4. **자식 인자**(SP-2 §3.3 + 감사 구속):
   ```
   node --permission --allow-fs-read=<GUARD> --allow-fs-read=<TMP>
        [--allow-fs-write=<TMP> (writableTmp일 때만; 기본은 쓰기 전면 거부)]
        --disallow-code-generation-from-strings --max-old-space-size=128
        --disable-warning=ExperimentalWarning --no-addons --disable-wasm-trap-handler
        --import=<file URL of GUARD> <TMP>/main.mjs | <SQL_ENTRY> <TMP>/query.sql
   ```
   - **금지 플래그**: `--allow-child-process`·`--allow-worker`·`--allow-addons`·`--allow-wasi`는 어떤 과제에서도 주지 않는다(정적 검사: `infra/runner/spawn-args.ts`의 문자열 목록 단언 테스트).
   - Linux: `prlimit --as=1610612736 --cpu=<ceil(timeout_s)+1> --fsize=8388608 --core=0 -- node …`(exec라 pid 동일). **`RLIMIT_NPROC` 금지.**
   - **빈 env**: 자식 env에는 설정 변수 2개(`FATHOM_MODE: 'js'|'sql'`, `FATHOM_DEADLINE_MS`)만 넣고, 가드가 **읽은 즉시 삭제**해 학습자 코드가 보는 `process.env`는 비어 있다(SP-2 §3.3 측정 구성 = 감사의 "empty env"). 부모 env·토큰·키·`NODE_OPTIONS`는 절대 물려주지 않는다. Windows에서 Node 기동에 필요한 최소 env(`SystemRoot` 등)는 V-live 스위트로 확정해 OS별 부트스트랩 목록에 넣는다.
   - `cwd` = `FATHOM_HOME/tmp/runner/run-<ulid>/`(0700), `detached: true`(새 프로세스 그룹 → 그룹 SIGKILL), stdio `['ignore','pipe','pipe','pipe']`(fd3 = 하네스 원시 출력 채널). 입력은 tmp 파일 + 읽기 허용.
5. **가드**(`guard.mjs`, 필수): builtin **default-deny 허용 목록** `assert, buffer, console, crypto, events, fs, fs/promises, path, perf_hooks, process, querystring, readline, stream*, string_decoder, timers*, url, util*, zlib, async_hooks, punycode, test, diagnostics_channel`(SQL 모드만 `sqlite` 추가 — JS 모드 `sqlite` 거부). 따라서 `vm, v8, os, module, wasi, tty, cluster, repl, child_process, worker_threads, net, dgram, dns, http(s), http2, tls, inspector`는 전부 거부. 판정은 `module.registerHooks`가 **해석된 `node:` URL**로 한다(스펠링 변형·CJS·`data:` URL 포함), `process.getBuiltinModule` 래핑, `fetch/WebSocket/EventSource/XMLHttpRequest`는 삭제 후 던지는 스텁, `net.Socket.prototype.connect`·`net.Server.prototype.listen` 무력화, `process.kill`은 자기 pid만, `process.{binding,_linkedBinding,dlopen,execve,_debugProcess,setuid*,_kill}`·`report.*` 차단, `execArgv` 비움, 자기 파괴 타이머, 모든 가드 속성 `writable:false, configurable:false`.
6. **네트워크 격리는 JS 층뿐**(커널 아님, RSK-RUN-02): 그래서 127.0.0.1의 모든 서비스 API는 **내부 호출자 토큰을 반드시 요구**하고(러너는 토큰을 받지 않음 → 401), Linux netns(`unshare -Urn`)·Docker `--network none`은 선택 강화로만 둔다.
7. **자원 감시자**(부모, `infra/runner/watchdog/`) — **감시 주기 25~50ms, 전 OS**:

   | OS | 방법 | 주기 | 보조 상한·트리 kill | 활성화 조건 |
   |---|---|---|---|---|
   | Linux | `/proc/<pid>/status` VmRSS 동기 읽기 | **25ms** | `prlimit` AS 1.5GB·CPU·FSIZE / 그룹 SIGKILL `process.kill(-pid)` | V-build 스위트(현재 유일하게 검증된 플랫폼) |
   | macOS | `ps -o rss= -p <pid>`(spawn 비용 과다 시 상주 헬퍼) | **50ms** | prlimit 없음 → 감시자 단독(RSK-RUN-05 고지) / 그룹 SIGKILL | V-ci·V-live에서 macOS 스위트 통과 |
   | Windows | **상주 PowerShell 헬퍼** `win-rss-helper.ps1`: stdin으로 pid 추가·삭제, `pid,workingSetBytes,ts` CSV 스트림 | **≤ 50ms 목표** | Job Object 또는 `taskkill /T /F /PID` 트리 kill | V-ci·V-live에서 Windows 스위트 통과 **그리고** 실측 주기 ≤ 50ms |

   RSS > `rssLimitMB` → 그룹 kill → `memory_limit`. V8 OOM(`SIGABRT` + `heap out of memory`)도 `memory_limit`. 벽시계 타임아웃 → `timeout`. stdout+stderr 합 `>= outCapBytes` → kill + `output_limit`. `hard_heap_limit`(SQLite)은 신뢰하지 않는다.
   **OS별 활성화 게이트(사전 합의 폴백)**: 활성화 조건을 충족하지 못한 OS에서는 러너가 필요한 과제 형식(코드 실행·SQL 실행·복잡도)을 **비활성**하고(`platform_disabled`, 문항 선택에서 제외, 화면에 "이 OS에서는 Docker 경로 권장" 안내), 릴리스 매니페스트 `runner_verified_platforms`(V-ci 산출물)에 검증된 `{os, arch, node}` 목록을 기록한다. 기동 시 `RunnerPort`가 현재 플랫폼이 목록에 있는지 확인한다.
8. **TS**: 부모에서 `module.stripTypeScriptTypes`로 벗겨 `.mjs`로 실행한다(그래서 JS 공격 스위트가 TS 경로를 덮는다). 자식에서 `.mts`를 직접 실행하는 경로는 검증되지 않았으므로 쓰지 않는다. erasable 구문만(enum·namespace·parameter property 금지 — 팩 lint와 저작 규칙).
9. **채점 신호 분리 — 학습자 출력은 절대 신뢰하지 않는다**(RES-14, 감사 구속): 학습자 stdout은 채점에 쓰지 않는다. 숨은 테스트는 학습자 코드 실행 **이후 별도 하네스 자식**(`harness-entry.mjs`, 같은 플래그·가드)이 **입력만** 받아 학습자 함수를 호출하고 **원시 반환값**을 fd3 JSON 프레임(`{run_id, case_id, value}`)으로 보낸다. **기대값 비교와 합격 판정은 부모가 한다** — 기대값은 자식에 들어가지 않는다. 같은 프로세스의 학습자 코드도 fd3에 쓸 수 있다는 것을 전제로 하므로, 위조로 얻을 수 있는 것은 "정답을 실제로 계산하는 것"뿐이다. 프레임의 run_id·케이스 순서·개수가 부모 기대와 다르면 `error`.
10. **복잡도 판정(AQ-17)**: 1순위 결정적 **연산 수 계측** — 하네스가 **불투명 원소**(값은 `ctx.compare`·`ctx.get`로만 관찰 가능)를 주입해 n ∈ {2^10, 2^12, 2^14}의 연산 수로 log-log 기울기를 계산한다(계측기를 거치지 않는 정렬로 연산 수를 숨길 수 없게 함). 계측 불가 과제만 2순위 — 한 하네스 자식 안에서 n·2n·4n·8n 각 3회, `process.cpuUsage()` 중앙값(최소 20ms, 미만이면 n 자동 확대)으로 기울기. 합격 = 기울기 ≤ 목표 차수 + 0.35, O(n²) 거부 = 기울기 ≥ 1.7. 프로세스 생성 시간은 측정에서 제외.
11. **SQL 러너**: `node:sqlite`에는 authorizer가 없으므로 **토크나이저가 `ATTACH`·`VACUUM INTO`를 막는 유일한 관문**이다. 부모·자식 이중 토크나이저(완전 렉싱: 주석·`'..'`·`".."`·`` `..` ``·`[..]`·`X'..'`) → 시작 키워드 allowlist `SELECT WITH INSERT UPDATE DELETE CREATE(TABLE|VIEW|INDEX) DROP(TABLE|VIEW|INDEX)`, 거부 `ATTACH DETACH PRAGMA(아래 7종 제외) VACUUM LOAD_EXTENSION READFILE WRITEFILE EDIT FTS3_TOKENIZER SQLITE_DBPAGE VIRTUAL TRIGGER EXPLAIN ANALYZE REINDEX BEGIN COMMIT END ROLLBACK SAVEPOINT RELEASE ALTER` + 파일 경로형 문자열, NUL·바인드 파라미터 거부, 문장 ≤ 20, SQL ≤ 64KB. **읽기 전용 PRAGMA 7종 허용**: `table_info table_xinfo table_list index_list index_info index_xinfo foreign_key_list`(CR-03). 자식: `:memory:` + `allowExtension:false` + `enableForeignKeyConstraints:true` + `PRAGMA max_page_count=4096`, `stmt.iterate()` **행 1,000·셀 1KB 캡**, 부모 2s 벽시계 kill. 임시 파일 spill 실패(`disk I/O error`)는 사용자 메시지로 매핑.
12. **출처 정책**(FR-LAB-016): `sourceKind ∈ {learner, seed(V4 통과), t1}`만. 가져온 문서·LLM 생성 코드는 읽기 전용 표시. 계약 테스트가 러너 호출 경로의 출처 검사 누락 0을 단언.
13. **청소·정보 노출**: content 기동 시 `tmp/runner/run-*` 잔존 디렉터리·pid 파일 정리(RSK-RUN-06), 부모 `exit` 훅에서 그룹 kill. 응답 전 stderr의 러너·tmp 절대경로 치환(RSK-RUN-09, NFR-SEC-012).
14. **회귀 게이트**(V-ci, 병합 차단): SP-2 차단 스위트를 `services/content/test/security/runner-escape.spec.ts`로 이식하되 감사 지적을 고친다 — ① 집계 = 격리 공격 37 + 자원 격리 14 + SQL 16 + 기능 대조 7, **RES-14는 통과로 세지 않고** §9 설계 테스트(자식이 위조 프레임을 써도 부모 판정 불변)로 대체 ② 모든 공격 행에 **호스트 관측 대조군**(none 층에서 호스트 측 효과 — 파일 생성·포트 접속 수신·프로세스 존재 — 가 실제로 관측됨)을 두고 자가 보고 마커만으로 판정하지 않는다 ③ SQL 16행 전부에 무토크나이저 대조군 ④ TS 진입(부모 strip → `.mjs`) 공격 행 추가 ⑤ netns 강화 경로의 NET-07·NET-10 결과를 기록. Node 마이너 버전 고정, 상향 시 스위트 재통과(RSK-RUN-10). OS별 스위트 통과가 §7 활성화 게이트의 입력이다.

## 대안 (Alternatives)

| 대안 | 장점 | 단점 | 판정 |
|---|---|---|---|
| pre-fork 재사용 풀 | 지연 ≈ 50ms 절감 | 권한·한도가 시작 시 고정, 전역 상태·프로토타입 오염 누수, OOM이면 어차피 재기동 | 기각(SP-2 §7.1, 감사 구속). 1회용 prewarm 예비만 스위트 통과 후 허용 |
| Docker 기본 | 커널 수준 격리 | Windows·macOS 설치 마찰, 데몬 의존, D-2(3분) 위반 | 선택 경로·미검증 OS의 권고 경로 |
| isolated-vm·vm2 | 프로세스 내 격리 | 네이티브 빌드(isolated-vm), vm2 탈출 이력·유지보수 종료 | 기각 |
| QuickJS-wasm 샌드박스 | 강한 격리 | Node API·TS·SQLite 학습 과제 불가 | 기각 |
| worker_threads + resourceLimits | 빠름 | 같은 프로세스·권한 공유, 네트워크·fs 차단 불가 | 기각 |
| 감시 주기 100ms(명세 원안) | 부하 적음 | 오버슈트 394MB(감사) | 기각 → 25~50ms |
| 하네스 자식이 합격 여부를 보고 | 단순 | 학습자 코드가 같은 프로세스에서 결과를 위조 가능(RES-14) | 기각 → 원시값만 받고 부모 판정 |
| 미검증 OS에서도 러너 활성 + 경고 | 기능 범위 유지 | 격리 근거 없는 실행 | 기각 → OS별 활성화 게이트 |

## 결과 (Consequences)

- **긍정**: Docker 없이 같은 설계를 3 OS에 적용하되, 검증된 플랫폼에서만 켠다. 정상 과제 p95가 목표 1.5s의 1/10 수준이다. 결과 위조·경로 노출·고아 프로세스 같은 실측 함정이 설계에 내장된다.
- **부정**: 같은 OS 사용자·같은 커널의 JS 층 방어다(RSK-RUN-01·02) → 출처 정책, 내부 토큰 미전달(401), 버전 고정 + CI 스위트, 선택 netns·Docker로 완화하고 잔여 위험을 문서화한다. Windows·macOS는 스위트 통과 전까지 러너 과업 형식이 꺼진다(학습 범위 축소를 고지).
- **후속**: RSK-RUN 정식 문서(SEC-01) 이관, V-ci 3 OS 스위트 + `runner_verified_platforms` 산출, `win-rss-helper.ps1` 주기 실측, Job Object 트리 kill, 대형 입력 과제의 입력 크기 상한을 저작 규칙에 명시.

## 동결 영향

`RunnerPort` 인터페이스, 플래그 세트·금지 플래그, 가드 허용 목록, SQL 허용·거부 규칙, 감시 주기 범위(25~50ms), OS별 활성화 게이트, 부모 판정 원칙, 출처 정책은 상세 동결이다(FR-LAB 변경 = CR-02·CR-03 반영).
