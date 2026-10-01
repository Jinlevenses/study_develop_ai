import { z } from 'zod';
import { DegradedPart } from '../../../common/degraded.js';
import { Level } from '../../../common/domain.js';
import { ConceptId, TrackId, Ulid } from '../../../common/ids.js';
import { Page } from '../../../common/pagination.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';
import {
  BlueprintList,
  BlueprintView,
  ConceptSummary,
  ImportBlueprintBody,
  NeighborGraph,
  NeighborsQuery,
  OutdatedReportBody,
  OutdatedReportView,
  PathListView,
  SearchQuery,
  SearchResultView,
  SourceDrawer,
  TrackCap,
} from '../../content/v1/catalog.js';
import { OverlayEventView, OverlayListQuery, OverlayPatchBody, RevertOverlayBody } from '../../content/v1/overlays.js';
import { ConceptPageContentPreSubmit } from '../../content/v1/pre-submit/concept.js';
import {
  LearnerConceptMini,
  LearnerConceptState,
  LearnerTrackView,
  PromotionPreview,
} from '../../learning/v1/learner.js';

export const TrackListView = S({
  tracks: z
    .array(
      S({
        track: TrackId,
        title_ko: z.string(),
        title_en: z.string(),
        concept_counts: z.tuple([
          z.number().int(),
          z.number().int(),
          z.number().int(),
          z.number().int(),
          z.number().int(),
        ]), // L1~L5
        cap: TrackCap, // = IF-CT-004
        learner: S({
          level: Level.nullable(),
          provisional: z.boolean(),
          needs_reconfirmation: z.boolean(),
          mastered: z.number().int().min(0),
        }).nullable(),
      }),
    )
    .max(40),
  degraded: z.array(DegradedPart),
});
export type TrackListView = z.infer<typeof TrackListView>;
export const TrackView = S({
  track: TrackId,
  title_ko: z.string(),
  cap: TrackCap,
  levels: z
    .array(
      S({
        level: Level,
        concepts: z.array(S({ concept: ConceptSummary, learner: LearnerConceptMini.nullable() })), // ConceptSummary = IF-CT-005, LearnerConceptMini = IF-LR-044
      }),
    )
    .length(5),
  learner: LearnerTrackView.nullable(), // = IF-LR-044
  degraded: z.array(DegradedPart),
});
export type TrackView = z.infer<typeof TrackView>;
export const ConceptPageView = S({
  content: ConceptPageContentPreSubmit, // = IF-CT-006 (임베디드 질문은 정답 없음)
  learner: LearnerConceptState.nullable(), // = IF-LR-040 (learning 정지 시 null + degraded)
  entry_stage: z.enum(['theory', 'pretest', 'problem', 'problem_definition']), // = learner.entry_stage 복사(learning 정지 시 'theory')
  degraded: z.array(DegradedPart),
});
export type ConceptPageView = z.infer<typeof ConceptPageView>;

// [Brief 결정 §4.3] 표에 스키마 이름이 없는 쿼리(이름 고정)
export const TrackViewQuery = S({ level: z.coerce.number().int().min(1).max(5).optional() });
export type TrackViewQuery = z.infer<typeof TrackViewQuery>;

// 하위 ⊕ IF-CT-004 + IF-LR-043
export const TracksListRoute = defineRoute({
  id: 'gateway.tracks.list',
  ifId: 'IF-GW-040',
  method: 'GET',
  path: '/api/v1/tracks',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: TrackListView },
  freeze: 'D',
  slice: 'R0',
  fr: ['FR-CUR-001', 'FR-CUR-025', 'FR-PRG-013'],
});
// 하위 ⊕ IF-CT-005(전 레벨) + IF-LR-044
export const TracksGetRoute = defineRoute({
  id: 'gateway.tracks.get',
  ifId: 'IF-GW-041',
  method: 'GET',
  path: '/api/v1/tracks/{track}',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: { params: S({ track: TrackId }), query: TrackViewQuery },
  response: { 200: TrackView },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-CUR-001', 'FR-CUR-025', 'FR-STD-032'],
});
// 하위 = IF-CT-010
export const PathsListRoute = defineRoute({
  id: 'gateway.paths.list',
  ifId: 'IF-GW-042',
  method: 'GET',
  path: '/api/v1/paths',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: PathListView },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-CUR-019'],
});
// 하위 ⊕ IF-CT-006 + IF-LR-040
export const ConceptsGetRoute = defineRoute({
  id: 'gateway.concepts.get',
  ifId: 'IF-GW-043',
  method: 'GET',
  path: '/api/v1/concepts/{concept_id}',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: { params: S({ concept_id: ConceptId }) },
  response: { 200: ConceptPageView },
  freeze: 'D',
  slice: 'R0',
  fr: ['FR-CUR-005~008', 'FR-CUR-012', 'FR-CUR-018', 'FR-PRG-010', 'FR-PRG-011', 'FR-DSH-006'],
});
// 하위 = IF-CT-008
export const ConceptsNeighborsRoute = defineRoute({
  id: 'gateway.concepts.neighbors',
  ifId: 'IF-GW-044',
  method: 'GET',
  path: '/api/v1/concepts/{concept_id}/neighbors',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: { params: S({ concept_id: ConceptId }), query: NeighborsQuery },
  response: { 200: NeighborGraph },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-CUR-018'],
});
// 하위 = IF-CT-009
export const ConceptsSourcesRoute = defineRoute({
  id: 'gateway.concepts.sources',
  ifId: 'IF-GW-045',
  method: 'GET',
  path: '/api/v1/concepts/{concept_id}/sources',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: { params: S({ concept_id: ConceptId }) },
  response: { 200: SourceDrawer },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-CUR-012', 'FR-CUR-021'],
});
// 하위 = IF-CT-013
export const OverlaysListRoute = defineRoute({
  id: 'gateway.overlays.list',
  ifId: 'IF-GW-046',
  method: 'GET',
  path: '/api/v1/overlays',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: true,
  request: { query: OverlayListQuery },
  response: { 200: Page(OverlayEventView) },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-CUR-020'],
});
// idem = patch_id
// 하위 = IF-CT-014
export const OverlaysCreateRoute = defineRoute({
  id: 'gateway.overlays.create',
  ifId: 'IF-GW-047',
  method: 'POST',
  path: '/api/v1/overlays',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { body: OverlayPatchBody },
  response: { 201: OverlayEventView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-CUR-020', 'FR-QST-016'],
});
// 하위 = IF-CT-015
export const OverlaysRevertRoute = defineRoute({
  id: 'gateway.overlays.revert',
  ifId: 'IF-GW-048',
  method: 'POST',
  path: '/api/v1/overlays/{patch_id}:revert',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ patch_id: Ulid }), body: RevertOverlayBody },
  response: { 201: OverlayEventView },
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-CUR-020'],
});
// 하위 = IF-CT-022
export const ConceptsOutdatedReportRoute = defineRoute({
  id: 'gateway.concepts.outdated_report',
  ifId: 'IF-GW-049',
  method: 'POST',
  path: '/api/v1/concepts/{concept_id}/outdated-reports',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { params: S({ concept_id: ConceptId }), body: OutdatedReportBody },
  response: { 201: OutdatedReportView },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-CUR-014'],
});
// 하위 = IF-CT-012
export const SearchQueryRoute = defineRoute({
  id: 'gateway.search.query',
  ifId: 'IF-GW-050',
  method: 'GET',
  path: '/api/v1/search',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: { query: SearchQuery },
  response: { 200: SearchResultView },
  deadlineMs: 1000,
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-CUR-011', 'FR-UX-005'],
});
// 하위 = IF-CT-020
export const BlueprintsListRoute = defineRoute({
  id: 'gateway.blueprints.list',
  ifId: 'IF-GW-052',
  method: 'GET',
  path: '/api/v1/blueprints',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: BlueprintList },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-CUR-024', 'FR-PRG-019'],
});
// 하위 = IF-CT-021
export const BlueprintsImportRoute = defineRoute({
  id: 'gateway.blueprints.import',
  ifId: 'IF-GW-053',
  method: 'POST',
  path: '/api/v1/blueprints:import',
  allowedCallers: ['browser'],
  idempotent: true,
  paginated: false,
  request: { body: ImportBlueprintBody },
  response: { 201: BlueprintView },
  freeze: 'O',
  slice: 'R3',
  fr: ['FR-CUR-024', 'AQ-13'],
});
// 하위 = IF-LR-045
export const PromotionGetRoute = defineRoute({
  id: 'gateway.promotion.get',
  ifId: 'IF-GW-051',
  method: 'GET',
  path: '/api/v1/promotion/{track}',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: { params: S({ track: TrackId }) },
  response: { 200: PromotionPreview },
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-PRG-012', 'FR-PRG-013', 'FR-PRG-032', 'FR-PRG-033', 'FR-CUR-025'],
});
export const GW_CONCEPTS_ROUTES = [
  TracksListRoute,
  TracksGetRoute,
  PathsListRoute,
  ConceptsGetRoute,
  ConceptsNeighborsRoute,
  ConceptsSourcesRoute,
  OverlaysListRoute,
  OverlaysCreateRoute,
  OverlaysRevertRoute,
  ConceptsOutdatedReportRoute,
  SearchQueryRoute,
  BlueprintsListRoute,
  BlueprintsImportRoute,
  PromotionGetRoute,
] as const;
