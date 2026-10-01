import { z } from 'zod';
import { DegradedPart } from '../../../common/degraded.js';
import { Level, Lifecycle, MasteryStatus } from '../../../common/domain.js';
import { ConceptId, Sha256Hex, TrackId } from '../../../common/ids.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';
import { EpochMs } from '../../../common/time.js';
import { DepthMapQuery, MapLayer } from '../../learning/v1/insight.js';

// MapLayer·DepthMapQuery의 정본은 learning(`http/learning/v1/insight.ts`, IF-LR-056) — 아래는 그 정의를 옮겨 적은 것(파일은 learning에 둔다).
//   export const MapLayer = z.enum(['mastery', 'retention', 'illusion', 'foundation_crack', 'revalidation', 'rusty', 'blueprint']);
//   export const DepthMapQuery = S({ track: z.union([TrackId, z.literal('all')]).default('all'),
//     layers: z.string().regex(/^[a-z_]+(,[a-z_]+)*$/).optional(),        // 쉼표 목록(MapLayer)
//     as_of: z.coerce.number().int().min(0).optional(),                   // 과거 오버레이(FR-DSH-005)
//     blueprint_id: BlueprintId.optional() });
export const DepthMapView = S({
  track: z.union([TrackId, z.literal('all')]),
  as_of: EpochMs.nullable(),
  layers: z.array(MapLayer),
  layout: S({ version: Sha256Hex, width: z.number(), height: z.number() }),
  cells: z
    .array(
      S({
        concept_id: ConceptId,
        track: TrackId,
        level: Level,
        x: z.number(),
        y: z.number(), // 좌표 = IF-CT-011, 상태 = IF-LR-056
        lifecycle: Lifecycle,
        mastery: MasteryStatus,
        provisional: z.boolean(),
        retention: z.number().min(0).max(1).nullable(),
        rusty: z.boolean(),
        illusion: z.boolean(),
        foundation_crack: z.boolean(),
        needs_revalidation: z.boolean(),
        depth_ring: z.number().int().min(0).max(4),
        star: z.boolean(),
        blueprint_weight: z.number().min(0).nullable(),
      }),
    )
    .max(2000),
  edges: z.array(S({ from: ConceptId, to: ConceptId })).max(5000),
  degraded: z.array(DegradedPart),
});
export type DepthMapView = z.infer<typeof DepthMapView>;
// 하위 ⊕ IF-LR-056 + IF-CT-011
export const MapGetRoute = defineRoute({
  id: 'gateway.map.get',
  ifId: 'IF-GW-055',
  method: 'GET',
  path: '/api/v1/map',
  allowedCallers: ['browser'],
  idempotent: false,
  paginated: false,
  request: { query: DepthMapQuery },
  response: { 200: DepthMapView },
  deadlineMs: 1500,
  freeze: 'D',
  slice: 'R1',
  fr: ['FR-DSH-003~006', 'FR-CUR-024'],
});
export const GW_MAP_ROUTES = [MapGetRoute] as const;
