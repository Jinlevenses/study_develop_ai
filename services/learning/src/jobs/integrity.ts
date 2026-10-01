import type { Result } from '@fathom/shared-kernel/errors/errors';
import { err, ok } from '@fathom/shared-kernel/errors/errors';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';

// DB-01 §12.3-3 — 복원 사본의 원장 불변 장치(append-only 트리거 4개) 검사. `def.restoreCheck`로 단다.
export const LEDGER_GUARD_TRIGGERS = [
  'lr_event_no_update',
  'lr_event_no_delete',
  'lr_checkpoint_no_update',
  'lr_checkpoint_no_delete',
] as const;

const GUARD_TRIGGERS_PRESENT =
  "SELECT name FROM sqlite_schema WHERE type = 'trigger' AND name IN ('lr_event_no_update', 'lr_event_no_delete', 'lr_checkpoint_no_update', 'lr_checkpoint_no_delete')";

export function ledgerGuardCheck(
  db: SqlitePort,
): Result<null, { readonly code: 'ledger_guard_missing'; readonly detail: string }> {
  const present = new Set(
    db
      .prepare(GUARD_TRIGGERS_PRESENT)
      .all()
      .map((row) => String(row.name)),
  );
  const missing = LEDGER_GUARD_TRIGGERS.filter((name) => !present.has(name));
  if (missing.length === 0) {
    return ok(null);
  }
  return err({ code: 'ledger_guard_missing', detail: missing.join(', ') });
}
