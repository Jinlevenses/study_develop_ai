import { Ulid } from '@fathom/contracts/common/ids';
import { S } from '@fathom/contracts/common/schema';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { RouteStub } from '../features/shell/chrome/route-stub.js';
import { safeSearch } from '../lib/search.js';

const SessionSearch = S({
  b: Ulid.optional(),
  view: z.enum(['player', 'report']).optional(),
});

export const Route = createFileRoute('/session/$sessionId')({
  validateSearch: safeSearch(SessionSearch),
  component: () => <RouteStub scr="SCR-02" title="세션 플레이어" />,
});
