# SP-2 스파이크 보고서 — 로컬 코드·SQL 러너 격리

- 대상 요구: FR-LAB-001 / FR-LAB-002 / FR-LAB-016, NFR-SEC-006, NFR-PERF-007 (`03-convergence.md` SP-2 행)
- 코드: `/home/user/study_develop_ai/spikes/sp2-runner-isolation/` (독립 패키지, 외부 의존성 0, `npm run spike`)
- 원시 결과: `spikes/sp2-runner-isolation/results/result.json`(전체), `result-latency.json`(최종 지연 재측정)
- 검증 등급: 이 보고서의 모든 수치는 **Linux 컨테이너 실측(V-build)**이다. Windows·macOS는 실행하지 못했으므로 해당 항목은 **V-live pending**으로 표시한다.

## 1. 가설

> 학습자의 임의 JS/TS·SQL을 "전용 러너 자식 프로세스 + `node --permission` + preload 모듈 차단 + RSS 감시자 + SQL 토크나이저 allowlist"만으로(Docker 없이) 명세 수준으로 격리할 수 있고, 프로세스 생성 포함 정상 실행 p95가 1.5s 이하다.

## 2. 환경

| 항목 | 값 |
|---|---|
| Node | `v22.22.2` (`/opt/node22/bin/node`) |
| OS | Linux 6.18.44-fc-v50 x86_64 (컨테이너, 4 vCPU, RAM 16GB, **uid 0(root)**) |
| SQLite | node:sqlite 번들 3.51.2 (`FTS5`, `MAX_ATTACHED=10`, `MAX_LENGTH=1e9`, `ENABLE_LOAD_EXTENSION` 없음: `load_extension()`은 `not authorized`) |
| 보조 도구 | `prlimit`(util-linux), `unshare`(user/net namespace) 사용 가능. Docker 바이너리는 있으나 데몬 없음(미측정) |
| 미검증 | Windows, macOS, 비 root 사용자(특히 `unshare -Urn`이 비 root에서 동작하는지) |

## 3. 방법

1. `node --permission`의 실제 플래그·동작을 먼저 실측하고(3.1), 그 위에 러너를 만들었다.
2. **러너 구조**(요청당 1 spawn): 부모 `src/runner.mjs`가 임시 cwd(`os.tmpdir()/fathom-runner/run-XXXX`, 0700)를 만들고 학습자 코드를 `main.mjs|mts|cjs`로 쓴 뒤, `prlimit … node --permission …`을 **빈 env**, `detached:true`(프로세스 그룹)로 spawn한다. 부모는 ① 벽시계 타임아웃, ② 100ms 주기 RSS 감시자(`/proc/<pid>/status` VmRSS), ③ stdout/stderr 64KB 캡을 걸고, 종료 후 그룹 SIGKILL + 임시 디렉터리 삭제를 한다.
3. **preload 가드** `src/guard.mjs`(`--import`): 3.2 참고.
4. **SQL 러너**: 부모에서 토크나이저 검사(`src/sql-tokenizer.mjs`, 위반 시 spawn 없이 거부) → 통과하면 같은 샌드박스 자식(`src/sql-entry.mjs`)에서 `node:sqlite` `:memory:` + `allowExtension:false`로 문장별 실행(자식에서 토크나이저 재검사).
5. **차단 시도 카탈로그** `src/attacks.mjs`: JS/TS **52건**(하위 페이로드 합계 100여 개) + SQL **16건**. 각 시도를 **3개 층**에서 실행해 시도 자체가 실제로 유효함(양성 대조)을 증명했다.
   - `none`: 일반 node(빈 env, 권한 모델·가드 없음)
   - `permission`: `--permission`만(가드 없음)
   - `full`: 러너 전체(권한 모델 + 가드 + rlimit)
   - 판정은 자식 stdout이 아니라 **호스트 측 부수효과**로 한다: 호스트 TCP/HTTP/UDP 리스너 접속 수, 밖에 생성된 파일, 부모에 도착한 SIGUSR1/2, 출력에 카나리(ssh 키·부모 env 비밀·/etc/passwd) 유출, 잔존 프로세스, 임시 디렉터리 잔존.
6. 지연 50회 측정, 감시자 오버슈트 측정, `--permission` 전제 재확인(3.3).

### 3.1 Node 22.22.2 `--permission` 실측 사실

| 플래그 | 실측 동작 |
|---|---|
| `--permission` | 경고 없이 동작(`--experimental-permission`은 별칭). 기본 거부: fs 읽기·쓰기, child_process, worker, addon, wasi |
| `--allow-fs-read=<경로>` | **디렉터리 경로를 주면 하위 전체 허용**(끝의 `/*` 불필요, 두 형태 동일 결과). 엔트리 스크립트는 자동 허용. **`--import` 프리로드는 별도로 허용해야 함**(없으면 `ERR_ACCESS_DENIED`로 부팅 실패) |
| `--allow-fs-write=<경로>` | 지정 디렉터리 하위만 쓰기. 심볼릭 링크·하드링크로 밖을 읽고/쓰는 시도(FS-09)는 모두 `ERR_ACCESS_DENIED` |
| `--allow-child-process` / `--allow-worker` / `--allow-addons` / `--allow-wasi` | 기본 거부. 거부 시 `process.execve`(22.22에 존재, 이미지 교체 우회 경로), `child_process`, `Worker`, `process.dlopen`이 `ERR_ACCESS_DENIED`/`ERR_DLOPEN_DISABLED` |
| **네트워크** | **차단 플래그 없음.** `net`/`http`/`fetch`/`WebSocket`/`dgram`/`dns`/`tls`/`http2`/`inspector.open` 모두 `permission` 층에서 **뚫림**(inspector.open은 막힘 — 3.2 표) |
| `process.permission.has()` | 존재하나 자식 내부 판단용, 보안 경계는 아님 |
| 권한 모델 밖 | `node:sqlite`의 `ATTACH DATABASE`, `VACUUM INTO`가 **파일을 생성**함(실측: `/tmp/sp2_attach.db` 8192B, `/tmp/sp2_vac.db` 4096B 생성), `process.kill(ppid, sig)`, `process.setuid`, `process.report.getReport()`(호스트명·cwd·execPath 노출) |
| `--disallow-code-generation-from-strings` | `eval`/`new Function`/`AsyncFunction` 생성자 → `EvalError`(MOD-01 5종 모두 차단). 단 `node:vm`의 `runInThisContext`는 이 플래그와 무관하게 컴파일되므로 가드에서 `vm` 자체를 차단해야 함 |
| TypeScript | 22.22.2는 **플래그 없이** type stripping 동작. erasable 구문만 가능(`enum`은 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`). `--experimental-transform-types`를 주면 단순 enum 실행 확인. 확장자는 `.mts`로 고정해야 `package.json` 탐색(읽기 거부)이 불필요 |

### 3.2 preload 가드 설계(`src/guard.mjs`) — 실제 동작한 것

1. **`module.registerHooks({resolve})`**(Node ≥ 22.15, 동기 훅)로 ESM `import`, 동적 `import()`, `require`, `createRequire`, `Module._load`, `data:` URL 내부 import를 **한 곳**에서 처리. 판정은 스펠링이 아니라 **해석 결과 url(`node:xxx`)** 로 하므로 `NET`, `node:NET`, `net/`, `node:net?x`, `dns/promises` 변형이 전부 막힘(MOD-03: `ERR_FATHOM_BLOCKED×9`, 나머지 2건은 존재하지 않는 패키지로 `ERR_MODULE_NOT_FOUND`).
2. **기본 거부(default-deny) 허용 목록** — 차단 목록 방식이 아니다. 허용: `assert, buffer, console, crypto, events, fs, fs/promises, path, perf_hooks, process, querystring, readline, stream*, string_decoder, timers*, url, util*, zlib, async_hooks, punycode, test, diagnostics_channel`. 그 외 전부 거부(요구 명세의 `net dgram dns http https http2 tls inspector child_process worker_threads`는 물론 `vm v8 os module wasi tty repl cluster trace_events`도 포함). **JS 모드에서는 `sqlite`도 거부**(FS-12: 권한 모델을 우회해 파일 생성). SQL 모드(`FATHOM_MODE=sql`)에서만 `sqlite` 허용.
3. `process.getBuiltinModule` 래핑(같은 목록 적용) — 안 하면 훅을 우회한다(PR-03).
4. 전역 `fetch`, `WebSocket`, `EventSource`, `XMLHttpRequest`를 던지는 스텁으로 교체. **`delete globalThis[k]` 후 `defineProperty`**: 바로 defineProperty 하면 지연 getter가 undici+wasm을 로드해 지연·메모리가 늘어난다.
5. **`net.Socket.prototype.connect`, `net.Server.prototype.listen` 무력화** — stdout/stdin 파이프가 `net.Socket` 인스턴스라 `new process.stdout.constructor().connect(port)` 가 순수 JS 네트워크 우회로가 된다(NET-02, `permission` 층에서 실제로 뚫림).
6. `process.binding/_linkedBinding/dlopen/execve/_debugProcess/setuid*` 차단, `process.kill`은 **자기 pid만** 허용(`kill(ppid,…)`로 부모/형제 신호 발사 방지, PR-06), `process._kill` 차단, `process.report.getReport/writeReport` 차단, `process.execArgv` 비움.
7. 자기 파괴 타이머(`FATHOM_DEADLINE_MS`, unref)로 부모가 죽었을 때의 2차 벽시계.
8. 설정용 env 두 개(`FATHOM_MODE`, `FATHOM_DEADLINE_MS`)는 가드가 **읽고 즉시 삭제** → 학습자 코드가 보는 `process.env`는 빈 객체.
9. 모든 가드 속성은 `writable:false, configurable:false` → 학습자가 덮어쓰기·삭제·복원 불가(MOD-07 tamper 시도 후에도 net 불가).

### 3.3 자식 실행 플래그(그대로 재사용 가능)

```js
// src/runner.mjs 발췌 — 요청당 spawn
const nodeArgs = [
  '--permission',
  `--allow-fs-read=${GUARD}`,           // preload 가드 (필수)
  `--allow-fs-read=${tmp}`,             // 학습자 파일 + 입력 (디렉터리 = 하위 전체)
  // 쓰기 기본 거부. 필요 시에만: `--allow-fs-write=${tmp}`
  // 미부여: --allow-child-process --allow-worker --allow-addons --allow-wasi
  '--disallow-code-generation-from-strings',
  '--max-old-space-size=128',
  '--disable-warning=ExperimentalWarning', '--no-addons',
  '--disable-wasm-trap-handler',        // ★ RLIMIT_AS와 TS type stripping(amaro wasm) 공존에 필수
  `--import=${pathToFileURL(GUARD).href}`,
  entry, // <tmp>/main.mjs | main.mts | main.cjs  (또는 sql-entry.mjs <tmp>/query.sql)
];
// OS 보조 상한 (Linux): prlimit는 exec하므로 pid가 node의 pid와 같다
spawn('prlimit', ['--as=1610612736', '--cpu=<ceil(timeout)+1>', '--fsize=8388608', '--core=0', '--', node, ...nodeArgs],
      { cwd: tmp, env: { FATHOM_MODE: 'js', FATHOM_DEADLINE_MS: '3500' }, stdio: ['ignore','pipe','pipe'], detached: true });
```

`--disable-wasm-trap-handler`가 필요한 이유(실측): 이 플래그 없이 `prlimit --as=1536MB`로 실행하면 wasm 메모리 예약(가상 ~10GB) 실패로 (a) TS type stripping(`amaro`)이 `RangeError: Out of memory: Cannot allocate Wasm memory`, (b) `WebSocket` 지연 로드 시 undici(llhttp wasm)도 같은 오류. 플래그를 주면 둘 다 정상. `--as`는 512MB에서 Node 부팅 자체가 실패, 1024MB부터 부팅 가능.

## 4. 결과

### 4.1 차단 시도 — JS/TS (52건, `full` 층 뚫림 **0**)

집계: `pass 52/52`, `full_escaped = []`, 양성 대조 유효 시도 **37/37**(`none` 층에서 전부 실제로 성공 → 시도가 공허하지 않음), `permission` 층만으로는 **19건이 뚫림**(아래 표). 잔존 프로세스 0, 임시 디렉터리 잔존 0(`tmpRootEntriesAtEnd: 0`).

**(a) 자원 무관 시도(3층 비교)**

| ID | 시도 | none | permission만 | **full** | full의 차단 근거 |
|---|---|---|---|---|---|
| FS-01 | `~/.ssh` 카나리 키·실제 홈 `.ssh` 읽기 | 뚫림 | 막힘 | **막힘** | `ERR_ACCESS_DENIED` |
| FS-02 | `/etc/passwd`, `/etc/hostname` | 뚫림 | 막힘 | **막힘** | 〃 |
| FS-03 | `/proc/self/environ`, `/proc/<ppid>/environ`(부모 비밀), cmdline | 뚫림 | 막힘 | **막힘** | 〃 |
| FS-04 | 절대경로로 밖에 쓰기(sync/promises) | 뚫림 | 막힘 | **막힘** | 〃 |
| FS-05 | `../` 상대 쓰기·mkdir·append | 뚫림 | 막힘 | **막힘** | 〃 |
| FS-06 | 형제 run 디렉터리·`/`·tmp 루트 나열 | 뚫림 | 막힘 | **막힘** | 〃 |
| FS-07 | `../../..`, `/proc/self/root`, `/proc/self/cwd/..` 트래버설 | 뚫림 | 막힘 | **막힘** | 〃 |
| FS-08 | `process.chdir('/')` 후 상대 읽기 | 뚫림 | 막힘 | **막힘** | 〃 |
| FS-09 | (쓰기 허용 tmp에서) 심볼릭/하드 링크 탈출 4종 | 뚫림 | 막힘 | **막힘** | 〃 |
| FS-10 | 쓰기 허용 tmp: 안쪽 쓰기 OK, 밖 쓰기 거부, 50MB 디스크 채우기 | 뚫림 | 막힘 | **막힘** | 〃 + `EFBIG`(RLIMIT_FSIZE 8MB) |
| FS-11 | `process.report.writeReport(밖)` | 뚫림 | 막힘 | **막힘** | 〃 |
| FS-12 | **JS에서 `node:sqlite` ATTACH / VACUUM INTO로 밖에 파일 생성** | 뚫림 | **뚫림** | **막힘** | 가드: `sqlite` 모듈 거부 |
| PR-01 | `child_process.spawnSync`(동적 import) | 뚫림 | 막힘 | **막힘** | 권한 + 가드 |
| PR-02 | `createRequire(...)('child_process')` | 뚫림 | 막힘 | **막힘** | `module` 자체가 허용 목록 밖 |
| PR-03 | `process.getBuiltinModule`, `process.binding('spawn_sync'/'process_wrap')` | 뚫림 | 막힘 | **막힘** | 가드 + `process.binding` `ERR_ACCESS_DENIED` |
| PR-04 | 제한된 fork 폭탄(자기 자신 6개 spawn) | 뚫림 | 막힘 | **막힘** | 가드 |
| PR-05 | `worker_threads.Worker`(파일·eval) | 뚫림 | 막힘 | **막힘** | 가드 |
| PR-06 | `process.kill(ppid,'SIGUSR2')`, `process._kill` | 뚫림 | **뚫림** | **막힘** | 가드 `kill(other pid)` 거부 (호스트에 신호 0) |
| PR-07 | `process.execve`, `dlopen`, `_debugProcess(ppid)`, `setuid` | 뚫림 | **뚫림** | **막힘** | 가드 4종 + 권한(execve) |
| NET-01 | `net.connect` → 호스트 TCP 리스너 | 뚫림 | **뚫림** | **막힘** | `ERR_FATHOM_BLOCKED` (호스트 접속 0) |
| NET-02 | `process.stdout.constructor`/`stdout.connect` 소켓 우회 | 뚫림 | **뚫림** | **막힘** | `Socket.prototype.connect` 무력화 |
| NET-03 | `http.get` | 뚫림 | **뚫림** | **막힘** | 가드 |
| NET-04 | 전역 `fetch()` | 뚫림 | **뚫림** | **막힘** | 스텁 |
| NET-05 | `WebSocket`/`EventSource` | 뚫림 | **뚫림** | **막힘** | 스텁 |
| NET-06 | `dgram` UDP 송신 | 뚫림 | **뚫림** | **막힘** | 가드 |
| NET-07 | `dns.lookup`/`dns/promises` | 뚫림 | **뚫림** | **막힘** | 가드 |
| NET-08 | `tls.connect`/`https.get`/`http2.connect` | 뚫림 | **뚫림** | **막힘** | 가드 |
| NET-09 | `inspector.open()`(디버그 포트) | 뚫림 | 막힘 | **막힘** | 권한 + 가드 |
| NET-10 | `net.createServer().listen` | 뚫림 | **뚫림** | **막힘** | 가드 |
| MOD-01 | `eval`, `new Function`, AsyncFunction/`constructor` 체인 5종 | 뚫림 | 막힘 | **막힘** | `EvalError`(`--disallow-code-generation…`) |
| MOD-02 | `vm.runInNewContext`/`runInThisContext` 탈출 | 뚫림 | **뚫림** | **막힘** | `vm` 모듈 거부 |
| MOD-03 | 스펠링 변형 11종 | 뚫림 | **뚫림** | **막힘** | resolved-url 기반 판정 |
| MOD-04 | **CJS 엔트리**: `require`, `module.constructor._load`, `process.mainModule`, `require.main` | 뚫림 | **뚫림** | **막힘** | 동기 훅이 CJS 로더도 덮음 |
| MOD-05 | `data:` URL 안에서 `node:net`/`child_process` import | 뚫림 | **뚫림** | **막힘** | 중첩 import도 훅 |
| MOD-06 | `module`, `v8`, `os`, `wasi`, `tty`, `trace_events`, `sqlite` 로드 | 뚫림 | **뚫림** | **막힘** | 기본 거부 |
| MOD-07 | 가드 변조(덮어쓰기·삭제) 후 다시 net 시도 | 뚫림 | **뚫림** | **막힘** | 속성 잠금 |
| ENV-01 | `process.env`, `report.getReport().environmentVariables`, HOME/PATH | 뚫림¹ | **뚫림**¹ | **막힘** | env 비어 있음 + report 차단 |

¹ ENV 양성 대조는 부모가 비밀 env를 자식에 그대로 넘기는 경우를 가정한 대조군(`controlOpts`). 러너는 애초에 `env: {}`로 spawn한다.

**(b) 자원 남용 시도 (`full` 층)**

| ID | 시도 | 결과 status | 피크 RSS(MB) | 소요(ms) | 판정 |
|---|---|---|---|---|---|
| PR-08 | SIGTERM 무시 + 무한 루프 | timeout(SIGKILL) | 49 | 805 | PASS |
| RES-01 | 무한 동기 루프 | timeout | 49 | 805 | PASS |
| RES-02 | `setInterval` + 마이크로태스크 폭풍 | timeout | 51 | 805 | PASS |
| RES-03 | `Atomics.wait` 영구 대기(CPU 0%, RLIMIT_CPU 무력) | timeout | 44 | 804 | PASS |
| RES-04 | `Buffer.alloc(2e9)` 미접촉(calloc, 가상 메모리만) | ok — `RLIMIT_AS`가 `Array buffer allocation failed`로 거부(한도를 끄면 할당 성공·RSS 0으로 무해) | 0 | 79 | PASS |
| RES-05 | `Buffer.alloc(2e9,1)` 접촉 | error(`RLIMIT_AS`에서 할당 실패) | 44 | 108 | PASS |
| RES-06 | 위와 동일, **RLIMIT_AS 끔**(감시자 단독) | **memory_limit** | 262 | 1418 | PASS |
| RES-07 | 16MB씩 Buffer 적재(감시자 단독) | **memory_limit** | 269 | 215 | PASS |
| RES-08 | JS 힙 폭탄 | memory_limit(V8 OOM `SIGABRT`을 분류) | 160 | 272 | PASS |
| RES-09 | 깊은 재귀 | error(RangeError, 호스트 무영향) | 0 | 93 | PASS |
| RES-10 | stdout 무한 출력 | output_limit(64KB) | 0 | 52 | PASS |
| RES-11 | stderr 무한 출력 | output_limit | 0 | 69 | PASS |
| RES-12 | stdout에 200MB 한 번에 쓰기 | memory_limit | 263 | 614 | PASS |
| RES-13 | zlib 압축 해제 폭탄(64MB×40 유지) | memory_limit | 274 | 528 | PASS |
| RES-14 | 가짜 `{"pass":true}` 출력 후 `exit(0)` | ok — 그대로 전달됨 | 0 | 63 | **수용 위험**(RSK-RUN, 6절) |

### 4.2 SQL 러너 (16건 + 기능 7건 = 23/23 PASS)

| ID | 시도 | 결과 | 대조(토크나이저 없이 같은 샌드박스) |
|---|---|---|---|
| SQL-01 | `ATTACH DATABASE '/…/x.db'` | 토크나이저 거부, **파일 생성 0**, spawn 0 | 대조군에서 **파일 생성됨**(권한 모델 우회 재현) |
| SQL-02 | `aTtAcH/**/DATABASE`(대소문자·주석) | 거부 | 파일 생성됨 |
| SQL-03 | `SELECT 1; ATTACH …`(2번째 문장 밀반입) | 거부 | 파일 생성됨 |
| SQL-04 | NUL 바이트 밀반입 | 거부(`NUL byte`) | 파일 미생성(C 문자열이 NUL에서 잘림 — 이 경우에도 토크나이저는 NUL 자체를 거부) |
| SQL-05 | `DETACH` | 거부 | — |
| SQL-06 | `PRAGMA writable_schema=1; PRAGMA journal_mode=WAL` | 거부 | — |
| SQL-07 | `VACUUM INTO '/…/v.db'` | 거부, 파일 0 | 대조군에서 **파일 생성됨** |
| SQL-08 | `load_extension('/lib/…')` | 토크나이저 거부 | DB 층 단독: `not authorized`(`allowExtension:false`가 실제로 막음) |
| SQL-09 | `"load_extension"(…)`(따옴표 식별자), `fts3_tokenizer`, `readfile` | 거부 | — |
| SQL-10 | `CREATE VIRTUAL TABLE … USING csv(filename='/etc/passwd')` | 거부(`VIRTUAL`) | — |
| SQL-11 | 25문장 | 거부(`> 20`) | — |
| SQL-12 | 무한 재귀 CTE `count(*)` | timeout 2.0s kill | — |
| SQL-13 | 무한 재귀 CTE `SELECT x` | 1000행 캡 후 정상 종료(`truncated:true`, 69ms) | — |
| SQL-14 | `length(hex(zeroblob(4e8)))` | **memory_limit**(RSS 263MB) | — |
| SQL-15 | 문자열 두 배 증식 + ORDER BY | `disk I/O error`로 안전 실패(SQLite 임시 파일 spill이 `--permission` 쓰기 거부로 막힘), 71MB | — |
| SQL-16 | 4KB blob 20만 행 INSERT | `database or disk is full`(`max_page_count`=16MB) | — |

기능(오탐) 검증: 윈도 함수(`SUM() OVER`), 재귀 CTE, DDL/DML/DROP 혼합, 안전 PRAGMA `table_info`, 문자열 안 `attach pragma vacuum`, SQLite 구문 오류 보고, 1000행 캡 — **7/7 PASS**. 토크나이저 단위 테스트(`npm run test:tokenizer`): 허용 11·거부 34, 오탐·미탐 0.

발견: `PRAGMA hard_heap_limit = 128MB`는 이 node:sqlite 빌드에서 값은 수락되지만 800MB 문자열 할당을 막지 못했다(직접 실행 확인). **SQLite 힙 상한으로 신뢰하지 말 것** — RSS 감시자와 `RLIMIT_AS`가 실제 방어선이다.

### 4.3 RSS 감시자 정밀도 (감시자 단독, `RLIMIT_AS` 끔, 각 5회)

| 샘플링 주기 | 1GB 일괄 접촉(피크) | 16MB씩 적재(피크) | 힙 배열(피크) | 결과 |
|---|---|---|---|---|
| 100ms(명세) | 259 ~ **381**MB | 296 ~ 327MB | 269 ~ 313MB | 15/15 memory_limit |
| 50ms | 305 ~ 329MB | 300 ~ 347MB | 261 ~ 317MB | 15/15 |
| 25ms | 268 ~ 309MB | 290 ~ 301MB | 259 ~ 282MB | 15/15 |

- 256MB 초과 뒤 kill까지의 **오버슈트는 최대 ≈ 1.5배(381MB)** (샘플에 잡힌 값이라 실제 순간 피크는 더 클 수 있음). 주기를 25ms로 줄이면 최대 오버슈트가 309MB로 준다.
- `--max-old-space-size=128`은 힙 밖 Buffer를 못 막는다는 v1.1 전제 **재확인**: 힙 128MB로 `Buffer.alloc(1.2e9,1)`이 성공, RSS 1185MB(감시자 끔). 같은 할당이 `RLIMIT_AS=1024MB`에서는 `Array buffer allocation failed`로 **깨끗하게 실패**(할당 자체가 거부되어 오버슈트가 없음).

### 4.4 정상 실행 지연 (프로세스 생성 포함, 순차 50회, 밀리초)

최종 재측정(`results/result-latency.json`):

| 시나리오 | p50 | **p95** | max | 비고 |
|---|---|---|---|---|
| `node -e 0` 순수 기동(기준선) | 32.9 | 43.3 | 45.2 | 이 머신의 Node 기동 하한 |
| JS hello — permission만(가드 없음) | 57.4 | 71.8 | 80.9 | |
| JS hello — **full**(권한+가드+prlimit) | 55.5 | **74.1** | 80.6 | 첫 실행 53.7ms |
| JS 전형 과제(fib+assert+twoSum) — full | 64.6 | **83.0** | 85.1 | |
| **TS** 전형 과제 — full(자식이 type stripping) | 186.5 | **287.6** | 318.6 | amaro wasm 로드가 +120ms |
| **SQL** 전형 과제(윈도 함수) — full | 72.2 | **123.1** | 141.7 | |
| JS 전형 — 동시 4개 | 81.4 | **156.2** | 169.6 | 4 vCPU |
| JS 전형 — **1회용 사전 기동 스페어** | 14.5 | 22.8 | 27.4 | 4.4배 빠름(아래 8절) |
| TS를 **부모에서 `module.stripTypeScriptTypes`**로 벗겨 JS로 실행 | 81.3 | 151.8 | — | 자식 type stripping 대비 −105ms(p50) |

직전 전체 실행(`result.json`)에서도 JS 전형 p95 81ms, TS 197ms, SQL 85ms, 동시 4개 148ms로 같은 범위였다(머신 부하에 따라 TS·SQL p95가 100~300ms 안에서 출렁임). **어느 시나리오도 목표 1.5s의 1/5 이하**다. 가드 오버헤드는 측정오차 이내(−2 ~ +3ms)다.

## 5. 합격 기준 대비 판정

| # | 기준 (출처) | 판정 | 근거 |
|---|---|---|---|
| 1 | 차단 시도 ≥ 20종 전부 실패 (SP-2, FR-LAB-001) | **PASS** (Linux) | JS/TS 52건 + SQL 16건, `full` 층 뚫림 0, 양성 대조 37/37 유효 |
| 2 | 호스트 파일 쓰기·읽기 0 (NFR-SEC-006) | **PASS** | FS-01~12, SQL-01/02/03/07: 밖 파일 생성 0, 카나리 유출 0 |
| 3 | 네트워크 연결 0 | **PASS** | NET-01~10 + MOD 우회: 호스트 리스너 접속 0(TCP/HTTP/UDP). 단 **JS 수준 차단**이라는 한계는 6절 |
| 4 | 타임아웃 100% | **PASS** | RES-01/02/03, PR-08, SQL-12 전부 SIGKILL(SIGTERM 무시·CPU 0% 대기 포함) |
| 5 | RSS 256MB 초과 kill | **PASS**(오버슈트 주의) | 15/15 kill, 피크 최대 381MB(100ms). 25ms 주기 시 309MB |
| 6 | 잔존 프로세스 0 | **PASS** | 매 시도 후 `/proc` 스캔 0, 최종 tmp 디렉터리 0 |
| 7 | stdout/stderr 64KB 절단 | **PASS**(경계 주의) | RES-10/11. 파이프 배압 특이 케이스는 7.5 |
| 8 | 잔여 위험 문서(RSK-RUN) 존재 (SP-2) | **PASS**(초안) | 6절이 RSK-RUN 초안. 정식 RSK-RUN 문서로 이관 필요 |
| 9 | 정상 실행 p95 ≤ 1.5s (NFR-PERF-007) | **PASS** | JS 74~83ms, SQL 85~123ms, TS 197~288ms, 동시 4 156ms |
| 10 | FR-LAB-002: `ATTACH` → 토크나이저 단계 거부·파일 0 | **PASS** | SQL-01~04 |
| 11 | FR-LAB-002: `PRAGMA`·`VACUUM INTO` 거부 | **PASS** | SQL-06/07(안전 PRAGMA 허용 목록은 결정 필요 — 7.4) |
| 12 | FR-LAB-002: 윈도 함수 결과 정확 | **PASS** | 기능 테스트 7/7 (순서 무관 비교 옵션은 채점기 범위라 미측정) |
| 13 | Windows·macOS 동작 | **V-live pending** | 미실행. `prlimit`, `/proc`, `unshare`, 프로세스 그룹 kill 전부 Linux 전용 코드 |
| 14 | 비 root·실사용자 권한에서 동일 결과 | **V-live pending** | 측정은 uid 0. 권한 모델 자체는 uid와 무관하나 `unshare -Urn`(user namespace)은 배포판별 설정 필요 |

> 종합: **Linux 기준 PASS(전 항목)**. FR-LAB-001의 "네트워크는 preload로 차단" 전략은 유효하나, 보안 경계가 V8/Node 내부 버그에 기대므로 6절의 잔여 위험을 문서로 고지하고 선택적 OS 격리 경로를 남긴다. `03-convergence.md`의 폴백(형식 비활성 + Docker `--network none`)은 **발동 조건에 해당하는 차단 불가 항목이 발견되지 않아 미발동**.

## 6. 잔여 위험 (RSK-RUN 초안)

| ID | 위험 | 심각도 | 근거·완화 |
|---|---|---|---|
| RSK-RUN-01 | **같은 OS 사용자·같은 커널**: 권한 모델·가드는 JS 런타임 층 방어다. V8/Node 자체 취약점(메모리 손상, 권한 모델 우회 과거 사례)이 나오면 전부 무력. Node 문서도 권한 모델을 악의적 코드에 대한 완전 샌드박스로 보장하지 않는다 | 높음(낮은 확률) | 로컬 단일 사용자 도구, 코드 출처 정책(FR-LAB-016)으로 학습자 자신의 코드만 실행. 완화: Node 버전 고정 + 이 스파이크의 차단 스위트를 CI(V-ci) 회귀 게이트로 승격, 보안 패치 시 상향 |
| RSK-RUN-02 | **네트워크가 커널 수준으로 막힌 것이 아님**. 가드는 JS 경로 차단이며 네이티브/미지의 경로가 있으면 loopback·LAN 도달 가능(부모 서비스의 127.0.0.1 API 포함 — 내부 토큰(NFR-SEC-003)이 마지막 방어선) | 중 | 측정: `unshare -Urn`(빈 네트워크 네임스페이스)으로 실행하면 가드 없이도 NET-01/03/04/06 `ENETUNREACH`(호스트 접속 0). 선택 옵션 `netns:true` 구현됨. 비 root 동작은 배포판 의존(미측정). 강한 요구 시 Docker `--network none` |
| RSK-RUN-03 | **결과 위조**: 학습자 코드가 같은 프로세스에서 `console.log`·`process.exit(0)`·`assert` 몽키패치로 PASS를 조작(RES-14) | 낮음(학습 서비스, 자기 자신을 속임) | 채점 신호를 학습자 stdout에서 분리(러너가 하네스 결과를 별도 채널 fd3/파일로 수신)하고 숨은 테스트 결과는 학습자 코드 실행 **이후** 별도 프로세스에서 산출. 성적에 영향이 큰 형식은 결정적 출력 비교 사용 |
| RSK-RUN-04 | **사이드채널**(타이밍, `SharedArrayBuffer`+`Atomics` 고해상도 타이머) | 낮음 | 수용. 완화 불가(Node 기본 기능) |
| RSK-RUN-05 | **RSS 오버슈트**: 100ms 주기에서 최대 ~1.5배(381MB), 감시자 사이 순간 폭증 가능. `RLIMIT_AS`(1.5GB)가 상한 | 낮음 | Linux 한정 완화. **Windows·macOS에는 `prlimit`이 없어 감시자 단독** → 주기 25~50ms 권장, V-live 검증 필요 |
| RSK-RUN-06 | **부모 비정상 종료 시 고아 프로세스**: 가드 타이머(이벤트 루프 필요)와 `RLIMIT_CPU`는 `Atomics.wait` 같은 0% CPU 블로킹을 못 끝낸다 | 낮음 | 부모 `process.on('exit')`에서 그룹 kill 구현. 추가 권고: 서비스 기동 시 `fathom-runner/run-*` 잔존 프로세스·디렉터리 청소(pid 파일) |
| RSK-RUN-07 | **CPU·동시성**: cgroup 없음. 러너 1개가 1코어를 3s 점유, 동시 4개면 지연 2배(4.4절) | 낮음 | 러너 풀 동시 실행 ≤ (코어 수 − 1), 큐잉 |
| RSK-RUN-08 | **디스크**: 기본은 쓰기 거부라 0. `writableTmp:true` 사용 시 파일당 8MB(`RLIMIT_FSIZE`)만 제한, **파일 개수·총량은 미제한** | 낮음 | 쓰기가 필요한 과제 형식만 opt-in, 총량 감시 추가(미구현) |
| RSK-RUN-09 | **정보 노출**: `process.execPath`(Node 경로), 임시 경로(`/tmp/fathom-runner/run-…`), Node 버전이 학습자 코드에 보임. **stderr에 러너 가드 절대경로가 섞임**(가드 예외 스택). 가드·SQL 엔트리 소스는 읽기 허용이라 읽힘(보안을 소스 비밀에 두지 않음) | 낮음 | 러너가 응답 전 stderr의 `RUN_ROOT`·러너 경로를 치환(NFR-SEC-012: 절대경로 0). 가드의 오류 스택은 잘라서 반환 |
| RSK-RUN-10 | **`registerHooks`/type stripping의 안정성**: `module.registerHooks`(≥22.15), type stripping은 22.22에서도 실험 단계 표기. 마이너 업데이트로 동작·경고가 바뀔 수 있음 | 중 | Node 마이너 고정 + 차단 스위트 CI 게이트 |
| RSK-RUN-11 | **`os` 등 허용 목록 밖 모듈 차단은 기능 제약**: `os`, `child_process` 등을 쓰는 과제 불가 | 낮음 | 콘텐츠 저작 규칙에 명시(FR-LAB-016 V4 실행 검증에서 자동으로 걸러짐) |
| RSK-RUN-12 | **Windows·macOS 미검증**(V-live pending): `--allow-fs-read` 경로 문법, env `{}`로 Node 기동 가능 여부(Windows는 `SystemRoot` 필요), 프로세스 트리 kill(`taskkill /T /F` 또는 Job Object), RSS 조회 | 미정 | 본 스파이크의 Linux 코드는 `process.platform` 분기 필요. R1 착수 전 각 OS에서 `npm run spike` 재실행 |

## 7. 설계 권고 (아키텍처 결정)

### 7.1 요청당 spawn vs pre-fork → **요청당 spawn을 기본으로 확정**

- 실측: 요청당 spawn JS p50 55~65ms / p95 74~83ms(목표 1.5s의 5%). 사전 기동이 줄여 주는 절대량은 ≈ 50ms(p50 64.6 → 14.5ms)로 사용자 체감 이득이 없다.
- pre-fork(재사용 워커 풀)는 **격리 약화**가 이득보다 크다. `--permission`의 허용 경로·`--max-old-space-size`·RLIMIT은 **프로세스 시작 시 고정**이라 실행마다 새 tmp 디렉터리·한도를 줄 수 없고, 학습자 코드가 남긴 전역 상태·프로토타입 오염·타이머·열린 핸들이 다음 요청으로 샌다. 타임아웃·OOM이면 어차피 kill 후 재기동해야 한다.
- 필요해지면(예: 저사양 PC에서 p95 상승) **"1회용 사전 기동 스페어"만** 허용: 미리 가드까지 기동해 stdin에서 "go"를 기다리다가 한 번 쓰고 폐기(실측 p50 14.5ms / p95 22.8ms, `src/runner.mjs`의 `prewarm`/`runOnSpare`, `src/warm-entry.mjs`). 재사용 금지. 단 스페어에서는 미리 정한 tmp 경로를 read 허용해야 하고 **차단 스위트를 스페어 경로로 재실행해야 도입 가능**(이 스파이크는 지연만 측정, 스위트는 요청당 spawn 경로만 통과).
- 동시성은 풀이 아니라 **세마포어**(동시 실행 수 상한)로 관리.

### 7.2 확정 플래그·API (FR-LAB-001에 반영)

1. 3.3의 플래그 세트를 그대로 사용. FR-LAB-001 ① 문구 보정: "fs 읽기는 러너 번들 경로만" → **"preload 가드 파일 + 요청별 임시 디렉터리만"**(가드 파일은 `--import` 때문에 필수 허용).
2. `--disable-wasm-trap-handler`는 RLIMIT_AS·TS와 함께 쓸 때 필수(Linux). 플랫폼별 분기 필요.
3. 모듈 차단은 **default-deny 허용 목록 + 해석된 url 기준 `registerHooks`**. 명세의 차단 목록에 **`node:sqlite`(JS 모드), `vm`, `v8`, `os`, `module`, `wasi`, `tty`, `cluster`, `repl`을 추가**(`sqlite`는 권한 모델을 우회해 파일을 생성하므로 필수).
4. 가드에서 `net.Socket.prototype.connect` 무력화가 필요(stdio 파이프가 `net.Socket`). `fetch`/`WebSocket`/`EventSource`는 삭제 후 스텁.
5. `process.kill`은 자기 pid만, `process.execve/_debugProcess/binding/dlopen/setuid*/report.*` 차단.
6. `RLIMIT_AS`(1.5GB) + `RLIMIT_CPU`(timeout+1s) + `RLIMIT_FSIZE`(8MB) + `--core=0`를 `prlimit`로 부여. **`RLIMIT_NPROC`는 쓰지 말 것**(UID 전체에 걸려 서비스 전체를 깨뜨림).
7. 부모 감시자는 **25~50ms 주기 권장**(명세의 100ms는 오버슈트 최대 381MB). `/proc/<pid>/status`의 VmRSS를 동기 읽기(비용 무시 가능).
8. 프로세스 트리 kill: `detached:true` + `process.kill(-pid,'SIGKILL')`(Linux/macOS). Windows는 별도 구현(V-live).
9. 출력 캡은 **`>= cap`에서 kill**(엄격 `>`는 안 된다: 7.5).
10. TypeScript: **부모에서 `module.stripTypeScriptTypes`로 벗겨 `.mjs`로 실행**하면 자식 wasm 로드(~120ms)를 피한다(p50 186 → 81ms). 줄·열 위치는 공백 치환으로 보존됨. 단 erasable 구문만 지원(enum·namespace·parameter property는 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` → 저작 규칙에 명시, 또는 `--experimental-transform-types`).

### 7.3 러너 포트 초안(`RunnerPort` 불변 유지)

```ts
interface RunRequest { kind: 'code' | 'sql'; lang?: 'js' | 'ts'; code: string; sourceKind: 'learner'|'seed'|'t1'; // FR-LAB-016은 러너 진입 전 검사
  timeoutMs?: number /*3000*/; rssLimitMB?: number /*256*/; outCapBytes?: number /*65536*/;
  writableTmp?: boolean /*false*/; netns?: boolean /*Linux 선택 하드닝*/ }
type RunStatus = 'ok'|'error'|'timeout'|'memory_limit'|'output_limit'|'rejected'|`killed_${string}`;
interface RunResult { status: RunStatus; stdout: string; stderr: string /*경로 치환 후*/; exitCode: number|null;
  durationMs: number; peakRssMB: number; outputTruncated: boolean; reason?: string /*rejected 사유*/ }
```

### 7.4 SQL 러너 결정

- **토크나이저가 유일한 게이트**다(node:sqlite에 authorizer 없음, `ATTACH`/`VACUUM INTO`는 권한 모델을 우회 — 4.2 대조군으로 재현). 정규식 스캔이 아니라 **완전 렉싱**(주석·`'..'`·`".."`·`` `..` ``·`[..]`·`X'..'`) 후 토큰 단위 판정. 구현: `src/sql-tokenizer.mjs`(부모+자식 이중 적용, NUL·바인드 파라미터 거부, 문장 ≤ 20, SQL ≤ 64KB).
- 허용 시작 키워드: `SELECT WITH INSERT UPDATE DELETE CREATE(TABLE|VIEW|INDEX) DROP(TABLE|VIEW|INDEX)`. 거부 단어: `ATTACH DETACH PRAGMA VACUUM LOAD_EXTENSION READFILE WRITEFILE EDIT FTS3_TOKENIZER SQLITE_DBPAGE VIRTUAL TRIGGER EXPLAIN ANALYZE REINDEX BEGIN COMMIT END ROLLBACK SAVEPOINT RELEASE ALTER` + 파일 경로형 문자열 리터럴(`/`,`~`,`C:\`,`file:`,`.db|.sqlite|.so|.dll`로 끝남 — 정당한 문자열에 오탐 가능, 감수).
- **결정 필요(명세 충돌)**: FR-LAB-002는 PRAGMA 전부 거부인데, 스키마 확인용 `PRAGMA table_info(t)` 등 읽기 전용 7종(`table_info table_xinfo table_list index_list index_info index_xinfo foreign_key_list`)만 허용 목록으로 두길 권고(구현·테스트 완료). 어차피 `SELECT * FROM pragma_table_info('t')`가 허용되므로 위험 차이가 없다.
- 러너 소유 설정: `allowExtension:false`, `enableForeignKeyConstraints:true`, `PRAGMA max_page_count=4096`(16MB DB, SQL-16이 `database or disk is full`로 안전 실패). `hard_heap_limit`은 효과 없음 → RSS 감시자에 의존.
- 실행: `stmt.iterate()`로 **행 1000개·셀 1KB 캡** 후 중단(무한 재귀 `SELECT`도 즉시 종료). 시간은 자식 안에서 끊을 수 없으므로 부모 2s 벽시계 kill(SQL-12).
- SQL도 **동일 샌드박스 자식**에서 실행. assessment 본 프로세스는 절대 학습자 SQL을 실행하지 않는다(현행 명세 유지). 임시 파일 spill은 권한 모델이 막아 대량 정렬은 `disk I/O error`로 실패함을 사용자 메시지로 매핑.

### 7.5 실측으로 발견한 함정 (구현 시 그대로 반영)

1. **stdout 배압 함정**: 동기 무한 루프 + `console.log`는 파이프(64KB)가 차면 Node가 쓰기를 힙에 쌓는데 이벤트 루프가 안 돌아 플러시되지 않는다. 부모가 **정확히 64KB(=cap)만** 받고 멈추는 경우가 있어 `>`로 판정하면 kill이 안 걸리고(1/8 재현: 58KB만 수신) 자식은 RSS/힙 OOM으로 죽었다. `>=`로 바꾸고, V8 OOM(`SIGABRT` + stderr `heap out of memory`)은 `memory_limit`로 분류.
2. `--permission`만으로는 **네트워크·`sqlite ATTACH`·`process.kill`·`report.getReport`가 다 열려 있다**(4.1 표의 permission 열). 층별 기여는 권한 모델 = 파일·프로세스, 가드 = 네트워크·모듈·sqlite·신호, rlimit/감시자 = 자원.
3. `Buffer.alloc(2e9)`(0 채움)는 calloc이라 RSS가 안 늘어난다. RSS 감시자로는 못 잡지만 실질 위험이 없고, `RLIMIT_AS` 1.5GB에서는 할당이 거부된다. 접촉(`fill`)하는 순간부터 RSS가 늘어 감시자가 잡는다.
4. 학습자 코드가 `process.stdin`을 읽게 하려면 스파이크의 `stdio[0]:'ignore'`를 바꿔야 한다(입력 주입은 tmp 파일 + `--allow-fs-read` 권장).
5. 자식의 `stderr`에 가드 예외 스택이 섞여 러너 경로가 노출된다 → 응답 전 치환(RSK-RUN-09).

## 8. 파일 목록

| 경로 | 역할 |
|---|---|
| `spikes/sp2-runner-isolation/src/runner.mjs` | 러너(부모): spawn·감시자·캡·정리, `prewarm/runOnSpare` 실험 |
| `.../src/guard.mjs` | preload 가드 |
| `.../src/sql-tokenizer.mjs`, `sql-tokenizer.test.mjs` | SQL 렉서·allowlist, 단위 테스트 |
| `.../src/sql-entry.mjs` | 샌드박스 안 SQL 실행기 |
| `.../src/attacks.mjs`, `harness.mjs` | 차단 시도 카탈로그, 3층 대조 + 호스트 부수효과 판정 |
| `.../src/latency.mjs`, `experiments.mjs`, `ts-precompile.bench.mjs` | 지연·감시자 오버슈트·전제 재확인·TS 사전 변환 |
| `.../src/spike.mjs` | 전체 실행(`npm run spike`), 결과를 `results/`에 저장 |
| `.../fixtures/` | 카나리(`fakehome/.ssh/id_rsa`)와 밖 쓰기 검출용 `outside/` |

## 9. 재현 방법

```bash
cd /home/user/study_develop_ai/spikes/sp2-runner-isolation
node -v                      # v22.22.x 필요
npm run test:tokenizer       # SQL 토크나이저 단위 테스트
npm run spike                # 전체(차단 시도 + SQL + 전제 실험 + 지연) ≈ 2분, JSON 요약을 stdout에 출력, 진행은 stderr
npm run spike:attacks        # 차단 시도만 (JS 52 + SQL 16 + 기능 7)
npm run spike:latency        # 지연 50회 측정만
node src/ts-precompile.bench.mjs   # TS 사전 변환 실험
```

의존 패키지 없음(`npm install` 불필요). Linux 전제(`prlimit`, `/proc`, 선택적 `unshare`). 호스트 부작용은 `fixtures/outside/`와 `os.tmpdir()/fathom-runner/`에 한정되며 실행 후 비워진다. 카나리 비밀은 부모 프로세스 env에만 존재하고 자식에는 전달되지 않는다.

## 감사(Audit) 결과

- 감사일: 2026-09-30. 방법: 같은 컨테이너(Node v22.22.2, Linux, 4 vCPU, uid 0)에서 `npm run spike`를 독립 재실행(1분 48초, 종료 코드 0), 새 `results/result.json`을 원문과 대조. 코드는 수정하지 않았다.
- 판정: **PASS 유지(Linux, V-build)**. SP-2 통과 기준 3개(차단 시도 ≥ 20종 전부 실패, RSK-RUN 작성, 정상 실행 p95 ≤ 1.5s)는 재현되었다. 다만 아래 A-3~A-6은 보고서 서술이 증거보다 강하게 표현된 부분이므로 본문 해석 시 이 정정을 우선한다.

### A-1. 재현된 수치

| 항목 | 보고서 | 감사 재실행 | 일치 |
|---|---|---|---|
| JS 차단 시도 pass / `full` 뚫림 | 52/52, 0 | 52/52, 0 | 예 |
| 양성 대조 유효(`none` 층) | 37/37 | 37/37 | 예 |
| `permission`만으로 뚫린 항목 | 19건 | 19건(같은 ID 목록) | 예 |
| SQL 차단 / 기능 테스트 | 16/16, 7/7 | 16/16, 7/7 | 예 |
| 토크나이저 없는 대조에서 파일 생성 | SQL-01/02/03/07 | SQL-01/02/03/07 생성, SQL-04 미생성 | 예 |
| 자원 시도 status | 표 4.1(b) | 전부 같은 status(피크 RSS·ms는 실행마다 변동) | 예 |
| 잔존 프로세스·tmp | 0 | 0(`tmpRootEntriesAtEnd: 0`) | 예 |
| 지연 p95(JS 전형 / TS / SQL / 동시 4) | 83 / 288 / 123 / 156ms | 62.8 / 155.1 / 74.2 / 65.0ms | 예(기준 1.5s 대비 여유 큼) |
| 감시자 100ms 최대 피크 | **381MB** | **394.3MB** | **아니오** — A-6 |
| 감시자 50ms / 25ms 최대 피크 | 347 / 309MB | 354.6 / 289.4MB | 대체로(표본 변동) |

`full` 층 37행은 모두 페이로드의 시도 횟수만큼 구체적 오류 코드(`ERR_ACCESS_DENIED`, `ERR_FATHOM_BLOCKED`, `EvalError`, `EFBIG` 등)를 출력했다. 즉 자식이 부팅 실패로 아무것도 출력하지 않아 "막힘"으로 잘못 집계된 공허한 통과는 없었다(FS-12, PR-02는 정적 import 단계에서 가드가 거부해 `error`로 종료. 이것도 정상 차단).

### A-2. 기준 대비 판정 확인

- 기준 1(≥ 20종 전부 실패): 충족. 단 A-3의 계수 정정을 적용해도 격리 공격 36건 + 자원 격리 14건으로 20종을 크게 넘는다.
- 기준 2(RSK-RUN 작성): 6절 초안으로 충족(정식 문서 이관 필요는 본문 그대로).
- 기준 3(p95 ≤ 1.5s): 충족, 재실행에서 더 낮게 측정됨.

### A-3. 정정 — "52/52 PASS"의 구성

52건에는 차단되지 않는 **RES-14(결과 위조)가 포함**되어 있고, 하네스가 `accepted:true` 항목을 무조건 `pass=true`로 기록한다. 정확한 표현은 "격리 공격 37건(FS-10 기능 확인 포함) 중 `full` 뚫림 0, 자원 격리 14건 중 기대 status 14, **수용 위험 1건(미차단)**"이다. 5절 표 1행의 "52건 전부 실패"는 이 기준으로 읽어야 한다.

### A-4. 정정 — "판정은 자식 stdout이 아니라 호스트 측 부수효과로 한다"(3절 5항)

`hostEffects()`는 호스트 부수효과와 함께 **페이로드가 스스로 출력한 `ESCAPED:` 표식도 뚫림으로 센다.** 재실행 결과 37개 대조 행 중 **20행(FS-03, FS-06~08, PR-01~05, PR-07, NET-07, NET-09, NET-10, MOD-01~07, ENV-01)은 `none` 층 양성 대조가 자기 보고 표식뿐**이고 호스트에서 관측된 효과는 없었다(읽기·모듈 로드·dns·listen처럼 호스트가 관측할 수단이 없는 시도). 이 행들의 `full` 층 "막힘" 판정도 표식 부재와 페이로드가 잡은 오류 코드에 기대고 있다. A-1대로 오류 코드가 구체적이라 결론은 유효하지만, 방법 서술은 "호스트 부수효과 **또는** 자식의 자기 보고 표식"으로 정정한다. 호스트 관측형 대조(파일·소켓·신호)는 나머지 17행(FS-01/02/04/05/09~12, PR-06, NET-01~06, NET-08)에만 해당한다.

### A-5. 정정 — "JS/TS 52건"

차단 카탈로그는 전부 `lang: 'js'`(MOD-04만 `cjs`)로 실행된다. **TS 엔트리(`.mts` + 자식 type stripping) 경로로 실행한 차단 시도는 0건**이며 TS는 지연만 측정됐다. 따라서 "TS 경로 격리 검증 완료"로 인용하면 안 된다. 7.2-10 권고(부모에서 `stripTypeScriptTypes` 후 `.mjs` 실행)를 채택하면 자식은 JS 경로와 동일하므로 JS 스위트 결과가 적용된다.

### A-6. 정정 — RSS 오버슈트 상한

100ms 주기 최대 피크는 이번 재실행에서 **394.3MB(≈ 1.54배)** 로 보고서의 381MB보다 컸다. 샘플링 값이므로 상한이 아니라 관측 사례로만 인용하고, 명세 "256MB 트리 kill"은 "256MB **초과 감지 후** kill(100ms에서 관측 최대 ~400MB)"로 읽어야 한다. 25~50ms 주기 권고(7.2-7)는 재실행으로도 지지된다(25ms 최대 289MB).

### A-7. 보충 — 네트워크 네임스페이스 실험(P6)

같은 실험에서 가드 없이 `unshare -Urn`만 쓴 경우 NET-07(`localhost` 조회, `/etc/hosts`로 해석)과 NET-10(네임스페이스 안 loopback listen)은 **성공**했다. 둘 다 호스트 도달은 없으므로(hits 0) 위험은 아니지만, RSK-RUN-02의 "netns만으로 NET 차단" 서술은 "호스트 도달 차단"으로 한정해야 한다.

### A-8. 범위 한계(보고서가 이미 고지, 재확인)

모든 결과는 Linux·uid 0 한정이다. Windows·macOS에는 `prlimit`, `/proc` RSS 조회, 프로세스 그룹 kill이 없어 이 결과가 이전되지 않는다. 1회용 사전 기동 스페어 경로는 차단 스위트를 거치지 않았다. SQL 16건 중 토크나이저 없는 대조가 있는 것은 파일 생성형 5건(SQL-01~04, 07)뿐이다.
