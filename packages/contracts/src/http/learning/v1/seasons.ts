import { z } from 'zod';
import { Level } from '../../../common/domain.js';
import { PolicyRef, TrackId, Ulid } from '../../../common/ids.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';
import { EpochMs, StudyDay } from '../../../common/time.js';

export const CreateSeasonBody = S({
  season_id: Ulid,
  starts_on: StudyDay,
  weeks: z.number().int().min(6).max(8),
  goals: z
    .array(S({ track: TrackId, target_level: Level }))
    .min(1)
    .max(6),
  premortem_ko: z.array(z.string().max(300)).max(5),
});
export type CreateSeasonBody = z.infer<typeof CreateSeasonBody>;
export const CloseSeasonBody = S({ retro_md: z.string().max(8000) });
export type CloseSeasonBody = z.infer<typeof CloseSeasonBody>;
export const LdiSummary = S({
  value: z.number(),
  delta: z.number().nullable(),
  params: PolicyRef,
  params_provisional: z.boolean(),
  computed_at: EpochMs,
});
export type LdiSummary = z.infer<typeof LdiSummary>;
export const SeasonView = S({
  season: S({
    season_id: Ulid,
    starts_on: StudyDay,
    ends_on: StudyDay,
    weeks: z.number().int(),
    state: z.enum(['active', 'closed']),
    goals: z.array(
      S({
        track: TrackId,
        target_level: Level,
        probability: z.number().min(0).max(1).nullable(),
        required_minutes_per_week: z.number().int().nullable(),
      }),
    ),
    premortem_ko: z.array(z.string()),
    retro_md: z.string().nullable(),
  }).nullable(),
  history: z
    .array(S({ season_id: Ulid, starts_on: StudyDay, ends_on: StudyDay, achieved_ratio: z.number().min(0).max(1) }))
    .max(100),
  ldi: LdiSummary.nullable(), // FR-DSH-011: LDI 숫자는 주간 리뷰·시즌 회고에서만
});
export type SeasonView = z.infer<typeof SeasonView>;
// idem = season_id
export const PracticeSeasonsCreateRoute = defineRoute({
  id: 'learning.practice.seasons.create',
  ifId: 'IF-LR-032',
  method: 'POST',
  path: '/internal/v1/practice/seasons',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { body: CreateSeasonBody },
  response: { 201: SeasonView },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-DSH-012'],
});
export const PracticeSeasonsCloseRoute = defineRoute({
  id: 'learning.practice.seasons.close',
  ifId: 'IF-LR-033',
  method: 'POST',
  path: '/internal/v1/practice/seasons/{season_id}:close',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { params: S({ season_id: Ulid }), body: CloseSeasonBody },
  response: { 200: SeasonView },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-DSH-012'],
});
export const LR_SEASONS_ROUTES = [PracticeSeasonsCreateRoute, PracticeSeasonsCloseRoute] as const;
