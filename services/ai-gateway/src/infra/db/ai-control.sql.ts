// control BC 운영 SQL — 정적 상수(STD-SQL-06). 테이블 = migrations/control/0001_control_core.sql.

/** DB-01 §14.3 — 내장 제공자 시드(enabled 1·동의 0). 이미 있으면 바꾸지 않는다(사용자 변경 보존). */
export const SEED_PROVIDER = `INSERT OR IGNORE INTO ai_provider(provider_id, kind, display_name, billing, trust, enabled, secret_source, config_json, created_at, updated_at)
VALUES (:provider_id, :kind, :display_name, :billing, :trust, 1, 'none', '{}', :now, :now)`;

export const READ_MODE_STATE = 'SELECT mode, reasons_json, changed_at FROM ai_mode_state WHERE id = 1';
export const READ_PREVIOUS_MODE =
  'SELECT previous_mode FROM ai_mode_history ORDER BY changed_at DESC, change_id DESC LIMIT 1';
export const LIST_PROVIDERS =
  'SELECT provider_id, kind, display_name, billing, trust, enabled, config_json FROM ai_provider ORDER BY provider_id';
/** `(provider_id, scope)`별 최신 `decided_at` 행(같은 시각이면 더 큰 ULID). 철회(granted 0)도 포함한다. */
export const LIST_LATEST_CONSENTS = `SELECT c.provider_id, c.scope, c.granted, c.decided_at FROM ai_consent c
WHERE c.consent_id = (
  SELECT c2.consent_id FROM ai_consent c2
  WHERE c2.provider_id = c.provider_id AND c2.scope = c.scope
  ORDER BY c2.decided_at DESC, c2.consent_id DESC LIMIT 1
)
ORDER BY c.provider_id, c.scope`;
export const LIST_PROBES = 'SELECT provider_id, status, version, flags_ok, reason_code, probed_at FROM ai_probe ORDER BY provider_id';

export const UPDATE_MODE_STATE = 'UPDATE ai_mode_state SET mode = :mode, reasons_json = :reasons_json, changed_at = :changed_at WHERE id = 1';
export const INSERT_MODE_HISTORY = `INSERT INTO ai_mode_history(change_id, mode, previous_mode, reasons_json, changed_at)
VALUES (:change_id, :mode, :previous_mode, :reasons_json, :changed_at)`;
