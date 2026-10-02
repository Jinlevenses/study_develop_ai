import { S } from '@fathom/contracts/common/schema';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { RouteStub } from '../features/shell/chrome/route-stub.js';
import { safeSearch } from '../lib/search.js';

const CurationSearch = S({
  tab: z.enum(['reports', 'health', 'pending', 'conflicts', 'warming', 'staging']).optional(),
  state: z.coerce.string().max(40).optional(),
  flag: z.coerce.string().max(40).optional(),
});

export const Route = createFileRoute('/curation')({
  validateSearch: safeSearch(CurationSearch),
  component: () => <RouteStub scr="SCR-14" title="큐레이션" />,
});
