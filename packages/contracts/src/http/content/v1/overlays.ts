import { z } from 'zod';
import { DeviceId, Sha256Hex, Ulid } from '../../../common/ids.js';
import { NdjsonEnd } from '../../../common/ndjson.js';
import { Cursor } from '../../../common/pagination.js';
import { S } from '../../../common/schema.js';
import { EpochMs } from '../../../common/time.js';

export const OverlayTargetKind = z.enum(['concept', 'ku', 'misconception', 'item', 'case', 'source']);
export type OverlayTargetKind = z.infer<typeof OverlayTargetKind>;
export const OVERLAY_FIELDS = {                                                     // 대상별 허용 필드(나머지 = VAL-900)
  concept: ['title_ko', 'summary_ko', 'aliases', 'tags', 'stages.theory.body_md', 'stages.code.body_md', 'stages.core.body_md'],
  ku: ['statement_ko', 'scope', 'valid_as_of'],
  misconception: ['wrong_belief_ko', 'correction_ko'],
  item: ['stem_md', 'options', 'answer', 'explanation_md', 'hints'],               // 'answer' 변경 = itembank.item.corrected{basis:'overlay'}
  case: ['alarm_md', 'debrief_md'],
  source: ['url', 'edition'],
} as const;
export const OverlayPatchBody = S({
  patch_id: Ulid, target_kind: OverlayTargetKind, target_id: z.string().max(160),
  field: z.string().regex(/^[a-z_]+(\.[a-z_]+){0,3}$/), base_version: Sha256Hex,   // 대상 레코드의 현재 content_hash(조회 시 받은 값)
  new_value: z.json(), reason_ko: z.string().min(1).max(500),
});
export type OverlayPatchBody = z.infer<typeof OverlayPatchBody>;
export const RevertOverlayBody = S({ revert_patch_id: Ulid, reason_ko: z.string().min(1).max(500) });
export type RevertOverlayBody = z.infer<typeof RevertOverlayBody>;
export const OverlayEventView = S({
  patch_id: Ulid, target_kind: OverlayTargetKind, target_id: z.string(), field: z.string(), base_version: Sha256Hex,
  new_value: z.json(), reason_ko: z.string(), device_id: DeviceId, ts: EpochMs, revert_of: Ulid.nullable(),
  state: z.enum(['applied', 'conflicted', 'reverted']), conflict_id: Ulid.nullable(),
});
export type OverlayEventView = z.infer<typeof OverlayEventView>;
export const OverlayListQuery = S({ target_kind: OverlayTargetKind.optional(), target_id: z.string().max(160).optional(),
  cursor: Cursor.optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });
export type OverlayListQuery = z.infer<typeof OverlayListQuery>;
export const ConflictView = S({
  conflict_id: Ulid, patch_id: Ulid, target_kind: OverlayTargetKind, target_id: z.string(), field: z.string(),
  base_version: Sha256Hex, new_base_version: Sha256Hex, pack_value: z.json(), overlay_value: z.json(),
  state: z.enum(['open', 'resolved']), resolution: z.enum(['keep_overlay', 'take_pack', 'edit']).nullable(), created_at: EpochMs,
});
export type ConflictView = z.infer<typeof ConflictView>;
export const ResolveConflictBody = S({ resolution: z.enum(['keep_overlay', 'take_pack', 'edit']), value: z.json().nullable() });
export type ResolveConflictBody = z.infer<typeof ResolveConflictBody>;
export const OverlayExportLine = z.discriminatedUnion('kind', [
  S({ kind: z.literal('header'), v: z.literal(1), device_id: DeviceId, generated_at: EpochMs, since: EpochMs.nullable() }),
  S({ kind: z.literal('overlay'), event: S({ patch_id: Ulid, target_kind: OverlayTargetKind, target_id: z.string(), field: z.string(),
    base_version: Sha256Hex, new_value: z.json(), reason_ko: z.string(), device_id: DeviceId, ts: EpochMs, revert_of: Ulid.nullable() }) }),
  NdjsonEnd,
]);
export type OverlayExportLine = z.infer<typeof OverlayExportLine>;
export const OverlayImportResult = S({ import_id: Ulid, inserted: z.number().int(), skipped: z.number().int(), conflicts: z.number().int() });
export type OverlayImportResult = z.infer<typeof OverlayImportResult>;
