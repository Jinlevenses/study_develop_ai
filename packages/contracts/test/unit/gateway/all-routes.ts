// 테스트 전용: 6개 서비스의 라우트 배열을 한곳에 모은다(IF-COM 10 + GW 179 + LR 75 + CT 55 + AI 39 + OP 28 = 386).

import { COMMON_ADMIN_ROUTES } from '../../../src/admin/admin-routes.js';
import type { RouteDef } from '../../../src/common/route.js';
import { InboxDeliverRoute } from '../../../src/events/inbox.js';
import { AI_CALIBRATION_ROUTES } from '../../../src/http/ai-gateway/v1/calibration.js';
import { AI_FIREWALL_ROUTES } from '../../../src/http/ai-gateway/v1/firewall.js';
import { AI_GENERATE_ROUTES } from '../../../src/http/ai-gateway/v1/generate.js';
import { AI_JOBS_ROUTES } from '../../../src/http/ai-gateway/v1/jobs.js';
import { AI_JUDGE_ROUTES } from '../../../src/http/ai-gateway/v1/judge.js';
import { AI_MODE_ROUTES } from '../../../src/http/ai-gateway/v1/mode.js';
import { AI_PROVIDERS_ROUTES } from '../../../src/http/ai-gateway/v1/providers.js';
import { AI_SECRETS_ROUTES } from '../../../src/http/ai-gateway/v1/secrets.js';
import { AI_STREAMS_ROUTES } from '../../../src/http/ai-gateway/v1/streams.js';
import { AI_USAGE_ROUTES } from '../../../src/http/ai-gateway/v1/usage.js';
import { AI_WORK_ORDERS_ROUTES } from '../../../src/http/ai-gateway/v1/work-orders.js';
import { CT_ACQUISITION_ROUTES } from '../../../src/http/content/v1/acquisition.js';
import { CT_CATALOG_ROUTES } from '../../../src/http/content/v1/catalog.js';
import { CT_GRADING_ROUTES } from '../../../src/http/content/v1/grading.js';
import { CT_ITEMBANK_ROUTES } from '../../../src/http/content/v1/itembank.js';
import { CT_OVERLAYS_ROUTES } from '../../../src/http/content/v1/overlays.js';
import { CT_RUNNER_ROUTES } from '../../../src/http/content/v1/runner.js';
import { GW_AI_ROUTES } from '../../../src/http/gateway/v1/ai.js';
import { GW_CLI_ROUTES } from '../../../src/http/gateway/v1/cli.js';
import { GW_CONCEPTS_ROUTES } from '../../../src/http/gateway/v1/concepts.js';
import { GW_CURATION_ROUTES } from '../../../src/http/gateway/v1/curation.js';
import { GW_DIALOGS_ROUTES } from '../../../src/http/gateway/v1/dialogs.js';
import { GW_EVIDENCE_ROUTES } from '../../../src/http/gateway/v1/evidence.js';
import { GW_HOME_ROUTES } from '../../../src/http/gateway/v1/home.js';
import { GW_IMPORTS_ROUTES } from '../../../src/http/gateway/v1/imports.js';
import { GW_INBOX_ROUTES } from '../../../src/http/gateway/v1/inbox.js';
import { GW_INTERNAL_ROUTES } from '../../../src/http/gateway/v1/internal.js';
import { GW_LONGTASKS_ROUTES } from '../../../src/http/gateway/v1/longtasks.js';
import { GW_MAP_ROUTES } from '../../../src/http/gateway/v1/map.js';
import { GW_OPS_ROUTES } from '../../../src/http/gateway/v1/ops.js';
import { GW_PRACTICE_ITEMS_ROUTES } from '../../../src/http/gateway/v1/practice-items.js';
import { GW_REVIEW_ROUTES } from '../../../src/http/gateway/v1/review.js';
import { GW_SESSION_ROUTES } from '../../../src/http/gateway/v1/session.js';
import { GW_SESSIONS_ROUTES } from '../../../src/http/gateway/v1/sessions.js';
import { GW_SETTINGS_ROUTES } from '../../../src/http/gateway/v1/settings.js';
import { GW_STREAM_ROUTES } from '../../../src/http/gateway/v1/stream.js';
import { LR_DIALOGS_ROUTES } from '../../../src/http/learning/v1/dialogs.js';
import { LR_INSIGHT_ROUTES } from '../../../src/http/learning/v1/insight.js';
import { LR_LEARNER_ROUTES } from '../../../src/http/learning/v1/learner.js';
import { LR_LEDGER_ROUTES } from '../../../src/http/learning/v1/ledger.js';
import { LR_LONGTASKS_ROUTES } from '../../../src/http/learning/v1/longtasks.js';
import { LR_NOTES_ROUTES } from '../../../src/http/learning/v1/notes.js';
import { LR_SEASONS_ROUTES } from '../../../src/http/learning/v1/seasons.js';
import { LR_SESSIONS_ROUTES } from '../../../src/http/learning/v1/sessions.js';
import { LR_SETTINGS_ROUTES } from '../../../src/http/learning/v1/settings.js';
import { LR_TELEMETRY_ROUTES } from '../../../src/http/learning/v1/telemetry.js';
import { OP_AUTOSTART_ROUTES } from '../../../src/http/ops/v1/autostart.js';
import { OP_BACKUPS_ROUTES } from '../../../src/http/ops/v1/backups.js';
import { OP_DOCTOR_ROUTES } from '../../../src/http/ops/v1/doctor.js';
import { OP_HEALTH_ROUTES } from '../../../src/http/ops/v1/health.js';
import { OP_LOGS_ROUTES } from '../../../src/http/ops/v1/logs.js';
import { OP_OPERATIONS_ROUTES } from '../../../src/http/ops/v1/operations.js';
import { OP_SYSTEM_ROUTES } from '../../../src/http/ops/v1/system.js';
import { OP_TELEMETRY_ROUTES } from '../../../src/http/ops/v1/telemetry.js';
import { OP_TIMELINE_ROUTES } from '../../../src/http/ops/v1/timeline.js';
import { OP_TRANSFER_ROUTES } from '../../../src/http/ops/v1/transfer.js';
import { OP_UPGRADE_ROUTES } from '../../../src/http/ops/v1/upgrade.js';

export const GW_GROUPS: Readonly<Record<string, readonly RouteDef[]>> = {
  session: GW_SESSION_ROUTES,
  stream: GW_STREAM_ROUTES,
  home: GW_HOME_ROUTES,
  sessions: GW_SESSIONS_ROUTES,
  'practice-items': GW_PRACTICE_ITEMS_ROUTES,
  concepts: GW_CONCEPTS_ROUTES,
  map: GW_MAP_ROUTES,
  evidence: GW_EVIDENCE_ROUTES,
  dialogs: GW_DIALOGS_ROUTES,
  longtasks: GW_LONGTASKS_ROUTES,
  review: GW_REVIEW_ROUTES,
  inbox: GW_INBOX_ROUTES,
  imports: GW_IMPORTS_ROUTES,
  curation: GW_CURATION_ROUTES,
  ai: GW_AI_ROUTES,
  ops: GW_OPS_ROUTES,
  settings: GW_SETTINGS_ROUTES,
  cli: GW_CLI_ROUTES,
  internal: GW_INTERNAL_ROUTES,
};
export const LR_ALL: readonly RouteDef[] = [
  ...LR_SESSIONS_ROUTES,
  ...LR_DIALOGS_ROUTES,
  ...LR_NOTES_ROUTES,
  ...LR_LONGTASKS_ROUTES,
  ...LR_SEASONS_ROUTES,
  ...LR_LEARNER_ROUTES,
  ...LR_INSIGHT_ROUTES,
  ...LR_SETTINGS_ROUTES,
  ...LR_LEDGER_ROUTES,
  ...LR_TELEMETRY_ROUTES,
];
export const CT_ALL: readonly RouteDef[] = [
  ...CT_CATALOG_ROUTES,
  ...CT_OVERLAYS_ROUTES,
  ...CT_ACQUISITION_ROUTES,
  ...CT_GRADING_ROUTES,
  ...CT_RUNNER_ROUTES,
  ...CT_ITEMBANK_ROUTES,
];
export const AI_ALL: readonly RouteDef[] = [
  ...AI_JUDGE_ROUTES,
  ...AI_GENERATE_ROUTES,
  ...AI_STREAMS_ROUTES,
  ...AI_JOBS_ROUTES,
  ...AI_WORK_ORDERS_ROUTES,
  ...AI_PROVIDERS_ROUTES,
  ...AI_SECRETS_ROUTES,
  ...AI_USAGE_ROUTES,
  ...AI_MODE_ROUTES,
  ...AI_CALIBRATION_ROUTES,
  ...AI_FIREWALL_ROUTES,
];
export const OP_ALL: readonly RouteDef[] = [
  ...OP_HEALTH_ROUTES,
  ...OP_OPERATIONS_ROUTES,
  ...OP_BACKUPS_ROUTES,
  ...OP_TRANSFER_ROUTES,
  ...OP_DOCTOR_ROUTES,
  ...OP_UPGRADE_ROUTES,
  ...OP_AUTOSTART_ROUTES,
  ...OP_TIMELINE_ROUTES,
  ...OP_LOGS_ROUTES,
  ...OP_TELEMETRY_ROUTES,
  ...OP_SYSTEM_ROUTES,
];
export const GW_ALL: readonly RouteDef[] = Object.values(GW_GROUPS).flat();
export const COM_ALL: readonly RouteDef[] = [...COMMON_ADMIN_ROUTES, InboxDeliverRoute]; // IF-COM-004 = events/inbox.ts
export const ALL_ROUTES: readonly RouteDef[] = [...COM_ALL, ...GW_ALL, ...LR_ALL, ...CT_ALL, ...AI_ALL, ...OP_ALL];
