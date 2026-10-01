# ADR-003. 통신 — 동기 REST + transactional outbox push relay + inbox, 통합 이벤트 envelope, 소비자 주도 구독

- **상태**: Accepted · **일자**: 2026-10-01 · **결정자**: T1(아키텍처)
- **Trace**: UR-05·08·12, NFR-DATA-012·013, NFR-AVL-005·011, IR-015·016, PLN-REV-01 AQ-02(FE-07), PLN-CNV-01 §12.1, 심사 기록 AQ-02 입장(local-operability·requirements-fit: push / agent-buildability: feed)
- **관련**: ARC-01 §8, ADR-001·011·013·015

## 맥락 (Context)

- 서비스마다 DB 파일이 따로 있어 서비스를 넘는 원자적 쓰기가 없다. 그래서 서비스 간 쓰기는 transactional outbox + Idempotency-Key여야 하고(C-04), 채점 응답 후 learning이 기록 전에 죽어도 증거가 정확히 1건이어야 한다(NFR-DATA-013).
- 브로커(NATS·Redis)는 상주 인프라라 금지다(AP-07). 남는 선택지는 생산자 push(A·C)와 outbox-as-feed long-poll pull(B)이다.
- 심사가 갈렸다. push 쪽: 연결·폴링 루프가 없어 1인 운영에 단순하다. feed 쪽: 생산자가 소비자를 몰라도 되고, 중앙 구독 표(`subscriptions.ts`)가 병렬 머지 핫스팟이 되지 않으며, 커서를 epoch 매니페스트에 기록해 "유실 0·중복 0"을 증명할 수 있다.
- A의 통합 이벤트 12종은 작업 주문 승인, 오버레이 충돌, 문항 격리의 증거 정책, `curriculum_ref` 갱신을 담지 못한다. B의 38종은 1인 용량에 비해 과하다.

## 결정 (Decision)

### 1. 동기 REST

- 경로: 서비스 간 `/internal/v1/<bc|resource>`, 브라우저·CLI `/api/v1/*`(gateway만). JSON, zod 검증(요청·응답 모두), HTTP/1.1 keep-alive.
- 헤더: `x-request-id`(ULID) · `traceparent`(W3C) · `authorization: Bearer <caller token>` · `idempotency-key`(상태 변경 필수, 없으면 400) · `x-fathom-deadline-ms`(남은 ms, 홉마다 차감) · `x-fathom-delivery-attempt`(inbox).
- 오류: RFC 9457 `application/problem+json` + `{code: "<SVC>-<CAT>-<NNN>", error_id, request_id}`. SVC ∈ `GW CT LR AI OP CLI`, CAT ∈ `VAL AUTH ACL NOTFOUND CONFLICT DEP LIMIT POLICY INTERNAL`.
- 멱등: `idem_request(key, caller, route_id)`에 응답 저장 7일, 같은 키·다른 본문 해시 → 422 `*-CONFLICT-001`. 도메인 수준 유일성(예: `attempt_id`)을 함께 둔다.
- 타임아웃: 연결 300ms(서킷), 요청 기본 2s, interactive 3000ms 예산.

### 2. 상태 전파 = outbox push relay (AQ-02: feed long-poll 기각)

공통 인프라 DDL(정본 `packages/shared-kernel/infra-migrations/`, ARC-01 §8.3): `outbox(seq, event_id, type, schema_version, occurred_at, correlation_id, causation_id, traceparent, payload)`, `outbox_delivery(dest, mode, last_acked_seq, attempts, next_attempt_at, last_error_code, updated_at)`, `inbox_dedupe`, `inbox_watermark(producer, last_producer_seq)`, `inbox_dead`, `idem_request`, `schema_migrations`.

- **쓰기**: 상태 변경과 `outbox` INSERT를 **같은 `BEGIN IMMEDIATE` tx**에서(`appendEvent(tx, …)`). 이벤트 1건 = 행 1개(목적지별 복제 없음).
- **relay**(생산자): 커밋 직후 `setImmediate` + 500ms 안전망. 목적지별 in-flight 1, 배치 ≤ 100, `seq` 순(목적지별 FIFO). `POST /internal/v1/inbox {producer, events[]}` → `200 {acked_through_seq}` → 커서 전진(구독하지 않는 타입 구간 포함). 실패 0.5s → 30s 지수 백오프, 재시작 후 이어짐. `notify` 목적지(gateway)는 60s 지난 이벤트를 건너뛴다. 정리 = 모든 `durable` 목적지가 ack한 행 중 7일 경과분.
- **inbox**(소비자): 이벤트마다 개별 tx — dedupe 확인 → envelope·payload zod(type × schema_version) → 핸들러(순수 + 짧은 쓰기) → `inbox_dedupe` INSERT + `inbox_watermark` UPSERT → COMMIT. 실패 시 구독의 `on_poison`이 `dead_letter`이고 시도 ≥ 3이면 `inbox_dead` 격리 + ack + 배너, **`halt`(원장 경로)이면 그 지점에서 멈추고 503**(생산자 재시도 + "원장 경로 정지" 경보).
- **구독 = 소비자 선언**: `packages/contracts/src/events/__consumers__/<svc>.json`
  ```json
  { "consumer": "learning",
    "subscriptions": [
      { "type": "grading.verdict.issued", "schema_versions": [1], "mode": "durable", "on_poison": "halt",
        "reads": ["verdict_id", "attempt_id", "item_id", "item_beta_snapshot", "item_n_options", "w_format", "w_grader"] } ] }
  ```
  `pnpm contracts:gen`이 이 파일들과 `events/catalog/*.ts`로 `routing.gen.ts`(생산자 → 목적지·타입·모드)와 `registry.gen.ts`를 만든다. 생산자 코드·계약은 소비자 추가 때 바뀌지 않는다(B의 장점 확보). `reads`는 소비자 주도 계약이며 `check:consumers`가 생산자 스키마의 해당 필드 삭제·개명·타입 변경을 막는다.
- **새 구독의 과거 이벤트**는 relay로 백필하지 않는다. 생산자의 스냅샷·export API로 재구성한다(예: `GET /internal/v1/catalog/curriculum/export?since=`).

### 3. envelope (R0 상세 동결)

```ts
// packages/contracts/src/events/envelope.ts
IntegrationEventEnvelope = z.object({
  event_id: Ulid, type: z.string().regex(/^[a-z]+\.[a-z_]+\.[a-z_]+$/), schema_version: z.number().int().min(1),
  producer: z.enum(['gateway','content','learning','ai-gateway','ops-api']), producer_seq: z.number().int().min(1),
  occurred_at: EpochMs, correlation_id: Ulid, causation_id: Ulid.nullable(),
  traceparent: z.string().regex(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/).nullable(),
  payload: z.record(z.string(), z.unknown()),
}).strict();
```

타입 이름 = `<context>.<entity>.<past_tense>`, context는 **BC 문맥**(`catalog`·`acquisition`·`itembank`·`grading`·`learning`·`ai`·`ops`)이고 `producer`는 배포 단위다(ADR-001).

### 4. 통합 이벤트 카탈로그 (23종, payload 상세 = ARC-01 §8.5)

| 생산 | 이벤트 |
|---|---|
| content | `catalog.pack.activated`(D) · `catalog.concept.changed`(D) · `catalog.overlay.conflicted`(O) · `acquisition.import.staged`(O) · `grading.verdict.issued`(D) · `grading.verdict.revised`(O) · `itembank.item.corrected`(D) |
| learning | `learning.evidence.recorded`(D) · `learning.session.completed`(D) · `learning.demand.forecasted`(D) · `learning.mastery.changed`(D) · `learning.level.promoted`(D) · `learning.ledger.merged`(D) |
| ai-gateway | `ai.mode.changed`(D) · `ai.provider.status_changed`(O) · `ai.job.completed`(O) · `ai.work_order.approval_requested`(O) · `ai.work_order.decided`(O) · `ai.budget.threshold_reached`(O) · `ai.judge.drift_detected`(O) |
| ops-api | `ops.health.changed`(D) · `ops.backup.completed`(D) · `ops.host_state.changed`(D) |

원장 경로(halt) 구독: learning의 `grading.verdict.issued`·`grading.verdict.revised`·`itembank.item.corrected`. 나머지는 dead-letter. gateway는 UI 관련 17종을 `notify`로 받아 SSE로 팬아웃한다.

### 5. 채점 경로 = 오케스트레이션 + outbox backstop

learning이 content `grading/attempts`를 동기 호출(같은 Idempotency-Key = attempt ULID)하고, content는 Verdict INSERT와 outbox `grading.verdict.issued`를 한 tx로 기록한다. learning은 원장 append의 멱등 키를 **`verdict:<verdict_id>`**로 쓴다. 동기 경로와 backstop 경로가 이 한 점에서 수렴해 정확히 1건이 된다. 교차 컨텍스트 전파(재게이트 → 증거 보정, 문항 건강, 워밍 풀, AI 모드)는 코레오그래피(이벤트 반응)다.

### 6. 브라우저 알림 = SSE 하나

`GET /api/v1/stream`(쿠키, `Last-Event-ID`, 15s heartbeat). gateway는 메모리 링 1,000건, 재시작으로 링이 비면 `event: resync` → 클라이언트 전체 무효화(IR-016 누락 0).

### 7. 백업·복원과의 결합(ADR-013)

epoch 매니페스트에 서비스별 `outbox_head_seq`·`delivery{dest: last_acked_seq}`·`inbox_watermark{producer: seq}`를 **스냅샷 사본에서 읽어** 기록한다. 복원 시 `delivery[D] := min(manifest[P].delivery[D], manifest[D].inbox_watermark[P])`로 커서를 되감아 재전송하고 소비자 dedupe가 중복을 흡수한다 → 교차 서비스 유실 0·중복 0.

## 대안 (Alternatives)

| 대안 | 장점 | 단점 | 판정 |
|---|---|---|---|
| outbox-as-feed long-poll(B) | 생산자가 소비자를 모름, 커서 기반 복원 증명 | 상시 long-poll 약 12개, 소비자별 폴링 루프, outbox 90일 보존(가장 느린 소비자 기준), gateway SSE hub가 feed 4개 폴링 | 기각(장점은 매니페스트·커서·watermark로 확보) |
| 중앙 `subscriptions.ts` + 목적지별 행 복제(A 원안) | 단순 | 소비자 추가마다 생산자 계약 파일 수정(머지 핫스팟), payload 중복 저장 | 기각 |
| 메시지 브로커(NATS·Redis Streams) | 표준 패턴 | 상주 인프라, epoch 백업 범위 밖 상태, Windows 설치 마찰 | 기각 |
| 동기 호출만(이벤트 없음) | 최소 부품 | 크래시 사이 유실, 반응자 증가 시 결합, NFR-DATA-013 불충족 | 기각 |

## 결과 (Consequences)

- **긍정**: 모든 상태가 SQLite 안에 있어 epoch 백업이 전파 상태까지 포함한다. 소비자 추가가 생산자 파일을 건드리지 않는다. 원장 경로는 유실 대신 정지 + 경보로 실패가 시끄럽다. 이벤트 23종으로 IF-01 동결 표면이 관리 가능하다.
- **부정**: 생산자 relay가 목적지별 재시도 상태를 가진다(테이블 1개). 소비자 장기 다운 시 outbox가 쌓인다 → 적체 나이 가시화·notify 60s 폐기. 새 구독의 과거 이벤트는 스냅샷 API가 필요하다.
- **후속**: IF-01이 23종 payload zod와 소비자 매니페스트 초안을 코드로 작성한다. 통합 테스트 `tests/integration/outbox-exactly-once.spec.ts`(크래시 주입), `restore-rewind.spec.ts`. `check:consumers`·`check:frozen`(ADR-010).

## 동결 영향

envelope, 공통 인프라 DDL, relay·inbox 규칙, 이벤트 이름 23종(D 표시는 payload까지 상세, O는 개요), 매니페스트 형식은 PG-2 동결 대상이다. 이벤트 추가·선택 필드 추가 = CR, 필드 삭제·의미 변경 = 새 `schema_version` + ADR.
