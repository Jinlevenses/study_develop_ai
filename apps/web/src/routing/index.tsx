import { S } from '@fathom/contracts/common/schema';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { RouteStub } from '../features/shell/chrome/route-stub.js';
import { safeSearch } from '../lib/search.js';

// TanStack 기본 파서가 '1'을 숫자로 바꾸므로 문자열로 되돌려 검증한다.
const ONE = z.coerce.string().pipe(z.literal('1'));

const IndexSearch = S({
  onboarding: ONE.optional(),
});

export const Route = createFileRoute('/')({
  validateSearch: safeSearch(IndexSearch),
  component: () => <RouteStub scr="SCR-01" title="홈" />,
});
