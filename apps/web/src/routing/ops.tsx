import { Ulid } from '@fathom/contracts/common/ids';
import { S } from '@fathom/contracts/common/schema';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { RouteStub } from '../features/shell/chrome/route-stub.js';
import { safeSearch } from '../lib/search.js';

const OpsSearch = S({
  tab: z.enum(['health', 'backups', 'transfer', 'doctor', 'logs', 'tripwires']).optional(),
  cid: Ulid.optional(),
});

export const Route = createFileRoute('/ops')({
  validateSearch: safeSearch(OpsSearch),
  component: () => <RouteStub scr="SCR-16" title="운영 콘솔" />,
});
