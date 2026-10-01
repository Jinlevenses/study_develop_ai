import { z } from 'zod';
import { CardId, ConceptId, ItemId, KuId, ObjKey, Ulid } from '../../../../common/ids.js';
import { S } from '../../../../common/schema.js';
import { EpochMs, StudyDay } from '../../../../common/time.js';
import { JudgeCardPostSubmit } from '../../../content/v1/post-submit/judge-card.js';

export const NotePostSubmit = S({
  phase: z.literal('post_submit'),
  block_id: Ulid,
  session_id: Ulid,
  concept_id: ConceptId,
  ladder_step: z.enum(['BN-1', 'BN-2', 'BN-3', 'BN-4', 'BN-5']),
  submitted_text: z.string().max(20_000),
  submitted_at: EpochMs,
  attempt_id: Ulid,
  verdict_id: Ulid.nullable(),
  status: z.enum(['graded', 'awaiting_self_grade', 'pending']),
  diff: S({
    units: z.record(
      ObjKey,
      S({
        // idea unit 객체 키(FR-STD-019 3색 diff)
        status: z.enum(['recalled', 'missing', 'error']),
        ku_id: KuId.nullable(),
        p: z.number().min(0).max(1).nullable(),
        uncertain_marked: z.boolean(),
      }),
    ),
  }).nullable(),
  model_note_md: z.string().max(20_000).nullable(),
  followups: S({
    cards: z.array(CardId).max(20),
    ox_item_ids: z.array(ItemId).max(20),
    import_candidates_ko: z.array(z.string().max(100)).max(10),
    recall_scheduled: z.array(StudyDay).max(3),
  }),
  judge_card: JudgeCardPostSubmit.nullable(), // gateway가 IF-CT-045로 채움(learning 응답에서는 항상 null)
});
export type NotePostSubmit = z.infer<typeof NotePostSubmit>;
