import { describe, expect, it } from 'vitest';
import {
  ApproveImportBody,
  CaptureInboxBody,
  CreateImportBody,
  ImportJobView,
  ImportListQuery,
  ImportSource,
  ImportStage,
  InboxItemView,
  InboxListQuery,
  StagingDiffEntry,
  StagingDiffPage,
  TriageInboxBody,
} from '../../../src/http/content/v1/acquisition.js';
import {
  ConflictListQuery,
  ConflictView,
  OVERLAY_FIELDS,
  OverlayExportLine,
  OverlayExportQuery,
  OverlayImportQuery,
  OverlayPatchBody,
  OverlayTargetKind,
  ResolveConflictBody,
} from '../../../src/http/content/v1/overlays.js';
import { SHA, ULID, ULID_B } from './samples.js';

describe('content overlays.ts 스키마', () => {
  it('UT-CON-103 OVERLAY_FIELDS 키 = OverlayTargetKind.options · field 정규식 · new_value 임의 JSON · OverlayExportLine 3종 [FR-CUR-020]', () => {
    expect(Object.keys(OVERLAY_FIELDS).sort()).toEqual([...OverlayTargetKind.options].sort());
    expect(OVERLAY_FIELDS.item).toContain('answer');

    const body = {
      patch_id: ULID,
      target_kind: 'concept',
      target_id: 'k8s.probes',
      field: 'stages.theory.body_md',
      base_version: SHA,
      new_value: '새 본문',
      reason_ko: '오탈자',
    };
    expect(OverlayPatchBody.safeParse(body).success).toBe(true);
    for (const v of [null, 1, true, ['a', { b: null }], { nested: { x: [1, 2] } }]) {
      expect(OverlayPatchBody.safeParse({ ...body, new_value: v }).success, JSON.stringify(v)).toBe(true);
    }
    expect(OverlayPatchBody.safeParse({ ...body, field: 'Title' }).success).toBe(false);
    expect(OverlayPatchBody.safeParse({ ...body, field: 'a.b.c.d.e' }).success).toBe(false);
    expect(OverlayPatchBody.safeParse({ ...body, reason_ko: '' }).success).toBe(false);
    expect(OverlayPatchBody.safeParse({ ...body, target_kind: 'pack' }).success).toBe(false);
    expect(OverlayPatchBody.safeParse({ ...body, extra: 1 }).success).toBe(false);

    const event = {
      patch_id: ULID,
      target_kind: 'item',
      target_id: 'k8s.probes.i01',
      field: 'answer',
      base_version: SHA,
      new_value: ['opt_a'],
      reason_ko: '정답 키 수정',
      device_id: ULID_B,
      ts: 5,
      revert_of: null,
    };
    const lines = [
      { kind: 'header', v: 1, device_id: ULID_B, generated_at: 1, since: null },
      { kind: 'overlay', event },
      { kind: 'end', count: 1, sha256: SHA },
    ];
    for (const l of lines) {
      expect(OverlayExportLine.safeParse(l).success, l.kind).toBe(true);
    }
    expect(OverlayExportLine.safeParse({ kind: 'overlay', event: { ...event, extra: 1 } }).success).toBe(false);
    expect(
      OverlayExportLine.safeParse({ kind: 'header', v: 2, device_id: ULID_B, generated_at: 1, since: null }).success,
    ).toBe(false);

    // --- (이어서)
    const conflict = {
      conflict_id: ULID,
      patch_id: ULID_B,
      target_kind: 'ku',
      target_id: 'k8s.probes.k01',
      field: 'statement_ko',
      base_version: SHA,
      new_base_version: SHA,
      pack_value: '팩',
      overlay_value: '오버레이',
      state: 'open',
      resolution: null,
      created_at: 1,
    };
    expect(ConflictView.safeParse(conflict).success).toBe(true);
    expect(ConflictView.safeParse({ ...conflict, resolution: 'merge' }).success).toBe(false);
    expect(ResolveConflictBody.safeParse({ resolution: 'edit', value: { a: 1 } }).success).toBe(true);
    expect(ResolveConflictBody.safeParse({ resolution: 'take_pack', value: null }).success).toBe(true);
    expect(ConflictListQuery.parse({}).limit).toBe(50);
    expect(ConflictListQuery.safeParse({ state: 'resolved' }).success).toBe(true);
    expect(ConflictListQuery.safeParse({ state: 'x' }).success).toBe(false);
    expect(OverlayExportQuery.parse({ since: '5' }).since).toBe(5);
    expect(OverlayExportQuery.safeParse({ since: '-1' }).success).toBe(false);
    expect(OverlayImportQuery.safeParse({ import_id: ULID }).success).toBe(true);
    expect(OverlayImportQuery.safeParse({}).success).toBe(false);
  });
});

const stage = (s: string) => ({
  stage: s,
  state: 'done',
  engine: 'D',
  started_at: 1,
  finished_at: 2,
  error_code: null,
});
const jobView = {
  job_id: ULID,
  source_kind: 'paste',
  title: null,
  state: 'running',
  stage: 'I1',
  stages: [stage('I1')],
  trust: 'user',
  masking: 'full',
  data_class: 'C2',
  work_order_id: null,
  quarantined_chunks: 0,
  diff_summary: null,
  created_at: 1,
  updated_at: 2,
};

describe('content acquisition.ts 스키마', () => {
  it('UT-CON-104 ImportSource url http:// 거부·https:// 통과, ImportStage 11값, TriageInboxBody 4종, ImportJobView.stages ≤ 11 [FR-IMP-001][FR-IMP-013]', () => {
    expect(ImportSource.safeParse({ kind: 'url', url: 'http://example.com/a' }).success).toBe(false);
    expect(ImportSource.safeParse({ kind: 'url', url: 'https://example.com/a' }).success).toBe(true);
    expect(ImportSource.safeParse({ kind: 'paste', text: '본문', title: null }).success).toBe(true);
    expect(ImportSource.safeParse({ kind: 'paste', text: '', title: null }).success).toBe(false);
    expect(
      ImportSource.safeParse({ kind: 'file', filename: 'a.md', media_type: 'text/markdown', content_base64: 'aGk=' })
        .success,
    ).toBe(true);
    expect(
      ImportSource.safeParse({ kind: 'file', filename: 'a.pdf', media_type: 'application/pdf', content_base64: 'aGk=' })
        .success,
    ).toBe(false);
    expect(ImportSource.safeParse({ kind: 'inbox', inbox_id: ULID }).success).toBe(true);
    expect(ImportSource.safeParse({ kind: 'folder' }).success).toBe(false);

    const create = { job_id: ULID, source: { kind: 'inbox', inbox_id: ULID_B }, target_track: null, local_only: true };
    expect(CreateImportBody.safeParse(create).success).toBe(true);
    expect(CreateImportBody.safeParse({ ...create, local_only: undefined }).success).toBe(false);

    expect(ImportStage.options).toHaveLength(11);
    expect(ImportStage.options).toContain('I1.5');
    expect(ImportStage.options).toContain('COPY_GUARD');
    expect(ImportStage.safeParse('I1_5').success).toBe(false);

    expect(ImportJobView.safeParse(jobView).success).toBe(true);
    const eleven = ImportStage.options.map(stage);
    expect(ImportJobView.safeParse({ ...jobView, stages: eleven }).success).toBe(true);
    expect(ImportJobView.safeParse({ ...jobView, stages: [...eleven, stage('I1')] }).success).toBe(false);
    expect(ImportJobView.safeParse({ ...jobView, state: 'paused' }).success).toBe(false);
    expect(ImportJobView.safeParse({ ...jobView, extra: 1 }).success).toBe(false);

    const triage = [
      { action: 'link', concept_id: 'k8s.probes' },
      { action: 'probe' },
      { action: 'import', job_id: ULID },
      { action: 'discard' },
    ];
    for (const t of triage) {
      expect(TriageInboxBody.safeParse(t).success, t.action).toBe(true);
    }
    expect(TriageInboxBody.safeParse({ action: 'archive' }).success).toBe(false);
    expect(TriageInboxBody.safeParse({ action: 'probe', extra: 1 }).success).toBe(false);
    expect(TriageInboxBody.safeParse({ action: 'link' }).success).toBe(false);

    // --- (이어서)
    const entry = {
      entry_id: ULID,
      op: 'add',
      target_kind: 'concept',
      target_id: 'u.me.vpn',
      before: null,
      after: { title_ko: 'VPN' },
      evidence_spans: [{ chunk_id: ULID, start: 0, end: 5, quote_ko: '인용' }],
      trust: 'llm_unverified',
      quarantined: false,
      decision: 'pending',
    };
    expect(StagingDiffEntry.safeParse(entry).success).toBe(true);
    expect(StagingDiffEntry.safeParse({ ...entry, op: 'remove' }).success).toBe(false);
    expect(StagingDiffPage.safeParse({ job_id: ULID, items: [entry], next_cursor: null }).success).toBe(true);
    const approve = { decisions: [{ entry_id: ULID, decision: 'edit', edited_value: { a: 1 } }], publish: false };
    expect(ApproveImportBody.safeParse(approve).success).toBe(true);
    expect(ApproveImportBody.safeParse({ ...approve, decisions: [] }).success).toBe(false);
    expect(CaptureInboxBody.safeParse({ inbox_id: ULID, text: '메모', source_url: null, captured_at: 1 }).success).toBe(
      true,
    );
    expect(
      CaptureInboxBody.safeParse({ inbox_id: ULID, text: 'a'.repeat(8001), source_url: null, captured_at: 1 }).success,
    ).toBe(false);
    const inbox = {
      inbox_id: ULID,
      text_masked: '메모',
      masking: 'partial',
      source_url: null,
      state: 'new',
      matches: [{ concept_id: 'k8s.probes', score: 0.5 }],
      linked_concept_id: null,
      created_at: 1,
      triaged_at: null,
    };
    expect(InboxItemView.safeParse(inbox).success).toBe(true);
    expect(InboxItemView.safeParse({ ...inbox, masking: 'none' }).success).toBe(false);
    expect(ImportListQuery.parse({ state: 'failed' }).limit).toBe(50);
    expect(ImportListQuery.safeParse({ state: 'bogus' }).success).toBe(false);
    expect(InboxListQuery.safeParse({ state: 'triaged', limit: '200' }).success).toBe(true);
    expect(InboxListQuery.safeParse({ limit: '201' }).success).toBe(false);
  });
});
