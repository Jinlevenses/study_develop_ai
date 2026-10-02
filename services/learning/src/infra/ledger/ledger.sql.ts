// DB-01 §6.3 — 원장 SQL(정적 리터럴, STD-SQL-06). `lr_event` 쓰기 문장(LEDGER_INSERT)은 ledger-writer.ts에만 있다(check:ledger-writer, STD-SQL-11).
// 읽기·보조 테이블(lr_device·lr_checkpoint) 문장만 이 파일에 둔다. 값은 전부 `:name` 바인딩.

/** UNIQUE(device_id, device_seq) 자동 인덱스 사용. */
export const LEDGER_DEVICE_HEAD =
  'SELECT device_seq, hash, client_ts FROM lr_event WHERE device_id = :device_id ORDER BY device_seq DESC LIMIT 1';

/** changes = 0일 때만. */
export const LEDGER_FIND_CONFLICT =
  'SELECT event_id, device_id, device_seq, idempotency_key, hash FROM lr_event WHERE event_id = :event_id OR idempotency_key = :idempotency_key OR (device_id = :device_id AND device_seq = :device_seq)';

/** 체크포인트·export 헤더·epoch ledger_head 앵커. */
export const LEDGER_HEADS =
  'SELECT e.device_id, e.device_seq AS seq, e.hash AS head_hash FROM lr_event e WHERE e.device_seq = (SELECT max(device_seq) FROM lr_event x WHERE x.device_id = e.device_id)';

/** 앵커 대조·import 시작점: (device_id, device_seq)의 hash. */
export const LEDGER_HASH_AT = 'SELECT hash FROM lr_event WHERE device_id = :device_id AND device_seq = :device_seq';

/** 체인 검증 순서(기기별) — 리플레이 순서가 아니다. */
export const LEDGER_CHAIN_ROWS =
  'SELECT event_id, device_id, device_seq, client_ts, type, schema_version, idempotency_key, payload, prev_hash, hash FROM lr_event ORDER BY device_id, device_seq';

/** export 순서(device_id, device_seq) — 생성 열·recorded_at 제외, payload·ext = 저장 문자열 그대로. */
export const LEDGER_EXPORT_ROWS =
  'SELECT event_id, device_id, device_seq, client_ts, type, schema_version, idempotency_key, payload, prev_hash, hash, experiment_arm, ext FROM lr_event ORDER BY device_id, device_seq';

// ───────── 리플레이(유일하게 허용된 순서) — 열 목록은 모두 같다 ─────────

export const LEDGER_REPLAY =
  'SELECT event_id, device_id, device_seq, client_ts, type, schema_version, idempotency_key, payload, prev_hash, hash, experiment_arm, recorded_at FROM lr_event ORDER BY client_ts, device_id, device_seq';
export const LEDGER_REPLAY_BY_CARD =
  'SELECT event_id, device_id, device_seq, client_ts, type, schema_version, idempotency_key, payload, prev_hash, hash, experiment_arm, recorded_at FROM lr_event WHERE card_id = :card_id ORDER BY client_ts, device_id, device_seq';
export const LEDGER_REPLAY_BY_CONCEPT =
  'SELECT event_id, device_id, device_seq, client_ts, type, schema_version, idempotency_key, payload, prev_hash, hash, experiment_arm, recorded_at FROM lr_event WHERE concept_id = :concept_id ORDER BY client_ts, device_id, device_seq';
export const LEDGER_REPLAY_CORRECTIONS =
  "SELECT event_id, device_id, device_seq, client_ts, type, schema_version, idempotency_key, payload, prev_hash, hash, experiment_arm, recorded_at FROM lr_event WHERE type IN ('evidence.voided', 'evidence.weight_adjusted') ORDER BY client_ts, device_id, device_seq";
/** rowid = 도착 순서 — 캐치업 커서 전용(DB-01 §6.4-3). */
export const LEDGER_SINCE_ROWID =
  'SELECT event_id, device_id, device_seq, client_ts, type, schema_version, idempotency_key, payload, prev_hash, hash, experiment_arm, recorded_at FROM lr_event WHERE rowid > :after ORDER BY rowid';
export const LEDGER_MAX_ROWID = 'SELECT coalesce(max(rowid), 0) AS n FROM lr_event';

// ───────── 보조: 기기·정책 부트스트랩 · 체크포인트 ─────────

export const LR_DEVICE_LOCAL = 'SELECT device_id FROM lr_device WHERE is_local = 1';
export const LR_DEVICE_INSERT_LOCAL =
  'INSERT INTO lr_device(device_id, is_local, platform, created_at) VALUES (:device_id, 1, :platform, :created_at)';
/** 병합 import로 처음 보는 원격 기기(최초 병합 시각 = created_at). */
export const LR_DEVICE_INSERT_REMOTE =
  "INSERT OR IGNORE INTO lr_device(device_id, is_local, platform, created_at) VALUES (:device_id, 0, '', :created_at)";
export const LEDGER_POLICY_EXISTS = "SELECT 1 AS present FROM lr_event WHERE type = 'policy.switched' LIMIT 1";

export const LR_CHECKPOINT_INSERT =
  'INSERT INTO lr_checkpoint(checkpoint_id, kind, devices_json, root_hash, source_file_sha256, projection_hash, created_at) VALUES (:checkpoint_id, :kind, :devices_json, :root_hash, :source_file_sha256, :projection_hash, :created_at)';
export const LR_CHECKPOINT_LATEST =
  'SELECT checkpoint_id, devices_json, root_hash FROM lr_checkpoint ORDER BY created_at DESC, checkpoint_id DESC LIMIT 1';
