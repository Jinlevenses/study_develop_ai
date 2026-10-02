import { BlueprintId, ConceptId, TrackId } from '@fathom/contracts/common/ids';
import { S } from '@fathom/contracts/common/schema';
import { EpochMs } from '@fathom/contracts/common/time';
import { MapLayer } from '@fathom/contracts/http/learning/v1/insight';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { RouteStub } from '../features/shell/chrome/route-stub.js';
import { safeSearch } from '../lib/search.js';

const MapSearch = S({
  track: z.union([TrackId, z.literal('all')]).optional(),
  layers: z
    .string()
    .regex(/^[a-z_]+(,[a-z_]+)*$/)
    .refine((v) => v.split(',').every((layer) => MapLayer.safeParse(layer).success))
    .optional(),
  as_of: z.coerce.number().pipe(EpochMs).optional(),
  bp: BlueprintId.optional(),
  view: z.enum(['map', 'table']).optional(),
  focus: ConceptId.optional(),
  panel: z.enum(['tracks', 'paths']).optional(),
});

export const Route = createFileRoute('/map')({
  validateSearch: safeSearch(MapSearch),
  component: () => <RouteStub scr="SCR-04" title="지도" />,
});
