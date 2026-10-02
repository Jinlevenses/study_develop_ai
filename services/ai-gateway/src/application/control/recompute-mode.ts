import type { AiModeChangedV1 } from '@fathom/contracts/events/catalog/ai';
import type { AiMode } from '@fathom/contracts/common/domain';
import { appendEvent } from '@fathom/shared-kernel/eventing/eventing';
import type { Outbox } from '@fathom/shared-kernel/eventing/eventing';
import type { Logger } from '@fathom/shared-kernel/log/log';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import type { Clock } from '@fathom/shared-kernel/time/time';
import { computeMode, toModeInput } from '../../domain/control/mode-calculator.js';
import { assembleProviders } from '../../domain/control/provider-status.js';
import type { ControlStore } from './ports.js';

export type RecomputeDeps = {
  readonly db: SqlitePort;
  readonly store: ControlStore;
  readonly outbox: Outbox;
  readonly clock: Clock;
  readonly newId: () => string;
  readonly log: Logger;
  readonly safeMode: boolean;
};
export type RecomputeResult = { readonly changed: boolean; readonly mode: AiMode };

/**
 * 모드 재산정(AI-01 §5.1·§5.2, FR-AI-002). 현재 모드와 같으면 아무것도 쓰지 않는다(reasons 갱신 0).
 * 다르면 한 `db.tx`(await 0)로 상태 갱신 + 이력 INSERT + outbox `ai.mode.changed`(STD-EVT-10). 히스테리시스(상향 30s)는 IT-04 — R0는 즉시 적용.
 */
export function recomputeMode(deps: RecomputeDeps): RecomputeResult {
  const { store } = deps;
  const current = store.readModeState();
  const states = assembleProviders({
    providers: store.listProviders(),
    consents: store.listLatestConsents(),
    probes: store.listProbes(),
  });
  const next = computeMode(toModeInput(deps.safeMode, states));
  if (next.mode === current.mode) {
    return { changed: false, mode: current.mode };
  }
  const changedAt = deps.clock.now();
  const changeId = deps.newId();
  const payload: AiModeChangedV1 = {
    mode: next.mode,
    previous_mode: current.mode,
    reasons: [...next.reasons],
    providers: states.map((s) => ({ id: s.meta.provider_id, kind: s.meta.kind, status: s.status })),
    changed_at: changedAt,
  };
  deps.db.tx(() => {
    store.writeTransition(
      { mode: next.mode, reasons: next.reasons, changed_at: changedAt },
      { change_id: changeId, mode: next.mode, previous_mode: current.mode, reasons: next.reasons, changed_at: changedAt },
    );
    appendEvent(deps.outbox, {
      type: 'ai.mode.changed',
      schema_version: 1,
      correlation_id: changeId,
      payload,
    });
  });
  deps.log.info({ event: 'control.mode.changed', mode: next.mode, previous_mode: current.mode }, 'ai mode changed');
  return { changed: true, mode: next.mode };
}
