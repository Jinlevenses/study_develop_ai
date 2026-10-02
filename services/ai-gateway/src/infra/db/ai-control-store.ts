import { AiMode, ProviderStatus } from '@fathom/contracts/common/domain';
import { ModeReason } from '@fathom/contracts/http/ai-gateway/v1/mode';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import { z } from 'zod';
import type { ControlStore, ModeHistoryRow, ModeStateRow } from '../../application/control/ports.js';
import type { ProviderRow } from '../../domain/control/provider-catalog.js';
import type { ConsentRow, ProbeRow } from '../../domain/control/provider-status.js';
import {
  INSERT_MODE_HISTORY,
  LIST_LATEST_CONSENTS,
  LIST_PROBES,
  LIST_PROVIDERS,
  READ_MODE_STATE,
  READ_PREVIOUS_MODE,
  UPDATE_MODE_STATE,
} from './ai-control.sql.js';

// control 저장소 구현 — 행은 읽는 즉시 zod로 좁힌다(STD-TS: 경계 검증). 저장 값이 어긋나면 결함(throw).

const Reasons = z.array(ModeReason).max(10);
const ModeRow = z
  .object({ mode: AiMode, reasons_json: z.string(), changed_at: z.number().int() })
  .strict();
const PreviousRow = z.object({ previous_mode: AiMode }).strict();
const Provider = z
  .object({
    provider_id: z.string(),
    kind: z.string(),
    display_name: z.string(),
    billing: z.enum(['metered', 'subscription', 'free', 'local']),
    trust: z.enum(['verified', 'unverified']),
    enabled: z.number().int(),
    config_json: z.string(),
  })
  .strict();
const Consent = z
  .object({
    provider_id: z.string(),
    scope: z.enum(['judge', 'generate', 'batch']),
    granted: z.number().int(),
    decided_at: z.number().int(),
  })
  .strict();
const Probe = z
  .object({
    provider_id: z.string(),
    status: ProviderStatus,
    version: z.string().nullable(),
    flags_ok: z.number().int(),
    reason_code: z.string().nullable(),
    probed_at: z.number().int(),
  })
  .strict();

function parseReasons(json: string): ModeStateRow['reasons'] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (cause) {
    throw new Error('invariant: ai_mode_state.reasons_json is not JSON', { cause });
  }
  return Reasons.parse(raw);
}

export function createControlStore(db: SqlitePort): ControlStore {
  return {
    readModeState(): ModeStateRow {
      const row = db.prepare(READ_MODE_STATE).get();
      if (row === undefined) {
        throw new Error('invariant: ai_mode_state row missing');
      }
      const parsed = ModeRow.parse(row);
      return { mode: parsed.mode, reasons: parseReasons(parsed.reasons_json), changed_at: parsed.changed_at };
    },
    readPreviousMode(): ModeStateRow['mode'] | null {
      const row = db.prepare(READ_PREVIOUS_MODE).get();
      return row === undefined ? null : PreviousRow.parse(row).previous_mode;
    },
    listProviders(): ProviderRow[] {
      return db
        .prepare(LIST_PROVIDERS)
        .all()
        .map((r) => Provider.parse(r));
    },
    listLatestConsents(): ConsentRow[] {
      return db
        .prepare(LIST_LATEST_CONSENTS)
        .all()
        .map((r) => Consent.parse(r));
    },
    listProbes(): ProbeRow[] {
      return db
        .prepare(LIST_PROBES)
        .all()
        .map((r) => Probe.parse(r));
    },
    writeTransition(state: ModeStateRow, history: ModeHistoryRow): void {
      db.prepare(UPDATE_MODE_STATE).run({
        mode: state.mode,
        reasons_json: JSON.stringify(state.reasons),
        changed_at: state.changed_at,
      });
      db.prepare(INSERT_MODE_HISTORY).run({
        change_id: history.change_id,
        mode: history.mode,
        previous_mode: history.previous_mode,
        reasons_json: JSON.stringify(history.reasons),
        changed_at: history.changed_at,
      });
    },
  };
}
