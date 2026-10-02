import { AI_ERRORS } from '@fathom/contracts/http/ai-gateway/v1/errors';
import { JudgeRunRoute } from '@fathom/contracts/http/ai-gateway/v1/judge';
import { AppError } from '@fathom/shared-kernel/errors/errors';
import type { ServiceApp } from '@fathom/shared-kernel/service/service';
import type { AiGate } from '../../application/control/ports.js';

/** IF-AI-001 `POST /internal/v1/judge/{task_id}` — R0는 게이트의 즉답(unavailable) 또는 거절(problem)뿐이다. */
export function registerJudgeRoutes(app: ServiceApp, gate: AiGate): void {
  app.route(JudgeRunRoute, (ctx) => {
    const decision = gate.judge(ctx.params.task_id, ctx.body);
    if (!decision.ok) {
      const { status, title } = AI_ERRORS[decision.code];
      return Promise.reject(new AppError(decision.code, status, title));
    }
    return Promise.resolve({ status: 200 as const, body: decision.result });
  });
}
