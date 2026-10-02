import { S } from '@fathom/contracts/common/schema';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { RouteStub } from '../features/shell/chrome/route-stub.js';
import { safeSearch } from '../lib/search.js';

const AiSearch = S({
  tab: z.enum(['providers', 'usage', 'budget', 'work_orders', 'jobs', 'firewall', 'calibration']).optional(),
});

export const Route = createFileRoute('/ai')({
  validateSearch: safeSearch(AiSearch),
  component: () => <RouteStub scr="SCR-15" title="AI 연결·비용" />,
});
