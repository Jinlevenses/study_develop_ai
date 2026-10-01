// contracts:gen — packages/contracts 의 계약 원천(src/**)에서 이벤트 레지스트리·라우팅·계약 스냅샷을 결정적으로 생성한다.
// (WP-00-09, ADR-008 §7, D-WBS-07, PR-7, IF-01 §2.10-4·§9.1) 수기 편집 금지 — 생성물은 이 스크립트만 쓴다(STD-GIT-05).
// 실행: pnpm contracts:gen [--check] [--root <dir>]. src 밖 파일이라 node:* 허용(STD 계약 패키지 규칙), 시계·난수·환경변수 0.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import * as m_admin_admin_routes from '../src/admin/admin-routes.js';
import * as m_admin_epoch_manifest from '../src/admin/epoch-manifest.js';
import * as m_admin_ipc from '../src/admin/ipc.js';
import * as m_admin_jobs from '../src/admin/jobs.js';
import * as m_ai_ai_gateway_policy from '../src/ai/ai-gateway-policy.js';
import * as m_ai_data_class from '../src/ai/data-class.js';
import * as m_ai_errors from '../src/ai/errors.js';
import * as m_ai_generate from '../src/ai/generate.js';
import * as m_ai_judge from '../src/ai/judge.js';
import * as m_ai_judge_keys from '../src/ai/judge-keys.js';
import * as m_ai_portable_schema from '../src/ai/portable-schema.js';
import * as m_ai_stream from '../src/ai/stream.js';
import * as m_ai_tasks from '../src/ai/tasks.js';
import * as m_ai_work_order from '../src/ai/work-order.js';
import * as m_common_degraded from '../src/common/degraded.js';
import * as m_common_domain from '../src/common/domain.js';
import * as m_common_errors from '../src/common/errors.js';
import * as m_common_ids from '../src/common/ids.js';
import * as m_common_ndjson from '../src/common/ndjson.js';
import * as m_common_pagination from '../src/common/pagination.js';
import * as m_common_practice from '../src/common/practice.js';
import * as m_common_problem from '../src/common/problem.js';
import * as m_common_route from '../src/common/route.js';
import * as m_common_schema from '../src/common/schema.js';
import * as m_common_time from '../src/common/time.js';
import * as m_db_hooks from '../src/db-hooks.js';
import * as m_events_catalog_acquisition from '../src/events/catalog/acquisition.js';
import * as m_events_catalog_ai from '../src/events/catalog/ai.js';
import * as m_events_catalog_catalog from '../src/events/catalog/catalog.js';
import * as m_events_catalog_grading from '../src/events/catalog/grading.js';
import * as m_events_catalog_itembank from '../src/events/catalog/itembank.js';
import * as m_events_catalog_learning from '../src/events/catalog/learning.js';
import * as m_events_catalog_ops from '../src/events/catalog/ops.js';
import * as m_events_consumer_manifest from '../src/events/consumer-manifest.js';
import { ConsumerManifest } from '../src/events/consumer-manifest.js';
import * as m_events_envelope from '../src/events/envelope.js';
import * as m_events_inbox from '../src/events/inbox.js';
import * as m_http_ai_gateway_v1_calibration from '../src/http/ai-gateway/v1/calibration.js';
import * as m_http_ai_gateway_v1_errors from '../src/http/ai-gateway/v1/errors.js';
import * as m_http_ai_gateway_v1_firewall from '../src/http/ai-gateway/v1/firewall.js';
import * as m_http_ai_gateway_v1_generate from '../src/http/ai-gateway/v1/generate.js';
import * as m_http_ai_gateway_v1_jobs from '../src/http/ai-gateway/v1/jobs.js';
import * as m_http_ai_gateway_v1_judge from '../src/http/ai-gateway/v1/judge.js';
import * as m_http_ai_gateway_v1_mode from '../src/http/ai-gateway/v1/mode.js';
import * as m_http_ai_gateway_v1_providers from '../src/http/ai-gateway/v1/providers.js';
import * as m_http_ai_gateway_v1_secrets from '../src/http/ai-gateway/v1/secrets.js';
import * as m_http_ai_gateway_v1_streams from '../src/http/ai-gateway/v1/streams.js';
import * as m_http_ai_gateway_v1_usage from '../src/http/ai-gateway/v1/usage.js';
import * as m_http_ai_gateway_v1_work_orders from '../src/http/ai-gateway/v1/work-orders.js';
import * as m_http_content_v1_acquisition from '../src/http/content/v1/acquisition.js';
import * as m_http_content_v1_catalog from '../src/http/content/v1/catalog.js';
import * as m_http_content_v1_errors from '../src/http/content/v1/errors.js';
import * as m_http_content_v1_grading from '../src/http/content/v1/grading.js';
import * as m_http_content_v1_itembank from '../src/http/content/v1/itembank.js';
import * as m_http_content_v1_overlays from '../src/http/content/v1/overlays.js';
import * as m_http_content_v1_post_submit_grading from '../src/http/content/v1/post-submit/grading.js';
import * as m_http_content_v1_post_submit_judge_card from '../src/http/content/v1/post-submit/judge-card.js';
import * as m_http_content_v1_pre_submit_case from '../src/http/content/v1/pre-submit/case.js';
import * as m_http_content_v1_pre_submit_concept from '../src/http/content/v1/pre-submit/concept.js';
import * as m_http_content_v1_pre_submit_hint from '../src/http/content/v1/pre-submit/hint.js';
import * as m_http_content_v1_pre_submit_item from '../src/http/content/v1/pre-submit/item.js';
import * as m_http_content_v1_runner from '../src/http/content/v1/runner.js';
import * as m_http_gateway_v1_ai from '../src/http/gateway/v1/ai.js';
import * as m_http_gateway_v1_cli from '../src/http/gateway/v1/cli.js';
import * as m_http_gateway_v1_concepts from '../src/http/gateway/v1/concepts.js';
import * as m_http_gateway_v1_curation from '../src/http/gateway/v1/curation.js';
import * as m_http_gateway_v1_dialogs from '../src/http/gateway/v1/dialogs.js';
import * as m_http_gateway_v1_errors from '../src/http/gateway/v1/errors.js';
import * as m_http_gateway_v1_evidence from '../src/http/gateway/v1/evidence.js';
import * as m_http_gateway_v1_home from '../src/http/gateway/v1/home.js';
import * as m_http_gateway_v1_imports from '../src/http/gateway/v1/imports.js';
import * as m_http_gateway_v1_inbox from '../src/http/gateway/v1/inbox.js';
import * as m_http_gateway_v1_internal from '../src/http/gateway/v1/internal.js';
import * as m_http_gateway_v1_longtasks from '../src/http/gateway/v1/longtasks.js';
import * as m_http_gateway_v1_map from '../src/http/gateway/v1/map.js';
import * as m_http_gateway_v1_ops from '../src/http/gateway/v1/ops.js';
import * as m_http_gateway_v1_practice_items from '../src/http/gateway/v1/practice-items.js';
import * as m_http_gateway_v1_review from '../src/http/gateway/v1/review.js';
import * as m_http_gateway_v1_session from '../src/http/gateway/v1/session.js';
import * as m_http_gateway_v1_sessions from '../src/http/gateway/v1/sessions.js';
import * as m_http_gateway_v1_settings from '../src/http/gateway/v1/settings.js';
import * as m_http_gateway_v1_stream from '../src/http/gateway/v1/stream.js';
import * as m_http_learning_v1_attempts from '../src/http/learning/v1/attempts.js';
import * as m_http_learning_v1_dialogs from '../src/http/learning/v1/dialogs.js';
import * as m_http_learning_v1_errors from '../src/http/learning/v1/errors.js';
import * as m_http_learning_v1_insight from '../src/http/learning/v1/insight.js';
import * as m_http_learning_v1_learner from '../src/http/learning/v1/learner.js';
import * as m_http_learning_v1_ledger from '../src/http/learning/v1/ledger.js';
import * as m_http_learning_v1_longtasks from '../src/http/learning/v1/longtasks.js';
import * as m_http_learning_v1_notes from '../src/http/learning/v1/notes.js';
import * as m_http_learning_v1_post_submit_artifact from '../src/http/learning/v1/post-submit/artifact.js';
import * as m_http_learning_v1_post_submit_attempt from '../src/http/learning/v1/post-submit/attempt.js';
import * as m_http_learning_v1_post_submit_case from '../src/http/learning/v1/post-submit/case.js';
import * as m_http_learning_v1_post_submit_note from '../src/http/learning/v1/post-submit/note.js';
import * as m_http_learning_v1_pre_submit_artifact from '../src/http/learning/v1/pre-submit/artifact.js';
import * as m_http_learning_v1_pre_submit_block from '../src/http/learning/v1/pre-submit/block.js';
import * as m_http_learning_v1_pre_submit_case from '../src/http/learning/v1/pre-submit/case.js';
import * as m_http_learning_v1_pre_submit_note from '../src/http/learning/v1/pre-submit/note.js';
import * as m_http_learning_v1_seasons from '../src/http/learning/v1/seasons.js';
import * as m_http_learning_v1_sessions from '../src/http/learning/v1/sessions.js';
import * as m_http_learning_v1_settings from '../src/http/learning/v1/settings.js';
import * as m_http_learning_v1_telemetry from '../src/http/learning/v1/telemetry.js';
import * as m_http_ops_v1_autostart from '../src/http/ops/v1/autostart.js';
import * as m_http_ops_v1_backups from '../src/http/ops/v1/backups.js';
import * as m_http_ops_v1_doctor from '../src/http/ops/v1/doctor.js';
import * as m_http_ops_v1_errors from '../src/http/ops/v1/errors.js';
import * as m_http_ops_v1_health from '../src/http/ops/v1/health.js';
import * as m_http_ops_v1_logs from '../src/http/ops/v1/logs.js';
import * as m_http_ops_v1_operations from '../src/http/ops/v1/operations.js';
import * as m_http_ops_v1_system from '../src/http/ops/v1/system.js';
import * as m_http_ops_v1_telemetry from '../src/http/ops/v1/telemetry.js';
import * as m_http_ops_v1_timeline from '../src/http/ops/v1/timeline.js';
import * as m_http_ops_v1_transfer from '../src/http/ops/v1/transfer.js';
import * as m_http_ops_v1_upgrade from '../src/http/ops/v1/upgrade.js';
import * as m_ledger_envelope from '../src/ledger/envelope.js';
import * as m_ledger_payloads_ai_mode_observed from '../src/ledger/payloads/ai-mode-observed.js';
import * as m_ledger_payloads_attempt_graded from '../src/ledger/payloads/attempt-graded.js';
import * as m_ledger_payloads_card_enrolled from '../src/ledger/payloads/card-enrolled.js';
import * as m_ledger_payloads_card_status_changed from '../src/ledger/payloads/card-status-changed.js';
import * as m_ledger_payloads_declaration_sealed from '../src/ledger/payloads/declaration-sealed.js';
import * as m_ledger_payloads_evidence_regraded from '../src/ledger/payloads/evidence-regraded.js';
import * as m_ledger_payloads_evidence_upgraded from '../src/ledger/payloads/evidence-upgraded.js';
import * as m_ledger_payloads_evidence_voided from '../src/ledger/payloads/evidence-voided.js';
import * as m_ledger_payloads_evidence_weight_adjusted from '../src/ledger/payloads/evidence-weight-adjusted.js';
import * as m_ledger_payloads_lesson_completed from '../src/ledger/payloads/lesson-completed.js';
import * as m_ledger_payloads_level_promoted from '../src/ledger/payloads/level-promoted.js';
import * as m_ledger_payloads_level_provisional_resolved from '../src/ledger/payloads/level-provisional-resolved.js';
import * as m_ledger_payloads_policy_switched from '../src/ledger/payloads/policy-switched.js';
import * as m_ledger_payloads_pretest_answered from '../src/ledger/payloads/pretest-answered.js';
import * as m_ledger_payloads_profile_setting_changed from '../src/ledger/payloads/profile-setting-changed.js';
import * as m_ledger_payloads_promotion_exam_completed from '../src/ledger/payloads/promotion-exam-completed.js';
import * as m_ledger_payloads_self_assessment_recorded from '../src/ledger/payloads/self-assessment-recorded.js';
import * as m_ledger_payloads_verdict_carried from '../src/ledger/payloads/verdict-carried.js';
import * as m_ledger_types from '../src/ledger/types.js';
import * as m_ledger_versions from '../src/ledger/versions.js';
import * as m_manifests_modes from '../src/manifests/modes.js';
import * as m_manifests_verification_class from '../src/manifests/verification-class.js';
import * as m_pack_delta from '../src/pack/delta.js';
import * as m_pack_feasibility from '../src/pack/feasibility.js';
import * as m_pack_manifest from '../src/pack/manifest.js';
import * as m_pack_records from '../src/pack/records.js';
import * as m_policy_ai_policy from '../src/policy/ai_policy.js';
import * as m_policy_cbm_params from '../src/policy/cbm_params.js';
import * as m_policy_composer_policy from '../src/policy/composer_policy.js';
import * as m_policy_firewall_rules from '../src/policy/firewall_rules.js';
import * as m_policy_fsrs_params from '../src/policy/fsrs_params.js';
import * as m_policy_gaming_params from '../src/policy/gaming_params.js';
import * as m_policy_gate_thresholds from '../src/policy/gate_thresholds.js';
import * as m_policy_ldi_params from '../src/policy/ldi_params.js';
import * as m_policy_lock from '../src/policy/lock.js';
import * as m_policy_mastery_rules from '../src/policy/mastery_rules.js';
import * as m_policy_method_policy from '../src/policy/method_policy.js';
import * as m_policy_ops_policy from '../src/policy/ops_policy.js';
import * as m_policy_search_params from '../src/policy/search_params.js';

// ---- 모듈 목록(정적 namespace import — 동적 import(변수) 금지, STD 12). 누락은 UT-CON-227이 잡는다. -------------------------------
type ModuleNs = Readonly<Record<string, unknown>>;
export const MODULES: readonly (readonly [string, ModuleNs])[] = [
  ['admin/admin-routes', m_admin_admin_routes],
  ['admin/epoch-manifest', m_admin_epoch_manifest],
  ['admin/ipc', m_admin_ipc],
  ['admin/jobs', m_admin_jobs],
  ['ai/ai-gateway-policy', m_ai_ai_gateway_policy],
  ['ai/data-class', m_ai_data_class],
  ['ai/errors', m_ai_errors],
  ['ai/generate', m_ai_generate],
  ['ai/judge', m_ai_judge],
  ['ai/judge-keys', m_ai_judge_keys],
  ['ai/portable-schema', m_ai_portable_schema],
  ['ai/stream', m_ai_stream],
  ['ai/tasks', m_ai_tasks],
  ['ai/work-order', m_ai_work_order],
  ['common/degraded', m_common_degraded],
  ['common/domain', m_common_domain],
  ['common/errors', m_common_errors],
  ['common/ids', m_common_ids],
  ['common/ndjson', m_common_ndjson],
  ['common/pagination', m_common_pagination],
  ['common/practice', m_common_practice],
  ['common/problem', m_common_problem],
  ['common/route', m_common_route],
  ['common/schema', m_common_schema],
  ['common/time', m_common_time],
  ['db-hooks', m_db_hooks],
  ['events/catalog/acquisition', m_events_catalog_acquisition],
  ['events/catalog/ai', m_events_catalog_ai],
  ['events/catalog/catalog', m_events_catalog_catalog],
  ['events/catalog/grading', m_events_catalog_grading],
  ['events/catalog/itembank', m_events_catalog_itembank],
  ['events/catalog/learning', m_events_catalog_learning],
  ['events/catalog/ops', m_events_catalog_ops],
  ['events/consumer-manifest', m_events_consumer_manifest],
  ['events/envelope', m_events_envelope],
  ['events/inbox', m_events_inbox],
  ['http/ai-gateway/v1/calibration', m_http_ai_gateway_v1_calibration],
  ['http/ai-gateway/v1/errors', m_http_ai_gateway_v1_errors],
  ['http/ai-gateway/v1/firewall', m_http_ai_gateway_v1_firewall],
  ['http/ai-gateway/v1/generate', m_http_ai_gateway_v1_generate],
  ['http/ai-gateway/v1/jobs', m_http_ai_gateway_v1_jobs],
  ['http/ai-gateway/v1/judge', m_http_ai_gateway_v1_judge],
  ['http/ai-gateway/v1/mode', m_http_ai_gateway_v1_mode],
  ['http/ai-gateway/v1/providers', m_http_ai_gateway_v1_providers],
  ['http/ai-gateway/v1/secrets', m_http_ai_gateway_v1_secrets],
  ['http/ai-gateway/v1/streams', m_http_ai_gateway_v1_streams],
  ['http/ai-gateway/v1/usage', m_http_ai_gateway_v1_usage],
  ['http/ai-gateway/v1/work-orders', m_http_ai_gateway_v1_work_orders],
  ['http/content/v1/acquisition', m_http_content_v1_acquisition],
  ['http/content/v1/catalog', m_http_content_v1_catalog],
  ['http/content/v1/errors', m_http_content_v1_errors],
  ['http/content/v1/grading', m_http_content_v1_grading],
  ['http/content/v1/itembank', m_http_content_v1_itembank],
  ['http/content/v1/overlays', m_http_content_v1_overlays],
  ['http/content/v1/post-submit/grading', m_http_content_v1_post_submit_grading],
  ['http/content/v1/post-submit/judge-card', m_http_content_v1_post_submit_judge_card],
  ['http/content/v1/pre-submit/case', m_http_content_v1_pre_submit_case],
  ['http/content/v1/pre-submit/concept', m_http_content_v1_pre_submit_concept],
  ['http/content/v1/pre-submit/hint', m_http_content_v1_pre_submit_hint],
  ['http/content/v1/pre-submit/item', m_http_content_v1_pre_submit_item],
  ['http/content/v1/runner', m_http_content_v1_runner],
  ['http/gateway/v1/ai', m_http_gateway_v1_ai],
  ['http/gateway/v1/cli', m_http_gateway_v1_cli],
  ['http/gateway/v1/concepts', m_http_gateway_v1_concepts],
  ['http/gateway/v1/curation', m_http_gateway_v1_curation],
  ['http/gateway/v1/dialogs', m_http_gateway_v1_dialogs],
  ['http/gateway/v1/errors', m_http_gateway_v1_errors],
  ['http/gateway/v1/evidence', m_http_gateway_v1_evidence],
  ['http/gateway/v1/home', m_http_gateway_v1_home],
  ['http/gateway/v1/imports', m_http_gateway_v1_imports],
  ['http/gateway/v1/inbox', m_http_gateway_v1_inbox],
  ['http/gateway/v1/internal', m_http_gateway_v1_internal],
  ['http/gateway/v1/longtasks', m_http_gateway_v1_longtasks],
  ['http/gateway/v1/map', m_http_gateway_v1_map],
  ['http/gateway/v1/ops', m_http_gateway_v1_ops],
  ['http/gateway/v1/practice-items', m_http_gateway_v1_practice_items],
  ['http/gateway/v1/review', m_http_gateway_v1_review],
  ['http/gateway/v1/session', m_http_gateway_v1_session],
  ['http/gateway/v1/sessions', m_http_gateway_v1_sessions],
  ['http/gateway/v1/settings', m_http_gateway_v1_settings],
  ['http/gateway/v1/stream', m_http_gateway_v1_stream],
  ['http/learning/v1/attempts', m_http_learning_v1_attempts],
  ['http/learning/v1/dialogs', m_http_learning_v1_dialogs],
  ['http/learning/v1/errors', m_http_learning_v1_errors],
  ['http/learning/v1/insight', m_http_learning_v1_insight],
  ['http/learning/v1/learner', m_http_learning_v1_learner],
  ['http/learning/v1/ledger', m_http_learning_v1_ledger],
  ['http/learning/v1/longtasks', m_http_learning_v1_longtasks],
  ['http/learning/v1/notes', m_http_learning_v1_notes],
  ['http/learning/v1/post-submit/artifact', m_http_learning_v1_post_submit_artifact],
  ['http/learning/v1/post-submit/attempt', m_http_learning_v1_post_submit_attempt],
  ['http/learning/v1/post-submit/case', m_http_learning_v1_post_submit_case],
  ['http/learning/v1/post-submit/note', m_http_learning_v1_post_submit_note],
  ['http/learning/v1/pre-submit/artifact', m_http_learning_v1_pre_submit_artifact],
  ['http/learning/v1/pre-submit/block', m_http_learning_v1_pre_submit_block],
  ['http/learning/v1/pre-submit/case', m_http_learning_v1_pre_submit_case],
  ['http/learning/v1/pre-submit/note', m_http_learning_v1_pre_submit_note],
  ['http/learning/v1/seasons', m_http_learning_v1_seasons],
  ['http/learning/v1/sessions', m_http_learning_v1_sessions],
  ['http/learning/v1/settings', m_http_learning_v1_settings],
  ['http/learning/v1/telemetry', m_http_learning_v1_telemetry],
  ['http/ops/v1/autostart', m_http_ops_v1_autostart],
  ['http/ops/v1/backups', m_http_ops_v1_backups],
  ['http/ops/v1/doctor', m_http_ops_v1_doctor],
  ['http/ops/v1/errors', m_http_ops_v1_errors],
  ['http/ops/v1/health', m_http_ops_v1_health],
  ['http/ops/v1/logs', m_http_ops_v1_logs],
  ['http/ops/v1/operations', m_http_ops_v1_operations],
  ['http/ops/v1/system', m_http_ops_v1_system],
  ['http/ops/v1/telemetry', m_http_ops_v1_telemetry],
  ['http/ops/v1/timeline', m_http_ops_v1_timeline],
  ['http/ops/v1/transfer', m_http_ops_v1_transfer],
  ['http/ops/v1/upgrade', m_http_ops_v1_upgrade],
  ['ledger/envelope', m_ledger_envelope],
  ['ledger/payloads/ai-mode-observed', m_ledger_payloads_ai_mode_observed],
  ['ledger/payloads/attempt-graded', m_ledger_payloads_attempt_graded],
  ['ledger/payloads/card-enrolled', m_ledger_payloads_card_enrolled],
  ['ledger/payloads/card-status-changed', m_ledger_payloads_card_status_changed],
  ['ledger/payloads/declaration-sealed', m_ledger_payloads_declaration_sealed],
  ['ledger/payloads/evidence-regraded', m_ledger_payloads_evidence_regraded],
  ['ledger/payloads/evidence-upgraded', m_ledger_payloads_evidence_upgraded],
  ['ledger/payloads/evidence-voided', m_ledger_payloads_evidence_voided],
  ['ledger/payloads/evidence-weight-adjusted', m_ledger_payloads_evidence_weight_adjusted],
  ['ledger/payloads/lesson-completed', m_ledger_payloads_lesson_completed],
  ['ledger/payloads/level-promoted', m_ledger_payloads_level_promoted],
  ['ledger/payloads/level-provisional-resolved', m_ledger_payloads_level_provisional_resolved],
  ['ledger/payloads/policy-switched', m_ledger_payloads_policy_switched],
  ['ledger/payloads/pretest-answered', m_ledger_payloads_pretest_answered],
  ['ledger/payloads/profile-setting-changed', m_ledger_payloads_profile_setting_changed],
  ['ledger/payloads/promotion-exam-completed', m_ledger_payloads_promotion_exam_completed],
  ['ledger/payloads/self-assessment-recorded', m_ledger_payloads_self_assessment_recorded],
  ['ledger/payloads/verdict-carried', m_ledger_payloads_verdict_carried],
  ['ledger/types', m_ledger_types],
  ['ledger/versions', m_ledger_versions],
  ['manifests/modes', m_manifests_modes],
  ['manifests/verification-class', m_manifests_verification_class],
  ['pack/delta', m_pack_delta],
  ['pack/feasibility', m_pack_feasibility],
  ['pack/manifest', m_pack_manifest],
  ['pack/records', m_pack_records],
  ['policy/ai_policy', m_policy_ai_policy],
  ['policy/cbm_params', m_policy_cbm_params],
  ['policy/composer_policy', m_policy_composer_policy],
  ['policy/firewall_rules', m_policy_firewall_rules],
  ['policy/fsrs_params', m_policy_fsrs_params],
  ['policy/gaming_params', m_policy_gaming_params],
  ['policy/gate_thresholds', m_policy_gate_thresholds],
  ['policy/ldi_params', m_policy_ldi_params],
  ['policy/lock', m_policy_lock],
  ['policy/mastery_rules', m_policy_mastery_rules],
  ['policy/method_policy', m_policy_method_policy],
  ['policy/ops_policy', m_policy_ops_policy],
  ['policy/search_params', m_policy_search_params],
];

// ---- 타입 ---------------------------------------------------------------------------------------------------------------
export type GenFiles = ReadonlyMap<string, string>; // packages/contracts 기준 posix 상대 경로 → 파일 내용
export type ConsumerManifestT = z.infer<typeof ConsumerManifest>;
export type ManifestInput = ConsumerManifestT & { readonly file?: string }; // file = 매니페스트 파일 이름(있으면 consumer와 대조)
export interface EventIndexEntry {
  readonly ifId: string;
  readonly producer: string;
  readonly freeze: 'D' | 'O';
  readonly slice: 'R0' | 'R1' | 'R2' | 'R3';
  readonly versions: Readonly<Record<number, z.ZodType>>;
}
export type EventIndex = ReadonlyMap<string, EventIndexEntry>; // event type → 정의
export interface RoutingEdge {
  readonly mode: 'durable' | 'notify';
  readonly types: readonly string[];
}
export interface SubscriptionEntry {
  readonly mode: 'durable' | 'notify';
  readonly on_poison: 'halt' | 'dead_letter' | 'drop';
  readonly schema_versions: readonly number[];
  readonly reads: readonly string[];
}
export interface RoutingResult {
  readonly routing: Readonly<Record<string, Readonly<Record<string, RoutingEdge>>>>; // producer → consumer → edge
  readonly subscriptions: Readonly<Record<string, Readonly<Record<string, SubscriptionEntry>>>>; // consumer → type → 구독
}

export class GenValidationError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`contracts:gen validation failed (${problems.length}): ${problems[0] ?? ''}`);
    this.name = 'GenValidationError';
    this.problems = problems;
  }
}

// ---- 경로·상수 ----------------------------------------------------------------------------------------------------------
const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, '..'); // packages/contracts
const MANIFEST_DIR = resolve(HERE, '../src/events/__consumers__'); // 원천 위치 고정(--root는 출력 위치만 바꾼다)
const SNAPSHOT_DIR = '.snapshots';
const REGISTRY_PATH = 'src/events/registry.gen.ts';
const ROUTING_PATH = 'src/events/routing.gen.ts';
const GEN_BANNER = '// GENERATED by pnpm contracts:gen (packages/contracts/scripts/gen.ts) — DO NOT EDIT';
const EXPECTED_CONSUMERS = ['ai-gateway', 'content', 'gateway', 'learning', 'ops-api'];
const PRODUCER_OF_PREFIX: Readonly<Record<string, string>> = {
  catalog: 'content',
  acquisition: 'content',
  grading: 'content',
  itembank: 'content',
  learning: 'learning',
  ai: 'ai-gateway',
  ops: 'ops-api',
};
const ROUTE_IF_ID = /^IF-(COM|GW|LR|CT|AI|OP)-\d{3}$/;
const EVENT_IF_ID = /^IF-EV-(0[1-9]|1\d|2[0-3])$/;

// ---- 유틸 ---------------------------------------------------------------------------------------------------------------
type Rec = Readonly<Record<string, unknown>>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isSchema = (v: unknown): v is z.ZodType => v instanceof z.ZodType;
const byCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0); // JS 문자열 사전순(로캘 무관)
const sortedKeys = (o: Rec): string[] => Object.keys(o).sort(byCode);
const asJson = (x: unknown): string => `${JSON.stringify(x, null, 2)}\n`;

function jsonSchemaOf(schema: z.ZodType, label: string): Record<string, unknown> {
  let out: unknown;
  try {
    out = z.toJSONSchema(schema);
  } catch (e) {
    throw new Error(`z.toJSONSchema failed for ${label}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!isRec(out)) {
    throw new Error(`z.toJSONSchema returned a non-object for ${label}`);
  }
  const { $schema: _drop, ...rest } = out;
  return rest;
}

/** TS 리터럴 직렬화(작은따옴표 문자열·JSON 배열/객체·`as const` 친화). 키 순서 = 입력 순서. */
function lit(v: unknown, indent: number): string {
  const pad = '  '.repeat(indent);
  const pad1 = '  '.repeat(indent + 1);
  if (typeof v === 'string') {
    return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  }
  if (typeof v === 'number' || typeof v === 'boolean' || v === null) {
    return String(v);
  }
  if (Array.isArray(v)) {
    return `[${v.map((x) => lit(x, indent)).join(', ')}]`;
  }
  if (isRec(v)) {
    const keys = Object.keys(v);
    if (keys.length === 0) {
      return '{}';
    }
    const inline = keys.every((k) => !isRec(v[k]));
    if (inline) {
      return `{ ${keys.map((k) => `${litKey(k)}: ${lit(v[k], indent)}`).join(', ')} }`;
    }
    return `{\n${keys.map((k) => `${pad1}${litKey(k)}: ${lit(v[k], indent + 1)},`).join('\n')}\n${pad}}`;
  }
  throw new Error('lit: unsupported value');
}
const litKey = (k: string): string => (/^[A-Za-z_$][\w$]*$/.test(k) || /^\d+$/.test(k) ? k : lit(k, 0));

// ---- 수집 ---------------------------------------------------------------------------------------------------------------
interface SchemaEntry {
  readonly mod: string;
  readonly name: string;
  readonly schema: z.ZodType;
}
interface RouteLike {
  readonly id: string;
  readonly ifId: string;
  readonly method: string;
  readonly path: string;
  readonly allowedCallers: readonly string[];
  readonly idempotent: boolean;
  readonly paginated: boolean;
  readonly request: Readonly<Record<string, z.ZodType | undefined | string>>;
  readonly response: Readonly<Record<string, z.ZodType>>;
  readonly responseKind?: string;
  readonly deadlineMs?: number;
  readonly bodyLimitBytes?: number;
  readonly freeze: string;
  readonly slice: string;
  readonly fr: readonly string[];
}
interface ErrorEntry {
  readonly code: string; // 파일 이름용 완성 코드(공통은 `common.<CAT>-<NNN>`)
  readonly status: number;
  readonly title: string;
  readonly retryable: boolean;
}
interface EventSource {
  readonly mod: string;
  readonly exportNames: Readonly<Record<number, string>>;
}
interface Collected {
  readonly schemas: SchemaEntry[];
  readonly routes: RouteLike[];
  readonly errors: ErrorEntry[];
  readonly events: Map<string, EventIndexEntry>;
  readonly eventSources: Map<string, EventSource>;
  readonly problems: string[];
}

const isRouteLike = (v: unknown): v is RouteLike =>
  isRec(v) &&
  typeof v.ifId === 'string' &&
  ROUTE_IF_ID.test(v.ifId) &&
  typeof v.method === 'string' &&
  typeof v.path === 'string' &&
  typeof v.id === 'string';

function collect(): Collected {
  const schemas: SchemaEntry[] = [];
  const routes: RouteLike[] = [];
  const errors: ErrorEntry[] = [];
  const events = new Map<string, EventIndexEntry>();
  const eventSources = new Map<string, EventSource>();
  const problems: string[] = [];
  const seenRoutes = new Set<unknown>();
  for (const [mod, ns] of MODULES) {
    for (const name of Object.keys(ns).sort(byCode)) {
      const value = ns[name];
      if (isSchema(value)) {
        schemas.push({ mod, name, schema: value });
      } else if (isRouteLike(value)) {
        if (!seenRoutes.has(value)) {
          seenRoutes.add(value);
          routes.push(value);
        }
      } else if (name.endsWith('_EVENTS') && isRec(value)) {
        for (const type of sortedKeys(value)) {
          const e = value[type];
          if (!isRec(e) || !isRec(e.versions)) {
            problems.push(`event ${type}: malformed catalog entry in ${mod}#${name}`);
            continue;
          }
          const versions: Record<number, z.ZodType> = {};
          const exportNames: Record<number, string> = {};
          for (const v of sortedKeys(e.versions)) {
            const schema = e.versions[v];
            if (!isSchema(schema)) {
              problems.push(`event ${type} v${v}: payload is not a zod schema`);
              continue;
            }
            versions[Number(v)] = schema;
            const exported = Object.keys(ns).find((k) => ns[k] === schema);
            if (exported === undefined) {
              problems.push(`event ${type} v${v}: payload schema is not exported by ${mod}`);
            } else {
              exportNames[Number(v)] = exported;
            }
          }
          if (events.has(type)) {
            problems.push(`event ${type}: defined twice`);
          }
          events.set(type, {
            ifId: String(e.ifId),
            producer: String(e.producer),
            freeze: e.freeze === 'O' ? 'O' : 'D',
            slice: e.slice === 'R1' || e.slice === 'R2' || e.slice === 'R3' ? e.slice : 'R0',
            versions,
          });
          eventSources.set(type, { mod, exportNames });
        }
      } else if (name.endsWith('_ERRORS') && isRec(value)) {
        for (const key of sortedKeys(value)) {
          const e = value[key];
          if (
            !isRec(e) ||
            typeof e.status !== 'number' ||
            typeof e.title !== 'string' ||
            typeof e.retryable !== 'boolean'
          ) {
            problems.push(`error ${key}: malformed registry entry in ${mod}#${name}`);
            continue;
          }
          const code = name === 'COMMON_ERRORS' ? `common.${key}` : key;
          errors.push({ code, status: e.status, title: e.title, retryable: e.retryable });
        }
      }
    }
  }
  return { schemas, routes, errors, events, eventSources, problems };
}

// ---- 매니페스트 ---------------------------------------------------------------------------------------------------------
/** `__consumers__/*.json` 읽기(디스크 읽기는 이 함수뿐). 파일 이름 대조·스키마 검증은 여기와 buildRouting이 나눠 한다. */
export function loadManifests(dir: string = MANIFEST_DIR): { manifests: ManifestInput[]; problems: string[] } {
  const manifests: ManifestInput[] = [];
  const problems: string[] = [];
  const names = readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .sort(byCode);
  for (const file of names) {
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    } catch (e) {
      problems.push(`manifest ${file}: invalid JSON (${e instanceof Error ? e.message : String(e)})`);
      continue;
    }
    const parsed = ConsumerManifest.safeParse(json);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        problems.push(`manifest ${file}: ${issue.path.join('.') || '(root)'} ${issue.message}`);
      }
      continue;
    }
    manifests.push({ ...parsed.data, file });
  }
  return { manifests, problems };
}

function topLevelKeys(schema: z.ZodType, label: string): Set<string> {
  const root = jsonSchemaOf(schema, label);
  const defs = isRec(root.$defs) ? root.$defs : {};
  const keys = new Set<string>();
  const visit = (node: unknown, depth: number): void => {
    if (!isRec(node) || depth > 8) {
      return;
    }
    if (typeof node.$ref === 'string') {
      const m = /^#\/\$defs\/(.+)$/.exec(node.$ref);
      if (m?.[1] !== undefined) {
        visit(defs[m[1]], depth + 1);
      }
      return;
    }
    if (isRec(node.properties)) {
      for (const k of Object.keys(node.properties)) {
        keys.add(k);
      }
    }
    for (const alt of ['anyOf', 'oneOf', 'allOf'] as const) {
      const list = node[alt];
      if (Array.isArray(list)) {
        for (const b of list) {
          visit(b, depth + 1);
        }
      }
    }
  };
  visit(root, 0);
  return keys;
}

/** 이벤트 정의 + 소비자 매니페스트 → ROUTING·SUBSCRIPTIONS. 순수 — 위반이 하나라도 있으면 GenValidationError(문제 목록). */
export function buildRouting(events: EventIndex, manifests: readonly ManifestInput[]): RoutingResult {
  const problems: string[] = [];
  const consumed = new Set<string>();
  const pairMode = new Map<string, 'durable' | 'notify'>();
  const routing: Record<string, Record<string, { mode: 'durable' | 'notify'; types: string[] }>> = {};
  const subscriptions: Record<string, Record<string, SubscriptionEntry>> = {};
  const keyCache = new Map<string, Set<string>>();
  const seenConsumers = new Set<string>();

  for (const m of manifests) {
    if (m.file !== undefined && m.file !== `${m.consumer}.json`) {
      problems.push(`manifest ${m.file}: consumer "${m.consumer}" must equal the file name`);
    }
    if (seenConsumers.has(m.consumer)) {
      problems.push(`manifest ${m.consumer}: defined twice`);
    }
    seenConsumers.add(m.consumer);
    const seenTypes = new Set<string>();
    for (const s of m.subscriptions) {
      const at = `${m.consumer} <- ${s.type}`;
      if (seenTypes.has(s.type)) {
        problems.push(`${at}: subscribed twice`);
      }
      seenTypes.add(s.type);
      const ev = events.get(s.type);
      if (ev === undefined) {
        problems.push(`${at}: unknown event type`);
        continue;
      }
      consumed.add(s.type);
      for (const v of s.schema_versions) {
        if (ev.versions[v] === undefined) {
          problems.push(`${at}: schema_version ${v} is not defined for the event`);
        }
      }
      if ((s.mode === 'notify') !== (s.on_poison === 'drop')) {
        problems.push(`${at}: mode "${s.mode}" and on_poison "${s.on_poison}" are incompatible (notify <=> drop)`);
      }
      if (m.consumer === ev.producer) {
        problems.push(`${at}: consumer must differ from producer "${ev.producer}"`);
      }
      const pairKey = `${ev.producer}>${m.consumer}`;
      const prev = pairMode.get(pairKey);
      if (prev !== undefined && prev !== s.mode) {
        problems.push(`${at}: producer/consumer pair ${pairKey} mixes modes "${prev}" and "${s.mode}"`);
      }
      pairMode.set(pairKey, s.mode);
      for (const r of s.reads) {
        if (r === '*') {
          continue;
        }
        const head = r.split('.')[0] ?? r;
        for (const v of s.schema_versions) {
          const schema = ev.versions[v];
          if (schema === undefined) {
            continue;
          }
          const ck = `${s.type}@${v}`;
          let keys = keyCache.get(ck);
          if (keys === undefined) {
            keys = topLevelKeys(schema, ck);
            keyCache.set(ck, keys);
          }
          if (!keys.has(head)) {
            problems.push(`${at}: reads "${r}" is not a top-level field of the v${v} payload`);
          }
        }
      }
      const edges = routing[ev.producer] ?? {};
      routing[ev.producer] = edges;
      const edge = edges[m.consumer] ?? { mode: s.mode, types: [] };
      edges[m.consumer] = edge;
      if (!edge.types.includes(s.type)) {
        edge.types.push(s.type);
      }
      const subs = subscriptions[m.consumer] ?? {};
      subscriptions[m.consumer] = subs;
      subs[s.type] = {
        mode: s.mode,
        on_poison: s.on_poison,
        schema_versions: [...s.schema_versions],
        reads: [...s.reads],
      };
    }
  }
  for (const type of [...events.keys()].sort(byCode)) {
    if (!consumed.has(type)) {
      problems.push(`${type}: event has no consumer`);
    }
  }
  if (problems.length > 0) {
    throw new GenValidationError(problems);
  }
  const sortedRouting: Record<string, Record<string, RoutingEdge>> = {};
  for (const p of sortedKeys(routing)) {
    const row: Record<string, RoutingEdge> = {};
    for (const c of sortedKeys(routing[p] ?? {})) {
      const e = routing[p]?.[c];
      if (e !== undefined) {
        row[c] = { mode: e.mode, types: [...e.types].sort(byCode) };
      }
    }
    sortedRouting[p] = row;
  }
  const sortedSubs: Record<string, Record<string, SubscriptionEntry>> = {};
  for (const c of sortedKeys(subscriptions)) {
    const row: Record<string, SubscriptionEntry> = {};
    for (const t of sortedKeys(subscriptions[c] ?? {})) {
      const e = subscriptions[c]?.[t];
      if (e !== undefined) {
        row[t] = e;
      }
    }
    sortedSubs[c] = row;
  }
  return { routing: sortedRouting, subscriptions: sortedSubs };
}

// ---- 검증(IF-01 §9.3·§2.16 + Brief §4.7-3) -------------------------------------------------------------------------------
function validateEvents(c: Collected): string[] {
  const problems: string[] = [];
  const ifIds = new Set<string>();
  for (const [type, e] of c.events) {
    if (!EVENT_IF_ID.test(e.ifId)) {
      problems.push(`${type}: ifId "${e.ifId}" is not IF-EV-01~23`);
    }
    if (ifIds.has(e.ifId)) {
      problems.push(`${type}: duplicate event ifId ${e.ifId}`);
    }
    ifIds.add(e.ifId);
    const prefix = type.split('.')[0] ?? '';
    const expected = PRODUCER_OF_PREFIX[prefix];
    if (expected === undefined) {
      problems.push(`${type}: unknown context prefix "${prefix}"`);
    } else if (expected !== e.producer) {
      problems.push(`${type}: producer "${e.producer}" must be "${expected}" for prefix "${prefix}"`);
    }
  }
  if (c.events.size !== 23) {
    problems.push(`expected 23 event types (IF-EV-01~23), found ${c.events.size}`);
  }
  return problems;
}

function validateRoutes(c: Collected): string[] {
  const problems: string[] = [];
  const ifIds = new Set<string>();
  const ids = new Set<string>();
  const methodPath = new Set<string>();
  for (const r of c.routes) {
    if (ifIds.has(r.ifId)) {
      problems.push(`route ${r.ifId}: duplicate ifId`);
    }
    ifIds.add(r.ifId);
    if (ids.has(r.id)) {
      problems.push(`route ${r.ifId}: duplicate route id ${r.id}`);
    }
    ids.add(r.id);
    const svc = r.ifId.split('-')[1] ?? '';
    const key = `${svc} ${r.method} ${r.path}`;
    if (methodPath.has(key)) {
      problems.push(`route ${r.ifId}: duplicate (method, path) ${r.method} ${r.path} in ${svc}`);
    }
    methodPath.add(key);
  }
  const codes = new Set<string>();
  for (const e of c.errors) {
    if (codes.has(e.code)) {
      problems.push(`error ${e.code}: duplicate code`);
    }
    codes.add(e.code);
  }
  return problems;
}

// ---- 출력 ---------------------------------------------------------------------------------------------------------------
function routeSnapshot(r: RouteLike): unknown {
  const reqProps: Record<string, unknown> = {};
  for (const k of ['params', 'query', 'body'] as const) {
    const s = r.request[k];
    if (isSchema(s)) {
      reqProps[k] = jsonSchemaOf(s, `${r.ifId}.request.${k}`);
    }
  }
  const respProps: Record<string, unknown> = {};
  for (const status of Object.keys(r.response).sort(byCode)) {
    const s = r.response[status];
    if (isSchema(s)) {
      respProps[status] = jsonSchemaOf(s, `${r.ifId}.response.${status}`);
    }
  }
  const bodyKind = typeof r.request.bodyKind === 'string' ? r.request.bodyKind : 'json';
  return {
    $comment: r.id,
    type: 'object',
    properties: {
      id: { const: r.id },
      method: { const: r.method },
      path: { const: r.path },
      allowedCallers: { enum: [...r.allowedCallers] },
      idempotent: { const: r.idempotent },
      paginated: { const: r.paginated },
      freeze: { const: r.freeze },
      slice: { const: r.slice },
      fr: { enum: [...r.fr] },
      deadlineMs: { const: r.deadlineMs ?? null },
      bodyLimitBytes: { const: r.bodyLimitBytes ?? null },
      responseKind: { const: r.responseKind ?? 'json' },
      bodyKind: { const: bodyKind },
      request: { type: 'object', properties: reqProps },
      response: { type: 'object', properties: respProps },
    },
  };
}

/** `.snapshots/**` 파일 전체의 해시 입력: 경로 사전순 `경로 + '\0' + 내용 + '\0'`(생성물 TS 2개 제외 — 순환 방지). */
export function contractsHash(files: GenFiles): string {
  const h = createHash('sha256');
  for (const path of [...files.keys()].filter((p) => p.startsWith(`${SNAPSHOT_DIR}/`)).sort(byCode)) {
    h.update(`${path}\0${files.get(path) ?? ''}\0`, 'utf8');
  }
  return h.digest('hex');
}

function registryText(c: Collected, hash: string): string {
  const types = [...c.events.keys()].sort(byCode);
  const importsByPath = new Map<string, Set<string>>();
  const payloadLines: string[] = [];
  const metaLines: string[] = [];
  for (const type of types) {
    const ev = c.events.get(type);
    const src = c.eventSources.get(type);
    if (ev === undefined || src === undefined) {
      continue;
    }
    const versionParts: string[] = [];
    for (const v of Object.keys(ev.versions)
      .map(Number)
      .sort((a, b) => a - b)) {
      const name = src.exportNames[v];
      if (name === undefined) {
        continue;
      }
      const rel = posix.relative('events', src.mod);
      const path = `${rel.startsWith('.') ? rel : `./${rel}`}.js`;
      const set = importsByPath.get(path) ?? new Set<string>();
      set.add(name);
      importsByPath.set(path, set);
      versionParts.push(`${v}: ${name}`);
    }
    payloadLines.push(`  ${lit(type, 0)}: { ${versionParts.join(', ')} },`);
    metaLines.push(
      `  ${lit(type, 0)}: { ifId: ${lit(ev.ifId, 0)}, producer: ${lit(ev.producer, 0)}, freeze: ${lit(ev.freeze, 0)}, slice: ${lit(ev.slice, 0)} },`,
    );
  }
  const imports = [...importsByPath.keys()]
    .sort(byCode)
    .map((p) => `import { ${[...(importsByPath.get(p) ?? [])].sort(byCode).join(', ')} } from '${p}';`);
  return [
    GEN_BANNER,
    ...imports,
    '',
    `export const EVENT_PAYLOADS = {\n${payloadLines.join('\n')}\n} as const;`,
    '',
    `export const EVENT_META = {\n${metaLines.join('\n')}\n} as const;`,
    '',
    'export type IntegrationEventType = keyof typeof EVENT_PAYLOADS;',
    '',
    `export const CONTRACTS_HASH = '${hash}';`,
    '',
  ].join('\n');
}

function routingText(r: RoutingResult): string {
  return [
    GEN_BANNER,
    '',
    `export const ROUTING = ${lit(r.routing, 0)} as const;`,
    '',
    `export const SUBSCRIPTIONS = ${lit(r.subscriptions, 0)} as const;`,
    '',
  ].join('\n');
}

/** 계약 원천 → 출력 파일 전부(경로 → 내용). 순수 — 디스크 읽기는 소비자 매니페스트 JSON뿐. 같은 원천 = 같은 바이트. */
export function generate(): GenFiles {
  const c = collect();
  const { manifests, problems: manifestProblems } = loadManifests();
  const problems = [...c.problems, ...manifestProblems, ...validateEvents(c), ...validateRoutes(c)];
  const consumers = manifests.map((m) => m.consumer).sort(byCode);
  if (manifestProblems.length === 0 && consumers.join(',') !== EXPECTED_CONSUMERS.join(',')) {
    problems.push(
      `expected 5 consumer manifests (${EXPECTED_CONSUMERS.join(', ')}), found: ${consumers.join(', ') || '(none)'}`,
    );
  }
  let routingResult: RoutingResult | null = null;
  try {
    routingResult = buildRouting(c.events, manifests);
  } catch (e) {
    if (e instanceof GenValidationError) {
      problems.push(...e.problems);
    } else {
      throw e;
    }
  }
  if (problems.length > 0 || routingResult === null) {
    throw new GenValidationError(problems);
  }

  const out = new Map<string, string>();
  for (const s of c.schemas) {
    out.set(`${SNAPSHOT_DIR}/schemas/${s.mod}/${s.name}.json`, asJson(jsonSchemaOf(s.schema, `${s.mod}#${s.name}`)));
  }
  for (const [type, e] of c.events) {
    for (const v of Object.keys(e.versions).map(Number)) {
      const schema = e.versions[v];
      if (schema !== undefined) {
        out.set(`${SNAPSHOT_DIR}/events/${type}.v${v}.json`, asJson(jsonSchemaOf(schema, `${type} v${v}`)));
      }
    }
  }
  for (const r of c.routes) {
    out.set(`${SNAPSHOT_DIR}/routes/${r.ifId}.json`, asJson(routeSnapshot(r)));
  }
  for (const e of c.errors) {
    out.set(
      `${SNAPSHOT_DIR}/errors/${e.code}.json`,
      asJson({
        type: 'object',
        properties: { status: { const: e.status }, title: { const: e.title }, retryable: { const: e.retryable } },
      }),
    );
  }
  const hash = contractsHash(out);
  out.set(REGISTRY_PATH, registryText(c, hash));
  out.set(ROUTING_PATH, routingText(routingResult));
  return new Map([...out.entries()].sort((a, b) => byCode(a[0], b[0])));
}

// ---- main ---------------------------------------------------------------------------------------------------------------
function listSnapshotFiles(root: string): string[] {
  const base = join(root, SNAPSHOT_DIR);
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
      } else {
        found.push(
          p
            .slice(root.length + 1)
            .split(sep)
            .join('/'),
        );
      }
    }
  };
  if (existsSync(base)) {
    walk(base);
  }
  return found.sort(byCode);
}

function pruneEmptyDirs(dir: string): boolean {
  let empty = true;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && pruneEmptyDirs(join(dir, e.name))) {
      continue;
    }
    empty = false;
  }
  if (empty) {
    rmdirSync(dir);
  }
  return empty;
}

const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};
const err = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

/** 종료 코드: 0 성공 · 1 검증 실패·--check 차이 · 2 엔진 고장(예외·알 수 없는 인자). */
export function main(argv: readonly string[]): number {
  let check = false;
  let rootArg: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') {
      check = true;
    } else if (a === '--root' && argv[i + 1] !== undefined) {
      rootArg = argv[i + 1] ?? null;
      i++;
    } else {
      err(`contracts:gen: unknown argument ${a ?? ''}`);
      return 2;
    }
  }
  const root = resolve(rootArg ?? DEFAULT_ROOT);
  try {
    const files = generate();
    const hash = contractsHash(files).slice(0, 12);
    if (check) {
      const existing = new Set(listSnapshotFiles(root));
      const lines: string[] = [];
      for (const [path, content] of files) {
        const abs = join(root, path);
        if (!existsSync(abs)) {
          lines.push(`missing ${path}`);
        } else if (readFileSync(abs, 'utf8') !== content) {
          lines.push(`stale ${path}`);
        }
        existing.delete(path);
      }
      for (const path of [...existing].sort(byCode)) {
        lines.push(`extra ${path}`);
      }
      if (lines.length > 0) {
        for (const l of lines) {
          out(l);
        }
        return 1;
      }
      out(`contracts:gen --check ok files=${files.size} hash=${hash}`);
      return 0;
    }
    for (const path of listSnapshotFiles(root)) {
      if (!files.has(path)) {
        rmSync(join(root, path));
      }
    }
    for (const [path, content] of files) {
      const abs = join(root, path);
      mkdirSync(dirname(abs), { recursive: true });
      if (!existsSync(abs) || readFileSync(abs, 'utf8') !== content) {
        writeFileSync(abs, content, 'utf8');
      }
    }
    if (existsSync(join(root, SNAPSHOT_DIR))) {
      pruneEmptyDirs(join(root, SNAPSHOT_DIR));
      mkdirSync(join(root, SNAPSHOT_DIR), { recursive: true });
    }
    out(`contracts:gen files=${files.size} hash=${hash}`);
    return 0;
  } catch (e) {
    if (e instanceof GenValidationError) {
      for (const p of e.problems) {
        out(p);
      }
      return 1;
    }
    err(`contracts:gen: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main(process.argv.slice(2));
}
