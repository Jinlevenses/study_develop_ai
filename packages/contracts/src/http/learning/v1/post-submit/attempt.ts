import { z } from 'zod';
import { Confidence, FsrsRating, GraderEngine, JudgeBadge, MasteryStatus } from '../../../../common/domain.js';
import { ConceptId, ObjKey, Ulid } from '../../../../common/ids.js';
import { S } from '../../../../common/schema.js';
import {
  AnswerRevealPostSubmit,
  FeedbackPostSubmit,
  SelfGradeFormPostSubmit,
} from '../../../content/v1/post-submit/grading.js';
import { CaseContinuationPreSubmit } from '../../../content/v1/pre-submit/case.js';

export const AttemptOutcomePostSubmit = z.discriminatedUnion('status', [
  S({
    status: z.literal('graded'),
    attempt_id: Ulid,
    verdict_id: Ulid,
    ledger_event_id: Ulid,
    result: z.enum(['correct', 'partial', 'incorrect', 'pending']),
    band: z.enum(['wrong', 'partial', 'right']),
    score: z.number().min(0).max(1),
    grader_engine: GraderEngine,
    calibrated: z.boolean(),
    pending: z.boolean(),
    provisional: z.boolean(),
    badge: JudgeBadge,
    feedback: FeedbackPostSubmit,
    reveal: AnswerRevealPostSubmit, // = IF-CT-040
    cbm: S({ confidence: Confidence, score: z.number(), max_chosen: z.number() }).nullable(),
    rating: S({ recommended: FsrsRating, applied: FsrsRating, needs_confirmation: z.boolean() }).nullable(), // pretest·카드 없음 = null
    mastery: S({ concept_id: ConceptId, from: MasteryStatus, to: MasteryStatus, provisional: z.boolean() }).nullable(),
    continuation: CaseContinuationPreSubmit.nullable(), // case_decision만(= IF-CT-040)
    next_block_id: Ulid.nullable(),
    upgrade_pending: z.boolean(), // 3s 이후 상위 엔진 진행 중(FR-QST-019)
  }),
  S({
    status: z.literal('awaiting_self_grade'),
    attempt_id: Ulid,
    self_grade_form: SelfGradeFormPostSubmit,
    reveal: AnswerRevealPostSubmit, // = IF-CT-040
    heuristic_preview: S({
      units: z.record(ObjKey, S({ covered: z.boolean(), p: z.number().min(0).max(1).nullable() })),
    }).nullable(),
  }),
]);
export type AttemptOutcomePostSubmit = z.infer<typeof AttemptOutcomePostSubmit>;
