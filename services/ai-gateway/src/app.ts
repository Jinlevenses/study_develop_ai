import type { ServiceApp } from '@fathom/shared-kernel/service/service';
import { registerControl } from './application/control/register.js';
import { registerGenerate } from './application/generate/register.js';
import { registerJudge } from './application/judge/register.js';
import { registerPrivacy } from './application/privacy/register.js';
import { registerRouting } from './application/routing/register.js';
import type { AiDeps } from './config.js';

export function registerApp(app: ServiceApp, deps: AiDeps): void {
  registerControl(app, deps);
  registerRouting(app, deps);
  registerJudge(app, deps);
  registerGenerate(app, deps);
  registerPrivacy(app, deps);
}
