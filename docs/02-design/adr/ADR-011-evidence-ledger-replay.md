# ADR-011. 증거 원장과 리플레이 — 단일 writer·`INSERT OR IGNORE`, 원장 이벤트 17종, 총순서·기기별 체인·헤드 앵커, Verdict 리플레이 입력, 이벤트 버전 파라미터, 병합, θ_q·θ 수축, 승급 규칙

- **상태**: Accepted · **일자**: 2026-10-01 · **결정자**: T1(아키텍처)
- **Trace**: UR-05·12·16, NFR-DATA-001·002·003·006·011·013, NFR-PERF-005·010, FR-PRG-001~009·013·017·018·027·029·032·033, FR-QST-011·015·019·020·024, FR-SET-018·022, DR-010·011·012·020·025, DEC-CNV-19·26·33·34, PLN-REV-01 AQ-07, **SP-3(구속) + 감사 PARTIAL(구속 결정 14항)**, **SP-6(구속) + 감사 PARTIAL(구속 결정 10항, 미결 4건)**
- **관련**: ARC-01 §7·§8.6·§9.5·§10.4·부록 B.2·B.4, ADR-002·003·004·013

## 맥락 (Context)

- 제품 정체성은 "깊이는 증거로 남는다"이고 15년·다기기(회사 Windows + 개인 MacBook)를 가정한다. 원장만으로(content·assessment DB 없이) FSRS·Elo·숙달·Lifecycle·LDI를 재구성한 결과가 라이브와 같아야 하고(D-4), 병합 결과는 순서·횟수와 무관해야 한다(NFR-DATA-011).
- SP-3(감사 재현): 총순서 `(client_ts, device_id, device_seq)`만 결정적이다 — 도착 순서(`rowid`)로 리플레이하면 ts-fsrs가 `Invalid delta_t`를 던지고, 동률을 `rowid`로 풀면 병합 순서에 따라 결과가 갈린다. fuzz는 끄거나 시드를 이벤트에 내장해야 한다(감사: 내장 시드를 무시하고 리플레이하면 카드 3,066/3,307 불일치 → 시드가 실제로 쓰임). 55만 이벤트 리플레이 7.5~9.9s, append p99 11.7ms(FULL, 감사). 기기별 `client_ts = max(now, last + 1)`이 시계 어긋남을 흡수. `ts-fsrs`는 정확히 5.4.2.
- **SP-3 감사가 찾은 결함·과대주장**: ① append-only는 UPDATE·DELETE만 시험했다 — `INSERT OR REPLACE`·`REPLACE INTO`는 `recursive_triggers`가 기본 OFF라 트리거 없이 행을 덮어쓰거나 지우고, `DROP TRIGGER`도 허용된다 ② 해시 체인의 **꼬리 변조는 탐지되지 않았다**(체인 헤드가 어디에도 앵커되지 않음) ③ 정정 경로(`append(correction)`, 정정이 든 병합)는 0회 실행 — 설계 주장일 뿐 ④ 숙달 "서로 다른 날"이 UTC 날짜(KST 09:00 경계)로 계산됨 — FR-PRG-027(04:00) 위반 ⑤ 리플레이가 원장 밖 상수(FSRS w·retention·short-term·fuzz·Elo K)에 의존하고 `payload.policy_version`을 읽지 않음 ⑥ LDI "항 캐시"는 한 시각에서만 맞다(`R_k(t)`가 t에 의존) ⑦ 부하 예측 정확도는 순환 검증(같은 망각곡선)이고 ±15% 띠 포함률은 주 15/16·alt1 9/10·alt2 5/10 ⑧ `ldi_params@v1` 민감도 분석 미수행 → 미확정.
- SP-6(감사 재현): 추측 보정 Elo가 없으면 OX 반복 찍기가 θ를 +0.5 올린다(F0 필수). 자기채점 반복이 OFFLINE에서 θ를 +3 부풀리고 우연한 결정적 정답으로 Mastered 115건이 생긴다 → 실효 θ = min(θ, θ_q)(F4). 형식 산입은 곱이 아니라 2조건. **감사**: 기준 (2) "무작위 θ 상승 ≤ 0.02"는 이벤트 ≥ 30인 개념 실행만 셌을 때만 성립(제외된 54건 중 19건이 +0.02 초과, 최대 +0.44; 1일 지평선 random_ox 9.1%가 초과, 최대 +0.94) → **증거가 충분할 때만 안전**. Mastered 0은 강화 확인(P ≥ 0.8에는 +1.886 필요, 관측 최대 +1.01). 미결 4건: (a) JUDGE_ONLY × SP-1 실패의 루브릭 엔진 (b) CBM 규칙(12문항에서 70% = 75%, 전부 C2 정답 66.7% 탈락) (c) 85% 비율이 n ≤ 6에서 100% (d) 희소 깊이 증거·D4 범위.
- 심사 graft(B): 원장 `schema_version` + 순수 upcaster 체인 + 골든 원장 fixture, 채점 멱등 키 `verdict:<verdict_id>`, Verdict = 리플레이 입력 운반체.

## 결정 (Decision)

### 1. 단일 writer와 테이블

`lr_event`에 쓰는 코드는 `services/learning/src/infra/ledger/ledger-writer.ts` **한 파일**(`check:ledger-writer`; 병합 job도 이 모듈을 호출). `learning.db`는 WAL + `synchronous=FULL`, 원장 연결은 열 때마다 **`PRAGMA recursive_triggers=ON`**. 쓰기 문장은 **`INSERT OR IGNORE INTO lr_event …` 하나뿐**이며 `INSERT OR REPLACE`·`REPLACE INTO`·`ON CONFLICT … DO UPDATE`·`DROP TRIGGER`는 `check:ledger-writer`가 정적으로 금지한다(재수입 멱등 = IGNORE).

```sql
CREATE TABLE lr_event(
  event_id        TEXT    PRIMARY KEY CHECK (length(event_id) = 26),          -- ULID, 멱등 수입 키
  device_id       TEXT    NOT NULL CHECK (length(device_id) = 26 AND device_id NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'),
  device_seq      INTEGER NOT NULL CHECK (device_seq >= 1),
  client_ts       INTEGER NOT NULL,          -- epoch ms, 기기별 단조: max(now, last_client_ts + 1)
  type            TEXT    NOT NULL,          -- §3의 17종
  schema_version  INTEGER NOT NULL,          -- 타입별, upcaster 입력
  idempotency_key TEXT    NOT NULL UNIQUE,
  payload         TEXT    NOT NULL CHECK (json_valid(payload)),
  prev_hash       TEXT    NOT NULL,          -- 같은 device 직전 이벤트 hash(첫 이벤트 '0' × 64)
  hash            TEXT    NOT NULL,          -- sha256(canonical({event_id, device_id, device_seq, client_ts, type, schema_version, idempotency_key, payload, prev_hash}))
  experiment_arm  TEXT,                      -- DR-020 이름 훅
  recorded_at     INTEGER NOT NULL,          -- 수신 시각(정보용, 리플레이 미사용)
  ext             TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(ext)),
  ext_v           INTEGER NOT NULL DEFAULT 1,
  card_id    TEXT GENERATED ALWAYS AS (json_extract(payload, '$.card_id'))    STORED,
  concept_id TEXT GENERATED ALWAYS AS (json_extract(payload, '$.concept_id')) STORED,
  UNIQUE (device_id, device_seq)
) STRICT;
CREATE INDEX ix_lr_event_order   ON lr_event(client_ts, device_id, device_seq);
CREATE INDEX ix_lr_event_card    ON lr_event(card_id, client_ts, device_id, device_seq);
CREATE INDEX ix_lr_event_concept ON lr_event(concept_id, client_ts, device_id, device_seq);
CREATE INDEX ix_lr_event_corr    ON lr_event(type) WHERE type IN ('evidence.voided', 'evidence.weight_adjusted');
CREATE TRIGGER lr_event_no_update BEFORE UPDATE ON lr_event BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
CREATE TRIGGER lr_event_no_delete BEFORE DELETE ON lr_event BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
-- recursive_triggers=ON이면 REPLACE의 암묵 DELETE도 위 트리거가 거부한다(SP-3 감사 재현).
-- 트리거는 실수 방지 장치이지 보안 경계가 아니다(같은 파일을 여는 코드는 트리거를 지울 수 있다) → 무결성 증명은 §2의 체인 + 외부 앵커.
```

보조 테이블: `lr_device(device_id PK, created_at, display_name, ext, ext_v)` · `lr_checkpoint(checkpoint_id PK, devices_json /* {device_id: {seq, head_hash}} */, root_hash, source_file_sha256, created_at)`(append-only) · `lr_projection_meta(projection_hash, fsrs_impl, policy_version, event_count, computed_at, ext, ext_v)` · 투영 `lr_card_state`·`lr_concept_state`(θ, θ_q, n_graded, 형식 집합, `study_day` 집합)·`lr_track_level`·`lr_lifecycle`(모두 `WITHOUT ROWID`, 정준 필드 순서 JSON) · `lr_forecast_log(window_id PK, made_at, horizon_days, predicted_total, actual_total NULL)`(예측 띠 보정용) · `lr_curriculum_ref`·`lr_curriculum_meta`. **LDI 전용 항·스냅샷 테이블은 두지 않는다**(§5).

### 2. 총순서·시각·체인·앵커

- 리플레이·증분 재도출은 **`ORDER BY client_ts, device_id, device_seq`로만** 한다(`rowid`·도착 순서·ULID 순서 금지). `device_id`는 ASCII ULID(CHECK)라 SQLite BINARY와 JS `<`가 같다. 카드에는 ts 비감소 순서로만 적용한다.
- `client_ts` = learning append 시각의 기기별 단조값. **FSRS 입력 시각 `fsrs_at`과 학습일 `study_day`는 이벤트 생성 시 정해 payload에 내장**한다: 클라이언트 `answered_at`을 `[session.started_at, now]`로 클램프 → 사용자 일 경계(FR-PRG-027, 기본 04:00, 생성 시점 설정)로 `study_day = YYYY-MM-DD`(로컬) 계산 → `fsrs_at = max(clamped, card.last_fsrs_at + 1)`. **리플레이는 TZ·설정을 다시 읽지 않는다**(UTC 날짜 계산 금지).
- 해시 체인은 **기기별**(prev_hash). **체인 헤드 앵커** `(device_id, device_seq, head_hash)`를 원장 밖 세 곳에 둔다: ① 체크포인트 매니페스트(`lr_checkpoint.devices_json`) ② export JSONL 헤더 줄(`{"kind":"header", "devices": {…}}`) ③ epoch 매니페스트 `ledger_head`(ADR-013). export·import·restore·doctor는 체인 연속성과 **앵커 대조**를 함께 검증한다 → 중간 변조·꼬리 변조·절단을 모두 탐지하고, 위반 시 해당 (device, seq)를 보고하며 import 전체를 거부한다(FR-PRG-003).
- ts-fsrs가 `FSRSValidationError`(음수 경과일 등)를 던지면 삼키지 않고 **원장 무결성 경보**(`degraded` 배너 + doctor 항목)로 올린다.

### 3. 원장 이벤트 17종 (R0 상세 동결, payload 정본 `packages/contracts/src/ledger/payloads/<type>.ts`)

| type (v1) | 발생 | `idempotency_key` | payload 핵심 | 투영 영향 |
|---|---|---|---|---|
| `attempt.graded` | Verdict 수신(동기 또는 backstop) | `verdict:<verdict_id>` | §4 리플레이 입력 + 계보 | FSRS·Elo θ/θ_q·숙달·Lifecycle |
| `evidence.upgraded` | `grading.verdict.revised`(deadline_upgrade) | `verdict:<new_verdict_id>` | supersedes_event_id + 새 판정 필드 | 원 증거의 결과·w 대체(밴드 변경분만 UI) |
| `evidence.regraded` | revised(pending_regrade·appeal) | `verdict:<new_verdict_id>` | supersedes_event_id, 새 판정 필드, `new_rating`, `rating_applied: false` | 숙달 즉시, FSRS grade는 학습자 확인 후(FR-QST-020) |
| `evidence.voided` | `itembank.item.corrected`(void) | `corr:<item_id>:<basis>:<gate_result_id>` | item_id, target_event_ids[], reason | 2-패스 무효 집합 → 키 재도출 |
| `evidence.weight_adjusted` | corrected(halve) · 정책 재계산 | `corr:…` · `recalc:<policy_version>:<event_id>` | target_event_ids[], factor 또는 새 w | w 대체(원본 불변, FR-PRG-002) |
| `pretest.answered` | 프리테스트 | `att:<attempt_id>` | item_id, item_beta, result | β 추정만(증거 0) |
| `lesson.completed` | 3단 레슨 | `cmd:<command_id>` | concept_id, stage(theory·code·core), duration_ms, study_day | Lifecycle |
| `self_assessment.recorded` | 자기채점·JOL·재채점 grade 확인 | `cmd:<command_id>` | kind(`self_grade`·`jol`·`regrade_rating_confirm`·`bias_probe`), target, value, study_day | 자기 증거(w 0.3) 또는 FSRS 확인 |
| `card.enrolled` | 카드 생성 | `card:<card_id>` | card_id(= concept × facet × response_mode), concept_id, facet, response_mode, tier | 카드 생성 |
| `card.status_changed` | suspend·retire·resume | `cmd:<command_id>` | card_id, status(`active`·`suspended`·`retired`), reason | 스케줄 제외·복귀 |
| `profile.setting_changed` | 리플레이 영향 설정 | `cmd:<command_id>` | key, from, to | 기록용(리플레이는 각 이벤트에 내장된 값만 사용) |
| `policy.switched` | 정책 세트 승인(FR-SET-018 비교 후) | `policy:<policy_version>` | policy_version, members{name: {version, sha256}}, replay_report_ref | 이후 생성 이벤트가 이 `policy_version`을 참조 |
| `ai_mode.observed` | `ai.mode.changed` 수신 | `aimode:<integration event_id>` | mode, providers[] | 잠정 판정 근거(FR-PRG-033) |
| `declaration.sealed` | 타임캡슐·anchor-0·시즌 목표 | `cmd:<command_id>` | kind, content_hash, sealed_payload | 불변 봉인 |
| `promotion.exam_completed` | 12문항 평가 종료 | `exam:<exam_id>` | track, level, item_ids, formats, correct_count, cbm_ratio, passed, profile | 승급 판정 입력 |
| `level.promoted` | 승급(확정·잠정) | `promo:<track>:<to_level>` | track, from, to, provisional, gates[], profile{policy_version, ai_mode, sp1_state} | 트랙 레벨 = 끈적한 사실(강등 없음) |
| `level.provisional_resolved` | 보정 엔진 재확인 | `promo-res:<track>:<level>:<n>` | track, level, `outcome: 'confirmed' \| 'provisional_revoked'`, `needs_reconfirmation: boolean`(철회 시 true) | 배지만 — **레벨은 내려가지 않는다**(BR-14) |

### 4. Verdict = 리플레이 입력 운반체

`grading.verdict.issued` payload(정본 `@fathom/contracts/events/catalog/grading`):

```ts
Verdict = z.object({
  verdict_id: Ulid, attempt_id: Ulid, session_id: Ulid, block_id: Ulid.nullable(),
  item_id: z.string(), item_content_hash: Sha256Hex, item_beta_snapshot: z.number(),
  item_n_options: z.number().int().min(0),                 // 0 = 열린 형식(추측 보정 c = 0), SP-6 F0
  gate_result_id: Ulid.nullable(), stakes: z.enum(['S0', 'S1', 'S2']),
  concept_id: z.string(), ku_ids: z.array(z.string()), mc_ids: z.array(z.string()),
  facet: z.string(), format: FormatId, response_mode: z.enum(['recognition', 'production']), tier: z.enum(['A', 'B', 'C']),
  result: z.enum(['correct', 'partial', 'incorrect', 'pending']), band: z.enum(['wrong', 'partial', 'right']),
  score: z.number().min(0).max(1), confidence: z.number().int().min(1).max(3).nullable(),
  latency_ms: z.number().int().min(0), rapid: z.boolean(), hints_used: z.number().int().min(0),
  grader_engine: z.enum(['D', 'J', 'LJ', 'H', 'S', 'PENDING']), calibrated: z.boolean(),
  grader_confidence: z.number().min(0).max(1).nullable(), pending: z.boolean(), provisional: z.boolean(),
  w_format: z.number().min(0).max(1), w_grader: z.number().min(0).max(1), gaming_factor: z.number().min(0).max(1),
  recommended_grade: z.number().int().min(1).max(4),       // 형식 정규화 후(recognition ≤ Good, FR-PRG-007)
  ai_mode: z.enum(['FULL', 'JUDGE_ONLY', 'LLM_ONLY', 'OFFLINE']), content_policy_version: z.string(),
  judge_log_ref: Ulid.nullable(), prompt_version: z.string().nullable(), issued_at: EpochMs,
}).strict();
```

`attempt.graded` payload = Verdict의 위 필드(평탄화, `item_beta = item_beta_snapshot`) + learning이 더하는 `card_id`, `rating`(확정 grade), `fsrs_at`, `study_day`, `policy_version`(learning 정책 세트 콘텐츠 주소 `ps_<sha256 16자>`). **리듀서가 읽는 필드**(SP-3 §6.8 + F0 + 감사): `card_id, concept_id, format, facet, response_mode, tier, rating, result, w_format, w_grader, gaming_factor, rapid, item_beta, item_n_options, policy_version, fsrs_at, study_day` + `client_ts`(+ 체인 검증용 `prev_hash`). w는 Verdict 발급 시점 값으로 고정되며 재계산은 새 이벤트로만 한다. **fuzz는 v1에서 금지**(`fsrs_params@v1.enable_fuzz = false`); 켜려면 `fuzz_seed` 필수(zod `superRefine`)인 새 정책 버전 + ADR. 복습 분산이 필요하면 큐 조립 시의 **비영속 jitter**로만 한다.

### 5. 투영 규칙 (`domain/learner-model`)

- 순수 리듀서 `apply(state, event, params) → state`. 입력은 (upcast된) payload·`client_ts`와 **이벤트의 `policy_version`이 가리키는 불변 파라미터 세트**(FSRS w·tier별 retention·short-term·fuzz·Elo K·숙달 임계·θ 수축)뿐 — 시계·난수·현재 설정·타 DB 조회 금지. 파라미터 세트는 `FATHOM_HOME/policy/`의 불변 버전 파일(과거 버전 영구 보관)에서 해석하며, 현재 활성 정책으로 대체하지 않는다.
- **FSRS**: `ts-fsrs` **5.4.2**, `fsrs(generatorParameters({enable_fuzz: false, enable_short_term: true, request_retention: <tier별>}))`, `f.next(card, fsrs_at, rating)`(`repeat` 금지), 카드 상태는 number(ms)만 저장(`Date` 금지), `lr_projection_meta.fsrs_impl = "ts-fsrs@5.4.2"`.
- **Elo(F0·F4)**: `P = c + (1 − c)·σ(θ − β)`, `c = item_n_options > 0 ? 1/item_n_options : 0`, `K = α / (1 + b·n)`(α 0.8, b 0.05, n = w > 0 관측 수), `θ += w·K·(obs − P)`(w ≤ 0이면 불변). **θ_q**는 `geq(w_format, 0.7) ∧ geq(w_grader, 0.6) ∧ gaming_factor > 0 ∧ !pending`인 이벤트로만 같은 식으로 갱신. **실효 θ = min(θ, θ_q)**(`unqualified_ceiling = 0`).
- **θ 증거 수축**(SP-6 감사 구속, CR-22): 개념의 채점 이벤트 수 `n_graded`에 대해 `θ̃ = θ_prior + (θ_eff − θ_prior)·n/(n + n0)`(`theta_prior = −0.5`, `theta_shrink_n0 = 10` — SIM-PROMO 재검증 후 확정). 숙달 P·LDI·적응 난이도·승급은 θ̃만 쓴다. UI는 `n_graded < theta_display_min_events(30)`이면 θ 숫자를 표시하지 않고 "증거 부족"을 보인다.
- **숙달**: `P(θ̃) ≥ 0.80 ∧ 산입 형식 F ≥ 3(형식마다 2조건 정답 이벤트 존재) ∧ 서로 다른 study_day ≥ 2`(DEC-CNV-19, CR-26). 빠른 응답은 정오 무관 w 0(DEC-CNV-33).
- **정정**: 2-패스 — `ix_lr_event_corr`로 무효·가중 대상 집합을 먼저 읽고 본 패스에서 적용(순서 무관, 병합 안전).
- **증분**: fast path는 카드 `last_review < ts` ∧ 개념 `last_ts < ts`(**엄격**)일 때만 append와 같은 tx에서 UPSERT, 그 외(동률·지각 도착·정정)는 `ix_card`·`ix_concept`로 카드·개념 키 재도출(지각 p99 35~45ms).
- **LDI**: 표시 시점마다 **전체 재계산**(카드 1.4만 장 9~14ms). 시각 의존 항을 캐시하지 않는다. `ldi_params@v1`은 REQ 부록 A 초기값이며 미확정(SIM-LDI 후속, 결과는 `ldi_params@v2` + 리플레이 비교 리포트).
- **부하 예측**(FR-PRG-018): 30일 총량 **범위만**. 띠 = `lr_forecast_log`의 과거 예측 오차 분위수(창 ≥ 8개 전에는 ±15%), 거버너는 **하한**을 예산과 비교, model/observed 선택은 V-field까지 잠정. 예측 계산은 worker_threads `forecast`(DB 핸들 없음; 부모가 카드 상태 배열을 넘김).
- **정준 투영 해시**: 정렬 키·고정 필드 순서·최단 왕복 숫자 표기·SHA-256. 체크포인트·epoch 매니페스트에 기록하고 병합·업그레이드 회귀와 야간 무결성 검사에 쓴다. 바이트 동일성은 같은 플랫폼·같은 Node 버전 안에서만 요구한다(OS 간 비교는 V-live).

### 6. 승급 (`PromotionEngine`, SP-6 `promotion.ts` 이식)

- `decidePromotion(input, rules) → {decision: 'promote' | 'promote_provisional' | 'not_ready' | 'cap_reached', profile{policy_version, ai_mode, sp1_state}, gates[]}` — `gates[]`는 FR-PRG-033 결정 카드의 행(게이트 ID·충족 여부·근거 이벤트·부족분). 자격이 되면 application이 `level.promoted`를 **원장에 기록**한다(끈적한 사실 — 이후 정책이 바뀌어도 강등 없음).
- `structuralFeasibility(policy, inventory, transition, mode, sp1)`는 `@fathom/contracts/pack/feasibility`의 순수 함수(learning·packc 공용)이며 blocker 코드(`NO_ASSESSMENT_POOL`, `EMPTY_LEVEL`, `D4_POSSIBLE<REQUIRED`, `CASE_L4+<2`, `MASTERY_FORMATS<3:<id>`)를 돌려준다. 승급 화면 "부족 조건", 팩 리포트 cap 오라클, R-POOL CI 게이트가 같은 함수를 쓴다.
- **규칙 값**(`mastery_rules@v1`, ARC-01 §7.3): F1 `empty_level: skip`, F3 `d4.floor_mode: min_with_possible`(필요 D4 = `max(min(2, possible), min(5, possible))`), F2 기각, 필수 개념 Mastered 수 = `n ≤ 3 ? n : min(n − 1, ceil(0.85n))`(CR-20), 희소 깊이 증거 = 트랙 범위·D4 가능 개념 = 레벨 ≤ k(CR-21), 승급 평가 = 12문항·형식 라운드로빈·형식 ≥ 4·**결정적 형식 + (SP-1 통과 시) 보정 Jev 형식만**, 합격 = 정답 ≥ 10/12(L4→L5 11/12) ∧ `Σ CBM 점수 / Σ 선택 확신도 최대` ≥ 0.70(L4→L5 0.75)(CR-19), 재도전 14일. 모든 임계 비교는 `geq(ε = 1e-9)`.
- **잠정**: 게이트 증거 중 자기채점·휴리스틱이 결정적이면 `provisional=true`. OFFLINE과 **JUDGE_ONLY × SP-1 실패의 서술형 루브릭 게이트**(자기채점 + 미보정 Jev 참고 점수)는 잠정이다(CR-18). `reconcileProvisional(levelNow, regradePassed)`는 보정 엔진(SP-1 통과 Jev 또는 FULL·LLM_ONLY의 LJ) 재채점 결과로 `confirmed` 또는 `provisional_revoked`(+ `needs_reconfirmation`)만 기록하고 **레벨을 내리지 않는다**(BR-14).
- 브리프 콘텐츠가 들어오기 전까지 제품 지도는 선언 cap이 아니라 오라클 cap(docker·cicd·cloud·ml·eng = L4)을 표시한다.

### 7. 병합(FR-SET-022, NFR-DATA-011)

`fathom export --since <checkpoint>` = 헤더 줄(체인 헤드 앵커) + 기기별 원장 JSONL(+ 오버레이·설정은 각 소유 서비스 export). `fathom import --merge <file>` → ops-api → learning `POST /internal/v1/ledger/import`(스트리밍, NFR-SEC-014 ②) → **단명 자식 job `merge`**: 헤더 앵커·기기별 체인 연속성 검증 → `INSERT OR IGNORE`(5,000건 배치, 배치마다 `BEGIN IMMEDIATE`) → `lr_checkpoint` 기록(root_hash = sha256(정준 devices 맵), devices_json = 병합 후 헤드) → 섀도 투영 테이블로 **전체 리플레이** → 섀도 시작 뒤 서빙 프로세스가 추가한 이벤트 캐치업 → `ALTER TABLE … RENAME` 원자 교체 1 tx → IPC 결과 → 부모가 기기 헤드·투영 캐시 재적재 후 `learning.ledger.merged`. 재수입은 멱등(삽입 0). 크로스 플랫폼 부동소수 차이(SP-3 RSK-1) 때문에 기기 간 투영 해시를 비교하지 않고 **병합 후 로컬 재계산**을 정본으로 한다.

### 8. 스키마 진화

- 저장된 이벤트는 다시 쓰지 않는다. 타입별 `schema_version` + 순수 upcaster `domain/ledger/upcasters/<type>/v<n>-to-v<n+1>.ts`, 현재 버전 맵 `@fathom/contracts/ledger/versions`. 리플레이 = 행 읽기 → 최신으로 upcast → 리듀서.
- 골든 원장 `services/learning/test/golden/*.jsonl` + 기대 투영 해시. 리듀서·upcaster·`ts-fsrs` 변경은 해시 불변이어야 하며, 의도된 변경이면 `fsrs_impl`·투영 버전을 올리고 "전체 재구성(job `rebuild`) + 투영 해시 diff 리포트" 마이그레이션으로 다룬다.

### 9. 검증

- 속성 기반(V-build): 리플레이 = 라이브(content·ai DB 삭제 상태), 무작위 병합 순서 100회 해시 동일, 재수입 멱등, upcaster 왕복, TZ 3종(UTC·Asia/Seoul·America/Los_Angeles) 불변, `study_day` 04:00 경계(03:59 = 전날), OX 반복 찍기 600회 Δθ < 0.02(보정 끄면 > 0.3 — 보정이 필요함을 증명), 자기채점 400회 후 실효 θ ≤ θ0, 19트랙 × 4전이 × 8조합 구조적 도달 blocker 0(팩 변경마다).
- **감사 추가(INT-1 게이트)**: ① `INSERT OR REPLACE`·`REPLACE INTO` 시도 → 거부(recursive_triggers) ② 기기 마지막 이벤트 변조·꼬리 절단 → 앵커 대조로 검출 ③ 정정 경로 결정성: `append(correction)` 증분 = 전체 리플레이, 타 기기 정정이 든 병합 = 전체 리플레이 ④ θ 회귀는 **노출 필터 없이 전체 개념 실행**(기준 (2) = 채점 이벤트 ≥ 30 이후 상승 ≤ 0.02, 그 전에는 UI 비노출·수축 확인) ⑤ SIM-PROMO: CR-18~22 값으로 SP-6 행렬 재계산(이상적 학습자 cap 이하 전이 전부 도달, 무작위 Mastered 0) — INT-2 진입 조건.
- 운영: 유휴 창(`ops.host_state.changed`)에서 job `replay-verify`(읽기 전용)가 전체 리플레이 → `projection_hash` 비교 → 불일치 시 배너 + doctor(자동 수정 금지).

### 10. FSRS 최적화(AQ-07)와 시뮬레이터

- `FsrsOptimizerPort` 기본 `none`(v1 Should). 구현은 **순수 TS**(단명 자식 job `fsrs-optimize`, 읽기 전용 연결, 결정적 테스트), 빌드타임 Python 오라클과 결과 대조, WASM은 검증되면 교체. 런타임 Python 금지(DEF-31). 결과는 리플레이 비교 리포트 후 사용자 승인 → `policy.switched`.
- 합성 학습자 시뮬레이터·15년 로그 생성기(SP-3·SP-6 코드 이식, NFR-MAINT-012)는 `services/learning/sim/`(개발 전용, 번들 제외): `promotion-sim.ts`(SIM-PROMO), `ldi-sensitivity.ts`(SIM-LDI). 같은 시드 → 같은 로그, 55만 건 ≤ 60s.

## 대안 (Alternatives)

| 대안 | 장점 | 단점 | 판정 |
|---|---|---|---|
| 상태 저장만(원장 없음) | 단순 | 리플레이·병합·감사 불가, UR-12 위반 | 기각 |
| 모든 aggregate event sourcing | 일관 모델 | 과잉 설계, 리플레이 비용·스키마 진화 부담 | 기각(증거만) |
| HLC(하이브리드 논리 시계) | 인과 정렬 | 결정성에는 불필요(SP-3), 복잡도 | 보류(ts 자리 예약, 필요 시 가산) |
| 리플레이 때 w·파라미터를 현재 설정으로 재계산 | 정책 변경 즉시 반영 | 과거 증거 의미 변화, FR-PRG-002 위반, 리플레이 비결정(감사) | 기각(이벤트 버전 파라미터 + 새 이벤트로만) |
| 기기별 투영을 CRDT로 병합 | 실시간 동기화 | 부동소수·FSRS 비가환, 복잡 | 기각(원장 합집합 + 로컬 재계산) |
| 승급을 투영에서만 계산 | 원장 단순 | 정책 변경 시 강등 발생(BR-14 위반) | 기각(`level.promoted` 사실 기록) |
| 트리거만으로 append-only 보장 | 단순 | REPLACE·DROP TRIGGER로 우회(감사) | 기각 → IGNORE 전용 + recursive_triggers + 체인 앵커 |
| LDI 개념별 항 캐시 | 증분 빠름 | 표시 시각이 바뀌면 무효(감사) | 기각 → 표시 시 전체 재계산 |
| θ 그대로 노출·투입 | 단순 | 증거 < 30에서 무작위 상승 최대 +0.94(감사) | 기각 → 30건 미만 비노출 + 수축 |

## 결과 (Consequences)

- **긍정**: 원장이 자급하므로 content·ai 장애·손상과 무관하게 학습 이력이 재현된다. 병합·복원·업그레이드 후 정합성을 해시와 외부 앵커로 증명한다. 찍기·자기채점 부풀림이 규칙 수준에서 막히고, 증거가 적은 개념의 θ가 학습자·승급에 과신을 주지 않는다.
- **부정**: 이벤트당 ≈ 666B(15년 ≈ 350MB). 리듀서·upcaster 변경은 골든 해시 관리가 필요하다. `ts-fsrs` 업그레이드는 마이그레이션 절차를 거친다. θ 수축은 정직한 학습자의 숙달을 늦출 수 있다 → SIM-PROMO로 `n0` 확정.
- **후속**: IF-01이 원장 payload 17종 zod를 작성. DB-01이 보조·투영 테이블 DDL 확정. SIM-PROMO·SIM-LDI(INT-2 전). 다기기 정정 병합·3대 이상 기기 테스트를 INT-3에 추가.

## 동결 영향

`lr_event` DDL·쓰기 형태(`INSERT OR IGNORE`)·연결 PRAGMA, 총순서·시각 규칙(`fsrs_at`·`study_day`), 체인 헤드 앵커 3곳, 원장 타입 17종과 멱등 키 규칙, Verdict 필드, 리듀서 입력 목록, 이벤트 버전 파라미터 원칙, F0·F4 식, 병합 절차는 R0 상세 동결이다. θ 수축·승급 임계값은 `mastery_rules` 정책 값(버전 교체 = CR). 타입 추가·선택 필드 추가 = CR, 필드 의미 변경 = 새 `schema_version` + upcaster + ADR.
