# ADR-015. 관측성 — 구조화 로그·요청 추적·로컬 메트릭·헬스 보드·이벤트 타임라인·자원 Tripwire·강등 가시성

- **상태**: Accepted · **일자**: 2026-10-01 · **결정자**: T1(아키텍처)
- **Trace**: UR-09·17, NFR-AVL-003·005·006·007·008, NFR-PERF-001~012, NFR-SEC-012, FR-SET-001·007·016, TW-01~13·GR-01~13, 심사 기록 graft(B 이벤트 타임라인·inbox_dead, C degradation-visible·자원 예산, 신규 로그 크기 상한), 감사(SP-2 플랫폼 게이트, SP-3 원장 무결성 경보, SP-4 크래시 후 무결성·doctor 경고)
- **관련**: ARC-01 §13, ADR-003·012·013

## 맥락 (Context)

- 1인 운영자에게 "조용한 실패"는 가장 비싼 장애다(NFR-AVL-005): 강등·보류·적체·격하는 60s 안에 화면에 보여야 한다. 요청 1건을 gateway → 하위 서비스까지 같은 ID로 조회할 수 있어야 한다(FR-SET-016). 텔레메트리는 로컬에만(NFR-AVL-008).
- OpenTelemetry SDK·Collector·UI를 상주시키는 것은 1인 로컬에 과하다. 하지만 k8s 학습 뷰에서 수집기를 붙여 보는 실습 여지는 남기고 싶다.
- 이벤트 기반 흐름(outbox·inbox)은 적체·독 이벤트가 로그에만 남기 쉽다. 15년 운용에서 로그·캐시가 디스크를 잠식할 수 있다.

## 결정 (Decision)

1. **로그**: 서비스는 stdout에 pino JSON만 쓴다(`@fathom/shared-kernel/log/log`). 필수 필드 `ts, level, svc, req_id, msg`(NFR-AVL-007), 선택 `event, dur_ms, err.code, trace_id, correlation_id, causation_id`. redact: API 키 패턴(`sk-ant-…`, `sk-…`, `AIza…`), `authorization`, `cookie`, `x-fathom-csrf`, 사내 패턴(`firewall_rules@v1` + 사용자 패턴), 학습자 원문 기본 제외(`log_content=false`). supervisor가 `logs/<svc>/YYYY-MM-DD.jsonl`에 기록, 일 회전, **14일 ∧ 서비스당 ≤ 50MB 중 먼저 도달 시 삭제**, 서비스별 메모리 링 5,000줄. 응답에는 스택·절대경로·SQL 0, `error_id`로 로그와 연결(NFR-SEC-012).
2. **추적(lite)**: gateway가 `x-request-id`(ULID)와 W3C `traceparent`를 만들고 모든 내부 HTTP·AI 호출·outbox envelope에 전파한다. 서비스마다 요청당 span 요약 1줄(`event: 'span', name, dur_ms, outcome`). OTel SDK·Collector 없음, 필드명은 OTel semantic convention과 호환(`trace_id`, `span_name`, `http.route` 등).
3. **메트릭**: `@fathom/shared-kernel/metrics/metrics`(의존성 없는 카운터·HDR 근사 히스토그램) → `GET /internal/v1/metrics`(Prometheus text). 필수 지표: `http_request_duration_ms{route,status}`, `first_item_latency_ms`, `grading_duration_ms{engine}`, `outbox_pending{dest}`, `outbox_oldest_age_ms{dest}`, `inbox_dead_total`, `inbox_halted{producer}`, `runner_queue_length`, `runner_peak_rss_mb`, `eventloop_delay_p99_ms`(`monitorEventLoopDelay`), `process_resident_memory_bytes`, `ai_calls_total{task,provider,outcome}`, `ai_cost_krw_total{billing}`, `sqlite_tx_duration_ms{db}`, `sqlite_busy_total{db}`·`sqlite_busy_snapshot_total{db}`(517 = 결함 신호, 0이어야 함), `job_duration_ms{job}`·`job_failures_total{job}`(단명 자식 job), `runner_platform_enabled`(0/1). ops-api가 15s마다 수집 → `op_health_sample`(1분 롤업, 30일) → Tripwire·SLO 계산.
4. **헬스**: `/healthz`(생존) · `/readyz`(DB 열림·스키마 일치·정책 로드·필수 peer) 200/503 규약(계약 테스트). supervisor 2s 폴링.
5. **헬스 보드**(ops-api `GET /internal/v1/health-board` → gateway `/api/v1/ops/health` + SSE `ops.health.changed` ≤ 5s): 서비스 상태·재시작 수·degraded 사유, AI 모드·제공자 상태, 백업 경과(RPO), 목적지별 outbox 적체(대기 수·가장 오래된 나이), `inbox_dead` 수·원장 경로 정지 여부, 러너 큐, 이벤트 루프 지연, RSS.
6. **이벤트 타임라인**(B graft): ops-api `GET /internal/v1/timeline?correlation_id=<ulid>` = 각 서비스 `GET /internal/v1/admin/events?correlation_id=`(outbox 행·`inbox_dedupe`·`inbox_dead`) + 로그 스캔 → attempt → verdict → ledger → mastery 체인을 시간순으로. 운영 콘솔 "이벤트 타임라인" 패널.
7. **로컬 SLO 배너**: 첫 문항 p95 ≤ 2s, 결정적 채점 p95 ≤ 300ms, outbox 적체 나이 < 10s, 재시작 < 5s, 이벤트 루프 지연 p99 < 50ms(계약 테스트에서도 검사, RK-02). 위반 시 `op_banner` + SSE.
8. **Tripwire**: TW-01~13·GR(학습 신호, ops-api가 `learning.session.completed`·learning 텔레메트리 API로 계산) + **자원 Tripwire**(C graft): 유휴 RSS 합계 ≤ 400MB, 콜드 기동 ≤ 10s(목표 3~5s), 15년 디스크 투영(learning ≈ 350MB + content ≤ 400MB + ai ≈ 200MB + 백업 7세대). 외부 전송 0.
9. **디스크 보호**: 여유 < 500MB → 경고 배너 + 정리 순서 ① 오래된 로그 ② `ai-cache.db` 만료분 → 전체 ③ `tmp/` ④ 백업 세대 축소 제안(자동 삭제는 하지 않음).
10. **강등 가시성 계약**(C graft): `tests/contract/degradation-visible.spec.ts`가 모든 강등·보류·적체·격하 경로(AI 모드 변화, 제공자 down, 쿼터·예산 임계, 판정 pending, `deferred` 증가, outbox 적체 > 10s, inbox_dead, degraded, 백업 중단, 정책·프롬프트 lock 불일치, **원장 무결성 경보**(`FSRSValidationError`·체인/앵커 불일치·`projection_hash` 불일치), **크래시 후 `integrity` job 실패**, **러너 플랫폼 비활성**(`runner_verified_platforms` 밖 OS), job 실패)가 이벤트 → SSE → 칩/배너를 내는지 검사한다. "로그만 있고 UI 없음" 경로 0.
11. **doctor 연계**: `fathom doctor`가 헬스 보드·무결성(`quick_check`·`integrity_check` 결과·기기별 체인 + 헤드 앵커·투영 해시)·**Node 22 EOL(2027-04-30)과 experimental `node:sqlite` 경고**·데이터 경로 위험(동기화 폴더·네트워크 경로·WSL 경로)·디스크·포트·prlimit·러너 검증 플랫폼 여부(아니면 "Docker 경로 권장")·Docker·graphify(`CodeGraphPort`) 감지를 한 화면·CLI 표로 보여 준다.

## 대안 (Alternatives)

| 대안 | 장점 | 단점 | 판정 |
|---|---|---|---|
| OTel SDK + Collector + UI(Jaeger·Grafana) | 표준 도구 | 상주 프로세스·자원, 로컬 1인에 과잉 | 기각(필드 호환만) |
| 서비스가 각자 로그 파일 기록 | 단순 | 회전·보관·tail이 서비스마다 중복, 크래시 시 버퍼 손실 | 기각(supervisor 수집) |
| 메트릭 없음(로그만) | 최소 | 적체·지연·RSS 추세 판단 불가 | 기각 |
| 외부 텔레메트리 | 원격 분석 | NFR-AVL-008 위반 | 기각 |

## 결과 (Consequences)

- **긍정**: 강등·적체가 사용자에게 보이고, 요청·이벤트 체인을 한 화면에서 추적한다. 자원 예산 위반이 조기에 드러난다. k8s 학습 뷰에서 수집기를 붙이는 실습이 가능하다.
- **부정**: 자체 메트릭 라이브러리·타임라인 집계를 유지보수한다(작게 유지, 공개 표면 ≤ 10 함수).
- **후속**: TW-01~13 계산식은 TST-01·DCP-01(로컬 텔레메트리 이벤트 정의)에서 확정. 운영 콘솔 화면은 SCR-01.

## 동결 영향

필수 로그 필드, 메트릭 이름 목록(가산 허용), 헬스 규약, 보관 상한, degradation-visible 계약은 상세 동결이다.
