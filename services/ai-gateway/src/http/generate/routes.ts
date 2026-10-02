import { AI_ERRORS } from '@fathom/contracts/http/ai-gateway/v1/errors';
import { GenerateRunRoute } from '@fathom/contracts/http/ai-gateway/v1/generate';
import { AppError } from '@fathom/shared-kernel/errors/errors';
import type { ServiceApp } from '@fathom/shared-kernel/service/service';
import type { AiGate } from '../../application/control/ports.js';

/** IF-AI-002 `POST /internal/v1/generate/{task_id}` — R0는 게이트의 즉답(unavailable) 또는 거절(problem)뿐이다. */
export function registerGenerateRoutes(app: ServiceApp, gate: AiGate): void {
  app.route(GenerateRunRoute, (ctx) => {
    const decision = gate.generate(ctx.params.task_id, ctx.body);
    if (!decision.ok) {
      const { status, title } = AI_ERRORS[decision.code];
      return Promise.reject(new AppError(decision.code, status, title));
    }
    return Promise.resolve({ status: 200 as const, body: decision.result });
  });
}
