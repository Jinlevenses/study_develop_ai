import { S } from '@fathom/contracts/common/schema';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { RouteStub } from '../features/shell/chrome/route-stub.js';
import { safeSearch } from '../lib/search.js';

// TanStack 기본 파서가 '1'을 숫자로 바꾸므로 문자열로 되돌려 검증한다.
const ONE = z.coerce.string().pipe(z.literal('1'));

const ConceptSearch = S({
  tab: z.enum(['theory', 'code', 'core']).optional(),
  lens: z.coerce.number().int().min(1).max(5).optional(),
  edit: ONE.optional(),
  src: ONE.optional(),
});

export const Route = createFileRoute('/concepts/$conceptId')({
  validateSearch: safeSearch(ConceptSearch),
  component: () => <RouteStub scr="SCR-03" title="개념 페이지" />,
});
