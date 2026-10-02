import type { ServiceApp, ServiceDeps } from '@fathom/shared-kernel/service/service';
import type { GatewayContext } from '../../config.js';
import { registerApiAiRoutes } from '../../http/api/ai.js';
import { registerApiConceptsRoutes } from '../../http/api/concepts.js';
import { registerApiCurationRoutes } from '../../http/api/curation.js';
import { registerApiDialogsRoutes } from '../../http/api/dialogs.js';
import { registerApiEvidenceRoutes } from '../../http/api/evidence.js';
import { registerApiHomeRoutes } from '../../http/api/home.js';
import { registerApiImportsRoutes } from '../../http/api/imports.js';
import { registerApiInboxRoutes } from '../../http/api/inbox.js';
import { registerApiLongtasksRoutes } from '../../http/api/longtasks.js';
import { registerApiMapRoutes } from '../../http/api/map.js';
import { registerApiOpsRoutes } from '../../http/api/ops.js';
import { registerApiPracticeItemsRoutes } from '../../http/api/practice-items.js';
import { registerApiReviewRoutes } from '../../http/api/review.js';
import { registerApiSessionsRoutes } from '../../http/api/sessions.js';
import { registerApiSettingsRoutes } from '../../http/api/settings.js';

// BFF 그룹 스텁 15개 호출 — 소유 WP가 각 http/api/<group>.ts에 라우트를 등록한다(IT-00은 라우트 0개).
export function registerBff(app: ServiceApp, deps: ServiceDeps<null>, ctx: GatewayContext): void {
  registerApiHomeRoutes(app, deps, ctx);
  registerApiSessionsRoutes(app, deps, ctx);
  registerApiPracticeItemsRoutes(app, deps, ctx);
  registerApiConceptsRoutes(app, deps, ctx);
  registerApiMapRoutes(app, deps, ctx);
  registerApiEvidenceRoutes(app, deps, ctx);
  registerApiDialogsRoutes(app, deps, ctx);
  registerApiLongtasksRoutes(app, deps, ctx);
  registerApiReviewRoutes(app, deps, ctx);
  registerApiInboxRoutes(app, deps, ctx);
  registerApiImportsRoutes(app, deps, ctx);
  registerApiCurationRoutes(app, deps, ctx);
  registerApiAiRoutes(app, deps, ctx);
  registerApiOpsRoutes(app, deps, ctx);
  registerApiSettingsRoutes(app, deps, ctx);
}
