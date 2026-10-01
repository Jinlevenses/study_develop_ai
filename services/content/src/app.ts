// 동결 대상(INT-1a, ADR-000 §1) — `register<Bc>()` 목록만 둔다. 바뀔 수 있는 설정은 config.ts에 둔다.
import type { InboxHandlerDef } from '@fathom/shared-kernel/eventing/eventing';
import type { ServiceApp, ServiceDeps } from '@fathom/shared-kernel/service/service';
import { acquisitionInboxHandlers, registerAcquisition } from './application/acquisition/register.js';
import { catalogInboxHandlers, registerCatalog } from './application/catalog/register.js';
import { gradingInboxHandlers, registerGrading } from './application/grading/register.js';
import { itembankInboxHandlers, registerItembank } from './application/itembank/register.js';
import { registerRunner, runnerInboxHandlers } from './application/runner/register.js';
import type { ContentPolicies } from './config.js';

export const CONTENT_INBOX_HANDLERS: readonly InboxHandlerDef[] = [
  ...catalogInboxHandlers,
  ...acquisitionInboxHandlers,
  ...itembankInboxHandlers,
  ...gradingInboxHandlers,
  ...runnerInboxHandlers,
];

export function registerAll(app: ServiceApp, deps: ServiceDeps<ContentPolicies>): void {
  registerCatalog(app, deps);
  registerAcquisition(app, deps);
  registerItembank(app, deps);
  registerGrading(app, deps);
  registerRunner(app, deps);
}
