import { S } from '@fathom/contracts/common/schema';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { DesignSystemPage } from '../features/shell/chrome/design-system/design-page.js';
import { safeSearch } from '../lib/search.js';

const DesignSearch = S({
  theme: z.enum(['dark', 'light']).optional(),
  contrast: z.enum(['more']).optional(),
});

export const Route = createFileRoute('/_design')({
  validateSearch: safeSearch(DesignSearch),
  component: DesignSystemPage,
});
