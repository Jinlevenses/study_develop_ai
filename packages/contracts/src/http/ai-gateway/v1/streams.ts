import { z } from 'zod';
import { Ulid } from '../../../common/ids.js';
import { defineRoute } from '../../../common/route.js';
import { S } from '../../../common/schema.js';

export const StreamsGetRoute = defineRoute({
  id: 'ai-gateway.streams.get',
  ifId: 'IF-AI-003',
  method: 'GET',
  path: '/internal/v1/streams/{ref}',
  allowedCallers: ['content'],
  idempotent: false,
  paginated: false,
  request: { params: S({ ref: Ulid }) },
  response: { 200: z.string() },
  responseKind: 'sse',
  deadlineMs: 120000,
  freeze: 'O',
  slice: 'R2',
  fr: ['FR-STD-020', 'FR-QST-023', 'IR-016'],
});
export const AI_STREAMS_ROUTES = [StreamsGetRoute] as const;
