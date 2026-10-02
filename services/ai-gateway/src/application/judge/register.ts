import type { ServiceApp } from '@fathom/shared-kernel/service/service';
import { registerJudgeRoutes } from '../../http/judge/routes.js';
import type { ControlPorts } from '../control/ports.js';
import type { JudgeDeps, JudgePorts } from './ports.js';

export function registerJudge(
  app: ServiceApp,
  deps: JudgeDeps & { readonly infra: JudgePorts & Pick<ControlPorts, 'gate'> },
): void {
  registerJudgeRoutes(app, deps.infra.gate);
}
