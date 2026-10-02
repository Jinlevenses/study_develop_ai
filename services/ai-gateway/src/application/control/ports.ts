import type { GenerateRequest, GenerateResult } from '@fathom/contracts/ai/generate';
import type { JudgeRequest, JudgeResult } from '@fathom/contracts/ai/judge';
import type { AiMode } from '@fathom/contracts/common/domain';
import type { ModeReason } from '@fathom/contracts/http/ai-gateway/v1/mode';
import type { ServiceDeps } from '@fathom/shared-kernel/service/service';
import type { SqlitePort } from '@fathom/shared-kernel/sqlite/sqlite';
import type { GateDecision, RegistryView } from '../../domain/control/answer-gate.js';
import type { ProviderRow } from '../../domain/control/provider-catalog.js';
import type { ConsentRow, ProbeRow } from '../../domain/control/provider-status.js';

// judge·generate 라우트가 쓰는 타입·게이트는 control BC가 소유한다(check:boundaries bc-cross — `ports.ts` 타입 import만 허용).
export type { GateDecision, GateRejection, RegistryView } from '../../domain/control/answer-gate.js';

export type ModeStateRow = {
  readonly mode: AiMode;
  readonly reasons: readonly ModeReason[];
  readonly changed_at: number;
};
export type ModeHistoryRow = {
  readonly change_id: string;
  readonly mode: AiMode;
  readonly previous_mode: AiMode;
  readonly reasons: readonly ModeReason[];
  readonly changed_at: number;
};

/** control 저장소(구현 = `infra/db/ai-control-store.ts`). 쓰기는 호출자가 연 `db.tx` 안에서만 부른다. */
export interface ControlStore {
  readModeState(): ModeStateRow;
  readPreviousMode(): AiMode | null;
  listProviders(): ProviderRow[];
  /** `(provider_id, scope)`별 최신 행(철회 포함). */
  listLatestConsents(): ConsentRow[];
  listProbes(): ProbeRow[];
  /** `ai_mode_state` 갱신 + `ai_mode_history` INSERT(같은 tx). */
  writeTransition(state: ModeStateRow, history: ModeHistoryRow): void;
}

/** judge·generate 즉답 게이트. 외부 호출·`ai_call_log`·스폰 0. */
export interface AiGate {
  judge(taskId: string, body: JudgeRequest): GateDecision<JudgeResult>;
  generate(taskId: string, body: GenerateRequest): GateDecision<GenerateResult>;
}

export type ControlPorts = {
  readonly db: SqlitePort;
  readonly firstBoot: 'seeded' | 'present';
  readonly registry: RegistryView;
  readonly store: ControlStore;
  readonly gate: AiGate;
};
export type ControlDeps = ServiceDeps<null> & { readonly infra: ControlPorts };
