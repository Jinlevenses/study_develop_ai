import { z } from 'zod';
import { Facet, Level } from '../common/domain.js';
import { KuId, MisconceptionId, ObjKey, TrackId } from '../common/ids.js';
import { DialogMove } from '../common/practice.js';
import { S } from '../common/schema.js';

const Opt = S({ key: ObjKey, text_md: z.string().max(2000) });
export const ItemBatchV1 = S({ items: z.array(S({
  format: z.enum(['mcq', 'ox', 'cloze', 'short']), stem_md: z.string().max(4000),
  options: z.array(S({ key: ObjKey, text_md: z.string().max(2000), mc_id: MisconceptionId.nullable() })).max(6),
  answer_keys: z.array(ObjKey).max(4), accepted_answers: z.array(z.string().max(200)).max(10), explanation_md: z.string().max(4000),
  cited_ku_ids: z.array(KuId).min(1).max(10), bloom: z.enum(['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create']),
  difficulty: z.number().int().min(1).max(5), assumptions: z.array(z.string().max(300)).max(5) })).min(1).max(5) });
export type ItemBatchV1 = z.infer<typeof ItemBatchV1>;
export const RubricV1 = S({ dimensions: z.array(S({ key: ObjKey, label_ko: z.string().max(60), levels: z.array(z.string().max(200)).min(2).max(5), weight: z.number().min(0).max(1) })).min(1).max(8),
  key_points: z.array(S({ key: ObjKey, statement_ko: z.string().max(500), ku_id: KuId.nullable() })).max(20) });
export type RubricV1 = z.infer<typeof RubricV1>;
export const ScenarioItemV1 = S({ title_ko: z.string().max(120), scenario_md: z.string().max(12_000), question_md: z.string().max(2000),
  options: z.array(Opt).max(5), rubric: RubricV1, cited_ku_ids: z.array(KuId).max(20), assumptions: z.array(z.string().max(300)).max(5) });
export type ScenarioItemV1 = z.infer<typeof ScenarioItemV1>;
export const CodeExerciseV1 = S({ lang: z.enum(['js', 'ts']), title_ko: z.string().max(120), task_md: z.string().max(8000), starter: z.string().max(20_000),
  tests: z.array(S({ key: ObjKey, input_json: z.string().max(8000), expected_json: z.string().max(8000), hidden: z.boolean() })).min(1).max(30),
  reference_code: z.string().max(20_000), complexity_target: z.string().max(20).nullable() });     // 실행은 러너(출처 t3 → 403, V4 통과 후 seed)
export type CodeExerciseV1 = z.infer<typeof CodeExerciseV1>;
export const ExplanationV1 = S({ level: Level.nullable(), body_md: z.string().max(8000), why_md: z.string().max(4000).nullable(),
  per_option: z.array(Opt).max(6), cited_ku_ids: z.array(KuId).max(20) });
export type ExplanationV1 = z.infer<typeof ExplanationV1>;
export const ImportDraftV1 = S({
  concepts: z.array(S({ temp_key: ObjKey, title_ko: z.string().max(120), title_en: z.string().max(120), track_hint: TrackId.nullable(), level_hint: Level.nullable(),
    summary_ko: z.string().max(300), span: S({ chunk_key: ObjKey, start: z.number().int(), end: z.number().int() }) })).max(30),
  kus: z.array(S({ temp_key: ObjKey, concept_temp_key: ObjKey, statement_ko: z.string().max(1000), facet: Facet,
    span: S({ chunk_key: ObjKey, start: z.number().int(), end: z.number().int() }) })).max(200),
  misconceptions: z.array(S({ temp_key: ObjKey, concept_temp_key: ObjKey, wrong_belief_ko: z.string().max(500), correction_ko: z.string().max(1000),
    span: S({ chunk_key: ObjKey, start: z.number().int(), end: z.number().int() }) })).max(60),
  relations: z.array(S({ from: ObjKey, to: ObjKey, kind: z.enum(['prereq', 'related', 'contrast', 'part_of']) })).max(200),
});
export type ImportDraftV1 = z.infer<typeof ImportDraftV1>;
export const FeedbackV1 = S({ summary_md: z.string().max(4000), per_point: z.array(S({ key: ObjKey, note_md: z.string().max(1000) })).max(20), cited_ku_ids: z.array(KuId).max(20) });
export type FeedbackV1 = z.infer<typeof FeedbackV1>;
export const UtteranceV1 = S({ utterance_ko: z.string().max(600), move: DialogMove, reveals_answer: z.literal(false) });
export type UtteranceV1 = z.infer<typeof UtteranceV1>;
export const ItemVariantV1 = S({ variants: z.array(S({ stem_md: z.string().max(4000), options: z.array(Opt).max(6), answer_keys: z.array(ObjKey).max(4) })).min(1).max(5) });
export type ItemVariantV1 = z.infer<typeof ItemVariantV1>;
export const IndependentSolveV1 = S({ chosen_keys: z.array(ObjKey).max(4), answer_text: z.string().max(2000).nullable(), rationale_short: z.string().max(500), confidence: z.number().min(0).max(1) });
export type IndependentSolveV1 = z.infer<typeof IndependentSolveV1>;
export const ModelAnswerV1 = S({ body_md: z.string().max(20_000), kp_coverage: z.array(S({ key: ObjKey, covered: z.boolean() })).max(30) });
export type ModelAnswerV1 = z.infer<typeof ModelAnswerV1>;
export const LlmJudgeAnswersV1 = S({ answers: z.array(S({ question_key: ObjKey, type: z.enum(['noul', 'choice', 'score']),   // LJ 엔진 내부 스키마
  p_yes: z.number().min(0).max(1).nullable(), choice: ObjKey.nullable(), score: z.number().min(0).nullable(), confidence: z.number().min(0).max(1) })).min(1).max(15) });
export type LlmJudgeAnswersV1 = z.infer<typeof LlmJudgeAnswersV1>;
export const PORTABLE_SCHEMAS = { 'ai/ItemBatch@1': ItemBatchV1, 'ai/ScenarioItem@1': ScenarioItemV1, 'ai/CodeExercise@1': CodeExerciseV1,
  'ai/Explanation@1': ExplanationV1, 'ai/ImportDraft@1': ImportDraftV1, 'ai/Feedback@1': FeedbackV1, 'ai/Utterance@1': UtteranceV1,
  'ai/ItemVariant@1': ItemVariantV1, 'ai/IndependentSolve@1': IndependentSolveV1, 'ai/ModelAnswer@1': ModelAnswerV1, 'ai/Rubric@1': RubricV1,
  'ai/LlmJudgeAnswers@1': LlmJudgeAnswersV1 } as const;
