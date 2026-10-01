import { z } from 'zod';
import { DataClass } from '../../../common/domain.js';
import { ConceptId, TrackId, Ulid } from '../../../common/ids.js';
import { Cursor } from '../../../common/pagination.js';
import { S } from '../../../common/schema.js';
import { EpochMs } from '../../../common/time.js';

export const ImportSource = z.discriminatedUnion('kind', [
  S({ kind: z.literal('url'), url: z.string().url().regex(/^https:\/\//) }),                         // SSRF 가드(§12.12, IF-EXT-11)
  S({ kind: z.literal('paste'), text: z.string().min(1).max(2_097_152), title: z.string().max(200).nullable() }),
  S({ kind: z.literal('file'), filename: z.string().max(255), media_type: z.enum(['text/markdown', 'text/plain', 'text/html']),
      content_base64: z.string().max(2_796_204) }),                                                   // 디코딩 ≤ 2 MiB
  S({ kind: z.literal('inbox'), inbox_id: Ulid }),
]);
export type ImportSource = z.infer<typeof ImportSource>;
export const CreateImportBody = S({ job_id: Ulid, source: ImportSource, target_track: TrackId.nullable(), local_only: z.boolean() }); // local_only = C3 강제(FR-IMP-010)
export type CreateImportBody = z.infer<typeof CreateImportBody>;
export const ImportStage = z.enum(['I1', 'I1.5', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7', 'COPY_GUARD', 'I8', 'I9']);   // DB 저장 철자 'I1_5'(리포지토리 매퍼 1곳에서 변환), COPY_GUARD = DCP §4.4 V3(CR-38)
export type ImportStage = z.infer<typeof ImportStage>;
export const ImportJobView = S({
  job_id: Ulid, source_kind: z.enum(['url', 'paste', 'file', 'inbox', 'folder', 'blueprint', 'pack_refresh', 'case_foundry']), title: z.string().max(200).nullable(),
  state: z.enum(['queued', 'running', 'awaiting_work_order', 'awaiting_approval', 'published', 'rejected', 'failed', 'cancelled']),
  stage: ImportStage,
  stages: z.array(S({ stage: ImportStage, state: z.enum(['pending', 'running', 'done', 'failed', 'skipped']),
    engine: z.enum(['D', 'H', 'J', 'L', 'LJ']).nullable(), started_at: EpochMs.nullable(), finished_at: EpochMs.nullable(), error_code: z.string().max(40).nullable() })).max(11),
  trust: z.enum(['user', 'llm_unverified', 'verified']), masking: z.enum(['full', 'partial']), data_class: DataClass,
  work_order_id: Ulid.nullable(), quarantined_chunks: z.number().int().min(0),
  diff_summary: S({ concepts: z.number().int(), kus: z.number().int(), items: z.number().int(), conflicts: z.number().int() }).nullable(),
  created_at: EpochMs, updated_at: EpochMs,
});
export type ImportJobView = z.infer<typeof ImportJobView>;
export const StagingDiffEntry = S({
  entry_id: Ulid, op: z.enum(['add', 'modify', 'merge', 'conflict']),
  target_kind: z.enum(['concept', 'ku', 'misconception', 'item', 'case', 'relation']), target_id: z.string().max(160),
  before: z.json().nullable(), after: z.json(),
  evidence_spans: z.array(S({ chunk_id: Ulid, start: z.number().int(), end: z.number().int(), quote_ko: z.string().max(500) })).max(10),
  trust: z.enum(['user', 'llm_unverified', 'verified']), quarantined: z.boolean(),
  decision: z.enum(['pending', 'approved', 'rejected', 'edited']),
});
export type StagingDiffEntry = z.infer<typeof StagingDiffEntry>;
export const StagingDiffPage = S({ job_id: Ulid, items: z.array(StagingDiffEntry), next_cursor: Cursor.nullable() });
export type StagingDiffPage = z.infer<typeof StagingDiffPage>;
export const ApproveImportBody = S({ decisions: z.array(S({ entry_id: Ulid, decision: z.enum(['approve', 'reject', 'edit']),
  edited_value: z.json().nullable() })).min(1).max(500), publish: z.boolean() });               // publish = I9 PackDelta 발행까지
export type ApproveImportBody = z.infer<typeof ApproveImportBody>;
export const RejectImportBody = S({ reason_ko: z.string().max(500) });
export type RejectImportBody = z.infer<typeof RejectImportBody>;
export const CaptureInboxBody = S({ inbox_id: Ulid, text: z.string().min(1).max(8000), source_url: z.string().url().nullable(), captured_at: EpochMs });
export type CaptureInboxBody = z.infer<typeof CaptureInboxBody>;
export const InboxItemView = S({
  inbox_id: Ulid, text_masked: z.string().max(8000), masking: z.enum(['full', 'partial']), source_url: z.string().url().nullable(),
  state: z.enum(['new', 'triaged', 'linked', 'imported', 'discarded']),
  matches: z.array(S({ concept_id: ConceptId, score: z.number() })).max(10), linked_concept_id: ConceptId.nullable(),
  created_at: EpochMs, triaged_at: EpochMs.nullable(),
});
export type InboxItemView = z.infer<typeof InboxItemView>;
export const TriageInboxBody = z.discriminatedUnion('action', [
  S({ action: z.literal('link'), concept_id: ConceptId }),
  S({ action: z.literal('probe') }),                                         // 연결 개념 프로브 블록을 다음 세션 후보로
  S({ action: z.literal('import'), job_id: Ulid }),                          // = IF-CT-030 source {kind:'inbox'}
  S({ action: z.literal('discard') }),
]);
export type TriageInboxBody = z.infer<typeof TriageInboxBody>;
