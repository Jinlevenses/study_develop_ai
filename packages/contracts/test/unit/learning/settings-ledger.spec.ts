import { describe, expect, it } from 'vitest';
import {
  CheckpointView,
  CreateCheckpointBody,
  LedgerExportEvent,
  LedgerExportHeader,
  LedgerExportLine,
  LedgerExportPolicySet,
  LedgerExportQuery,
  LedgerHeads,
  LedgerImportQuery,
  LedgerImportView,
  LedgerViolation,
  VerifyLedgerBody,
  VerifyLedgerView,
} from '../../../src/http/learning/v1/ledger.js';
import {
  DdayScope,
  DeclarationAck,
  LearnerProfile,
  OnboardingBody,
  PatchProfileBody,
  PersonalOverrides,
  PolicyPreview,
  PolicyPreviewBody,
  PolicyStatusView,
  PutDdayBody,
  PutPauseBody,
  RhythmView,
  SealDeclarationBody,
} from '../../../src/http/learning/v1/settings.js';
import { LearningSignals, SignalsQuery } from '../../../src/http/learning/v1/telemetry.js';
import { LedgerEventType } from '../../../src/ledger/envelope.js';
import { DAY, NOW, PS, SHA, ULID, ULID_B, ULID_C, withFields } from './samples.js';

const head = { seq: 1, head_hash: SHA };
const header = {
  kind: 'header',
  v: 1,
  exporting_device_id: ULID,
  generated_at: NOW,
  app_version: '1.0.0',
  since_checkpoint_id: null,
  devices: { [ULID]: head },
  schema_versions: Object.fromEntries(LedgerEventType.options.map((t) => [t, 1])),
};
const policySet = {
  kind: 'policy_set',
  policy_version: PS,
  members: { mastery_rules: { version: 'mastery_rules@v1', sha256: SHA } },
  documents: { 'mastery_rules@v1': { sha256: SHA, yaml: 'version: mastery_rules@v1\n' } },
};
const ledgerEvent = {
  event_id: ULID_B,
  device_id: ULID,
  device_seq: 1,
  client_ts: NOW,
  type: 'lesson.completed',
  schema_version: 1,
  idempotency_key: 'lesson:k8s.probes',
  payload: {},
  prev_hash: '0'.repeat(64),
  hash: SHA,
  experiment_arm: null,
  recorded_at: NOW,
};
const end = { kind: 'end', count: 1, sha256: SHA };
const profile = {
  device_id: ULID,
  timezone: 'Asia/Seoul',
  day_boundary_hour: 4,
  weekly_goal_sessions: 3,
  rest_tokens_per_week: 1,
  default_minutes: 15,
  default_energy: 'normal',
  wildcard_mode: 'suggest',
  quota_mode: 'suggest',
  log_content: false,
  reduced_motion: 'system',
  ui_density: 'auto',
  notifications: { weekly_review: true, return_nudge: false },
  career_years: null,
  primary_track: null,
  path_id: null,
  onboarded: false,
};

describe('learning settings.ts · ledger.ts · telemetry.ts', () => {
  it('UT-CON-187 PatchProfileBody {} 통과·PersonalOverrides.request_retention.A 0.98 거부·DdayScope 3종·SealDeclarationBody.kind 3 [FR-SET-009][FR-PRG-028]', () => {
    expect(PatchProfileBody.safeParse({}).success).toBe(true);
    expect(
      PatchProfileBody.safeParse({
        day_boundary_hour: 4,
        default_minutes: null,
        notifications: { weekly_review: true, return_nudge: true },
      }).success,
    ).toBe(true);
    expect(PatchProfileBody.safeParse({ day_boundary_hour: 24 }).success).toBe(false);
    expect(PatchProfileBody.safeParse({ default_minutes: 10 }).success).toBe(false);
    expect(PatchProfileBody.safeParse({ timezone: 'UTC' }).success).toBe(false); // 읽기 전용 필드는 받지 않는다
    expect(LearnerProfile.safeParse(profile).success).toBe(true);
    expect(LearnerProfile.safeParse({ ...profile, extra: 1 }).success).toBe(false);
    expect(LearnerProfile.safeParse(withFields(profile, { reduced_motion: 'maybe' })).success).toBe(false);

    expect(
      PersonalOverrides.safeParse({
        request_retention: { A: 0.9, B: 0.7, C: 0.97 },
        daily_new_limit: 10,
        daily_review_limit: 100,
      }).success,
    ).toBe(true);
    expect(PersonalOverrides.safeParse({ request_retention: { A: 0.97 } }).success).toBe(true);
    expect(PersonalOverrides.safeParse({ request_retention: { A: 0.98 } }).success).toBe(false);
    expect(PersonalOverrides.safeParse({ request_retention: { B: 0.69 } }).success).toBe(false);
    expect(PersonalOverrides.safeParse({ daily_new_limit: 101 }).success).toBe(false);
    expect(PersonalOverrides.safeParse({ extra: 1 }).success).toBe(false);
    const status = {
      active_policy_version: PS,
      members: { mastery_rules: { version: 'mastery_rules@v1', sha256: SHA, owner: 'learning' } },
      available: [{ name: 'mastery_rules', versions: ['mastery_rules@v1'] }],
      overrides: null,
      provisional: ['ldi_params@v1'],
    };
    expect(PolicyStatusView.safeParse(status).success).toBe(true);
    expect(PolicyStatusView.safeParse({ ...status, active_policy_version: 'bad' }).success).toBe(false);
    expect(
      PolicyPreviewBody.safeParse({ preview_id: ULID, target: { overrides: { daily_new_limit: 5 } } }).success,
    ).toBe(true);
    expect(PolicyPreviewBody.safeParse({ preview_id: ULID, target: { members: { x: 'bad' } } }).success).toBe(false);
    const preview = {
      preview_id: ULID,
      current_policy_version: PS,
      target_policy_version: PS,
      expires_at: NOW,
      report: {
        events_replayed: 1,
        queue_size_delta: 0,
        mastered_delta: 0,
        ldi_delta: null,
        changed_concepts: [],
        duration_ms: 10,
      },
    };
    expect(PolicyPreview.safeParse(preview).success).toBe(true);
    expect(
      OnboardingBody.safeParse({ career_years: 3, weekly_minutes: 15, path_id: null, declarations: [] }).success,
    ).toBe(true);
    expect(
      OnboardingBody.safeParse({ career_years: 3, weekly_minutes: 14, path_id: null, declarations: [] }).success,
    ).toBe(false);

    const scopes = [
      { kind: 'concepts', concept_ids: ['k8s.probes'] },
      { kind: 'tag', tag: 'cert:cka' },
      { kind: 'blueprint', blueprint_id: 'cert-cka@2026' },
    ];
    expect(DdayScope.options).toHaveLength(3);
    for (const s of scopes) {
      expect(DdayScope.safeParse(s).success, s.kind).toBe(true);
      expect(DdayScope.safeParse({ ...s, extra: 1 }).success, `${s.kind} extra`).toBe(false);
    }
    expect(DdayScope.safeParse({ kind: 'tag', tag: 'CKA' }).success).toBe(false);
    expect(DdayScope.safeParse({ kind: 'concepts', concept_ids: [] }).success).toBe(false);
    expect(PutDdayBody.safeParse({ target_date: DAY, scope: scopes[1] }).success).toBe(true);
    expect(PutPauseBody.safeParse({ mode: 'crunch', from: DAY, to: DAY, crunch_scope: 'mvd' }).success).toBe(true);
    expect(PutPauseBody.safeParse({ mode: 'rest', from: DAY, to: DAY, crunch_scope: null }).success).toBe(false);
    const rhythm = { pause: null, dday: null, return_mode: { active: false, since: null, gap_days: 0 } };
    expect(RhythmView.safeParse(rhythm).success).toBe(true);
    expect(RhythmView.safeParse({ ...rhythm, return_mode: { active: false, since: null, gap_days: -1 } }).success).toBe(
      false,
    );

    expect(SealDeclarationBody.shape.kind.options).toHaveLength(3);
    const seal = { declaration_id: ULID, kind: 'time_capsule', payload: { note: '미래의 나에게' }, unseal_at: null };
    expect(SealDeclarationBody.safeParse(seal).success).toBe(true);
    expect(SealDeclarationBody.safeParse({ ...seal, kind: 'wish' }).success).toBe(false);
    expect(SealDeclarationBody.safeParse({ ...seal, extra: 1 }).success).toBe(false);
    expect(DeclarationAck.safeParse({ declaration_id: ULID, ledger_event_id: ULID_B, content_hash: SHA }).success).toBe(
      true,
    );
  });

  it('UT-CON-188 LedgerExportLine 4종·schema_versions 16키 거부(전수 17)·LedgerViolation.kind 8·LedgerImportQuery.mode 리터럴·SignalsQuery [FR-SET-022][FR-PRG-003]', () => {
    expect(LedgerExportLine.options).toHaveLength(4);
    for (const [name, line] of [
      ['header', header],
      ['policy_set', policySet],
      ['event', { kind: 'event', event: ledgerEvent }],
      ['end', end],
    ] as const) {
      expect(LedgerExportLine.safeParse(line).success, name).toBe(true);
      expect(LedgerExportLine.safeParse({ ...line, extra: 1 }).success, `${name} extra`).toBe(false);
    }
    expect(LedgerExportLine.safeParse({ kind: 'footer' }).success).toBe(false);
    expect(LedgerExportEvent.safeParse({ kind: 'event', event: { ...ledgerEvent, type: 'nope' } }).success).toBe(false);

    expect(LedgerEventType.options).toHaveLength(17);
    expect(LedgerExportHeader.safeParse(header).success).toBe(true);
    const sixteen = Object.fromEntries(LedgerEventType.options.slice(1).map((t) => [t, 1]));
    expect(Object.keys(sixteen)).toHaveLength(16);
    expect(LedgerExportHeader.safeParse({ ...header, schema_versions: sixteen }).success).toBe(false);
    expect(
      LedgerExportHeader.safeParse({ ...header, schema_versions: { ...header.schema_versions, 'attempt.nope': 1 } })
        .success,
    ).toBe(false);
    expect(LedgerExportHeader.safeParse({ ...header, v: 2 }).success).toBe(false);
    expect(LedgerExportPolicySet.safeParse(policySet).success).toBe(true);
    expect(
      LedgerExportPolicySet.safeParse({
        ...policySet,
        documents: { 'mastery_rules@v1': { sha256: SHA, yaml: 'x'.repeat(1_000_001) } },
      }).success,
    ).toBe(false);
    expect(LedgerExportQuery.safeParse({}).success).toBe(true);
    expect(LedgerExportQuery.safeParse({ since: ULID, device_id: ULID_B }).success).toBe(true);
    expect(LedgerExportQuery.safeParse({ since: 'x' }).success).toBe(false);

    expect(LedgerViolation.shape.kind.options).toHaveLength(8);
    const violation = { device_id: null, device_seq: null, kind: 'chain_break', detail: '체인 끊김' };
    expect(LedgerViolation.safeParse(violation).success).toBe(true);
    expect(LedgerViolation.safeParse({ ...violation, kind: 'other' }).success).toBe(false);
    expect(LedgerImportQuery.safeParse({ import_id: ULID, mode: 'merge' }).success).toBe(true);
    expect(LedgerImportQuery.safeParse({ import_id: ULID, mode: 'replace' }).success).toBe(false);
    expect(LedgerImportQuery.safeParse({ import_id: ULID }).success).toBe(false);
    const importView = {
      import_id: ULID,
      state: 'receiving',
      received_lines: 0,
      inserted: 0,
      skipped_duplicates: 0,
      devices: {},
      checkpoint_id: null,
      projection_hash: null,
      violations: [violation],
      started_at: NOW,
      finished_at: null,
    };
    expect(LedgerImportView.safeParse(importView).success).toBe(true);
    expect(LedgerImportView.safeParse({ ...importView, state: 'paused' }).success).toBe(false);
    expect(
      LedgerImportView.safeParse({ ...importView, violations: Array.from({ length: 101 }, () => violation) }).success,
    ).toBe(false);
    expect(CreateCheckpointBody.safeParse({ checkpoint_id: ULID, reason: 'manual' }).success).toBe(true);
    expect(CreateCheckpointBody.safeParse({ checkpoint_id: ULID, reason: 'auto' }).success).toBe(false);
    expect(
      CheckpointView.safeParse({
        checkpoint_id: ULID,
        devices: { [ULID]: head },
        root_hash: SHA,
        source_file_sha256: null,
        created_at: NOW,
      }).success,
    ).toBe(true);
    expect(
      LedgerHeads.safeParse({
        local_device_id: ULID,
        event_count: 0,
        devices: { [ULID]: { ...head, last_client_ts: NOW } },
      }).success,
    ).toBe(true);
    const verifyBody = {
      verify_id: ULID,
      replay: true,
      anchors: [{ source: 'epoch', ref: 'e1', heads: { [ULID_C]: { seq: 1, hash: SHA } } }],
    };
    expect(VerifyLedgerBody.safeParse(verifyBody).success).toBe(true);
    expect(
      VerifyLedgerBody.safeParse({ ...verifyBody, anchors: [{ source: 'cloud', ref: 'e1', heads: {} }] }).success,
    ).toBe(false);
    const verifyView = {
      verify_id: ULID,
      state: 'done',
      chain_ok: true,
      anchors: [{ source: 'checkpoint', ref: 'c1', ok: true, mismatches: [] }],
      projection_hash_live: SHA,
      projection_hash_replay: SHA,
      match: true,
      duration_ms: 5,
    };
    expect(VerifyLedgerView.safeParse(verifyView).success).toBe(true);
    expect(VerifyLedgerView.safeParse({ ...verifyView, state: 'queued' }).success).toBe(false);

    // telemetry.ts
    expect(SignalsQuery.parse({ from: '0', to: '100' })).toEqual({ from: 0, to: 100 });
    expect(SignalsQuery.safeParse({ from: '-1', to: '100' }).success).toBe(false);
    expect(SignalsQuery.safeParse({ from: '1' }).success).toBe(false);
    expect(SignalsQuery.safeParse({ from: '1', to: '2', extra: 1 }).success).toBe(false);
    const signals = {
      from: 0,
      to: NOW,
      tripwires: [{ id: 'TW-01', value: 1, threshold: 2, state: 'ok' }],
      sessions: { count: 0, median_minutes: null, first_item_p95_ms: null },
    };
    expect(LearningSignals.safeParse(signals).success).toBe(true);
    expect(
      LearningSignals.safeParse(
        withFields(signals, { tripwires: [{ id: 'GR-01', value: null, threshold: null, state: 'insufficient_data' }] }),
      ).success,
    ).toBe(true);
    expect(
      LearningSignals.safeParse(
        withFields(signals, { tripwires: [{ id: 'TW-14', value: 1, threshold: 2, state: 'ok' }] }),
      ).success,
    ).toBe(false);
    expect(
      LearningSignals.safeParse(
        withFields(signals, { tripwires: [{ id: 'TW-01', value: 1, threshold: 2, state: 'bad' }] }),
      ).success,
    ).toBe(false);
  });
});
