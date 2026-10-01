import { z } from 'zod';
import { JudgeAnswer, JudgeState } from '../../../ai/judge.js';
import { JudgeTaskId } from '../../../ai/tasks.js';
import { Sp1State } from '../../../common/domain.js';
import { GoldId, ObjKey, SemVer, Ulid } from '../../../common/ids.js';
import { NdjsonEnd } from '../../../common/ndjson.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';
import { EpochMs } from '../../../common/time.js';
import { JobView } from './jobs.js';

export const CalibrationStatus = S({
  task_id: JudgeTaskId,
  engine: z.enum(['J', 'LJ']),
  calibrated: z.boolean(),
  sp1_state: Sp1State,
  gold: S({ draft: z.number().int(), confirmed: z.number().int(), required: z.number().int() }),
  metrics: S({
    idea_unit_accuracy: z.number().nullable(),
    precision_at_conf06: z.number().nullable(),
    rubric_kappa: z.number().nullable(),
    paraphrase: z.number().nullable(),
    verbosity_bias: z.number().nullable(),
  }).nullable(),
  model_version: z.string().max(80).nullable(),
  drift: z.boolean(),
  last_run_at: EpochMs.nullable(),
});
export type CalibrationStatus = z.infer<typeof CalibrationStatus>;
export const CalibrationStatusList = S({ tasks: z.array(CalibrationStatus).max(19) });
export type CalibrationStatusList = z.infer<typeof CalibrationStatusList>;
export const ConfirmCard = S({
  gold_id: GoldId,
  task_id: JudgeTaskId,
  question_key: ObjKey,
  prompt_ko: z.string().max(300),
  state_preview_md: z.string().max(4000),
  model_label: JudgeAnswer,
});
export type ConfirmCard = z.infer<typeof ConfirmCard>;
export const ConfirmCardList = S({ cards: z.array(ConfirmCard).max(3), remaining_today: z.number().int().min(0) }); // 하루 ≤ 3
export type ConfirmCardList = z.infer<typeof ConfirmCardList>;
export const ConfirmGoldBody = S({
  decision: z.enum(['confirm', 'correct', 'skip']),
  corrected_label: JudgeAnswer.nullable(),
});
export type ConfirmGoldBody = z.infer<typeof ConfirmGoldBody>;
export const GoldItemView = S({
  gold_id: GoldId,
  task_id: JudgeTaskId,
  state: z.enum(['model_labeled_draft', 'user_confirmed', 'user_corrected', 'skipped']),
  updated_at: EpochMs,
});
export type GoldItemView = z.infer<typeof GoldItemView>;
export const RunCalibrationBody = S({ job_id: Ulid, task_id: JudgeTaskId, work_order_id: Ulid });
export type RunCalibrationBody = z.infer<typeof RunCalibrationBody>;
export const GoldExportLine = z.discriminatedUnion('kind', [
  S({ kind: z.literal('header'), v: z.literal(1), generated_at: EpochMs, since: EpochMs.nullable() }),
  S({
    kind: z.literal('gold'),
    item: S({
      gold_id: GoldId,
      task_id: JudgeTaskId,
      template_version: SemVer,
      state: JudgeState,
      question_key: ObjKey,
      label: JudgeAnswer,
      label_state: z.enum(['user_confirmed', 'user_corrected']),
      confirmed_at: EpochMs,
    }),
  }),
  NdjsonEnd,
]);
export type GoldExportLine = z.infer<typeof GoldExportLine>;
export const GoldImportResult = S({ import_id: Ulid, inserted: z.number().int(), skipped: z.number().int() });
export type GoldImportResult = z.infer<typeof GoldImportResult>;
export const ConfirmCardsQuery = S({ limit: z.coerce.number().int().min(1).max(3).default(3) });
export type ConfirmCardsQuery = z.infer<typeof ConfirmCardsQuery>;
export const GoldExportQuery = S({ since: z.coerce.number().int().min(0).optional() });
export type GoldExportQuery = z.infer<typeof GoldExportQuery>;
export const GoldImportQuery = S({ import_id: Ulid });
export type GoldImportQuery = z.infer<typeof GoldImportQuery>;
export const CalibrationStatusRoute = defineRoute({
  id: 'ai-gateway.calibration.status',
  ifId: 'IF-AI-042',
  method: 'GET',
  path: '/internal/v1/calibration',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: CalibrationStatusList },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-013', 'FR-AI-014'],
});
export const CalibrationConfirmCardsRoute = defineRoute({
  id: 'ai-gateway.calibration.confirm_cards',
  ifId: 'IF-AI-043',
  method: 'GET',
  path: '/internal/v1/calibration/confirm-cards',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: false,
  request: { query: ConfirmCardsQuery },
  response: { 200: ConfirmCardList },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-013', 'FR-AI-027'],
});
export const CalibrationGoldExportRoute = defineRoute({
  id: 'ai-gateway.calibration.gold_export',
  ifId: 'IF-AI-044',
  method: 'GET',
  path: '/internal/v1/calibration/gold/export',
  allowedCallers: ['ops-api'],
  idempotent: false,
  paginated: false,
  request: { query: GoldExportQuery },
  response: { 200: GoldExportLine },
  responseKind: 'ndjson',
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-SET-004', 'FR-SET-006'],
});
// idem = import_id
export const CalibrationGoldImportRoute = defineRoute({
  id: 'ai-gateway.calibration.gold_import',
  ifId: 'IF-AI-045',
  method: 'POST',
  path: '/internal/v1/calibration/gold/import',
  allowedCallers: ['ops-api'],
  idempotent: true,
  paginated: false,
  request: { query: GoldImportQuery, body: GoldExportLine, bodyKind: 'ndjson' },
  response: { 200: GoldImportResult },
  bodyLimitBytes: 8_589_934_592,
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-SET-006', 'FR-SET-022'],
});
export const CalibrationGoldConfirmRoute = defineRoute({
  id: 'ai-gateway.calibration.gold_confirm',
  ifId: 'IF-AI-046',
  method: 'POST',
  path: '/internal/v1/calibration/gold/{gold_id}:confirm',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { params: S({ gold_id: GoldId }), body: ConfirmGoldBody },
  response: { 200: GoldItemView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-027'],
});
// idem = job_id
export const CalibrationRunRoute = defineRoute({
  id: 'ai-gateway.calibration.run',
  ifId: 'IF-AI-047',
  method: 'POST',
  path: '/internal/v1/calibration:run',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { body: RunCalibrationBody },
  response: { 202: JobView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-AI-014', 'D-14'],
});
export const AI_CALIBRATION_ROUTES = [
  CalibrationStatusRoute,
  CalibrationConfirmCardsRoute,
  CalibrationGoldExportRoute,
  CalibrationGoldImportRoute,
  CalibrationGoldConfirmRoute,
  CalibrationRunRoute,
] as const;
