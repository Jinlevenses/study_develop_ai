# 아키텍처 제안 심사 기록 (Judge Panel Record)

> 3개 제안(A 운영성 우선 / B 도메인 우선 / C AI·콘텐츠 확장성 우선)을 3개 렌즈(로컬 운영성 / 요구 적합성 / 에이전트 빌드 가능성)로 독립 심사한 결과. 합산 점수 최고안을 기반안으로 채택하고 graft를 이식한다.

## 합산 점수

| 제안 | local-operability | requirements-fit | agent-buildability | 합계 |
|---|---|---|---|---|
| A-operability-first | 8.5 | 7.4 | 8.1 | **24.0** |
| B-domain-first | 6.5 | 6.9 | 7.7 | **21.1** |
| C-ai-content-extensibility-first | 6 | 7.8 | 6.4 | **20.2** |

**채택 기반안: A-operability-first**


## 심사: local-operability (winner: A-operability-first)

### 근거
운영성 렌즈는 Windows·macOS에서 1인이 수년간 운영하는 조건을 기준으로 삼았다. A가 이긴다. 한 명령·한 origin·dev=운영 경로, DB·HTTP가 없는 최소 supervisor(fork+IPC)를 갖췄다. 그래서 Windows SIGTERM 부재, 토큰 비디스크 전달, 고아 프로세스 0을 동시에 해결한다. 서비스별 재시작·격하 표가 구체적이고, ops가 타 DB를 열지 않는 epoch 백업·복원 절차와 운영 중심 관측성(적체 나이, 이벤트 루프 지연, SLO 배너)도 있다. Node EOL·디스크·동기화 폴더까지 다룬 FMEA도 A만큼 깊은 안이 없다. A의 약점은 세 가지다. 병합 content의 채점 장애 반경, 업그레이드·롤백 절차 부재, 원장 upcaster·dead-letter 부재. 모두 B·C에서 이식하거나 작은 추가로 메울 수 있어 구조 변경이 필요 없다. B는 D-9 내성(content 다운 중에도 학습 지속, IndexedDB 큐)과 이벤트 타임라인·upcaster가 뛰어나다. 그러나 상주 7개·DB 6개·이벤트 38종·연결 약 12개로 부품이 가장 많다. env 토큰, SIGTERM, `%APPDATA%`, dev origin 분기 같은 크로스플랫폼 운영 결함도 있어 6.5점이다. C는 자원 수치화, 배치 격리, fragment 부트스트랩이 좋다. 하지만 ops가 forge.db를 직접 여는 백업은 NFR-MAINT-002 위반이자 경합 원인이다. RSS 50ms는 SP-2 권고에 역행하고, Windows Get-Process 50ms는 실현할 수 없다. 온디맨드 수명주기·2단 큐 상태, STORED 생성열 마이그레이션 비용이 수년 운영 부담을 키워 6.0점이다. 권고: A를 기반으로 삼고, B의 attempt 큐·dead-letter·이벤트 타임라인·upcaster·epoch 중단 규칙과 C의 배치 자식 격리·ai-cache 분리·degradation-visible 테스트·fragment 토큰을 이식한다. 여기에 세 안 모두 빠뜨린 `fathom upgrade`(업그레이드 전 자동 epoch → 오프라인 migrate dry-run → 버전 핸드셰이크 → 번들 2세대 롤백)와 Windows RSS 장기 헬퍼를 신규로 추가한다. 참조: /home/user/study_develop_ai/docs/02-design/proposals/{A-operability-first,B-domain-first,C-ai-content-extensibility-first}.md, /home/user/study_develop_ai/docs/02-design/spikes/{SP-2,SP-4}.md, REQ NFR-AVL-002·NFR-SEC-003·NFR-MAINT-002·NFR-PORT-005.

### 점수별 강점/약점

**A-operability-first — 8.5**
- 강점: 한 명령·한 origin·dev=운영 경로(OP-10): `pnpm dev`도 같은 supervisor를 쓰고, gateway가 Vite를 프록시해 쿠키·CSRF가 개발과 운영에서 똑같이 동작한다(§4.1, §12.1). B는 dev에서 5173 origin을 따로 허용해 경로가 갈라진다; supervisor는 약 300 LoC이고 DB·HTTP가 없다. fork+IPC로 Windows SIGTERM 부재(SP-4 §5.5-6)를 우회하고, 토큰은 env·디스크 없이 전달한다(NFR-SEC-003 문언 충족). IPC가 끊기면 자식이 db.close() 후 종료해 고아 프로세스가 남지 않는다(§4.1~4.2); 재시작·격하 표(§4.4)가 서비스별로 구체적이다: 250ms→1s→2s 백오프, 60s 안 3회 초과 시 degraded + doctor, ai-gateway 다운이면 300ms circuit으로 OFFLINE 간주; epoch 백업에서 ops는 다른 서비스 DB를 열지 않는다(NFR-MAINT-002). 각 서비스가 VACUUM INTO + integrity_check(worker)로 자기 DB만 스냅샷하고, 매니페스트에 outboxSeq·inboxWatermark·schemaVersion을 담는다. 복원은 서비스별 restore 모드 → 리플레이 해시 확인. 일 증분으로 RPO ≤ 26h(§5.5); 관측성이 운영 중심이다: supervisor가 로그 수집·회전(14일)하고 live tail 링을 둔다. 헬스 보드에 outbox 적체 나이·러너 큐를 보여 주고, 로컬 SLO 위반 시 배너를 띄운다. monitorEventLoopDelay p99<50ms를 계약 테스트로 건다(RA-A2); 장기 운용 FMEA를 갖췄다: 디스크 부족, 동기화 폴더, Node 22 EOL(2027-04-30 전 Node 24 검증), node:sqlite 네이티브 크래시(F-16, SP-4 R-3), 포트 점유와 PWA 재설치; 설치 마찰이 작다: 네이티브·Python·브로커 0, 포터블 번들(Node 동봉), 3 OS 자동 기동(LaunchAgent/schtasks/systemd --user), `%LOCALAPPDATA%` CR(SP-4 권고). 병합으로 약 60MB를 절감하고 프로세스는 5개다; 카오스 테스트(§16)가 5개 서비스를 각각 kill한다. SP-2 권고대로 Linux RSS 감시를 25ms로 둔다
- 약점: 병합 content의 장애 반경: content가 죽으면 채점이 멈춘다. learning 재시도(3회·6s)가 끝난 뒤의 경로가 '채점 대기 큐 표시'로만 적혀 있어 모호하다. B의 web IndexedDB attempt 큐 같은 클라이언트 측 보존이 없다; 앱 업그레이드 절차가 얇다: '마이그레이션 드라이런 조율' 한 줄뿐이다. 업그레이드 전 자동 epoch, 서비스 간 스키마·계약 버전 핸드셰이크, 롤백(이전 번들 + epoch 복원)이 명시되지 않았다; 원장 이벤트 schema_version 진화(upcaster)가 없다. 15년 수명에서 필요한 장치다(B에만 있음); 독 이벤트(dead-letter) 처리가 없다. relay 백오프만으로는 영구 실패 이벤트가 적체로만 보인다; Windows RSS 감시가 `tasklist`를 100ms마다 spawn하는 방식이다. 프로세스 생성 비용이 Windows에서 커서 감시 자체가 자원을 먹고 주기를 지키기 어렵다; 내부 포트를 OS 할당으로 기본 설정해 디버깅 마찰이 있다(RA-A5를 스스로 인정). `--fixed-ports`가 옵션에 그친다; 배치 AI 생성(T3/T4, 재게이트)을 content 프로세스 안에서 돌려 배치 OOM·GC 정지가 채점 경로에 닿을 수 있다. 분리 트리거만 있고 v1 격리 수단이 없다

**B-domain-first — 6.5**
- 강점: D-9 내성이 가장 강하다: 자급형 Item 스냅샷과 curriculum_ref 사본 덕분에 content가 다운돼도 세션·채점이 계속된다(F-02). web IndexedDB attempt 큐로 assessment·learning 재기동 중에도 응답이 유실되지 않는다(§5.1); 관측성: correlation_id로 attempt→verdict→ledger→mastery 체인을 조회하는 '이벤트 타임라인', feed 지연 게이지, inbox_dead 목록(§14); 독 이벤트를 inbox_dead로 격리하고 배너를 띄운다. 원장 경로만은 정지 + 경보로 처리해 증거 유실이 없다(§4.7); 원장 이벤트 upcaster 체인과 골든 원장 fixture로 15년 스키마 진화에 대비한다(§4.5); insight.db는 재구성 가능한 읽기 모델로 백업에서 뺀다. epoch 백업 중 한 서비스라도 2s 안에 quiesce하지 못하면 epoch를 중단하는 규칙이 명확하다(§7.4); 팩 활성화를 blue/green으로 해 부분 실패 시 포인터를 전환하지 않는다(F-10); ops 워커와 supervisor를 분리해 ops가 kill돼도 학습이 계속된다
- 약점: 움직이는 부품이 가장 많다: 상주 프로세스 7개(supervisor + 6), DB 파일 6개, 통합 이벤트 38종, long-poll 연결 약 12개. 1인 운영자의 인지·자원 부담이 크고 RSS 추정도 없다; 내부 토큰을 spawn env로 전달한다(§13). NFR-SEC-003 '메모리 보관'과 긴장 관계이고, 같은 사용자 권한이면 /proc/<pid>/environ으로 읽을 수 있으며 자식에게 상속될 위험이 있다; 종료 절차가 SIGTERM에 의존한다(§12.1). SP-4 §5.5-6에 따르면 Windows에는 우아한 SIGTERM이 없다; Windows 데이터 경로가 `%APPDATA%`다(§7.1). SP-4가 경고한 로밍 프로필·OneDrive WAL 위험을 무시했다; dev에서 브라우저 origin이 5173이고 gateway가 이를 허용한다. 개발과 운영의 쿠키·CSRF 경로가 갈라진다; 팩 업그레이드가 ops 사가 + content·assessment 2단 활성화라 업그레이드 실패 모드가 늘어난다. 참조 사본 불일치(R-B02)에는 resync 운영 절차가 필요하다; AQ-07에서 uv-python을 선택지로 허용해 설치 마찰 여지를 남겼다. Windows RSS 감시는 PowerShell 100ms 방식이라 실현성이 약하다

**C-ai-content-extensibility-first — 6**
- 강점: 운영 비용을 수치로 적었다: 상주 5개, 유휴 RSS 약 300~380MB, 콜드 기동 3~5s, 15년 디스크 추정(§13.1). 확장 장치마다 u와 cut 순서를 매겼다; forge를 온디맨드 프로세스로 분리해 배치 AI OOM·크래시가 대화형 채점 경로와 격리된다(FM-02). Safe Mode = ai-gateway·forge 미기동으로 정의가 깔끔하다; 토큰은 IPC 부트스트랩 봉투로 전달하고, dev에서도 gateway가 Vite를 프록시해 origin이 4747 하나다. `%LOCALAPPDATA%` CR을 냈다; ai-cache.db를 분리해 백업에서 빼서 백업 크기를 줄였다. epoch 매니페스트에 정책·프롬프트 lock 해시를 기록한다; '로그만 있고 UI 없음' 경로를 막는 `tests/contract/degradation-visible` 계약 테스트. 부트스트랩 토큰을 URL fragment로 넘겨 로그·Referer에 남지 않는다; registry.lock 불일치 시 해당 과업만 비활성화하고 doctor로 알린다(FM-18). 실패가 시끄럽게 드러난다
- 약점: forge가 비상주일 때 ops가 forge.db를 직접 읽기 전용으로 열어 스냅샷한다(§4.5-4). NFR-MAINT-002(타 서비스 DB 경로 오픈 0)를 위반하고, 백업 중 forge가 기동되면 경합이 생긴다; Linux RSS 감시를 50ms로 잡아 SP-2 권고(25ms, 100ms에서 381MB 오버슈트)보다 느슨하다. Windows `Get-Process` 50ms는 PowerShell spawn 비용 때문에 사실상 실현할 수 없다; 온디맨드 수명주기(기동 조건·10분 유휴 종료·배치 창)와 2단 큐(pipeline_run↔ai_job), 작업 주문·예약 상태가 운영 상태기계를 늘린다. forge.db·ai.db 사이의 불일치 위험을 스스로 인정했다(RK-C02); AQ-03에서 발화 렌더를 gateway→ai-gateway 스트림으로 둬 BFF가 AI 경로에 들어간다. gateway 장애 반경이 커진다; content가 다운되면 채점이 멈추는 점은 A와 같다(FM-03). 클라이언트 측 attempt 보존이 없다; AQ-10에서 ext 키를 STORED 생성열로 승격한다. SQLite `ALTER TABLE ADD COLUMN`은 STORED 생성열을 추가할 수 없어 테이블 재작성 마이그레이션이 필요하므로 수년간 업그레이드 비용이 커진다; 사용자 팩 git·packc 워크플로와 프롬프트 레지스트리는 1인 운영에서 확장성 가치에 비해 운영 표면을 늘린다. 업그레이드·롤백 절차는 A와 마찬가지로 부재하다

### Graft 권고
- [B→A] web IndexedDB attempt 큐(`apps/web/src/lib/attempt-queue.ts`): 제출 응답을 같은 Idempotency-Key로 보존하고, learning·content 재기동 후 자동 재전송한다. 병합 content의 장애 반경을 D-9 수준으로 완화한다
- [B→A] 독 이벤트 처리: 모든 서비스 DB에 `inbox_dead(event_id, source, error, failed_at)`를 둔다. 3회 실패하면 격리 + `ops.health.changed` 배너를 띄운다. 단 learning 원장 경로는 격리하지 않고 relay 정지 + 경보로 처리한다
- [B→A] 운영 콘솔 '이벤트 타임라인': causation_id·correlation_id(=attempt_id)로 attempt→grade→ledger→mastery 체인을 조회한다. 목적지별 outbox 적체와 함께 표시한다
- [B→A] 원장 이벤트 `schema_version` + 순수 함수 upcaster 체인(`services/learning/src/domain/ledger/upcasters/`)과 골든 원장 fixture 회귀 테스트(15년 스키마 진화)
- [B→A] epoch 중단 규칙을 명문화한다: 한 서비스라도 2s 안에 quiesce·snapshot에 실패하면 epoch 전체를 중단하고 resume한 뒤 다음 주기에 재시도한다. 부분 매니페스트는 절대 기록하지 않는다
- [C→A] 배치 AI 작업(T3/T4 생성·재게이트·캘리브레이션) 격리: 별도 서비스(forge)를 만들지 않고 content가 띄우는 단명 자식 프로세스(`--max-old-space-size` 상한)에서 실행한다. 미승인 초안은 `as_staging_*` 테이블에만 두고, 출제 쿼리는 gate_status 조건으로 이중 방어한다
- [C→A] ai-cache를 `ai-cache.db`로 분리하고 백업에서 제외한다(재생성 가능)
- [C→A] `tests/contract/degradation-visible`: 모든 강등·보류·적체 경로가 SSE/배너 이벤트를 내는지 검사한다(NFR-AVL-005)
- [C→A] 1회용 부트스트랩 토큰을 쿼리 문자열이 아니라 URL fragment(`#bt=`)로 전달한다(로그·Referer 미기록)
- [C→A] 자원 예산표를 Tripwire로 만든다: 유휴 RSS 합계 ≤ 400MB, 콜드 기동 ≤ 10s(목표 3~5s), 15년 디스크 추정. ops가 `op_health_sample`로 감시한다
- [신규] `fathom upgrade` 절차: ① 업그레이드 전 자동 epoch ② 서비스별 단명 `migrate` 모드(서빙 프로세스 밖, 먼저 스냅샷 사본에서 dry-run) ③ supervisor가 부트스트랩 시 contracts·스키마 버전 핸드셰이크를 해서 혼합 버전 기동을 거부 ④ 롤백 = 직전 번들(`FATHOM_HOME/app/<ver>/` 2세대 보관) + 직전 epoch 복원
- [신규] Windows RSS 감시: 100ms마다 tasklist를 spawn하지 않고, 장기 실행 헬퍼 1개(PowerShell 루프가 stdin으로 pid 목록을 받아 WorkingSet을 CSV로 스트리밍)를 둔다. V-live에서 주기를 보정한다
- [신규] 로그 보관에 크기 상한을 추가한다(서비스당 ≤ 50MB, 14일과 함께 먼저 도달하는 쪽 적용). 디스크 부족 시 로그·ai-cache를 먼저 정리한다
- [A 자체 조정] 내부 포트 기본값을 선호 고정(4761~4764, `--fixed-ports`를 기본으로)으로 바꾸고, 충돌 시에만 OS 할당 + registry를 쓴다. 수년간 디버깅 마찰을 줄인다(RA-A5)

### AQ 입장
- AQ-01: A안 채택. content+assessment를 병합하고 forge 신설은 기각한다. 배치 격리는 content의 단명 자식 프로세스로 흡수한다. B식 분리가 주는 D-9 이득은 web attempt 큐와 세션 prefetch로 대부분 확보한다. 재분리는 A의 트리거 3개로 판단한다
- AQ-02: A·C의 push relay(정적 구독 표, 목적지별 FIFO)를 채택하고 B의 feed long-poll은 기각한다(연결 약 12개와 커서 관리 부담). 대신 B의 inbox_dead와 매니페스트의 outboxSeq·inbox watermark 기록을 채택한다
- AQ-03: A·B 채택. 대화 상태·재개 = learning, 턴 판정·루브릭·발화 렌더 = content[assess]가 ai-gateway를 호출한다. C처럼 gateway가 ai-gateway를 스트림 호출하는 방식은 BFF를 AI 경로에 넣어 장애 반경을 키우므로 기각한다
- AQ-04: 세 안 모두 HttpOnly·SameSite=Strict 쿠키 + CSRF 헤더로 같다. 부트스트랩 토큰 전달만 C의 URL fragment 방식을 채택한다
- AQ-06: DEK/KEK 2층 구조는 공통이다. scrypt 파라미터는 A·C의 N=2^17을 채택하고 B의 2^15는 기각한다
- AQ-07: A 채택(WASM 우선 → 순수 TS 포트, 런타임 Python 0). B의 uv-python 선택지는 설치 마찰 때문에 기각한다. C처럼 forge에 둘 필요 없이 learning의 worker_thread에서 실행한다
- AQ-08: gateway는 4747로 합의되어 있다. 내부 포트는 선호 고정 4761~4764 + 충돌 시 OS 할당 + `run/registry.json`을 채택한다(A의 기본 동적 할당보다 디버깅이 쉽다). 토큰 전달은 A·C의 IPC 부트스트랩을 채택하고 B의 env 방식은 기각한다
- AQ-09: 요청당 spawn + 세마포어 min(3, cores−1)은 공통이다. RSS 감시 주기는 A·B의 Linux 25ms를 채택하고 C의 50ms는 SP-2 권고 위반이라 기각한다. Windows는 장기 실행 헬퍼 방식으로 바꾼다
- AQ-10: A 채택. 승격은 VIRTUAL 생성열 + 인덱스로 한다. C의 STORED는 SQLite ALTER TABLE ADD COLUMN으로 추가할 수 없어 테이블 재작성 마이그레이션이 필요하므로 기각한다
- AQ-11: A·B 채택(정책마다 소유 서비스가 로드·검증). C의 '무소유 배포'는 해시 불일치 시 기동 거부 책임이 흩어지므로 기각한다
- AQ-14: 세 안 모두 컴파일러 API 비의존으로 같다. 도구 전용 TypeScript는 5.9로 pin한다(B의 6.x는 기각)
- AQ-17: B·C의 연산 수 계측을 1순위로 하고, 불가할 때 A의 한 러너 호출 내부 process.cpuUsage() 중앙값 log-log 기울기를 2순위로 쓴다
- CR(데이터 경로): A·C의 Windows `%LOCALAPPDATA%\fathom`을 채택하고 B의 `%APPDATA%`는 기각한다. SP-4 §5.5-1 근거로 NFR-PORT-005 CR을 올린다
- 종료 절차: A·C의 IPC 메시지 종료를 채택하고 B의 SIGTERM 의존은 기각한다(Windows)

## 심사: requirements-fit (winner: C-ai-content-extensibility-first)

### 근거
요구 적합성 렌즈에서 C가 가장 많은 핵심 요구를 구조적으로 충족한다.
- UR-13: 단일 수입 포트와 forge.db 물리 격리로 D-6(게이트 없는 AI 문항 0)이 쿼리 조건이 아니라 구조로 보장된다. 게이트 mutant, prompt 계보, 패밀리 일괄 격리로 품질을 V-build에서 증명할 수 있다.
- UR-15/16: FirewalledPayload 타입, 데이터 등급 C0~C3, 작업 주문 PEP, Jev 객체 키 규칙이 있다.
- §5.6: 서비스별 강등 행렬을 제시한다.
- §5.7-6: modes.manifest.json·verification-class.json 초안을 둔다.
- UR-08: serve/produce 분할이 배치 AI 격리라는 실질적 이유를 가진다.

C의 결함은 모두 국소적이라 graft로 고칠 수 있다. ops의 forge.db 직접 스냅샷(NFR-MAINT-002 위반), RSS 50ms(SP-2 이탈), gateway의 발화 렌더, +7.5u 용량 부담이 그것이다.

A는 운영성, DoD D-2/D-3, 동결 조건 검증성이 가장 좋다. 하지만 병합된 content에 배치 생성과 대화형 채점이 동거하고, UR-13·UR-15 품질 장치가 얕아 2위다.

B는 UR-08과 D-9를 가장 잘 충족하고 이벤트 동결 상세도 가장 우수하다. 그러나 배관 비용(38 이벤트, 참조 사본, 교차 서비스 팩 saga)이 1인 용량에 부담이다. 또 FR-LAB-017 위반(uv-python), manifest 초안 누락, %APPDATA% 유지 같은 명시적 기준선 이탈이 있다. 그래서 B는 구조가 아니라 계약 상세(envelope, upcaster, 증거 보정 choreography, 자급형 Item)의 공급원으로 쓰는 것이 맞다.

SP-6(현재 존재)은 F1·F3·F4 정책 수정 없이는 FAIL이다. 세 제안 모두 파라미터 수준 반응을 주장하지만, F4는 learning 투영에 θ_q 추가가 필요하므로 graft로 명시했다.

### 점수별 강점/약점

**A-operability-first — 7.4**
- 강점: UR-08/CON-004 준수: 6서비스·상주 5프로세스, 경계 강제를 문서가 아니라 런타임 규칙으로 만듦. 호출자별 내부 토큰을 IPC 부트스트랩 봉투로만 전달(NFR-SEC-003 '디스크·로그 0'을 가장 강하게 충족)하고 allowCallers ACL로 context map 외 호출은 401; §5.7 ARC 동결 조건을 가장 기계적으로 검증 가능: check:ledger-writer 단일 writer 정적 검사, SP-3 §6.8 replay 입력을 contracts/learning/event.v1.ts 필수 필드로 동결, epoch 백업에서 각 서비스가 자기 DB만 VACUUM INTO(ops는 타 DB를 열지 않음, NFR-MAINT-002); DoD D-2(설치→첫 세션 ≤3분)와 D-3(p95 ≤2s)에 가장 유리: 네이티브·Python·브로커 0, 2홉 경로, 세션 prefetch, dev=prod 동일 supervisor·origin(OP-10); SP-2·SP-4를 정확히 반영: RSS 감시 Linux 25ms, prlimit은 Linux만, PRAGMA 7종 허용, %LOCALAPPDATA% 이전. CR 6건을 명시(CR-A1~A6); AQ-01~17 전부 답변. content 재분리 트리거 3개(ADR 조건)로 병합을 되돌릴 수 있게 함. modes.manifest.json을 learning·web·E2E가 공유
- 약점: UR-13 품질 공학이 얕음: prompt 버전 계보, prompt_version 단위 패밀리 일괄 격리, V-build용 gate mutant 평가, 작업 주문(FR-AI-025/026 집행 단일 지점) 설계가 없고, 대량 승인은 모달 수준에 그침; 병합된 content가 catalog·import I1~I9·T3/T4 생성 조율·gate·grading·runner를 모두 호스팅. 배치 AI 파이프라인이 대화형 채점 프로세스와 같은 프로세스에 있어 NFR-PERF-003(300ms)·장애 반경 위험이 큼(worker 분리는 pack-loader와 replay에만 해당); 통합 이벤트 12종은 너무 적음: work-order 승인·overlay 충돌·item quarantine의 증거 정책 이벤트가 없어 IF-01 계약 동결(§5.7-3/4)에 보강이 필요; D-6 보장이 출제 쿼리 조건(gate_status IN …)뿐이고, 미승인 초안과 서비스 카탈로그가 같은 DB에 있음; UR-15/16 방화벽이 타입 수준에서 강제되지 않음(데이터 등급과 FirewalledPayload 같은 장치가 없음)

**B-domain-first — 6.9**
- 강점: UR-08 분할의 의미가 가장 강함: 자급형 계측기(Item이 KU·misconception 스냅샷을 내장)와 curriculum_ref 사본 덕에 content가 죽어도 세션·채점이 계속됨. D-9와 NFR-AVL-002를 최소 기준 이상으로 충족; §5.7-3 이벤트 envelope 상세가 가장 동결에 가까움: 통합 envelope(producer_seq·correlation·causation), 원장 16종, upcaster 체인, 소비자 주도 이벤트 계약, verdict:<id> 멱등 키로 동기 경로와 feed 경로가 한 점에서 수렴; 사다리 소유권을 명확히 함: D/H/S 엔진을 assessment에 두어 ai-gateway가 죽어도 사다리 하단이 살아 있고, learning은 AI를 직접 호출하지 않음. gate_status 상태기계와 KU 개정→재게이트→evidence.voided/weight_adjusted choreography가 UR-13 게이트를 증거 보정까지 연결; UR-14: Conversation aggregate, PromotionExam process manager, Case가 4개 BC를 거치는 생애 흐름이 명확함. Insight만 CQRS(insight.db, 재구성 가능, 백업 제외)로 두어 과잉 설계를 피함; FR 그룹마다 R0~R3 첫 slice가 있어 2단 동결(NFR-MAINT-006)에 직접 연결됨
- 약점: 배관 비용이 가장 큼: 통합 이벤트 38종, 서비스 2곳의 참조 사본, content와 assessment에 걸친 PackActivation blue/green saga, BC별로 나뉜 overlay 소유권. 1인 개발 용량(보장 코어 103u)에서 분산 결합 위험이 있고, 저자도 +1~2u라고 인정; AQ-07의 선택적 uv-python 경로가 FR-LAB-017 '[T] 런타임 Python 프로세스 생성 0'과 DEF-31에 정면으로 충돌; §5.7-6의 modes.manifest.json·verification-class.json 초안이 언급되지 않음. Windows는 %APPDATA%를 유지(SP-4 권고 미반영); 내부 토큰을 spawn env로 전달(IPC보다 약함). dev에서 브라우저가 5173을 쓰고 Origin 5173을 허용해 dev와 prod 경로가 갈라짐; learning이 BC 4개를 가진 god service가 될 위험(R-B01). outbox-as-feed long-poll이 생산자×소비자 약 12개 연결을 만듦. UR-15 쪽의 쿼터·작업 주문·방화벽을 타입으로 강제하는 장치가 없음

**C-ai-content-extensibility-first — 7.8**
- 강점: UR-13·D-6이 구조적으로 보장됨: 카탈로그를 바꾸는 경로는 .fpack·PackDelta·overlay 셋뿐이고, 미승인 초안은 물리적으로 forge.db에만 있음. packc가 V1~V9, 3단 KPI·cap(FR-CUR-025/026), Depth Map 좌표를 사전 계산; UR-13 품질을 키 없는 V-build에서도 증명 가능: E1 결정적 gate mutant 재현율, prompt registry lock·activation, prompt_version 단위 패밀리 일괄 격리, V-build와 V-live를 정직하게 분리(EX-9); UR-15/16 fit이 가장 강함: FirewalledPayload 브랜드 타입(방화벽 우회 경로를 타입으로 차단), 데이터 등급 C0~C3, generic-cli trust에 따른 C0 제한, 작업 주문·예약으로 ai-gateway를 FR-AI-025/026의 단일 PEP로 만듦, Jev 객체 키 규칙 6개와 model_drift→calibrate 연결(D-14); §7.7에서 FULL/JUDGE_ONLY/LLM_ONLY/OFFLINE × 서비스별 동작 행렬이 가장 명확함. forge는 awaiting_provider로 파킹되어 OFFLINE에서도 코어는 무영향; UR-08 분할이 의미 있음: serve와 produce를 분리해 배치 AI의 크래시·GC·쿼터 소진이 대화형 경로에 닿지 않음. forge는 온디맨드라 상주 비용이 0에 가까움. modes.manifest.json·verification-class.json을 루트에 둠(§5.7-6). %LOCALAPPDATA% CR 반영
- 약점: NFR-MAINT-002 위반: forge가 상주하지 않을 때 ops가 forge.db를 읽기 전용 연결로 스냅샷함(§4.5-4). 해당 서비스의 단명 snapshot/restore 모드로 고쳐야 함; SP-2 이탈: RSS 감시를 Linux 50ms로 둠(SP-2의 25ms 권고와 오버슈트 309MB 근거를 무시); AQ-03에서 발화 렌더를 gateway가 ai-gateway 스트림으로 호출하게 해 BFF에 도메인 역할이 섞임. learning·content·gateway에 걸친 3주체 대화 흐름; 용량 부담: 확장 장치로 약 +7.5u, 그중 2u는 보장 코어. 7서비스 상한과 PackDelta 계약이 늘고, forge→content(preview)·forge→ai-gateway 2홉. 온디맨드 기동이 epoch 백업(D-8)과 Tier C 60s 승격 체감을 복잡하게 함; fsrs-optimize가 forge에서 learning 리뷰 로그 스트림을 소비해 교차 서비스 데이터 흐름이 추가됨. 승인·리플레이 비교 소유권이 불명확

### Graft 권고
- [A→C] epoch 백업·복원은 반드시 소유 서비스가 자기 DB만 스냅샷한다. forge가 상주하지 않으면 supervisor가 forge를 `--snapshot` 단명 모드로 띄운다. ops는 타 DB를 열지 않는다(NFR-MAINT-002 정적 검사와 런타임 파일 핸들 검사). 복원은 각 서비스의 `restore` 단명 프로세스가 맡는다
- [A→C] 러너 RSS 감시는 SP-2 권고대로 Linux `/proc` 25ms, macOS `ps` 50ms, Windows 100ms(V-live 보정)로 한다. CR-A2를 그대로 채택
- [A→C] supervisor는 DB·HTTP가 없는 초소형 프로세스로 두고, ops-api(백업·doctor·Tripwire)는 별도 진입점으로 분리한다. IPC 끊김이면 자식이 스스로 종료(고아 0). dev=prod 동일 supervisor(OP-10)와 `check:ledger-writer` 정적 검사를 포함
- [A→C] CR 목록 CR-A1~A6(%LOCALAPPDATA%, RSS 주기, PRAGMA 7종, learning.db만 synchronous=FULL, fs read 문구, 예측 표시 범위)을 CR 로그로 옮긴다
- [B→C] 통합 이벤트 envelope(event_id·schema_version·producer·producer_seq·correlation_id·causation_id·traceparent)와 원장 이벤트 16종 + upcaster 체인을 IF-01 R0 상세로 동결한다. 소비자 주도 이벤트 계약(`contracts/events/__consumers__`)도 함께
- [B→C] 자급형 계측기: 발행된 Item이 KU·misconception 스냅샷과 content_hash를 내장한다. 병합된 content 안에서도 grading 모듈이 curriculum 모듈을 조회하지 않게 해 재분리 비용을 낮춘다
- [B→C] 증거 보정 choreography를 명시한다: content.item.quarantined{evidence_policy: void|halve|keep} → learning evidence.voided / evidence.weight_adjusted(새 이벤트, 원본 불변). 멱등 키는 `verdict:<id>` 하나로 두어 동기 경로와 backstop 경로를 한 점에서 수렴시킨다
- [B→C] 원장 경로의 독 이벤트는 격리하지 않고 정지 + 경보로 처리하고, 비원장 경로만 inbox_dead로 보낸다. epoch 매니페스트에 outbox_seq와 소비자 inbox watermark를 함께 기록한다
- [B→C] 대화 턴 판정과 발화 요청은 content(grading)가 ai-gateway에 요청하고, gateway는 스트림 중계만 한다(BFF의 도메인 로직 0). learning은 Conversation 상태·재개만 소유한다
- [B→C] Insight 읽기 모델은 재구성 가능한 별도 테이블 또는 DB로 두고 백업에서 제외한다. Learner Model은 인라인 투영(read-your-writes)
- [SP-6→all] mastery_rules@v1에 F1(empty_level skip), F3(d4.floor_mode min_with_possible), F4(elo.unqualified_ceiling 0)를 반영한다. F4에는 learning 투영에 θ_q(w_format≥0.7 ∧ w_grader≥0.6 이벤트로만 갱신)를 추가해야 한다. 콘텐츠 Brief 7건은 D-11 cap 표 입력으로 쓴다
- [A→C] 분리 재검토 트리거(검색 p95 >100ms 2주, 생성 배치의 채점 p95 침범, 릴리스 주기 분리)를 content 병합 ADR에 넣는다

### AQ 입장
- AQ-01: content+assessment 병합 + forge(온디맨드 생산 서비스) 신설(C). 내부 모듈 curriculum/itembank/grading/runner/ingest는 ports.ts 경유로만 연결하고, B의 자급형 Item 스냅샷과 A의 분리 재검토 트리거를 추가한다. B의 분리 유지는 38 이벤트, 참조 사본, 팩 saga 비용이 UR-08 이득보다 크므로 기각
- AQ-02: outbox → HTTP push relay → inbox dedupe(A·C). B의 long-poll feed는 기각하되 B의 envelope, producer_seq, epoch 매니페스트의 inbox watermark 기록은 채택. 채점은 동기 호출 + outbox backstop, 멱등 키 `verdict:<id>`
- AQ-03: 세션·대화 상태와 재개는 learning. 턴 판정·루브릭·다음 move(결정적 상태기계)와 발화 요청(AI-G07, OFFLINE이면 질문 은행)은 content.grading. gateway가 ai-gateway를 호출하는 C안은 기각
- AQ-04: HttpOnly·SameSite=Strict 쿠키 + X-Fathom-CSRF + Host 421/Origin 403. 부트스트랩 토큰은 query(?t=, A)가 아니라 URL fragment(#bt=, C)로 전달해 로그·Referer 누출을 막는다. 세션 값을 포트에 바인딩(B)
- AQ-06: 키체인 > secrets.enc(DEK/KEK 2층, scrypt N=2^17, B의 2^15는 기각) > env(경고). KEK 평문을 같은 디스크에 두지 않고, 백업 passphrase는 AI 키 KEK와 분리(A)
- AQ-07: 순수 TS optimizer를 기본으로 하고 WASM이 검증되면 교체(C·A). Python/uv 경로는 FR-LAB-017·DEF-31 위반이므로 기각(B). 결과는 policy.switched 제안 + 리플레이 비교 후 사용자 승인. 실행 위치는 learning replay worker를 권장(forge가 원장 스트림을 소비하는 교차 흐름 제거)
- AQ-08: gateway 4747(폴백 4748~4757 + 1회 안내). 내부는 선호값 4760~4764 + 동적 폴백 + run/registry.json(C). 완전 OS 할당(A)은 --fixed-ports 옵션으로만
- AQ-09: 요청당 spawn + 세마포어 min(3, cores−1). RSS 감시 Linux 25ms, macOS 50ms, Windows 100ms(A·B, SP-2). C의 50ms는 기각. prlimit은 Linux만, fs read는 가드 파일 + 요청별 tmp
- AQ-10: ext TEXT + ext_v. 조회용 키는 GENERATED VIRTUAL 열 + 색인(A)으로 승격해 STORED 저장 비용을 피한다. DR-020 이름 훅은 실제 열로 두고 lint:hooks로 검사
- AQ-11: 저장소 policy/<name>@vN.yaml + manifest(sha256). 소비 서비스가 직접 로드하고 해시를 검증한다(A·C). 초기값은 부록 A + SP-3 + SP-6 F1·F3·F4
- AQ-12: 18화면 유지. 블루프린트 커버리지는 Depth Map 레이어(A·C), 대량 승인은 SSE로 띄우는 전역 다이얼로그(C)
- AQ-14: AST 비의존 게이트(의존 그래프, import 정규식, Biome GritQL). 컴파일러 API가 필요하면 도구 전용 TS pin(기획 권고는 6.x, 5.9도 허용)
- AQ-17: 연산 수 계측(비교자·접근자 주입)을 1순위로 하고(B·C), 계측이 불가능하면 한 러너 호출 안에서 n·2n·4n·8n의 process.cpuUsage 중앙값으로 log-log 기울기를 판정(A)

## 심사: agent-buildability (winner: A-operability-first)

### 근거
A-operability-first를 기반안으로 권고합니다. 여기에 B의 도메인 골격과 C의 콘텐츠·AI 안전 장치를 옮겨 붙입니다. 세 기준 모두 차이가 작지 않아 점수는 A 8.1, B 7.7, C 6.4입니다.

**① AI 에이전트 병렬 원샷 빌드: A가 가장 강함**
- 서비스 골격이 `createService()` 하나라 에이전트가 복제할 템플릿이 하나입니다.
- 동결할 통합 이벤트가 12종뿐입니다. contracts 경로와 `allowedCallers` ACL도 코드로 정해져 있습니다.
- 개발과 운영이 같은 supervisor 경로를 씁니다.
- 게이트가 결정적입니다. `check-boundaries`, `check-ledger-writer`, 실제 supervisor를 띄우는 spawn-stack, chaos 테스트가 있고 TS 컴파일러 API에 의존하지 않습니다.
- 보장 코어 103u 대비 plumbing이 가장 적습니다.

B는 계약 완결성이 최고입니다(이벤트 38종 + 원장 16종, 소비자 주도 계약). 대신 참조 사본 2벌, 3서비스에 걸친 PackActivation 사가, long-poll feed 약 12개 때문에 통합 부담이 가장 큽니다. C는 forge 신설과 +7.5u, 2단 큐, 온디맨드 수명주기 때문에 결정적 통합 테스트가 가장 어렵습니다.

**② 아키텍처 역전 없는 진화(UR-05)**
- B가 개념적으로 가장 좋습니다. BC·upcaster가 있고, 분리 상태에서 '배포 병합'으로 줄이는 쪽이라 되돌리기가 쌉니다.
- A는 서비스가 6개라 ≤7 상한까지 1슬롯이 남습니다. 분리 트리거와 포트, 테이블 접두어도 미리 정해 두어 분리 비용이 제한적입니다.
- C는 7슬롯을 다 써서 grading 재분리가 CON-004 위반이 됩니다. 구조적 막다른 길입니다. 반면 AI·프롬프트·팩 축의 변경 용이성은 C가 최고라서 그 장치를 graft로 가져옵니다.

**③ graphify 친화성(UR-09)**
- B가 최고입니다. BC 폴더, BC 간 import 금지, `tools/graph`가 god-nodes를 감시합니다.
- A는 graphify를 2차 확인에만 씁니다.
- C는 설정 파일에 흩어진 동작 때문에 코드 그래프에 보이지 않는 엣지가 많습니다.

**결함 검증(원문 대조)**
- A: learning이 커리큘럼 그래프를 얻는 방법이 없습니다. D-4·D-9가 prefetch에만 기댑니다. B의 `curriculum_ref`로 해소합니다.
- B: 토큰을 env로 전달하고, 개발 모드 origin이 운영과 갈라지며, `%APPDATA%`를 그대로 씁니다.
- C: ops가 `forge.db`를 직접 열어 NFR-MAINT-002를 위반합니다. RSS 감시 50ms는 SP-2 권고 25ms와 어긋나고, BFF에 AI 발화 렌더를 둡니다.

**스파이크 반영**
- SP-6(현재 존재): 정책 수정 F1·F3·F4, 콘텐츠 Brief, 추측 보정 Elo 필수화를 적용하면 PASS입니다. 세 제안 모두 이를 정책 파일 값만으로 흡수합니다. 따라서 구조 판정에는 영향이 없고, AQ-11에 반영합니다.
- SP-7 보고서는 아직 없습니다. 세 제안의 AQ-14 대응이 모두 컴파일러 API에 의존하지 않으므로 판정을 바꾸지 않습니다.

**최종 권고**
- 기반은 A입니다(content 병합, 서비스 6개, 한 origin, IPC 토큰).
- B에서 가져올 것: 전달 방식(outbox-as-feed pull), envelope, 소비자 주도 계약, BC 폴더와 graphify 게이트, `curriculum_ref`, `verdict:<id>` 멱등 키, upcaster.
- C에서 가져올 것: `packc`/`.fpack`, 단일 수입 포트(content 내부 staging), `FirewalledPayload`, 프롬프트 lock, E1 뮤턴트.

참조 파일:
- `/home/user/study_develop_ai/docs/02-design/proposals/A-operability-first.md`
- `/home/user/study_develop_ai/docs/02-design/proposals/B-domain-first.md`
- `/home/user/study_develop_ai/docs/02-design/proposals/C-ai-content-extensibility-first.md`
- `/home/user/study_develop_ai/docs/02-design/spikes/SP-6.md`

### 점수별 강점/약점

**A-operability-first — 8.1**
- 강점: 원샷 병렬 빌드에 가장 유리: 상주 프로세스 5개, 모든 서비스가 shared-kernel `createService()` 골격 하나로 부팅한다(OP-5, §13.1). 에이전트가 복제할 템플릿이 하나라 cross-cutting 변경이 적다.; contracts-as-code 경로가 구체적이다: `packages/contracts/src/{http/<svc>/v1, events, events/subscriptions.ts, learning/event.v1.ts, ai/judge.ts, admin/v1.ts}`. 라우트별 `allowedCallers` ACL도 계약에 넣고 계약 테스트로 검사한다(§3, §10.3, §16).; 통합 이벤트가 12종뿐이라 INT-1a에 동결할 계약 표면이 작고, 2단 동결(FE-11)과도 맞는다(§5.3).; 결정적 게이트가 구체적이다: `check-boundaries`(pnpm strict + package.json ⊆ 허용표 + 정규식 스캐너), `check-ledger-writer`, `lint-hooks`, `lint-jev-keys`. `testkit/spawn-stack.ts`가 실제 supervisor를 띄우는 통합 테스트와 chaos 테스트(content kill 포함)도 있다(§13.2, §16). TS 컴파일러 API에 의존하지 않아 SP-7 결과가 어떻든 영향이 작다.; 개발과 운영이 같은 경로다(OP-10): 같은 supervisor, gateway가 Vite를 프록시해 origin 4747 하나를 쓴다. 쿠키·CSRF 동작이 개발에서도 똑같아 늦게 터지는 결함이 줄어든다.; SP-2(RSS 감시 25ms)·SP-3·SP-4를 가장 충실하게 반영했다. 내부 토큰은 IPC 봉투로만 전달한다(env·디스크 0). `%LOCALAPPDATA%` CR을 포함해 CR 6건이 실측에 근거한다.; 서비스 6개라 ≤7 상한까지 1슬롯이 남는다. 나중에 분리해도 CON-004를 위반하지 않으므로 UR-05 관점의 진화 여유가 있다. 분리 재검토 트리거 3개와 모듈 포트(`CatalogReader`), 테이블 접두어 `ct_`/`as_`도 미리 정해 두었다.
- 약점: 병합한 `content`(catalog + assess + runner + import + 팩 적재)가 파일 소유 핫스팟이다. `services/content/migrations/` 하나를 두 모듈 에이전트가 같이 건드리게 되어 병렬 작업 시 충돌 위험이 있다(모듈별 마이그레이션 디렉터리가 없다).; learning이 Keystone·선수 그래프·`required_for_level`·cap을 어디서 얻는지 명시하지 않았다. content에 동기 조회하면 D-4(content DB를 지운 뒤 원장만으로 리플레이 = 라이브)와 D-9(content 장애 중 학습 지속)가 prefetch에만 기대게 된다. 설계 공백이다.; intra-service 모듈 경계가 `modules/{catalog,assess}` 2개뿐이다. graphify 활용도 'INT 스냅샷 2차 확인'에 그쳐 UR-09 활용이 얕다. BC 단위 클러스터·god-node 감시가 없다.; push relay의 정적 구독 표 `events/subscriptions.ts`가 중앙 파일이다. 소비자를 추가할 때마다 생산자 쪽 계약 파일을 고쳐야 하므로 병렬 에이전트의 머지 핫스팟이 된다.; 이벤트 envelope(`schema_version`·`producer_seq`·`correlation_id`)와 원장 upcaster 전략이 B보다 덜 구체적이다. 15년 스키마 진화 경로가 약하다.

**B-domain-first — 7.7**
- 강점: UR-09에 가장 친화적이다: 서비스 내부를 `src/domain/<bc>/`로 나누고 `domain/<bcA> ↛ domain/<bcB>` 규칙을 둔다. `tools/graph`(graphify 래퍼)가 서비스 경계 엣지를 검사하고 god-nodes를 감시한다(§11, R-B01). 그래프 클러스터가 BC 11개와 1:1로 맞는다.; 병렬 에이전트용 계약이 가장 완결적이다: envelope 정의(`schema_version`, `producer_seq`, `correlation_id`, `causation_id`, `traceparent`), 통합 이벤트 38종의 payload 키 표, 원장 이벤트 16종, 소비자 주도 계약 `contracts/events/__consumers__/<svc>.json`, 가산 변경만 허용하는 `check:frozen`(§4, §15). 에이전트가 IF-01 없이도 바로 계약 코드를 쓸 수 있다.; outbox-as-feed(pull)에서는 생산자가 소비자를 모른다. 소비자를 추가해도 생산자 코드·계약이 바뀌지 않고, epoch 매니페스트에 `outbox_seq`와 `inbox_cursor`를 기록해 '유실 0·중복 0'을 증명할 수 있다(§4.7, §7.4).; 원장 자급성을 가장 설득력 있게 풀었다: Verdict가 리플레이 입력을 운반하고(§4.4), `verdict:<id>` 단일 멱등 키로 동기 경로와 폴백 경로가 한 점에 수렴한다. `curriculum_ref`로 learning은 content 없이 세션을 조립하고 승급을 판정한다. upcaster 체인·골든 원장·속성 기반 테스트도 있다(§4.5, §15).; UR-05 관점에서 되돌리기 방향이 싸다: 분리 상태를 유지하되 VC-1에서 plumbing 비용이 크면 '배포 병합'(BC·계약 불변, 코드 이동만)으로 줄일 수 있다(AQ-01).; H·S 채점 엔진을 assessment에 두고, 독 이벤트는 `inbox_dead`로 격리하되 원장 경로는 정지 + 경보한다. 실패 의미론이 명확하다.
- 약점: 원샷 용량 대비 plumbing이 가장 무겁다: 38종 이벤트, 참조 사본 2벌(learning·assessment의 `curriculum_ref`), resync API, ops가 조율하는 blue/green `PackActivation` 사가(content + assessment 3서비스 교차), long-poll feed 약 12개. 스스로 +1~2u라 밝혔는데, 보장 코어 103u 대비 통합 테스트 부담이 가장 크다.; `learning`이 Practice·Ledger·Learner Model·Insight 4개 BC를 가진 god service다. 병렬 에이전트의 파일 소유 핫스팟이 A의 content 못지않다.; 서비스 7개로 상한에 붙어 있다. 줄이는 방향만 싸고, 늘릴 여유는 없다.; 내부 토큰을 spawn env로 전달한다(A·C는 IPC 봉투).; 개발 모드는 브라우저가 Vite 5173 origin을 쓰고 gateway가 Origin 5173을 허용한다. 개발과 운영의 쿠키·CSRF 경로가 갈라진다.; supervisor 코드가 `apps/cli/src/supervisor`에 있어 ops 서비스와 소유가 어긋난다. `tools/* → services/*/src/domain` subpath import는 graphify의 교차 엣지 0 지표(NFR-MAINT-001 [A])와 충돌할 수 있다.; SP-4의 `%LOCALAPPDATA%` 권고를 반영하지 않았다(`%APPDATA%` 유지). Mermaid 8개는 렌더 검증을 하지 않았다.

**C-ai-content-extensibility-first — 6.4**
- 강점: content-as-code가 가장 성숙하다: `tools/packc`가 zod·lint·copy-guard·V4 실행 검증·Depth Map 레이아웃 사전 계산을 거쳐 `.fpack`(manifest·merkle root)을 만든다. content는 컴파일본만 설치하므로 원천 파싱 코드가 서비스에 없다(§6.2). 규칙별 음성 fixture로 결정적 게이트를 만들기 좋다.; 타입 수준 강제가 강하다: `FirewalledPayload` 브랜드 타입과 네트워크 계층 계수 테스트로 방화벽 우회 0을 V-build에서 증명한다(§7.2). 데이터 등급 C0~C3과 generic-cli `trust: unverified` 시 C0만 허용하는 규칙도 있다(§11.5).; 키 없는 빌드 환경에서도 참인 품질 증거가 있다: E1 게이트 뮤턴트 평가(V-build). 프롬프트 레지스트리 `registry.lock.json`과 계보의 `prompt_version`으로 패밀리 단위 일괄 격리가 가능하다(§7.3, §7.6). 15년 동안 AI·CLI가 계속 바뀌는 축(UR-12·15)에 대한 진화성이 가장 좋다.; 확장 장치마다 u·lite 사양·cut 순서를 적은 trade-off ledger가 있다(§13.2). UR-18 용량 관리에 쓸모가 있다. 단일 수입 포트(`.fpack`·PackDelta·오버레이)로 D-6을 구조적으로 보장한다.
- 약점: 기획 후보 서비스 집합 밖의 `forge`를 새로 만든다. 확장 장치로만 +7.5u가 늘어 원샷 완성(UR-18, GC 103u)과 긴장한다. 2단 큐(`pipeline_run` ↔ `ai_job`) 불일치 위험(RK-C02), 온디맨드 기동·종료 수명주기, forge→content(preview·G12)·forge→learning(리뷰 로그) 엣지가 늘어 결정적 통합 테스트가 가장 어렵다.; content + forge로 7슬롯을 다 쓴다. §2.3이 말하는 'grading+runner 재분리'는 CON-004(≤7)를 위반하므로 사실상 막혀 있다. UR-05 관점의 구조적 막다른 길이다.; NFR-MAINT-002 위반: forge가 상주하지 않을 때 ops가 `forge.db`를 직접 열어 스냅샷한다(§4.5-4).; AQ-03에서 발화 렌더(AI-G07)를 gateway가 ai-gateway에 직접 호출하게 했다. BFF에 도메인·AI 오케스트레이션이 들어간다.; SP-2 실측(25ms면 오버슈트 309MB, 100ms면 381MB)과 달리 RSS 감시 주기가 Linux 50ms다.; 동작이 `tasks.yaml`·`providers.yaml`·prompts 같은 설정에 흩어져 있어 graphify 코드 그래프에 보이지 않는 엣지가 많다. graphify 활용 설계도 doctor 감지 수준뿐이다(UR-09 가장 약함). 병합 content(curriculum·itembank·grading·runner·ingest)의 핫스팟 문제도 A와 같다.

### Graft 권고
- [B→A] learning.db에 `curriculum_ref` 사본 테이블을 추가한다(`content.pack.upgraded`·`content.concept.*` 이벤트로 갱신, `manifest_hash` 대조, `GET /internal/v1/curriculum/export?since=` 재구성). 이렇게 하면 Keystone·희소 레벨·cap·승급을 content 없이 계산할 수 있어 D-4·D-9를 prefetch에 의존하지 않고 보장한다. A의 가장 큰 공백을 메운다.
- [B→A] 통합 이벤트 envelope를 동결한다: `event_id`·`type`·`schema_version`·`producer`·`producer_seq`·`occurred_at`·`correlation_id`·`causation_id`·`traceparent`. 위치는 `packages/contracts/src/events/envelope.ts`.
- [B→A] 소비자 주도 이벤트 계약 `contracts/events/__consumers__/<svc>.json`과 `check:frozen`(가산만 허용, 파괴 변경은 ADR)을 넣고, A의 중앙 `subscriptions.ts`를 대체한다. 소비자를 추가해도 생산자 파일을 수정하지 않으므로 병렬 머지 충돌이 사라진다.
- [B→A] 서비스 내부를 BC 폴더로 나눈다: `services/<svc>/src/domain/<bc>/`, `domain/<bcA> ↛ domain/<bcB>`. content는 catalog·itembank·grading·runner·acquisition, learning은 practice·ledger·learner-model·insight다. `tools/graph`(graphify 래퍼)로 교차 서비스 엣지 0과 god-nodes 임계를 G2 게이트에 넣는다(UR-09).
- [B→A] 채점 멱등 키를 `verdict:<verdict_id>` 하나로 모아 동기 경로와 outbox 폴백이 한 점에서 수렴하게 한다. Verdict 필드 표(§4.4)는 `contracts/learning/event.v1.ts`의 필수 필드로 쓴다.
- [B→A] 원장 이벤트 16종 목록, `schema_version`별 upcaster 체인, 골든 원장 fixture, 속성 기반 테스트(병합 교환·멱등, 리플레이 = 라이브)를 V-build 게이트에 넣는다.
- [B→A] `inbox_dead` 독 이벤트를 격리한다. 원장 쓰기 경로에서는 격리 대신 정지 + 경보한다. web IndexedDB에 미전송 attempt 큐를 두고 같은 Idempotency-Key로 재시도한다.
- [B→A] 발행된 Item에 KU·오개념 스냅샷과 `content_hash`를 내장한다(자급형 계측기). 병합 서비스 안에서도 `assess → catalog` 런타임 의존을 줄여 이후 분리 비용을 낮춘다.
- [A 보강] content의 마이그레이션을 모듈별 디렉터리 `services/content/migrations/{catalog,assess}/`로 나누고 소유 에이전트를 정한다. 이 분리는 경계 lint로 검사한다.
- [C→A] `tools/packc` 팩 컴파일러를 도입한다: `.fpack`(manifest sha256 + merkle root), content는 컴파일본만 설치, Depth Map 레이아웃 사전 계산, lint 규칙별 음성 fixture.
- [C→A] 단일 수입 포트를 content 내부 규칙으로 가져온다: 카탈로그 변경은 `.fpack`·PackDelta·오버레이 세 경로뿐이고, 미승인 초안은 서빙 테이블과 분리된 `ct_staging_*`에만 둔다. 가져오기·생성 파이프라인은 content의 worker/단명 자식에서 SQLite 기반 pipeline-kit(lite, 선형 단계)으로 돌린다. forge 분리는 A의 분리 트리거에 추가해 ADR로 결정한다.
- [C→A] `FirewalledPayload` 브랜드 타입과 네트워크 계층 계수 테스트를 넣고, 데이터 등급 C0~C3을 두며, generic-cli `trust: unverified` 시 C0만 허용한다.
- [C→A] `ai/prompts/<task>/<semver>/` 프롬프트 레지스트리와 `registry.lock.json`(불일치 시 해당 과업 비활성)을 두고, 계보·캐시 키에 `prompt_version`을 넣는다. E1 게이트 뮤턴트 평가(`pnpm ai:eval:gates`)는 V-build 게이트로 쓴다.
- [C→A] 작업 주문·예약은 ai-gateway를 단일 PEP로 둔다. v1 lite는 승인 플래그만 둔다.
- [C→A] 부트스트랩 토큰을 쿼리 대신 URL fragment(`#bt=`)로 전달한다. 서버 로그·Referer에 남지 않는다.
- [C→A] 확장 장치 trade-off ledger(u·lite·cut 순서)를 ARC-01 부록으로 넣는다.
- [B→A] 쿠키 세션 값에 port를 바인딩하고 서버가 요청 포트와 대조한다. 쿠키는 포트로 격리되지 않기 때문이다.
- [A 보강] 내부 포트를 선호 고정값으로 기본화한다(ops-api 4761·content 4762·learning 4763·ai-gateway 4764). 동적 폴백과 `run/registry.json`은 유지한다. 테스트·k8s 매니페스트·graphify 문서가 결정적으로 된다.

### AQ 입장
- AQ-01: 병합(A)을 권고한다. 단 모듈을 BC 폴더(catalog·itembank·grading·runner·acquisition)로 나누고, 테이블 접두어와 모듈별 마이그레이션을 분리하며, Item 스냅샷을 내장한다(B graft). forge는 v1에서 신설하지 않는다(C 기각). 7번째 슬롯은 향후 분리 여유로 남긴다. 분리 트리거는 A의 3개에 '배치 파이프라인이 채점 p95를 침범'을 더한다.
- AQ-02: 전달은 B의 outbox-as-feed(pull, `GET /internal/v1/feed?after=seq` long-poll + 소비자 `inbox_cursor`·`inbox_seen`·`inbox_dead`)를 권고한다. 생산자 무수정 확장, epoch 커서 기록, 병렬 머지 충돌 제거 때문이다. 대화형 채점은 동기 호출 + 같은 멱등 키 폴백으로 한다(A·B·C 공통). 브라우저는 gateway SSE와 `resync`(A)를 쓴다.
- AQ-03: 세션·대화 상태와 재개는 learning, 턴 판정·루브릭·다음 move·발화 렌더(질문 은행/LLM)는 content의 grading 모듈이 맡는다(A·B). C의 'gateway가 AI-G07 직접 호출'은 BFF에 도메인이 들어가므로 기각한다.
- AQ-04: 세 제안 모두 HttpOnly·SameSite=Strict 쿠키다. 여기에 부트스트랩 fragment(C), 세션 값 port 바인딩(B), 같은 출처 GET으로만 얻는 CSRF(A)를 결합한다.
- AQ-05: 세 제안 공통(`--bare` 제외 플래그 조합, 격리 `CODEX_HOME`)에 C의 generic-cli unverified → C0 제한을 추가한다.
- AQ-06: 세 제안 공통(키체인 > DEK/KEK 암호 파일 > env). scrypt는 N=2^17(A·C)을 채택한다(B의 2^15 기각). 백업 암호 passphrase는 AI 키 KEK와 분리한다(A).
- AQ-07: `FsrsOptimizerPort` 기본은 `none`(v1 Should)으로 두고, 결정적 테스트가 가능한 순수 TS 구현을 우선한다. 결과는 빌드타임 Python 오라클과 대조한다(C). WASM은 검증되면 교체한다. B의 선택적 uv-python 런타임 경로는 기각한다(DEF-31·운영 부품).
- AQ-08: gateway는 4747(폴백 4748~4756 + 1회 안내)이다. 내부 포트는 A의 동적 할당 대신 선호 고정(4761~4764) + 동적 폴백 + registry로 한다.
- AQ-09: 요청당 spawn + 세마포어 min(3, cores−1), RSS 감시 Linux 25ms(A·B, SP-2 실측)로 한다. C의 50ms는 기각한다. prlimit은 Linux 전용, fs 읽기는 가드 파일 + 요청 tmp만 허용한다.
- AQ-10: `ext TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(ext))` + `ext_v`(`ext_schema_version`)를 둔다. 조회가 필요한 키는 VIRTUAL 생성열 + 인덱스로 승격한다(A, 재작성 비용 0). C의 STORED는 기각한다.
- AQ-11: 저장소 루트 `policy/<name>@v<k>.yaml` + lock/manifest(A·C, B의 `content/policy/` 위치는 기각)로 둔다. 소비 서비스가 로드하고 해시를 검증하며, 이벤트에 `policy_version`을 기록한다. SP-6 결과(F1·F3·F4, 추측 보정 Elo 필수 파라미터)는 `mastery_rules@v1` 값으로만 반영하며 구조 변경은 0이다.
- AQ-12·13·15·16: 세 제안이 사실상 같다. 18화면 유지, CNCF는 GitHub 판본 해시, Q-Net은 사용자 제공, PWA는 앱 셸만 캐시한다.
- AQ-14: TS 컴파일러 API에 의존하지 않는다: pnpm strict + package.json 허용표 + import 정규식 + Biome GritQL(A)에 graphify 엣지 교차 검사(B)를 더한다. 최후 수단은 도구 전용 TS pin이다(SP-7 미보고).
- AQ-17: 1순위는 비교자·접근자 주입에 의한 결정적 연산 수 계측과 log-log 기울기다(B·C). 계측할 수 없으면 한 러너 안에서 n·2n·4n·8n을 `process.cpuUsage`로 측정한 중앙값의 기울기를 쓴다(A). 임계는 목표 차수 + 0.35이고, O(n²)은 기울기 ≥ 1.7이면 거부한다.
- Windows 데이터 경로: `%LOCALAPPDATA%\fathom`으로 바꾸는 CR을 채택한다(A·C, B 기각). 내부 토큰은 IPC 봉투로 전달한다(A·C, B의 env는 기각). 개발 모드는 gateway가 Vite를 프록시하는 단일 origin(A·C)으로 한다. supervisor는 `services/ops`에 둔다(B의 `apps/cli` 위치는 기각).
