import { S } from '@fathom/contracts/common/schema';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { RouteStub } from '../features/shell/chrome/route-stub.js';
import { safeSearch } from '../lib/search.js';

const SettingsSearch = S({
  section: z.enum(['profile', 'rhythm', 'schedule', 'policies', 'display', 'keys', 'notify', 'system']).optional(),
});

export const Route = createFileRoute('/settings')({
  validateSearch: safeSearch(SettingsSearch),
  component: () => <RouteStub scr="SCR-17" title="설정" />,
});
