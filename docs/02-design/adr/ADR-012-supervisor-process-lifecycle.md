# ADR-012. supervisor와 프로세스 수명주기 — fork + IPC 봉투, 선호 고정 포트, 재시작·격하, 버전 핸드셰이크, dev = 운영 경로

- **상태**: Accepted · **일자**: 2026-10-01 · **결정자**: T1(아키텍처)
- **Trace**: UR-08·15·17, FR-SET-001·002·012·015·023·024, NFR-AVL-002·003·006·009, NFR-SEC-001·003, NFR-PERF-008, NFR-PORT-001·004·005, PLN-REV-01 AQ-08, SP-4 §5.5-6·§6.6 + 감사(경고 플래그 전파·크래시 후 무결성·대량 작업 프로세스 분리·`%LOCALAPPDATA%\Fathom`), 심사 기록 AQ-08·종료 절차 입장
- **관련**: ARC-01 §14, ADR-001·009·013·015

## 맥락 (Context)

- 1인 사용자가 Windows·macOS·Linux에서 한 명령으로 켜고 끈다(FR-SET-001). 서비스 1개가 죽어도 학습이 계속되고 5s 안에 재시작해야 한다(NFR-AVL-003).
- Windows에는 우아한 SIGTERM이 없다(SP-4 §5.5-6). `spawn`은 `execArgv`를 상속하지 않아 ExperimentalWarning 억제 플래그가 빠진다(SP-4 #17), `fork`·worker는 상속한다.
- 내부 토큰은 디스크·로그·env 0이어야 한다(NFR-SEC-003). 개발 경로와 운영 경로가 갈라지면 쿠키·CSRF·포트 결함이 늦게 드러난다(심사: A의 OP-10, B의 dev origin 분기 기각).
- 내부 포트를 OS 할당으로 두면 디버깅·k8s·테스트 문서가 비결정적이다(A 자체 조정 graft).

## 결정 (Decision)

1. **supervisor**(`services/ops/src/supervisor/`, 빌드본 `services/ops/dist/supervisor/main.js`): 프로세스 기동·감시·재시작, 포트 레지스트리, 호출자 토큰 발급, 버전 핸드셰이크, 로그 수집·회전, dev 파일 감시. **DB·HTTP 서버를 갖지 않는다**(목표 ≤ 400 LoC). 백업·doctor·텔레메트리는 ops-api의 몫이다. CLI는 supervisor를 **파일 경로로 spawn**(import 아님, detached)한다.
2. **자식 생성 = `child_process.fork` + IPC**: `execArgv = ['--disable-warning=ExperimentalWarning']`(prod) 또는 `['--disable-warning=ExperimentalWarning', '--import', 'tsx', '--conditions=source']`(dev). 자식 env는 부모 env를 그대로 넘기지 않고 `PATH, HOME, LANG, LC_ALL, TMPDIR, TZ`(+ Windows `SYSTEMROOT, APPDATA, LOCALAPPDATA, USERPROFILE`)와 `FATHOM_HOME`, 그리고 **`NODE_OPTIONS=--disable-warning=ExperimentalWarning`**(서비스가 다시 spawn하는 Node 자식도 경고 억제를 받도록 — spawn은 `execArgv`를 상속하지 않음, SP-4 감사)만 둔다(토큰·키 없음). 러너 자식은 이 env를 물려받지 않는다(빈 env, ADR-007).
3. **부트스트랩 봉투**(첫 IPC 메시지, `@fathom/contracts/admin/ipc`의 `BootstrapEnvelope`): `{type:'bootstrap', v:1, svc, boot_id, app_version, contracts_hash, profile, home, web_root, listen{host:'127.0.0.1', port}, self_token, callers{svc: token}, peers{svc: {url}}, flags{safe_mode, batch_enabled, after_crash}, log_level}`(`after_crash` = 이 서비스의 직전 종료가 비정상이었음). 토큰 5개(호출자 서비스별 256bit)는 supervisor 메모리에서만 생성·보관하고 봉투로만 전달한다.
4. **IPC 메시지**(`@fathom/contracts/admin/ipc`): supervisor → 자식 `bootstrap`·`registry.updated{peers}`·`shutdown{grace_ms}`·`log.level{level}` / 자식 → supervisor `listening{port}`·`ready{contracts_hash, schema_versions, app_version}`·`fatal{exit_code, code}` / ops-api ↔ supervisor `svc.stop|start|restart{svc}`·`svc.run_mode{svc, mode:'migrate'|'restore'|'verify', args}` → `svc.run_mode.result{exit_code, tail}`·`status.get` → `status{services}`·`logs.tail{svc, n}`. IPC가 끊기면(= supervisor 사망) 자식은 새 요청을 거절하고 `db.close()` 후 종료한다(고아 0). 서비스가 스스로 fork하는 **단명 자식 job**(ADR-002 §3: snapshot·pack-load·merge·rebuild·replay-verify·integrity·fsrs-optimize·pipeline)은 supervisor 관리 대상이 아니다 — 부모 서비스와 IPC로만 말하고, 부모가 죽으면 IPC 끊김으로 스스로 종료하며, stdout(pino JSON, `svc`에 `job` 필드 추가)은 부모가 자기 stdout으로 중계해 같은 로그 스트림에 남는다.
5. **포트(AQ-08)**:

   | 프로파일 | gateway | ops-api | content | learning | ai-gateway | 예약(7번째) | Vite |
   |---|---|---|---|---|---|---|---|
   | `prod` | **4747**(폴백 4748~4756 → OS, 안내 1회) | 4761 | 4762 | 4763 | 4764 | 4765 | — |
   | `dev` | 4847(폴백 4848~4856) | 4861 | 4862 | 4863 | 4864 | 4865 | 127.0.0.1:5173 `strictPort` |
   | `test` | 0 | 0 | 0 | 0 | 0 | — | — |

   내부 서비스는 선호 포트 bind 실패 시 OS 할당 후 `listening{port}`로 보고 → supervisor가 `run/registry.json`(서비스별 `{pid, port, state, started_at, restarts}`, **토큰 없음**, 0600)을 갱신하고 `registry.updated`를 방송. 재시작 시 직전 포트를 먼저 재사용한다. 모든 `listen()`은 `127.0.0.1`(`shared-kernel/service` 가드, 위반 exit 78).
6. **기동 순서**(콜드 ≤ 10s, 목표 3~5s): CLI가 `run/supervisor.lock`(`{pid, boot_id, version, started_at, profile}`) 확인 → 살아 있으면 open만 → 아니면 Node 버전(≥ 22.15)·`FATHOM_HOME`·동기화 폴더 휴리스틱 검사 후 supervisor spawn → 토큰 생성 → ops-api·content·learning·ai-gateway 병렬 fork(Safe Mode면 ai-gateway 제외, content `batch_enabled=false`) → 각 서비스: 스키마 버전 확인 · `PRAGMA quick_check`(봉투 `flags.after_crash = true`면 ready 후 job `integrity`로 `integrity_check` 전체 검사, 실패 = `degraded` + 배너, SP-4 감사) · 정책 로드 · relay 시작 → `listening` → `ready` → **핸드셰이크**: 전원의 `contracts_hash`가 supervisor 번들 값과 같고 `schema_versions`가 기대값이어야 한다(불일치 = 혼합 버전 기동 거부, 해당 서비스 exit 78, 업그레이드 롤백 경로, ADR-013) → learning·content `ready` 후 gateway fork → `registry.json` 기록 → CLI에 ready(+ `fathom open`이면 부트스트랩 URL 열기, ADR-009).
7. **재시작·격하**: 비정상 종료 → 250ms → 1s → 2s 백오프(≤ 5s). 60s 안 3회 초과 → `degraded`(재시작 중지) + ops-api 배너·doctor. **종료 코드 규약**: 0 = 요청된 종료(재시작 안 함), 64 = 사용법 오류, 70 = 내부 오류(재시작), 75 = 일시 실패(즉시 재시작), **78 = 설정·버전·스키마 불일치(재시작 안 함, degraded)**. 서비스별 영향은 ARC-01 §14.2 표.
8. **종료**: `fathom down` → gateway `/api/v1/cli/shutdown`(cli.token) → ops-api → supervisor `shutdown.all`. 순서 gateway → content·learning·ai-gateway → ops-api → supervisor. 각 서비스는 `shutdown{grace_ms: 3000}`에 새 요청 503 → 진행 중 tx 완료 → relay 1회 drain → `db.close()` → exit 0. gateway가 응답하지 않으면 CLI가 lock의 pid에 POSIX `SIGTERM` / Windows `taskkill /PID <pid>`(자식은 IPC 끊김으로 정상 종료, WAL은 크래시 안전 — SP-4 §4.3).
9. **로그 수집**: 서비스 stdout(pino JSON 줄)을 supervisor가 받아 `logs/<svc>/YYYY-MM-DD.jsonl`에 쓰고 일 회전, 14일 ∧ 서비스당 ≤ 50MB 중 먼저 도달 시 정리, 서비스별 메모리 링 5,000줄(`logs.tail`). JSON이 아닌 줄(예: 네이티브 크래시 출력)은 `{level:'fatal', svc, raw}`로 감싼다.
10. **dev = 운영 경로**: `pnpm dev` = `tsx apps/cli/src/main.ts up --profile=dev --foreground` → 같은 supervisor 코드. supervisor가 `services/<svc>/src/**`·`packages/{contracts,shared-kernel}/src/**`를 recursive `fs.watch`(300ms debounce)로 감시하고 **정상 수명주기(IPC shutdown → fork)**로 영향 서비스만 재기동한다(`node --watch`는 IPC 채널을 깨므로 금지). Vite는 관리 자식, gateway가 비-API 경로·HMR WebSocket을 프록시해 **origin 1개(4847)**. `FATHOM_HOME = <repo>/.fathom-dev`.
11. **Safe Mode**(`fathom up --safe`, NFR-AVL-009): ai-gateway 미기동, content 배치 0, learning 유휴 리플레이 검증 중지. 학습·doctor·restore 가능.
12. **자동 기동**(FR-SET-024, 기본 off): ops-api `autostart` 모듈이 템플릿(`services/ops/assets/autostart/`)으로 macOS `~/Library/LaunchAgents/dev.fathom.agent.plist`, Windows `schtasks /Create /SC ONLOGON /TN Fathom /TR "<launcher> up"`, Linux `~/.config/systemd/user/fathom.service`를 생성·삭제한다.
13. **Windows**: 종료·설정 변경은 IPC만, 트리 kill = `taskkill /T /F /PID`, npm shim 해석(`shared-kernel/proc`), 경로는 `path.join`·한글·공백 허용, 데이터 경로 `%LOCALAPPDATA%\Fathom`(CR-01), 동기화 폴더·네트워크 경로·WSL 경로(`\\wsl$\…`)는 기동 시 경고. Windows 지원 판정은 V-ci 후속 게이트(ADR-014) 통과 후에만 "PASS"로 표기한다.

## 대안 (Alternatives)

| 대안 | 장점 | 단점 | 판정 |
|---|---|---|---|
| turbo `dev`·concurrently로 서비스 병렬 실행 | 도구 기본 | 헬스·재시작·토큰·레지스트리 없음, dev와 운영 경로 분기 | 기각 |
| pm2 | 기능 풍부 | 추가 데몬·의존, IPC 토큰 전달 불가, Windows 편차 | 기각 |
| OS 서비스 관리자(launchd·systemd)로 서비스별 등록 | 견고 | 3 OS 별도 구현, 1인 설치 마찰 | 기각(자동 기동은 supervisor 1개만) |
| SIGTERM 기반 종료(B) | 표준 | Windows 불가 | 기각 |
| env로 토큰 전달(B) | 단순 | `/proc/<pid>/environ` 노출·상속 | 기각 |
| 내부 포트 완전 동적(A 원안) | 충돌 없음 | 디버깅·문서·k8s 비결정적 | 기각(선호 고정 + 폴백) |
| 단일 프로세스(모놀리식) | 최소 | UR-08 위반 | 기각 |

## 결과 (Consequences)

- **긍정**: 한 명령·한 origin·dev = 운영. 크로스 플랫폼 종료와 토큰 전달이 같은 메커니즘(IPC)이다. 혼합 버전 기동이 구조적으로 거부된다. 포트가 결정적이라 디버깅·테스트·k8s 문서가 단순하다.
- **부정**: supervisor는 단일 장애점이다 → 로직 최소화, IPC 끊김 시 자식 정상 종료, 자동 기동, SW 앱 셸 오프라인 안내. dev 파일 감시는 OS별 `fs.watch` 편차가 있다(V-ci).
- **후속**: INT-1a L02 최소(기동·감시·재시작·레지스트리·토큰), INT-1b 핸드셰이크·로그. 카오스 테스트(`tests/chaos`)가 supervisor 훅으로 서비스 kill.

## 동결 영향

봉투·IPC 메시지 스키마, 포트 표, 종료 코드 규약, 기동·종료 순서, dev 프로파일 규칙은 상세 동결이다.
