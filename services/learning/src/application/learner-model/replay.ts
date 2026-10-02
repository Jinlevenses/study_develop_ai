import type { LedgerEventEnvelope } from '@fathom/contracts/ledger/envelope';
import { PolicySwitchedV1 } from '@fathom/contracts/ledger/payloads/policy-switched';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import { foldEvents } from '../../domain/learner-model/projector/apply.js';
import { buildCorrectionIndex } from '../../domain/learner-model/projector/corrections.js';
import type { ProjectionSlice } from '../../domain/learner-model/projector/types.js';
import type { LedgerReplaySource, ProjectorParamsResolver } from './ports.js';

// ADR-011 §5 전체 리플레이 = 2-패스(정정 인덱스 → 본 패스). replay-verify·rebuild가 같은 함수를 쓴다(메모리 fold, 쓰기 0).

export type ReplayFoldResult = { readonly slice: ProjectionSlice; readonly event_count: number };

/** policy.switched를 볼 때마다 resolver에 등록한다(라이브·리플레이 공통, §4.1). */
export function registerPolicySwitch(params: ProjectorParamsResolver, event: LedgerEventEnvelope): void {
  if (event.type !== 'policy.switched') {
    return;
  }
  const parsed = PolicySwitchedV1.safeParse(event.payload);
  if (!parsed.success) {
    throw new Error(`invariant: policy.switched payload invalid ${event.event_id}`);
  }
  params.register(parsed.data.policy_version, parsed.data.members);
}

/** 원장 전체 리플레이(총순서)를 메모리 slice로 접는다. */
export function replayFold(
  db: SqlitePort,
  source: LedgerReplaySource,
  params: ProjectorParamsResolver,
): ReplayFoldResult {
  const index = buildCorrectionIndex(source.replay(db));
  let count = 0;
  function* tapped(): IterableIterator<LedgerEventEnvelope> {
    for (const event of source.replay(db)) {
      count += 1;
      registerPolicySwitch(params, event);
      yield event;
    }
  }
  const slice = foldEvents(tapped(), (ps) => params.resolve(db, ps), index);
  return { slice, event_count: count };
}
