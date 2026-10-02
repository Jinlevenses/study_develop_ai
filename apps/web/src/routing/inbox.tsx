import { S } from '@fathom/contracts/common/schema';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { RouteStub } from '../features/shell/chrome/route-stub.js';
import { safeSearch } from '../lib/search.js';

const InboxSearch = S({
  tab: z.enum(['inbox', 'imports']).optional(),
  state: z.coerce.string().max(40).optional(),
});

export const Route = createFileRoute('/inbox')({
  validateSearch: safeSearch(InboxSearch),
  component: () => <RouteStub scr="SCR-12" title="Inbox" />,
});
