import type { AiMode } from '@fathom/contracts/common/domain';
import { decideGenerate, decideJudge } from '../../domain/control/answer-gate.js';
import type { AiGate, RegistryView } from './ports.js';

/** 매 요청 `ai_mode_state` 1행을 읽어(`readMode`) 도메인 판정에 넘긴다 — 모드 전이가 즉시 반영된다. */
export function createAiGate(deps: { readonly registry: RegistryView; readonly readMode: () => AiMode }): AiGate {
  return {
    judge: (taskId, body) => decideJudge({ taskId, body, registry: deps.registry, mode: deps.readMode() }),
    generate: (taskId, body) => decideGenerate({ taskId, body, registry: deps.registry, mode: deps.readMode() }),
  };
}
