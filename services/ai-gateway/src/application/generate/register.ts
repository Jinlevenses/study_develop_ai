import type { ServiceApp } from '@fathom/shared-kernel/service/service';
import { registerGenerateRoutes } from '../../http/generate/routes.js';
import type { ControlPorts } from '../control/ports.js';
import type { GenerateDeps, GeneratePorts } from './ports.js';

export function registerGenerate(
  app: ServiceApp,
  deps: GenerateDeps & { readonly infra: GeneratePorts & Pick<ControlPorts, 'gate'> },
): void {
  registerGenerateRoutes(app, deps.infra.gate);
}
