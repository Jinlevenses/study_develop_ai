import type { ServiceApp } from '@fathom/shared-kernel/service/service';
import { registerAutostart } from './application/autostart/register.js';
import { registerBackup } from './application/backup/register.js';
import { registerDoctor } from './application/doctor/register.js';
import { registerHealth } from './application/health/register.js';
import { registerHost } from './application/host/register.js';
import { registerTelemetry } from './application/telemetry/register.js';
import { registerUpgrade } from './application/upgrade/register.js';
import type { OpsDeps } from './config.js';

export function registerApp(app: ServiceApp, deps: OpsDeps): void {
  registerBackup(app, deps);
  registerHealth(app, deps);
  registerDoctor(app, deps);
  registerHost(app, deps);
  registerUpgrade(app, deps);
  registerAutostart(app, deps);
  registerTelemetry(app, deps);
}
