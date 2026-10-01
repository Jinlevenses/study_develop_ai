import { z } from 'zod';
import { JudgeBadge } from '../../../../common/domain.js';
import { KuId, MisconceptionId, ObjKey, Ulid } from '../../../../common/ids.js';
import { S } from '../../../../common/schema.js';
import { Verdict } from '../../../../events/catalog/grading.js';
import { CaseContinuationPreSubmit } from '../pre-submit/case.js';
import { RunResultView } from '../runner.js';

export const CorrectAnswer = z.discriminatedUnion('kind', [
  S({ kind: z.literal('ox'), value: z.boolean() }),
  S({ kind: z.literal('choice'), option_keys: z.array(ObjKey).min(1).max(10) }),
  S({ kind: z.literal('text'), accepted: z.array(z.string().max(500)).min(1).max(20) }),
  S({ kind: z.literal('cloze'), blanks: z.record(ObjKey, z.array(z.string().max(500)).min(1).max(10)) }),
  S({ kind: z.literal('matching'), pairs: z.record(ObjKey, ObjKey) }),
  S({ kind: z.literal('numeric'), value: z.number(), tolerance_log10: z.number().min(0) }),
  S({ kind: z.literal('positions'), keys: z.array(ObjKey).max(20) }),
  S({ kind: z.literal('code'), reference_md: z.string().max(65_536).nullable(),
      hidden_tests: S({ passed: z.number().int(), failed: z.number().int(), cases: z.array(S({ case_key: ObjKey, ok: z.boolean() })).max(100) }),
      complexity: S({ slope: z.number(), method: z.enum(['ops', 'cpu']), target_order: z.number(), passed: z.boolean() }).nullable() }),
  S({ kind: z.literal('sql'), reference_sql: z.string().max(65_536).nullable(), result_match: z.boolean() }),
  S({ kind: z.literal('cond_pair'), answers: S({ a: z.array(ObjKey), b: z.array(ObjKey) }), pivot_ko: z.string().max(500) }),
  S({ kind: z.literal('rubric'), units: z.record(ObjKey, S({ label_ko: z.string().max(200), ku_id: KuId.nullable() })) }),
  S({ kind: z.literal('case_decision'), best_option_key: ObjKey, scores: z.record(ObjKey, z.number().min(0).max(1)) }),
  S({ kind: z.literal('none') }),
]);
export type CorrectAnswer = z.infer<typeof CorrectAnswer>;
export const AnswerRevealPostSubmit = S({
  answer: CorrectAnswer, explanation_md: z.string().max(8000).nullable(), model_answer_md: z.string().max(20_000).nullable(),
  cited_ku_ids: z.array(KuId).max(20), runner: RunResultView.nullable(),          // code·sql: 학습자 코드 실행 결과(stdout은 표시용, 채점 미사용)
});
export type AnswerRevealPostSubmit = z.infer<typeof AnswerRevealPostSubmit>;
export const FeedbackPostSubmit = S({
  summary_md: z.string().max(4000),
  per_unit: z.record(ObjKey, S({ status: z.enum(['correct', 'partial', 'missing', 'error']), note_md: z.string().max(1000).nullable(), ku_id: KuId.nullable() })),
  misconception: S({ mc_id: MisconceptionId, wrong_belief_ko: z.string(), correction_ko: z.string() }).nullable(),  // FR-QST-023
  source: z.enum(['template', 'ku_assembled', 'ai_generated']),
  stream_ref: Ulid.nullable(),                                                    // R2 AI-G06 → IF-CT-047
});
export type FeedbackPostSubmit = z.infer<typeof FeedbackPostSubmit>;
export const SelfGradeFormPostSubmit = S({ attempt_id: Ulid, overall_required: z.boolean(),
  rubric: z.record(ObjKey, S({ label_ko: z.string().max(200), kind: z.enum(['kp', 'dimension']), ku_id: KuId.nullable(),
    levels: z.array(z.string().max(100)).min(2).max(5) })) });
export type SelfGradeFormPostSubmit = z.infer<typeof SelfGradeFormPostSubmit>;
export const GradeAttemptResponse = z.discriminatedUnion('status', [
  S({ status: z.literal('graded'), verdict: Verdict, badge: JudgeBadge, feedback: FeedbackPostSubmit, reveal: AnswerRevealPostSubmit,
      upgrade_pending: z.boolean(), continuation: CaseContinuationPreSubmit.nullable() }),
  S({ status: z.literal('awaiting_self_grade'), attempt_id: Ulid, self_grade_form: SelfGradeFormPostSubmit, reveal: AnswerRevealPostSubmit,
      heuristic_preview: S({ units: z.record(ObjKey, S({ covered: z.boolean(), p: z.number().min(0).max(1).nullable() })) }).nullable() }),
]);
export type GradeAttemptResponse = z.infer<typeof GradeAttemptResponse>;
