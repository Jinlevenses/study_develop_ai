import { describe, expect, it } from 'vitest';
import {
  ApproveStagingBody,
  CreateReportBody,
  CreateReportRequest,
  GateStatus,
  ItemGateView,
  ItemHealthView,
  QuarantineItemBody,
  ReportListQuery,
  ReportView,
  ResolveReportBody,
  S2Approval,
  StagingItemView,
  StagingListQuery,
  WarmingView,
} from '../../../src/http/content/v1/itembank.js';
import { HintQuery, HintViewPreSubmit } from '../../../src/http/content/v1/pre-submit/hint.js';
import {
  ItemBodyPreSubmit,
  ItemDeliveryPreSubmit,
  SelectItemsRequest,
  SelectSlot,
} from '../../../src/http/content/v1/pre-submit/item.js';
import {
  CreateRunBody,
  CreateRunRequest,
  RunnerPlatformView,
  RunResultView,
  RunStatus,
} from '../../../src/http/content/v1/runner.js';
import { itemDelivery, SHA, ULID, ULID_B } from './samples.js';

const run = { run_id: ULID, item_id: null, kind: 'code', lang: 'js', code: 'console.log(1)', mode: 'stdout' };
const runResult = {
  run_id: ULID,
  status: 'ok',
  stdout: '1\n',
  stderr: '',
  exit_code: 0,
  duration_ms: 20,
  peak_rss_mb: 30.5,
  output_truncated: false,
  reason: null,
  public_tests: { passed: 1, failed: 0, cases: [{ case_key: 'c01', ok: true, message_ko: null }] },
  sql: { columns: ['a'], rows: [['x', 1, null]], truncated: false },
};
const platform = { os: 'linux', arch: 'x64', node: '22.22.2' };

describe('content runner.ts 스키마', () => {
  it('UT-CON-108 RunStatus killed_seccomp 통과·killed_ 거부, CreateRunRequest.source_kind 3종, RunnerPlatformView [FR-LAB-001][NFR-SEC-006]', () => {
    for (const s of [
      'ok',
      'error',
      'timeout',
      'memory_limit',
      'output_limit',
      'rejected',
      'platform_disabled',
      'killed_seccomp',
    ]) {
      expect(RunStatus.safeParse(s).success, s).toBe(true);
    }
    expect(RunStatus.safeParse('killed_').success).toBe(false);
    expect(RunStatus.safeParse('Killed_x').success).toBe(false);
    expect(RunStatus.safeParse('crashed').success).toBe(false);

    expect(CreateRunBody.safeParse(run).success).toBe(true);
    expect(CreateRunBody.safeParse({ ...run, source_kind: 'learner' }).success).toBe(false); // 공개 본문에는 source_kind가 없다(gateway가 learner로 채움)
    for (const source_kind of ['learner', 'seed', 't1']) {
      expect(CreateRunRequest.safeParse({ ...run, source_kind }).success, source_kind).toBe(true);
    }
    expect(CreateRunRequest.safeParse({ ...run, source_kind: 't2' }).success).toBe(false);
    expect(CreateRunRequest.safeParse({ ...run, source_kind: 'seed', code: '' }).success).toBe(false);
    expect(CreateRunRequest.safeParse({ ...run, source_kind: 'seed', mode: 'full' }).success).toBe(false);

    expect(RunResultView.safeParse(runResult).success).toBe(true);
    expect(RunResultView.safeParse({ ...runResult, status: 'killed_oom' }).success).toBe(true);
    expect(RunResultView.safeParse({ ...runResult, peak_rss_mb: -1 }).success).toBe(false);
    expect(RunResultView.safeParse({ ...runResult, extra: 1 }).success).toBe(false);

    const view = {
      enabled: true,
      platform,
      verified_platforms: [platform],
      watchdog_period_ms: 50,
      reason: null,
      docker_recommended: false,
      queue: { running: 0, queued: 0, max_concurrency: 2 },
    };
    expect(RunnerPlatformView.safeParse(view).success).toBe(true);
    expect(RunnerPlatformView.safeParse({ ...view, reason: 'broken' }).success).toBe(false);
    expect(RunnerPlatformView.safeParse({ ...view, platform: { ...platform, os: 'freebsd' } }).success).toBe(false);
  });
});

const bodies = [
  { kind: 'ox' },
  {
    kind: 'choice',
    options: { opt_a: { text_md: 'A' }, opt_b: { text_md: 'B' } },
    order: ['opt_a', 'opt_b'],
    multi: false,
  },
  { kind: 'text', max_chars: 200, placeholder_ko: null },
  { kind: 'cloze', template_md: '{{blank:b01}}', blanks: { b01: { max_chars: 20 } } },
  { kind: 'matching', left: { l01: '왼쪽' }, right: { r01: '오른쪽' } },
  { kind: 'code', lang: 'ts', mode: 'write', starter: '', public_tests_md: null, runnable: true },
  { kind: 'sql', schema_md: 'create table t(a)', starter: '', runnable: false },
  { kind: 'positions', lines: { l01: 'x' }, order: ['l01'], max_select: 3 },
  { kind: 'numeric', unit_hint: 'ms' },
  { kind: 'essay', min_chars: 0, max_chars: 4000, kp_count: null, rubric_dims: [{ key: 'dim01', label_ko: '정확성' }] },
  {
    kind: 'cond_pair',
    parts: {
      a: { stem_md: 'a', options: { opt_a: { text_md: 'A' } } },
      b: { stem_md: 'b', options: { opt_a: { text_md: 'A' } } },
    },
    pivot_required: true,
  },
  { kind: 'review', diff_md: '+a', lines: { l01: '+a' }, order: ['l01'] },
  { kind: 'authoring', target_ku_ids: ['k8s.probes.k01'], item_format: 'mcq' },
  {
    kind: 'case_decision',
    node_key: 'node01',
    options: { opt_a: { text_md: 'A' } },
    order: ['opt_a'],
    rationale: 'none',
  },
];
const slot = {
  slot_id: ULID,
  kind: 'items',
  concept_id: 'k8s.probes',
  level: 2,
  mode_id: 'M-01',
  format_candidates: ['ox'],
  count: 3,
  target_beta: null,
  response_mode: null,
  facet: null,
  case_id: null,
  variant_seed: null,
  artifact_id: null,
  engine_constraints: { calibrated_only: false, deterministic_only: true },
};
const selectReq = {
  session_id: ULID,
  ai_mode_observed: 'OFFLINE',
  slots: [slot],
  exclude_item_ids: [],
  exclude_stem_families: [],
};

describe('content pre-submit item·hint 스키마', () => {
  it('UT-CON-109 ItemBodyPreSubmit 14종, ItemDeliveryPreSubmit, SelectItemsRequest.slots 0·61개 거부 [FR-STD-002][FR-QST-001]', () => {
    expect(ItemBodyPreSubmit.options).toHaveLength(14);
    expect(bodies).toHaveLength(14);
    for (const b of bodies) {
      expect(ItemBodyPreSubmit.safeParse(b).success, b.kind).toBe(true);
      expect(ItemBodyPreSubmit.safeParse({ ...b, extra: 1 }).success, `${b.kind}+extra`).toBe(false);
    }
    expect(ItemBodyPreSubmit.safeParse({ kind: 'drag' }).success).toBe(false);
    expect(ItemBodyPreSubmit.safeParse({ kind: 'choice', options: {}, order: ['opt_a'], multi: false }).success).toBe(
      false,
    );

    expect(ItemDeliveryPreSubmit.safeParse(itemDelivery).success).toBe(true);
    expect(ItemDeliveryPreSubmit.safeParse({ ...itemDelivery, hints_available: 5 }).success).toBe(false);
    expect(ItemDeliveryPreSubmit.safeParse({ ...itemDelivery, time_limit_ms: 999 }).success).toBe(false);
    expect(ItemDeliveryPreSubmit.safeParse({ ...itemDelivery, answer_key: 'opt_a' }).success).toBe(false);
    expect(
      ItemDeliveryPreSubmit.safeParse({ ...itemDelivery, lineage: { source_kind: 'seed', trust: 'x' } }).success,
    ).toBe(false);

    expect(SelectSlot.safeParse(slot).success).toBe(true);
    expect(SelectSlot.safeParse({ ...slot, count: 21 }).success).toBe(false);
    expect(SelectItemsRequest.safeParse(selectReq).success).toBe(true);
    expect(SelectItemsRequest.safeParse({ ...selectReq, slots: [] }).success).toBe(false);
    expect(SelectItemsRequest.safeParse({ ...selectReq, slots: Array(60).fill(slot) }).success).toBe(true);
    expect(SelectItemsRequest.safeParse({ ...selectReq, slots: Array(61).fill(slot) }).success).toBe(false);

    expect(HintQuery.safeParse({ session_id: ULID, block_id: ULID_B }).success).toBe(true);
    const hint = {
      item_id: 'k8s.probes.i01',
      step: 2,
      kind: 'concept_link',
      body_md: '개념을 다시 보세요',
      concept_link: 'k8s.probes',
      penalty_note_ko: '힌트 감점',
      steps_available: 2,
    };
    expect(HintViewPreSubmit.safeParse(hint).success).toBe(true);
    expect(HintViewPreSubmit.safeParse({ ...hint, step: 5 }).success).toBe(false);
    expect(HintViewPreSubmit.safeParse({ ...hint, kind: 'answer' }).success).toBe(false);
  });
});

describe('content itembank.ts 스키마', () => {
  it('UT-CON-110 GateStatus 11값, ReportView.excluded_from_queue false 거부, S2Approval, StagingListQuery [FR-QST-004][FR-QST-016]', () => {
    expect(GateStatus.options).toHaveLength(11);
    expect(GateStatus.safeParse('gated_pass').success).toBe(true);
    expect(GateStatus.safeParse('passed').success).toBe(false);

    const report = {
      report_id: ULID,
      item_id: 'k8s.probes.i01',
      reason: 'key_wrong',
      text: null,
      state: 'received',
      classification: null,
      resolution: null,
      excluded_from_queue: true,
      evidence_voided: false,
      created_at: 1,
      resolved_at: null,
    };
    expect(ReportView.safeParse(report).success).toBe(true);
    expect(ReportView.safeParse({ ...report, excluded_from_queue: false }).success).toBe(false);
    expect(ReportView.safeParse({ ...report, reason: 'rude' }).success).toBe(false);
    expect(
      ReportView.safeParse({ ...report, resolution: { kind: 'kept', reason_ko: '유지', patch_id: null } }).success,
    ).toBe(true);
    expect(
      CreateReportBody.safeParse({ report_id: ULID, reason: 'other', text: null, attempt_id: null, session_id: null })
        .success,
    ).toBe(true);
    expect(
      CreateReportRequest.safeParse({
        report_id: ULID,
        item_id: 'k8s.probes.i01',
        reason: 'outdated',
        text: null,
        attempt_id: null,
        session_id: null,
      }).success,
    ).toBe(true);
    expect(
      CreateReportRequest.safeParse({
        report_id: ULID,
        reason: 'outdated',
        text: null,
        attempt_id: null,
        session_id: null,
      }).success,
    ).toBe(false);

    const s2 = { cross_judge_id: ULID, span_check_id: null, curator_decision: 'pending', s2_mode: 'cross_family' };
    expect(S2Approval.safeParse(s2).success).toBe(true);
    expect(S2Approval.safeParse({ ...s2, curator_decision: 'maybe' }).success).toBe(false);
    expect(S2Approval.safeParse({ ...s2, s2_mode: 'x' }).success).toBe(false);

    expect(StagingListQuery.parse({}).limit).toBe(50);
    expect(StagingListQuery.safeParse({ status: 'review' }).success).toBe(true);
    expect(StagingListQuery.safeParse({ status: 'draft' }).success).toBe(false);
    expect(StagingListQuery.safeParse({ limit: '0' }).success).toBe(false);

    const staging = {
      staging_id: ULID,
      origin: 't4',
      concept_id: 'k8s.probes',
      format: 'mcq',
      stakes: 'S2',
      status: 'review',
      preview_md: '미리보기',
      s2,
      updated_at: 1,
    };
    expect(StagingItemView.safeParse(staging).success).toBe(true);
    expect(StagingItemView.safeParse({ ...staging, s2: null }).success).toBe(true);
    expect(ApproveStagingBody.safeParse({ decision: 'approve', reason_ko: null }).success).toBe(true);
    expect(ApproveStagingBody.safeParse({ decision: 'maybe', reason_ko: null }).success).toBe(false);

    expect(ReportListQuery.safeParse({ state: 'classified' }).success).toBe(true);
    expect(ReportListQuery.safeParse({ state: 'x' }).success).toBe(false);
    const health = {
      item_id: 'k8s.probes.i01',
      concept_id: 'k8s.probes',
      format: 'mcq',
      gate_status: 'gated_pass',
      flags: ['too_easy'],
      stats: { n: 10, p_correct: 0.9, mean_latency_ms: null, option_freq: { opt_a: 0.5 } },
      updated_at: 1,
    };
    expect(ItemHealthView.safeParse(health).success).toBe(true);
    expect(ItemHealthView.safeParse({ ...health, flags: ['weird'] }).success).toBe(false);
    const gate = {
      item_id: 'k8s.probes.i01',
      gate_status: 'quarantined',
      stem_family: null,
      changed_at: 1,
      affected_items: 1,
    };
    expect(ItemGateView.safeParse(gate).success).toBe(true);
    expect(ItemGateView.safeParse({ ...gate, affected_items: 0 }).success).toBe(false);
    expect(QuarantineItemBody.safeParse({ reason_ko: '문제', scope: 'family', evidence_policy: 'halve' }).success).toBe(
      true,
    );
    expect(QuarantineItemBody.safeParse({ reason_ko: '', scope: 'family', evidence_policy: 'halve' }).success).toBe(
      false,
    );
    expect(ResolveReportBody.safeParse({ resolution: 'retired', reason_ko: '폐기', patch: null }).success).toBe(true);
    expect(
      WarmingView.safeParse({
        pools: [{ concept_id: 'k8s.probes', format: 'mcq', level: 2, have: 1, need: 5 }],
        last_forecast_at: null,
        last_computed_at: 1,
      }).success,
    ).toBe(true);
    expect(SHA).toHaveLength(64);
  });
});
