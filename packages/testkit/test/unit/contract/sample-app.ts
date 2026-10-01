import { defineRoute } from '@fathom/contracts/common/route';
import { S } from '@fathom/contracts/common/schema';
import { z } from 'zod';
import type { FakeRoute } from './fake-server.js';

export const Thing = S({ id: z.string(), name: z.string() });
export const CreateThing = defineRoute({
  id: 'learning.things.create',
  ifId: 'IF-LR-9001',
  method: 'POST',
  path: '/internal/v1/things',
  allowedCallers: ['gateway'],
  idempotent: true,
  paginated: false,
  request: { body: S({ name: z.string(), count: z.number().int() }) },
  response: { 201: Thing },
  freeze: 'D',
  slice: 'R0',
  fr: [],
});
export const ListThings = defineRoute({
  id: 'learning.things.list',
  ifId: 'IF-LR-9002',
  method: 'GET',
  path: '/internal/v1/things',
  allowedCallers: ['gateway', 'learning'],
  idempotent: false,
  paginated: true,
  request: { query: S({ limit: z.string() }) },
  response: { 200: S({ items: z.array(Thing), next_cursor: z.string().nullable() }) },
  freeze: 'D',
  slice: 'R0',
  fr: [],
});
export const GetThing = defineRoute({
  id: 'learning.things.get',
  ifId: 'IF-LR-9003',
  method: 'GET',
  path: '/internal/v1/things/{thing_id}',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: false,
  request: { params: S({ thing_id: z.string() }) },
  response: { 200: Thing },
  freeze: 'D',
  slice: 'R0',
  fr: [],
});
export const QuestionView = S({
  item_id: z.string(),
  choices: z.array(S({ key: z.string(), correct_option: z.boolean() })),
});
export const SafeView = S({ item_id: z.string(), choices: z.array(S({ key: z.string() })) });
export const GetQuestion = defineRoute({
  id: 'learning.questions.get',
  ifId: 'IF-LR-9004',
  method: 'GET',
  path: '/internal/v1/questions/{item_id}',
  allowedCallers: ['gateway'],
  idempotent: false,
  paginated: false,
  request: {},
  response: { 200: QuestionView },
  freeze: 'D',
  slice: 'R0',
  fr: [],
});

export const sampleRoutes: FakeRoute[] = [
  {
    route: CreateThing,
    respond: ({ body }) => ({
      status: 201,
      body: { id: 'x1', name: typeof body === 'object' && body !== null && 'name' in body ? String(body.name) : 'n' },
    }),
  },
  {
    route: ListThings,
    respond: () => ({ status: 200, body: { items: [{ id: 'x1', name: 'n' }], next_cursor: null } }),
  },
  { route: GetThing, respond: ({ params }) => ({ status: 200, body: { id: params.thing_id ?? '', name: 'n' } }) },
  {
    route: GetQuestion,
    respond: () => ({ status: 200, body: { item_id: 'q1', choices: [{ key: 'a', correct_option: true }] } }),
  },
];
