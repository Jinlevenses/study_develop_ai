import { z } from 'zod';
import { JudgeAnswer, JudgeState } from '../../../ai/judge.js';
import { JudgeTaskId } from '../../../ai/tasks.js';
import { Sp1State } from '../../../common/domain.js';
import { GoldId, ObjKey, SemVer, Ulid } from '../../../common/ids.js';
import { NdjsonEnd } from '../../../common/ndjson.js';
import { S } from '../../../common/schema.js';
import { EpochMs } from '../../../common/time.js';

export const CalibrationStatus = S({
  task_id: JudgeTaskId, engine: z.enum(['J', 'LJ']), calibrated: z.boolean(), sp1_state: Sp1State,
  gold: S({ draft: z.number().int(), confirmed: z.number().int(), required: z.number().int() }),
  metrics: S({ idea_unit_accuracy: z.number().nullable(), precision_at_conf06: z.number().nullable(), rubric_kappa: z.number().nullable(),
    paraphrase: z.number().nullable(), verbosity_bias: z.number().nullable() }).nullable(),
  model_version: z.string().max(80).nullable(), drift: z.boolean(), last_run_at: EpochMs.nullable(),
});
export type CalibrationStatus = z.infer<typeof CalibrationStatus>;
export const CalibrationStatusList = S({ tasks: z.array(CalibrationStatus).max(19) });
export type CalibrationStatusList = z.infer<typeof CalibrationStatusList>;
export const ConfirmCard = S({ gold_id: GoldId, task_id: JudgeTaskId, question_key: ObjKey, prompt_ko: z.string().max(300),
  state_preview_md: z.string().max(4000), model_label: JudgeAnswer });
export type ConfirmCard = z.infer<typeof ConfirmCard>;
export const ConfirmCardList = S({ cards: z.array(ConfirmCard).max(3), remaining_today: z.number().int().min(0) });   // 하루 ≤ 3
export type ConfirmCardList = z.infer<typeof ConfirmCardList>;
export const ConfirmGoldBody = S({ decision: z.enum(['confirm', 'correct', 'skip']), corrected_label: JudgeAnswer.nullable() });
export type ConfirmGoldBody = z.infer<typeof ConfirmGoldBody>;
export const GoldItemView = S({ gold_id: GoldId, task_id: JudgeTaskId, state: z.enum(['model_labeled_draft', 'user_confirmed', 'user_corrected', 'skipped']), updated_at: EpochMs });
export type GoldItemView = z.infer<typeof GoldItemView>;
export const RunCalibrationBody = S({ job_id: Ulid, task_id: JudgeTaskId, work_order_id: Ulid });
export type RunCalibrationBody = z.infer<typeof RunCalibrationBody>;
export const GoldExportLine = z.discriminatedUnion('kind', [
  S({ kind: z.literal('header'), v: z.literal(1), generated_at: EpochMs, since: EpochMs.nullable() }),
  S({ kind: z.literal('gold'), item: S({ gold_id: GoldId, task_id: JudgeTaskId, template_version: SemVer, state: JudgeState, question_key: ObjKey,
    label: JudgeAnswer, label_state: z.enum(['user_confirmed', 'user_corrected']), confirmed_at: EpochMs }) }),
  NdjsonEnd,
]);
export type GoldExportLine = z.infer<typeof GoldExportLine>;
export const GoldImportResult = S({ import_id: Ulid, inserted: z.number().int(), skipped: z.number().int() });
export type GoldImportResult = z.infer<typeof GoldImportResult>;
