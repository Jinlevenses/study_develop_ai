// DB-01 §3.5·§3.6 — `lint:hooks`(tools/gates/check-hooks.mjs)가 어휘 분석으로 읽는 입력이다.
// 값은 문자열·숫자 리터럴과 배열·객체 리터럴만 쓴다(템플릿 리터럴·변수 참조·spread·함수 호출 0). zod import 없음.

export type DbNameHook = {
  readonly hook: string;
  readonly table: string;
  readonly columns: readonly string[];
  readonly file: string;
};
export const DB_NAME_HOOKS = [
  {
    hook: 'event',
    table: 'lr_event',
    columns: ['event_id', 'device_id', 'device_seq', 'client_ts', 'idempotency_key', 'experiment_arm'],
    file: 'services/learning/migrations/ledger/0001_ledger_core.sql',
  },
  {
    hook: 'judge_log',
    table: 'ai_judge_log',
    columns: ['probabilities', 'input_hash', 'model_version'],
    file: 'services/ai-gateway/migrations/judge/0001_judge_core.sql',
  },
  {
    hook: 'item',
    table: 'ib_item',
    columns: ['source_kind', 'stem_family', 'gate_status', 'defect_manifest'],
    file: 'services/content/migrations/itembank/0001_itembank_core.sql',
  },
  {
    hook: 'card',
    table: 'lr_card_state',
    columns: ['response_mode'],
    file: 'services/learning/migrations/learner-model/0001_projections.sql',
  },
  {
    hook: 'misconception',
    table: 'ct_misconception',
    columns: ['meta_family', 'status'],
    file: 'services/content/migrations/catalog/0001_catalog_core.sql',
  },
  {
    hook: 'ku',
    table: 'ct_ku',
    columns: ['valid_as_of', 'deprecated_by', 'scope'],
    file: 'services/content/migrations/catalog/0001_catalog_core.sql',
  },
  {
    hook: 'concept',
    table: 'ct_concept',
    columns: ['volatility', 'required_for_level'],
    file: 'services/content/migrations/catalog/0001_catalog_core.sql',
  },
  {
    hook: 'track',
    table: 'ct_track',
    columns: ['offline_cap_level'],
    file: 'services/content/migrations/catalog/0001_catalog_core.sql',
  },
  {
    hook: 'case',
    table: 'ct_case',
    columns: ['variant_params', 'root_cause_pool', 'best_if', 'contested'],
    file: 'services/content/migrations/catalog/0001_catalog_core.sql',
  },
  {
    hook: 'overlay',
    table: 'ct_overlay_event',
    columns: ['base_version'],
    file: 'services/content/migrations/catalog/0001_catalog_core.sql',
  },
  {
    hook: 'pack',
    table: 'ct_pack',
    columns: ['channel'],
    file: 'services/content/migrations/catalog/0001_catalog_core.sql',
  },
  {
    hook: 'inbox',
    table: 'aq_inbox_item',
    columns: ['source_kind'],
    file: 'services/content/migrations/acquisition/0001_acquisition_core.sql',
  },
] as const satisfies readonly DbNameHook[];

export type DbExtHook = {
  readonly hook: string;
  readonly tables: readonly string[];
  readonly keys: readonly string[];
  readonly deferred: string;
};
export const DB_EXT_HOOKS = [
  {
    hook: 'case.world_id · episode_seq · expert_path',
    tables: ['ct_case', 'lr_long_task'],
    keys: ['case.world_id', 'case.episode_seq', 'case.expert_path'],
    deferred: 'DEF-09·24',
  },
  { hook: 'concept.epa_refs', tables: ['ct_concept'], keys: ['epa.refs'], deferred: 'DEF-18' },
  {
    hook: 'anchor_set_id · attempt.anchor_run_id',
    tables: ['ib_item', 'gr_attempt', 'lr_event'],
    keys: ['anchor.set_id', 'anchor.run_id'],
    deferred: 'DEF-19',
  },
  {
    hook: 'item.mutants · panel_distribution',
    tables: ['ib_item'],
    keys: ['mutant.list', 'sct.panel_distribution'],
    deferred: 'DEF-08·13',
  },
  {
    hook: 'stimulus_id · ladder',
    tables: ['ct_concept'],
    keys: ['stimulus.id', 'stimulus.ladder'],
    deferred: 'DEF-16',
  },
  { hook: 'graph_ref', tables: ['ct_concept'], keys: ['graph.ref'], deferred: 'DEF-01' },
  {
    hook: 'pack.signature · direction',
    tables: ['ct_pack'],
    keys: ['pack.signature', 'pack.direction'],
    deferred: 'DEF-21·23·29',
  },
] as const satisfies readonly DbExtHook[];

export type DbExtTable = { readonly db: string; readonly table: string };
// §3.6 분류 표에서 ext 열이 `ext·ext_v`인 행 전부(문서 순서). ct_path는 E지만 ext 열이 '—'이므로 제외.
export const DB_EXT_TABLES = [
  { db: 'content.db', table: 'ct_pack' },
  { db: 'content.db', table: 'ct_track' },
  { db: 'content.db', table: 'ct_concept' },
  { db: 'content.db', table: 'ct_ku' },
  { db: 'content.db', table: 'ct_misconception' },
  { db: 'content.db', table: 'ct_source' },
  { db: 'content.db', table: 'ct_rubric' },
  { db: 'content.db', table: 'ct_case' },
  { db: 'content.db', table: 'ct_artifact_task' },
  { db: 'content.db', table: 'ct_lab' },
  { db: 'content.db', table: 'ct_blueprint' },
  { db: 'content.db', table: 'ct_pack_delta' },
  { db: 'content.db', table: 'ct_overlay_event' },
  { db: 'content.db', table: 'aq_import_job' },
  { db: 'content.db', table: 'aq_staging_item' },
  { db: 'content.db', table: 'aq_staging_diff' },
  { db: 'content.db', table: 'aq_inbox_item' },
  { db: 'content.db', table: 'aq_candidate' },
  { db: 'content.db', table: 'ib_item_model' },
  { db: 'content.db', table: 'ib_item' },
  { db: 'content.db', table: 'ib_staging_item' },
  { db: 'content.db', table: 'ib_family' },
  { db: 'content.db', table: 'ib_report' },
  { db: 'content.db', table: 'gr_attempt' },
  { db: 'learning.db', table: 'lr_event' },
  { db: 'learning.db', table: 'lr_device' },
  { db: 'learning.db', table: 'lr_projection_meta' },
  { db: 'learning.db', table: 'lr_session' },
  { db: 'learning.db', table: 'lr_dialog_state' },
  { db: 'learning.db', table: 'lr_long_task' },
  { db: 'learning.db', table: 'lr_profile_mode' },
  { db: 'learning.db', table: 'lr_curriculum_ref' },
  { db: 'ai.db', table: 'ai_provider' },
  { db: 'ai.db', table: 'ai_work_order' },
  { db: 'ai.db', table: 'ai_gold_item' },
  { db: 'ai.db', table: 'ai_firewall_pattern' },
  { db: 'ops.db', table: 'op_backup' },
  { db: 'ops.db', table: 'op_upgrade' },
] as const satisfies readonly DbExtTable[];
