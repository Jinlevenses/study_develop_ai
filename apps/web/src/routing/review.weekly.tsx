import { S } from '@fathom/contracts/common/schema';
import { IsoWeek } from '@fathom/contracts/common/time';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { RouteStub } from '../features/shell/chrome/route-stub.js';
import { safeSearch } from '../lib/search.js';

const ReviewWeeklySearch = S({
  week: IsoWeek.optional(),
  tab: z.enum(['review', 'calibration', 'cards', 'radar']).optional(),
});

export const Route = createFileRoute('/review/weekly')({
  validateSearch: safeSearch(ReviewWeeklySearch),
  component: () => <RouteStub scr="SCR-10" title="주간 리뷰" />,
});
