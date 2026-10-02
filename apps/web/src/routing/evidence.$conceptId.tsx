import { S } from '@fathom/contracts/common/schema';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { RouteStub } from '../features/shell/chrome/route-stub.js';
import { safeSearch } from '../lib/search.js';

const EvidenceSearch = S({
  tab: z.enum(['gates', 'events', 'cards']).optional(),
});

export const Route = createFileRoute('/evidence/$conceptId')({
  validateSearch: safeSearch(EvidenceSearch),
  component: () => <RouteStub scr="SCR-05" title="증거 원장" />,
});
